// Pure logic with no page access, so it can be unit tested (see tests/).

// ------------------------------------------------------------------ games
// Rarities run lowest to highest. "hitFrom" is the first rarity that counts as a hit.
export const GAMES = {
  pokemon: {
    name: "Pokémon", color: "#f2b705",
    rar: ["Common", "Uncommon", "Rare", "Holo Rare", "Promo", "Double Rare (ex)", "Ultra Rare", "ACE SPEC", "Shiny Rare", "Art Rare (AR)",
      "Illustration Rare (IR)", "Special Art Rare (SAR)", "Special Illustration Rare (SIR)", "Hyper Rare (Gold)", "Mega Hyper Rare"],
    hitFrom: "Double Rare (ex)", tcg: "pokemon", word: "pokemon",
  },
  onepiece: {
    name: "One Piece", color: "#d63b2f",
    rar: ["Common (C)", "Uncommon (UC)", "Rare (R)", "Leader (L)", "Promo (P)", "Super Rare (SR)", "Alternate Art / Parallel",
      "Special (SP)", "Secret Rare (SEC)", "Manga Rare", "Treasure Rare (TR)"],
    hitFrom: "Super Rare (SR)", tcg: "one-piece-card-game", word: "one piece",
  },
  lorcana: {
    name: "Disney Lorcana", color: "#6b4fd8",
    rar: ["Common", "Uncommon", "Rare", "Promo", "Super Rare", "Legendary", "Epic", "Enchanted", "Iconic"],
    hitFrom: "Legendary", tcg: "lorcana-tcg", word: "lorcana",
  },
};
export const CONDS = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged", "Graded"];

export const rarIndex = c => { const g = GAMES[c.game]; return g ? g.rar.indexOf(c.rarity) : -1; };
export const rarLevel = c => { const g = GAMES[c.game], i = rarIndex(c); return g && i >= 0 ? i / (g.rar.length - 1) : -1; };
export const isHit = c => {
  const g = GAMES[c.game];
  return (g && rarIndex(c) >= g.rar.indexOf(g.hitFrom)) || c.cond === "Graded" || !!(c.photos && c.photos.length);
};

/** Turn a rarity string from a card database into one of our rarity names. */
export function mapRarity(game, raw, name = "") {
  const r = String(raw || "").toLowerCase().replace(/_/g, " ").trim();
  if (game === "pokemon") {
    if (!r || r === "none") return "";
    if (r.includes("mega hyper")) return "Mega Hyper Rare";
    if (r.includes("special illustration")) return "Special Illustration Rare (SIR)";
    if (r.includes("special art")) return "Special Art Rare (SAR)";
    if (r.includes("illustration")) return "Illustration Rare (IR)";
    if (r.includes("art rare")) return "Art Rare (AR)";
    if (r.includes("hyper") || r.includes("secret") || r.includes("gold")) return "Hyper Rare (Gold)";
    if (r.includes("ace spec")) return "ACE SPEC";
    if (r.includes("shiny")) return "Shiny Rare";
    if (/ultra|full art|radiant|amazing|vmax|vstar|holo rare v|rare holo v|lv\.?x|prime|legend|break/.test(r)) return "Ultra Rare";
    if (r.includes("double")) return "Double Rare (ex)";
    if (r.includes("promo")) return "Promo";
    if (r.includes("holo")) return "Holo Rare";
    if (r.includes("uncommon")) return "Uncommon";
    if (r.includes("common")) return "Common";
    if (r.includes("rare")) return "Rare";
    return "Other";
  }
  if (game === "onepiece") {
    const n = String(name).toLowerCase();
    if (n.includes("(manga)")) return "Manga Rare";
    if (n.includes("(sp)") || r === "sp") return "Special (SP)";
    if (r === "tr") return "Treasure Rare (TR)";
    if (r === "sec") return "Secret Rare (SEC)";
    if (n.includes("(parallel)") || n.includes("alternate art")) return "Alternate Art / Parallel";
    return {c: "Common (C)", uc: "Uncommon (UC)", r: "Rare (R)", l: "Leader (L)", p: "Promo (P)", pr: "Promo (P)", sr: "Super Rare (SR)"}[r] || (r ? "Other" : "");
  }
  if (game === "lorcana") {
    const hit = GAMES.lorcana.rar.find(x => x.toLowerCase() === r);
    return hit || (r ? "Other" : "");
  }
  return "";
}

/** Match typed text (like "SIR" or "secret rare") to a rarity in a game's list. */
export function guessRarity(game, txt) {
  if (!txt) return "";
  const t = txt.toLowerCase().trim(), list = GAMES[game].rar;
  return list.find(r => r.toLowerCase() === t) || list.find(r => r.toLowerCase().includes("(" + t + ")")) ||
    list.find(r => r.toLowerCase().startsWith(t)) || "Other";
}

