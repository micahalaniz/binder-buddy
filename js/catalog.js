// Card lookup + live prices from free, open community databases (no keys, no accounts):
//   Pokémon:        TCGdex      https://tcgdex.dev   (TCGplayer + Cardmarket prices)
//   Disney Lorcana: Lorcast     https://lorcast.com  (daily TCGplayer prices)
//   One Piece:      OPTCG API   https://optcgapi.com (TCGplayer market prices + 2-week history)
//   Magic:          Scryfall    https://scryfall.com (daily TCGplayer prices; card images © Wizards of the Coast)
//   Yu-Gi-Oh!:      YGOPRODeck  https://ygoprodeck.com (prices per printing; no card pictures, as they ask)
// Every result is turned into one shape:
//   {game, src, id, name, set, num, rarity, img, imgLg, tcgId, variants: {key: usd}, v, market, trend}
import { mapRarity, normNum, GAMES } from "./logic.js";
import { cacheGet, cacheSet } from "./store.js";
import { sleep } from "./util.js";

const HOUR = 3600e3, DAY = 24 * HOUR;
const TCGDEX = "https://api.tcgdex.net/v2/en", LORCAST = "https://api.lorcast.com/v0", OPTCG = "https://optcgapi.com/api";

// Ask a card database. If it says "slow down" (429) or is having a moment (5xx), wait a little longer each
// time and try again; if it's gone for good (404), return null. Each try gives up after 15 seconds (big lists: 90).
async function getJSON(url, tries = 3, ms = 15000, init = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      if (navigator.onLine === false) throw new Error("offline");
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
      let r;
      try { r = await fetch(url, {...init, signal: ctl.signal}); } finally { clearTimeout(timer); }
      if (r.status === 404) return null;
      if (r.status === 429 || r.status >= 500) {
        const wait = Math.min(10, +r.headers.get("Retry-After") || 0) * 1000 || 800 * 3 ** i;
        if (i < tries - 1) { await sleep(wait); continue; }
      }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { if (i === tries - 1 || e.message === "offline") throw e; await sleep(600 * (i + 1)); }
  }
}

export const VARIANT_NAMES = {
  "normal": "Normal", "holofoil": "Holo", "reverse-holofoil": "Reverse holo", "1st-edition-holofoil": "1st Edition holo",
  "1st-edition-normal": "1st Edition", "unlimited-holofoil": "Unlimited holo", "unlimited": "Unlimited", "foil": "Foil", "etched": "Foil etched",
};
const round = n => Math.round(n * 100) / 100;

// ================================================================== Pokémon (TCGdex)
let pkSets = null;
async function pokemonSets() {
  if (pkSets) return pkSets;
  let data = await cacheGet("pk-sets", 3 * DAY);
  if (!data) {
    const [sets, pocket] = await Promise.all([getJSON(TCGDEX + "/sets"), getJSON(TCGDEX + "/series/tcgp").catch(() => null)]);
    const skip = new Set(((pocket && pocket.sets) || []).map(s => s.id));
    data = (sets || []).filter(s => !skip.has(s.id)).map((s, i) => ({id: s.id, name: s.name, official: s.cardCount && s.cardCount.official, order: i}));
    cacheSet("pk-sets", data);
  }
  pkSets = new Map(data.map(s => [s.id, s]));
  return pkSets;
}
const pkSetOf = id => id.slice(0, id.lastIndexOf("-"));
/** Pokémon sets whose printed card count matches, newest first (for "025/165" style codes). */
/** Every card in a Pokémon set: [{id, localId, name}]. Kept for a day. */
const pkSetCards = new Map();
export async function pokemonSetCards(setId) {
  if (!pkSetCards.has(setId)) pkSetCards.set(setId, getJSON(`${TCGDEX}/sets/${encodeURIComponent(setId)}`).then(s => (s && s.cards) || []).catch(e => { pkSetCards.delete(setId); throw e; }));
  return pkSetCards.get(setId);
}
export async function pokemonSetsByTotal(total) {
  const sets = await pokemonSets(), t = +String(total).replace(/\D/g, "");
  return [...sets.values()].filter(s => +s.official === t).sort((a, b) => b.order - a.order);
}

