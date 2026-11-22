// Card lookup + live prices from free, open community databases (no keys, no accounts):
//   Pokémon:        TCGdex      https://tcgdex.dev   (TCGplayer + Cardmarket prices)
//   Disney Lorcana: Lorcast     https://lorcast.com  (daily TCGplayer prices)
//   One Piece:      OPTCG API   https://optcgapi.com (TCGplayer market prices + 2-week history)
// Every result is turned into one shape:
//   {game, src, id, name, set, num, rarity, img, imgLg, tcgId, variants: {key: usd}, v, market, trend}
import { mapRarity, normNum } from "./logic.js";
import { cacheGet, cacheSet } from "./store.js";
import { sleep } from "./util.js";

const HOUR = 3600e3, DAY = 24 * HOUR;
const TCGDEX = "https://api.tcgdex.net/v2/en", LORCAST = "https://api.lorcast.com/v0", OPTCG = "https://optcgapi.com/api";

async function getJSON(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await sleep(400); }
  }
}

export const VARIANT_NAMES = {
  "normal": "Normal", "holofoil": "Holo", "reverse-holofoil": "Reverse holo", "1st-edition-holofoil": "1st Edition holo",
  "1st-edition-normal": "1st Edition", "unlimited-holofoil": "Unlimited holo", "unlimited": "Unlimited", "foil": "Foil",
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
export async function pokemonSetsByTotal(total) {
  const sets = await pokemonSets(), t = +String(total).replace(/\D/g, "");
  return [...sets.values()].filter(s => +s.official === t).sort((a, b) => b.order - a.order);
}

async function searchPokemon(q, num) {
  const sets = await pokemonSets();
  const list = await getJSON(`${TCGDEX}/cards?name=${encodeURIComponent(q)}&pagination:itemsPerPage=120`) || [];
  return list.filter(c => sets.has(pkSetOf(c.id)))
    .filter(c => !num || normNum(c.localId) === normNum(num))
    .map(c => {
      const s = sets.get(pkSetOf(c.id));
      return {game: "pokemon", src: "tcgdex", id: c.id, name: c.name, set: s.name, order: s.order,
        num: c.localId + (s.official ? "/" + String(s.official).padStart(String(c.localId).length, "0") : ""),
        img: c.image ? c.image + "/low.webp" : "", imgLg: c.image ? c.image + "/high.webp" : "", partial: true};
    })
    .sort((a, b) => b.order - a.order)
    .slice(0, 60);
}

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
    const parts = await Promise.all(["allSetCards", "allSTCards", "allPromos"].map(p => getJSON(`${OPTCG}/${p}/`).catch(() => [])));
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
export async function search(game, text) {
  const t = String(text || "").trim();
  if (!t) return [];
  if (game === "onepiece") return searchOnePiece(t);
  const m = t.match(/^(.*?)(?:\s+#?([a-z]{0,3}\d{1,3})(?:\s*\/\s*[a-z]{0,3}\d{1,3})?)?$/i);
  const name = (m && m[1] || t).trim(), num = m && m[2];
  if (!name) return [];
  return game === "lorcana" ? searchLorcana(name, num) : searchPokemon(name, num);
}

/** Full details + prices for one card. */
export function card(src, id) {
  return src === "tcgdex" ? pokemonCard(id) : src === "lorcast" ? lorcanaCard(id) : src === "optcg" ? onePieceCard(id) : Promise.resolve(null);
}

/** Refresh prices for a list of saved items that came from a card database. onStep(done, total). */
export async function refreshPrices(items, onStep = () => {}) {
  const linked = items.filter(i => i.ref && i.ref.src);
  let done = 0, changed = 0, failed = 0;
  if (linked.some(i => i.ref.src === "optcg")) await onePieceAll(true).catch(() => {});
  const work = async it => {
    try {
      const d = await card(it.ref.src, it.ref.id);
      if (d) {
        const v = pickVariant(d.variants, it.ref.v);
        if (v && d.variants[v] != null) { it.market = d.variants[v]; changed++; }
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
  await Promise.all([pool(pk, 4), (async () => { for (const it of lo) { await work(it); await sleep(120); } })(), pool(op, 8)]);
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