// ------------------------------------------------------------------ price links
/** Optional affiliate wrapper (empty = plain links). Disclosed in the About page when set. */
export const AFF = { tcgplayer: "" };   // e.g. "https://tcgplayer.pxf.io/c/XXXX/YYYY/ZZZZ"
const wrapTcg = u => AFF.tcgplayer ? AFF.tcgplayer + "?u=" + encodeURIComponent(u) : u;

export function priceLinks(c) {
  const g = GAMES[c.game] || GAMES.pokemon;
  const q = [c.name, c.num].filter(Boolean).join(" ");
  const qg = encodeURIComponent(q + " " + g.word);
  const graded = c.cond === "Graded" && c.grade ? " " + c.grade : "";
  const links = [];
  if (c.tcgId) links.push({key: "tcg", label: "TCGplayer (price history chart)", url: wrapTcg("https://www.tcgplayer.com/product/" + c.tcgId)});
  else links.push({key: "tcg", label: "TCGplayer", url: wrapTcg(`https://www.tcgplayer.com/search/${g.tcg}/product?q=` + encodeURIComponent(q))});
  links.push({key: "ebay", label: "eBay sold" + (graded ? " (" + c.grade + ")" : ""), url: "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(q + graded + " " + g.word) + "&LH_Sold=1&LH_Complete=1"});
  links.push({key: "pc", label: "PriceCharting", url: "https://www.pricecharting.com/search-products?type=prices&q=" + qg});
  links.push({key: "130", label: "130point (eBay sales incl. best offers)", url: "https://130point.com/sales/"});
  return links;
}

// ------------------------------------------------------------------ fair price ("Scalper Shield")
export const VERDICTS = {
  steal:   {emoji: "🤑", label: "Great deal", tone: "ok"},
  fair:    {emoji: "👍", label: "Fair price", tone: "ok"},
  high:    {emoji: "🤔", label: "A bit high", tone: "warn"},
  scalper: {emoji: "🚫", label: "Scalper price", tone: "bad"},
};
/** kind "single" compares to market value; kind "sealed" compares to the store price (MSRP). */
export function priceVerdict(ask, ref, kind = "single") {
  ask = +ask; ref = +ref;
  if (!(ask > 0) || !(ref > 0)) return null;
  const ratio = ask / ref;
  const cut = kind === "sealed" ? [1.0, 1.2, 1.5] : [0.85, 1.1, 1.3];
  const key = ratio <= cut[0] ? "steal" : ratio <= cut[1] ? "fair" : ratio <= cut[2] ? "high" : "scalper";
  return {key, ratio, pct: Math.round(ratio * 100), over: ask - ref, ...VERDICTS[key]};
}

// ------------------------------------------------------------------ trades
export const sideTotal = items => items.reduce((s, i) => s + (+i.value || 0) * (+i.qty || 1), 0);
/** Compare what you give with what you get. Within 5% is called fair. */
export function tradeVerdict(giveItems, getItems) {
  const give = sideTotal(giveItems), get = sideTotal(getItems), diff = get - give, base = Math.max(give, get);
  if (!giveItems.length || !getItems.length || base === 0) return {key: "empty", give, get, diff};
  const pct = Math.abs(diff) / base;
  return {key: pct <= 0.05 ? "fair" : diff > 0 ? "ahead" : "behind", give, get, diff, pct};
}

// ------------------------------------------------------------------ bundles
export function bundle(rows, pct, min = 0) {
  const use = rows.filter(c => (+c.qty || 0) > 0 && (+c.market || 0) >= min);
  const count = use.reduce((s, c) => s + (+c.qty || 0), 0);
  const market = use.reduce((s, c) => s + (+c.qty || 0) * (+c.market || 0), 0);
  const paid = use.reduce((s, c) => s + (+c.qty || 0) * (+c.paid || 0), 0);
  const noPrice = use.filter(c => c.market === "" || c.market == null).length;
  return {rows: use, count, market, paid, ask: market * pct / 100, noPrice};
}

// ------------------------------------------------------------------ bulk add
export function parseBulkLine(line) {
  const p = line.split(/\t|,/).map(s => s.trim());
  if (p.length < 2 || !p[1]) return null;
  const gk = p[0].toLowerCase().replace(/[^a-z]/g, "");
  const game = gk.startsWith("one") ? "onepiece" : gk.startsWith("lor") ? "lorcana" : gk.startsWith("pok") ? "pokemon" : null;
  if (!game) return null;
  const condTxt = p[5] || "";
  const cond = CONDS.find(c => c.toLowerCase() === condTxt.toLowerCase()) || (/^(psa|bgs|cgc|sgc|tag|ace)/i.test(condTxt) ? "Graded" : "Near Mint");
  return {
    game, name: p[1], set: p[2] || "", num: p[3] || "", rarity: guessRarity(game, p[4]), lang: "English", cond,
    grade: cond === "Graded" ? condTxt : "", qty: p[6] ? Math.max(0, Math.round(+p[6] || 0)) : 1,
    paid: p[7] ? +p[7] || 0 : "", market: p[8] ? +p[8] || 0 : "",
  };
}

// ------------------------------------------------------------------ scanning: read the printed card code
/** Pull card codes out of text read from a card photo. */
export function parseCardText(text) {
  const t = String(text || "").replace(/[|]/g, "1").replace(/\s+/g, " ");
  const out = {};
  // One Piece: OP01-120, ST10-005, EB01-012, PRB01-001, P-001
  const op = t.toUpperCase().match(/\b(OP|ST|EB|PRB)\s?(\d{2})\s?[-–—]\s?(\d{3})\b/);
  if (op) out.opId = `${op[1]}${op[2]}-${op[3]}`;
  else {
    // the scanner often reads the tiny "OP" as "0P", "05" or "OR", and 0 as O
    const m = t.toUpperCase().match(/\b[O0Q][P5R]\s?([O0\d]{2})\s?[-–—]\s?(\d{3})\b/);
    if (m) out.opId = `OP${m[1].replace(/O/g, "0")}-${m[2]}`;
  }
  // Lorcana: "207/204 • EN • 1"
  const lo = t.match(/\b(\d{1,3})\s*\/\s*(\d{2,3})\s*[•·.*°o+»«-]?\s*E\s?N\s*[•·.*°o+»«-]?\s*(\d{1,2})\b/i);
  if (lo) { out.lorNum = String(+lo[1]); out.lorSet = String(+lo[3]); }
  // Pokémon: "238/191" (also catches Lorcana numbers, which is fine: the game decides)
  const pk = t.match(/\b([A-Z]{0,3}\d{1,3})\s*\/\s*([A-Z]{0,3}\d{2,3})\b/i);
  if (pk) { out.num = pk[1].toUpperCase(); out.total = pk[2].toUpperCase(); }
  // Name guesses: words of letters, longest runs first
  out.words = [...new Set((t.match(/[A-Za-zÀ-ÿ'’.\-]{3,}(?: [A-Za-zÀ-ÿ'’.\-]{2,}){0,2}/g) || [])
    .map(w => w.trim()).filter(w => !/^(HP|EN|Basic|Stage|Weakness|Resistance|Retreat|Illus|Pokemon|Pokémon|Trainer|Energy|Ability)$/i.test(w)))].slice(0, 8);
  return out;
}

export const normNum = s => String(s || "").replace(/^0+(?=\d)/, "").toUpperCase();

// ------------------------------------------------------------------ trade links: match cards and suggest fair trades
/** Keys that say "this is the same card": the database id when we know it, plus game + name + number. */
export function cardKeys(c) {
  const keys = [];
  if (c.ref && c.ref.src && c.ref.id) keys.push(c.ref.src + ":" + c.ref.id);
  if (c.name) keys.push([c.game || "", String(c.name).toLowerCase().trim(), normNum(String(c.num || "").split("/")[0])].join("|"));
  return keys;
}
/** Does card c match anything in the list? */
export function matchesAny(c, list) {
  const set = new Set(list.flatMap(cardKeys));
  return cardKeys(c).some(k => set.has(k));
}
/**
 * Pick cards to offer for what you want.
 * want: total value of the cards you asked for.
 * cands: [{id, value, wanted}] (one entry per copy you could give; wanted = on their wishlist).
 * myGap: how much more than "want" you're OK giving. Their side never drops more than 5% (min $1) below fair.
 * Returns {pick: [ids], give, diff, fits} or null.
 */
const better = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
export function suggestTrade(want, cands, myGap = 0) {
  want = +want || 0;
  const pool = cands.filter(c => +c.value > 0).sort((a, b) => (b.wanted - a.wanted) || (Math.abs(a.value - want) - Math.abs(b.value - want))).slice(0, 16);
  if (!want || !pool.length) return null;
  const lo = want - Math.max(1, want * 0.05), hi = want + Math.max(0, +myGap || 0);
  let best = null;
  for (let mask = 1; mask < (1 << pool.length); mask++) {
    let give = 0, wanted = 0, n = 0;
    for (let i = 0; i < pool.length; i++) if (mask & (1 << i)) { give += +pool[i].value; wanted += pool[i].wanted ? 1 : 0; n++; }
    const fits = give >= lo && give <= hi, diff = give - want;
    // best = fits first, then more of the cards they want, then closest value, then fewer cards
    const score = [fits ? 1 : 0, fits ? wanted : 0, -Math.abs(diff), -n];
    if (!best || better(score, best.score)) best = {score, mask, give, diff, fits};
  }
  const pick = pool.filter((_, i) => best.mask & (1 << i)).map(c => c.id);
  return {pick, give: Math.round(best.give * 100) / 100, diff: Math.round(best.diff * 100) / 100, fits: best.fits};
}