// Name lists are kept for a few minutes so typing "Pikachu", "Pikachu 1", "Pikachu 151" asks the database once.
const pkNameCache = new Map();
function pkByName(name) {
  const k = name.toLowerCase();
  if (!pkNameCache.has(k)) {
    pkNameCache.set(k, getJSON(`${TCGDEX}/cards?name=${encodeURIComponent(name)}&pagination:itemsPerPage=1000`).then(l => l || []).catch(e => { pkNameCache.delete(k); throw e; }));
    setTimeout(() => pkNameCache.delete(k), 10 * 60 * 1000);
  }
  return pkNameCache.get(k);
}
function pkShape(c, s) {
  const official = s && s.official;
  return {game: "pokemon", src: "tcgdex", id: c.id, name: c.name, set: s ? s.name : pkSetOf(c.id), order: s ? s.order : 1e6,
    num: c.localId + (official ? "/" + String(official).padStart(String(c.localId).length, "0") : ""),
    img: c.image ? c.image + "/low.webp" : "", imgLg: c.image ? c.image + "/high.webp" : "", partial: true};
}
/**
 * Pokémon search. Understands: "Pikachu", "Pikachu 25", "Pikachu 025/165", "Charizard 151" (set),
 * "Umbreon ex Prismatic", "025/165" (just the number printed on the card). Shows every match, newest first.
 */
async function searchPokemon(text) {
  let sets = await pokemonSets();
  const code = text.match(/^#?([a-z]{0,3}\d{1,3})\s*\/\s*([a-z]{0,3}\d{2,3})$/i);
  if (code) {
    const ss = await pokemonSetsByTotal(code[2]);
    const found = await Promise.all(ss.slice(0, 20).map(s => pokemonSetCards(s.id).then(l => l.filter(c => normNum(c.localId) === normNum(code[1])).map(c => pkShape(c, s))).catch(() => [])));
    return found.flat();
  }
  const tokens = text.split(/\s+/).filter(Boolean);
  let fallback = null;
  for (let k = tokens.length; k >= 1; k--) {
    const name = tokens.slice(0, k).join(" "), rest = tokens.slice(k);
    if (name.length < 2) continue;
    let list = await pkByName(name);
    if (!list.length) continue;
    // a brand-new set this device hasn't heard of yet: get the set list again (once)
    list = list.filter(c => !POCKET.test(pkSetOf(c.id)));
    if (!pkFresh && list.some(c => !sets.has(pkSetOf(c.id)))) { pkFresh = true; pkSets = null; await cacheSet("pk-sets", null); sets = await pokemonSets(); }
    const all = list.map(c => pkShape(c, sets.get(pkSetOf(c.id))));
    fallback = fallback || all;
    if (!rest.length) return sortPk(all);
    // every extra word must match the card number ("25", "025/165") or the set ("151", "Prismatic")
    const ok = (r, t) => {
      const [n, tot] = t.replace(/^#/, "").split("/"), [rn, rt] = String(r.num).split("/");
      if (/\d/.test(n) && normNum(n) === normNum(rn) && (!tot || normNum(tot) === normNum(rt))) return true;
      const st = (r.set + " " + pkSetOf(r.id)).toLowerCase();
      return st.includes(t.toLowerCase());
    };
    const hits = all.filter(r => rest.every(t => ok(r, t)));
    if (hits.length) {
      const exactNum = r => rest.some(t => normNum(t.split("/")[0]) === normNum(String(r.num).split("/")[0])) ? 0 : 1;
      return sortPk(hits).sort((a, b) => exactNum(a) - exactNum(b));
    }
  }
  return fallback ? sortPk(fallback) : [];
}
let pkFresh = false;
const POCKET = /^(A\d|P-A|B\d)/;   // TCG Pocket is a phone game, not printed cards
const sortPk = l => l.sort((a, b) => b.order - a.order).slice(0, 400);
async function pokemonCard(id) {
  const c = await getJSON(`${TCGDEX}/cards/${encodeURIComponent(id)}`);
  if (!c) return null;
  const tp = (c.pricing && c.pricing.tcgplayer) || {}, cm = (c.pricing && c.pricing.cardmarket) || null;
  const variants = {};
  let tcgId = null;
  for (const [k, v] of Object.entries(tp)) {
    if (v && typeof v === "object" && v.marketPrice != null) { variants[k] = round(v.marketPrice); tcgId = tcgId || v.productId; }
  }
  // Cardmarket's rolling averages give a free "where is it heading" signal.
  let trend = null;
  if (cm && cm.avg30 > 0 && cm.avg7 > 0) trend = {from: cm.avg30, to: cm.avg7, unit: "EUR", label: "Cardmarket 30-day vs 7-day average", pct: Math.round((cm.avg7 - cm.avg30) / cm.avg30 * 100)};
  const s = c.set || {};
  const official = s.cardCount && s.cardCount.official;
  const v = pickVariant(variants);
  return {game: "pokemon", src: "tcgdex", id: c.id, name: c.name, set: s.name || "", rarity: mapRarity("pokemon", c.rarity),
    num: c.localId + (official ? "/" + String(official).padStart(String(c.localId).length, "0") : ""),
    img: c.image ? c.image + "/low.webp" : "", imgLg: c.image ? c.image + "/high.webp" : "", tcgId, variants, v, market: v ? variants[v] : null, trend};
}
function pickVariant(variants, want) {
  if (want && variants[want] != null) return want;
  for (const k of ["holofoil", "normal", "1st-edition-holofoil", "unlimited-holofoil", "reverse-holofoil", "foil"]) if (variants[k] != null) return k;
  return Object.keys(variants)[0] || null;
}

// ================================================================== Lorcana (Lorcast)
function lorcastShape(c) {
  const variants = {};
  if (c.prices && c.prices.usd != null) variants.normal = round(+c.prices.usd);
  if (c.prices && c.prices.usd_foil != null) variants.foil = round(+c.prices.usd_foil);
  const im = (c.image_uris && c.image_uris.digital) || {};
  const v = pickVariant(variants);
  return {game: "lorcana", src: "lorcast", id: c.id, name: c.name + (c.version ? " - " + c.version : ""), set: c.set ? c.set.name : "",
    num: c.collector_number || "", rarity: mapRarity("lorcana", c.rarity), img: im.small || im.normal || "", imgLg: im.large || im.normal || "",
    tcgId: c.tcgplayer_id || null, variants, v, market: v ? variants[v] : null, setCode: c.set ? c.set.code : ""};
}
async function searchLorcana(q, num) {
  const d = await getJSON(`${LORCAST}/cards/search?q=${encodeURIComponent(q)}`);
  return ((d && d.results) || []).map(lorcastShape).filter(c => !num || normNum(c.num) === normNum(num)).slice(0, 60);
}
async function lorcanaCard(id) { const c = await getJSON(`${LORCAST}/cards/${encodeURIComponent(id)}`); return c ? lorcastShape(c) : null; }
export async function lorcanaBySetNum(set, num) { const c = await getJSON(`${LORCAST}/cards/${encodeURIComponent(set)}/${encodeURIComponent(num)}`); return c ? lorcastShape(c) : null; }

// ================================================================== One Piece (OPTCG API, whole list cached for a day)
let opAll = null;
export async function onePieceAll(force) {
  if (opAll && !force) return opAll;
  let data = force ? null : await cacheGet("op-all", 20 * HOUR);
  if (!data) {
    const parts = await Promise.all(["allSetCards", "allSTCards", "allPromos"].map(p => getJSON(`${OPTCG}/${p}/`, 3, 90000).catch(() => [])));
    data = parts.flat().filter(c => c && c.card_image_id).map(c => ({
      i: c.card_image_id, s: c.card_set_id, n: c.card_name, set: c.set_name, r: c.rarity, m: c.market_price, img: c.card_image}));
    if (data.length) cacheSet("op-all", data);
  }
  opAll = data;
  return opAll;
}
function opShape(c) {
  const variants = c.m != null ? {normal: round(+c.m)} : {};
  return {game: "onepiece", src: "optcg", id: c.i, code: c.s, name: c.n, set: c.set, num: c.s, rarity: mapRarity("onepiece", c.r, c.n),
    img: c.img, imgLg: c.img, tcgId: null, variants, v: c.m != null ? "normal" : null, market: c.m != null ? round(+c.m) : null};
}
async function searchOnePiece(q) {
  const all = await onePieceAll(), qq = q.toLowerCase().trim();
  const code = qq.toUpperCase().match(/\b(OP|ST|EB|PRB|P)\d{0,2}-\d{3}\b/);
  const words = qq.split(/\s+/).filter(Boolean);
  return all.filter(c => code ? c.s === code[0] : words.every(w => (c.n + " " + c.s + " " + c.set).toLowerCase().includes(w)))
    .slice(0, 60).map(opShape);
}
async function onePieceCard(id) { const c = (await onePieceAll()).find(x => x.i === id); return c ? opShape(c) : null; }
export async function onePieceByCode(code) { return (await onePieceAll()).filter(x => x.s === code).map(opShape); }
/** The last 2 weeks of TCGplayer market prices for one One Piece card (Day1 = newest). */
export async function onePieceHistory(id, code) {
  for (const kind of ["sets", "decks", "promos"]) {
    try {
      const rows = await getJSON(`${OPTCG}/${kind}/card/twoweeks/${encodeURIComponent(code)}/`, 1);
      const row = (rows || []).find(r => r.card_image_id === id);
      if (row) {
        const pts = [];
        for (let d = 14; d >= 1; d--) { const v = row["Day" + d + "_Market_Price"]; if (v != null) pts.push({d: -(d - 1), v: +v}); }
        return pts;
      }
    } catch (e) {}
  }
  return [];
}

// ================================================================== public API
/** Search one game's card database. Text like "pikachu 238" also filters by card number. */
// ================================================================== Magic: The Gathering (Scryfall)
// Scryfall's rules: free to use in apps that add value and don't paywall it; don't alter card images; space out requests.
const SCRY = "https://api.scryfall.com";
let scryNext = 0;
async function scry(url, init) {
  const slot = Math.max(Date.now(), scryNext); scryNext = slot + 110;          // about 9 requests a second at most
  if (slot > Date.now()) await sleep(slot - Date.now());
  return getJSON(url, 3, 15000, init);
}
function scryShape(c) {
  const im = c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || {};
  const p = c.prices || {}, variants = {};
  if (p.usd != null) variants.normal = round(+p.usd);
  if (p.usd_foil != null) variants.foil = round(+p.usd_foil);
  if (p.usd_etched != null) variants.etched = round(+p.usd_etched);
  const v = pickVariant(variants);
  return {game: "mtg", src: "scryfall", id: c.id, name: c.name, set: c.set_name || "", setCode: c.set || "", num: c.collector_number || "",
    rarity: mapRarity("mtg", c.rarity), img: im.small || im.normal || "", imgLg: im.large || im.normal || "",
    tcgId: c.tcgplayer_id || null, variants, v, market: v ? variants[v] : null};
}
async function searchMagic(q, num) {
  const d = await scry(`${SCRY}/cards/search?q=${encodeURIComponent(q + (num ? " cn:" + num : ""))}&unique=prints&order=released&dir=desc`);
  return ((d && d.data) || []).slice(0, 60).map(scryShape);
}
async function magicCard(id) { const c = await scry(`${SCRY}/cards/${encodeURIComponent(id)}`); return c ? scryShape(c) : null; }
/** Up to 75 cards in one request (used by the daily price update). */
async function magicMany(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 75) {
    try {
      const d = await scry(`${SCRY}/cards/collection`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({identifiers: ids.slice(i, i + 75).map(id => ({id}))})});
      for (const c of (d && d.data) || []) out.set(c.id, scryShape(c));
    } catch (e) {}
  }
  return out;
}

// ================================================================== Yu-Gi-Oh! (YGOPRODeck)
// Prices are per printing (set code + rarity). YGOPRODeck asks apps not to hotlink its card pictures,
// so Yu-Gi-Oh! cards show your own photo (or the name) instead, and we keep card data cached on the device.
const YGO = "https://db.ygoprodeck.com/api/v7";
let ygoNext = 0;
const ygoMem = new Map();
async function ygo(url) {
  const slot = Math.max(Date.now(), ygoNext); ygoNext = slot + 80;           // well under their 20 requests a second
  if (slot > Date.now()) await sleep(slot - Date.now());
  const d = await getJSON(url);
  return d;
}
// A printing is identified by what's printed on it: set code + rarity. (The database can give one card
// several ids, one per artwork, so ids aren't safe for matching.)
const ygoId = (cid, p) => `${p.set_code}~${p.set_rarity_code || p.set_rarity}`;
/** Which card has this set code (remembered on the device for a month). */
async function ygoCidByCode(code) {
  const k = "ygocode:" + code, hit = await cacheGet(k, 30 * DAY); if (hit) return hit;
  const one = await ygo(`${YGO}/cardsetsinfo.php?setcode=${encodeURIComponent(code)}`).catch(() => null);
  if (one && one.id) { cacheSet(k, one.id); return one.id; }
  return null;
}
function ygoShape(c, p) {
  const price = +p.set_price > 0 ? round(+p.set_price) : null;
  return {game: "ygo", src: "ygo", id: ygoId(c.id, p), name: c.name, set: p.set_name || "", setCode: p.set_name || "", num: p.set_code || "",
    rarity: mapRarity("ygo", p.set_rarity), img: "", imgLg: "", tcgId: null,
    variants: price != null ? {normal: price} : {}, v: price != null ? "normal" : null, market: price};
}
/** One card with all its printings, cached on the device for a day (YGOPRODeck asks apps to store data locally). */
function ygoCardRaw(cid) {
  if (!ygoMem.has(cid)) ygoMem.set(cid, (async () => {
    const hit = await cacheGet("ygo:" + cid, 20 * HOUR); if (hit) return hit;
    const d = await ygo(`${YGO}/cardinfo.php?id=${encodeURIComponent(cid)}`);
    const c = d && d.data && d.data[0];
    if (c) cacheSet("ygo:" + cid, {id: c.id, name: c.name, card_sets: c.card_sets || []});
    return c || null;
  })().catch(e => { ygoMem.delete(cid); throw e; }));
  return ygoMem.get(cid);
}
async function searchYgo(q) {
  const code = q.toUpperCase().match(/\b[A-Z0-9]{2,5}-[A-Z]{0,2}\d{3}\b/);
  if (code) return ygoByCode(code[0]);
  const d = await ygo(`${YGO}/cardinfo.php?fname=${encodeURIComponent(q)}&num=15&offset=0`).catch(e => { if (/HTTP 400/.test(e.message)) return null; throw e; });
  const out = [];
  for (const c of (d && d.data) || []) for (const p of c.card_sets || []) { out.push(ygoShape(c, p)); cacheSet("ygocode:" + p.set_code, c.id); }
  return out.slice(0, 60);
}
/** Every rarity printed with this set code, like LOB-EN001. */
export async function ygoByCode(code) {
  const cid = await ygoCidByCode(code); if (!cid) return [];
  const c = await ygoCardRaw(cid);
  return c ? (c.card_sets || []).filter(p => p.set_code === code).map(p => ygoShape(c, p)) : [];
}
async function ygoCard(id) {
  const [code, rar] = id.split("~");
  const cid = await ygoCidByCode(code); if (!cid) return null;
  const c = await ygoCardRaw(cid); if (!c) return null;
  const p = (c.card_sets || []).find(x => x.set_code === code && (x.set_rarity_code || x.set_rarity) === rar) || (c.card_sets || []).find(x => x.set_code === code);
  return p ? ygoShape(c, p) : null;
}

export async function search(game, text) {
  const t = String(text || "").trim();
  if (!t) return [];
  if (game === "onepiece") return searchOnePiece(t);
  if (game === "ygo") return searchYgo(t);
  const m = t.match(/^(.*?)(?:\s+#?([a-z]{0,3}\d{1,3})(?:\s*\/\s*[a-z]{0,3}\d{1,3})?)?$/i);
  const name = (m && m[1] || t).trim(), num = m && m[2];
  if (!name) return [];
  return game === "lorcana" ? searchLorcana(name, num) : game === "mtg" ? searchMagic(name, num) : searchPokemon(t);
}

/** Full details + prices for one card. */
export function card(src, id) {
  return src === "tcgdex" ? pokemonCard(id) : src === "lorcast" ? lorcanaCard(id) : src === "optcg" ? onePieceCard(id) : src === "scryfall" ? magicCard(id) : src === "ygo" ? ygoCard(id) : Promise.resolve(null);
}

/** Refresh prices for a list of saved items that came from a card database. onStep(done, total). */
export async function refreshPrices(items, onStep = () => {}) {
  const linked = items.filter(i => i.ref && i.ref.src);
  let done = 0, changed = 0, failed = 0;
  if (linked.some(i => i.ref.src === "optcg")) await onePieceAll(true).catch(() => {});
  const memo = new Map();
  const work = async it => {
    try {
      // the same card can be in your binder twice (two conditions) and on your wishlist: ask the database once
      const k = it.ref.src + ":" + it.ref.id;
      if (!memo.has(k)) memo.set(k, card(it.ref.src, it.ref.id));
      const d = await memo.get(k);
      if (d) {
        const v = pickVariant(d.variants, it.ref.v);
        // graded cards: the database price is for a raw (ungraded) copy, so keep it separately and never overwrite your graded value
        if (v && d.variants[v] != null) { if (it.cond === "Graded") it.raw = d.variants[v]; else it.market = d.variants[v]; changed++; }
        it.priced = new Date().toISOString();
        if (d.tcgId) it.tcgId = d.tcgId;
        if (d.trend) it.trend = d.trend;
        if (d.img) { it.img = d.img; it.imgLg = d.imgLg; }
        logPrice(it);
      }
    } catch (e) { failed++; }
    onStep(++done, linked.length);
  };
  // Pokémon: a few at a time. Lorcana: one at a time with a pause (Lorcast asks for 50–100 ms between calls).
  const pk = linked.filter(i => i.ref.src === "tcgdex"), lo = linked.filter(i => i.ref.src === "lorcast"), op = linked.filter(i => i.ref.src === "optcg");
  const pool = async (list, n) => { const q = [...list]; await Promise.all(Array.from({length: n}, async () => { while (q.length) await work(q.shift()); })); };
  // Magic: ask Scryfall for up to 75 cards at once, then fill each card from that answer
  const mt = linked.filter(i => i.ref.src === "scryfall");
  const magic = async () => {
    if (!mt.length) return;
    const got = await magicMany([...new Set(mt.map(i => i.ref.id))]);
    for (const it of mt) { if (got.has(it.ref.id)) memo.set("scryfall:" + it.ref.id, Promise.resolve(got.get(it.ref.id))); await work(it); }
  };
  const yg = linked.filter(i => i.ref.src === "ygo");   // Yu-Gi-Oh!: spaced out inside ygo(); one lookup per card covers all its printings
  // safety net: a card from any source not listed above still gets updated, slowly
  const other = linked.filter(i => !["tcgdex", "lorcast", "optcg", "scryfall", "ygo"].includes(i.ref.src));
  await Promise.all([pool(pk, 4), (async () => { for (const it of lo) { await work(it); await sleep(120); } })(), pool(op, 8), magic(), pool(yg, 2), pool(other, 1)]);
  return {total: linked.length, changed, failed};
}

/** Keep a small per-card price log on the device, one point per day. */
export function logPrice(it) {
  if (it.market === "" || it.market == null) return;
  const d = new Date().toISOString().slice(0, 10);
  it.ph = Array.isArray(it.ph) ? it.ph : [];
  const last = it.ph[it.ph.length - 1];
  if (last && last.d === d) last.v = +it.market; else it.ph.push({d, v: +it.market});
  if (it.ph.length > 180) it.ph = it.ph.slice(-180);
}

export { pickVariant };

// ================================================================== sets (for "142 of 191" progress)
/** Which set a saved card belongs to: {game, set} or null (cards typed in by hand aren't linked). */
export function setOf(c) {
  if (!c.ref || !c.ref.id) return null;
  if (c.ref.src === "tcgdex") return {game: "pokemon", set: pkSetOf(c.ref.id)};
  if (c.ref.src === "optcg") return {game: "onepiece", set: c.ref.id.split("-")[0]};
  if (c.ref.src === "lorcast" && c.setCode) return {game: "lorcana", set: c.setCode};
  if (c.ref.src === "scryfall" && c.setCode) return {game: "mtg", set: c.setCode};
  if (c.ref.src === "ygo" && (c.setCode || c.set)) return {game: "ygo", set: c.setCode || c.set};
  return null;
}
/** Lorcana set codes weren't saved on older cards: look them up once (with Lorcast's pause between calls). */
export async function fillSetCodes(list) {
  let n = 0;
  for (const c of list.filter(c => c.ref && c.ref.src === "lorcast" && !c.setCode)) {
    try { const d = await getJSON(`${LORCAST}/cards/${encodeURIComponent(c.ref.id)}`); if (d && d.set) { c.setCode = d.set.code; n++; } } catch (e) {}
    await sleep(120);
  }
  return n;
}
const GAMES_RAR_YGO = GAMES.ygo.rar;
const EXTRA_LOR = ["Enchanted", "Iconic", "Epic", "Promo", "Special"];
/**
 * Every card in a set: {name, base, cards: [{src, id, num, name, img, extra, market}]}.
 * base = the printed set size ("191" in 238/191). extra = secret rares, enchanted, parallels and other chase prints past it.
 */
export async function setList(game, set) {
  const key = `set4:${game}:${set}`;   // set4: counting rules changed, so older saved lists are ignored
  const hit = await cacheGet(key, 3 * DAY);
  if (hit) return hit;
  let out = null;
  if (game === "pokemon") {
    const d = await getJSON(`${TCGDEX}/sets/${encodeURIComponent(set)}`);
    if (d) {
      const base = (d.cardCount && d.cardCount.official) || 0;
      out = {name: d.name, base, cards: (d.cards || []).map(c => ({src: "tcgdex", id: c.id, num: c.localId, name: c.name,
        img: c.image ? c.image + "/low.webp" : "", extra: base > 0 && /^\d+$/.test(c.localId) ? +c.localId > base : !/^\d+$/.test(c.localId), market: null}))};
    }
  } else if (game === "lorcana") {
    const d = await getJSON(`${LORCAST}/sets/${encodeURIComponent(set)}/cards`);
    if (d && d.length) {
      const cards = d.map(lorcastShape).map((c, i) => ({src: "lorcast", id: c.id, num: c.num, name: c.name, img: c.img, market: c.market,
        extra: EXTRA_LOR.some(x => (d[i].rarity || "").toLowerCase().startsWith(x.toLowerCase()))}));
      out = {name: d[0].set ? d[0].set.name : "Set " + set, base: cards.filter(c => !c.extra).length, cards};
    }
  } else if (game === "mtg") {
    const s = await scry(`${SCRY}/sets/${encodeURIComponent(set)}`);
    if (s) {
      const base = s.printed_size || s.card_count || 0, cards = [];
      let url = `${SCRY}/cards/search?q=${encodeURIComponent("e:" + set)}&unique=prints&order=set`;
      for (let page = 0; url && page < 12; page++) {          // 175 cards a page; big sets have a few pages
        const d = await scry(url); if (!d) break;
        for (const c of d.data || []) { const x = scryShape(c); cards.push({src: "scryfall", id: x.id, num: x.num, name: x.name, img: x.img, market: x.market,
          extra: !/^\d+$/.test(x.num) || (base > 0 && +x.num > base)}); }
        url = d.has_more ? d.next_page : null;
      }
      if (cards.length) out = {name: s.name, base, cards, keepImages: true};   // Scryfall: card images must not be faded or recolored
    }
  } else if (game === "ygo") {
    const d = await ygo(`${YGO}/cardinfo.php?cardset=${encodeURIComponent(set)}`).catch(() => null);
    if (d && d.data && d.data.length) {
      // Group by the card itself, not the printed number: regions number differently (LOB-E021 isn't LOB-021).
      // Each card gets one entry per rarity, shown as its English printing and covering every region printing.
      // Its most common rarity counts toward the set; rarer versions (like Starlight) are chase cards.
      const cards = [];
      let base = 0;
      for (const c of d.data) {
        const mine = (c.card_sets || []).filter(p => p.set_name === set).map(p => ygoShape(c, p));
        if (!mine.length) continue;
        base++;
        const byRar = new Map();
        for (const x of mine) { if (!byRar.has(x.rarity)) byRar.set(x.rarity, []); byRar.get(x.rarity).push(x); }
        [...byRar.entries()].sort((a, b) => GAMES_RAR_YGO.indexOf(a[0]) - GAMES_RAR_YGO.indexOf(b[0])).forEach(([rar, xs], i) => {
          xs.sort((a, b) => /-EN/.test(b.num) - /-EN/.test(a.num));
          const x = xs[0];
          cards.push({src: "ygo", id: x.id, also: xs.slice(1).map(y => y.id), num: x.num, name: x.name + (i ? " (" + rar + ")" : ""), img: "", market: x.market, extra: i > 0});
        });
      }
      out = {name: set, base, cards};
    }
  } else if (game === "onepiece") {
    const all = (await onePieceAll()).filter(c => c.s.startsWith(set + "-"));
    if (all.length) {
      const cards = all.map(c => ({src: "optcg", id: c.i, num: c.s, name: c.n, img: c.img, market: c.m != null ? round(+c.m) : null, extra: c.i !== c.s}))
        .sort((a, b) => a.num.localeCompare(b.num) || a.extra - b.extra);
      out = {name: all[0].set || set, base: new Set(all.map(c => c.s)).size, cards};
    }
  }
  if (out) {
    out.cards.sort((a, b) => a.extra - b.extra || String(a.num).localeCompare(String(b.num), undefined, {numeric: true}));
    cacheSet(key, out);
  }
  return out;
}
