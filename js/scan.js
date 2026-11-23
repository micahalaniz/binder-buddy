// Scan cards from photos, on this device. Tesseract.js (open-source OCR) reads the small printed
// code on each card (like 238/191, OP01-120 or 207/204 • EN • 1) plus the name, then we look the
// card up in the free card databases. Photos never leave the phone; only the OCR program itself is
// downloaded (once) from the jsDelivr CDN the first time you scan.
import { parseCardText, normNum, numKey, nameMatch } from "./logic.js";
import { search, card, onePieceByCode, lorcanaBySetNum, pokemonSetsFor, pokemonSetCards, ygoByCode } from "./catalog.js";
import { loadImg } from "./util.js";
import { recall } from "./learn.js";
import { findCards, matchCard } from "./vision.js";

const TESS = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";
let workerP = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load the scanner. Check your internet."));
    document.head.appendChild(s);
  });
}
export async function getWorker() {
  if (!workerP) workerP = (async () => { await loadScript(TESS); return window.Tesseract.createWorker("eng"); })();
  try { return await workerP; } catch (e) { workerP = null; throw e; }
}
export async function stopWorker() { if (workerP) { try { (await workerP).terminate(); } catch (e) {} workerP = null; } }

/** Draw part of an image to a canvas, scaled so its long side is about `size`, in grayscale with extra contrast. */
function crop(im, sx, sy, sw, sh, size, con = 1.5) {
  const k = size / Math.max(sw, sh), cv = document.createElement("canvas");
  cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
  const g = cv.getContext("2d");
  g.filter = `grayscale(1) contrast(${con})`;
  g.drawImage(im, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return cv;
}

async function readCell(worker, im, x, y, w, h) {
  // whole card, then the One Piece code corner, then the bottom strip blown up (where the tiny card code lives), then the name strip
  const parts = [crop(im, x, y, w, h, 1400), crop(im, x + w * 0.55, y + h * 0.94, w * 0.4, h * 0.06, 1600, 1.8), crop(im, x, y + h * 0.78, w, h * 0.22, 1800),
    crop(im, x, y + h * 0.86, w * 0.5, h * 0.14, 1400), crop(im, x + w * 0.5, y + h * 0.86, w * 0.5, h * 0.14, 1400), crop(im, x, y, w, h * 0.16, 1200)];
  let text = "";
  for (const cv of parts) {
    const r = await worker.recognize(cv);
    text += "\n" + r.data.text;
    if (parseCardText(text).opId || parseCardText(text).lorSet) break;   // found an exact code: stop early
  }
  return text;
}

/** Turn OCR text into likely cards. gameHint: "auto" | game key. */
export async function identify(text, gameHint = "auto") {
  const p = parseCardText(text);
  const out = [], seen = new Set();
  const add = list => { for (const c of list || []) if (c && !seen.has(c.src + c.id)) { seen.add(c.src + c.id); out.push(c); } };
  const allow = g => gameHint === "auto" || gameHint === g;
  if (p.opId && allow("onepiece")) add(await onePieceByCode(p.opId));
  if (!out.length && p.ygoCode && allow("ygo")) { try { add(await ygoByCode(p.ygoCode)); } catch (e) {} }
  if (!out.length && p.lorSet && allow("lorcana")) { try { add([await lorcanaBySetNum(p.lorSet, p.lorNum)]); } catch (e) {} }
  let pkChecked = false, pkExact = false;
  if (!out.length && ((p.num && p.total) || p.pkCode) && allow("pokemon")) {
    // "025/165", "TG05/TG30", "RC5/RC32", "SWSH050": the number alone isn't enough (lots of sets have 12 or 165
    // cards, and the scanner can drop a digit), so the name it read has to agree.
    pkChecked = true;
    try {
      const {sets, key: q} = await pokemonSetsFor(p);
      const lists = await Promise.all(sets.slice(0, 25).map(s => pokemonSetCards(s.id).catch(() => [])));
      const all = lists.flat();
      const get = list => Promise.all(list.slice(0, 6).map(c => card("tcgdex", c.id).catch(() => null))).then(l => l.filter(Boolean));
      const atNumL = all.filter(c => numKey(c.localId) === q);
      // 1. that number in a matching set AND the name agrees: found it
      const agree = atNumL.filter(c => nameMatch(c.name, p.words));
      if (agree.length) { add(await get(agree)); pkExact = agree.length === 1; }
      else {
        // 2. the name somewhere in those sets at a close number (a lost digit like 11 → 1, typos like "Pid0ve")
        const near = c => { const n = numKey(c.localId); return n.includes(q) || q.includes(n); };
        const named = all.filter(c => nameMatch(c.name, p.words));
        const close = named.filter(near), far = named.filter(c => !near(c)).slice(0, 4);
        if (close.length) add(await get(close));
        else {
          // 3. the name couldn't be read (fancy fonts) or the read is messy: offer both, you confirm.
          //    A number read the same way twice is trusted more than a stray word.
          const shown = p.pkCode ? `${p.pkCode.pre}\\s?(?:EN\\s?)?${p.pkCode.n}` : `${p.num}\\s*/\\s*${p.total}`;
          const twice = (text.match(new RegExp(`\\b${shown}\\b`, "gi")) || []).length >= 2;
          const atNum = await get(atNumL), byName = await get(far);
          if (twice) { add(atNum); add(byName); } else { add(byName); add(atNum); }
          pkExact = twice && atNum.length === 1 && !byName.length && (sets.length === 1 || !!p.pkCode);
        }
      }
    } catch (e) {}
  }
  if (!out.length && !pkChecked && p.num && allow("pokemon")) {
    for (const w of [...p.words].sort((a, b) => b.length - a.length).slice(0, 4)) {
      try {
        const hits = (await search("pokemon", w + " " + p.num)).filter(c => !p.total || normNum(String(c.num).split("/")[1]) === normNum(p.total));
        add(hits);
        if (out.length) break;
      } catch (e) {}
    }
  }
  let exact = out.length > 0;
  // Pokémon: "found it" only when the name agrees AND the number is exactly right; otherwise ask to confirm
  if (pkChecked && out.length) exact = pkExact;
  if (!out.length) {
    // No code found: guess from the name text (you'll be asked to confirm)
    const g = gameHint === "auto" ? "pokemon" : gameHint;
    for (const w of p.words.filter(w => /^[A-Z][a-zé'’.-]{3,}( [A-Za-z]{2,})?$/.test(w)).slice(0, 3)) {
      try { add((await search(g, w)).slice(0, 8)); } catch (e) {}
      if (out.length) break;
    }
  }
  // Fixed before? (by you on this device, or by a checked report for everyone)
  let remembered = null;
  const m = recall(p);
  if (m) {
    try {
      const c = out.find(x => x.src === m.ref.src && x.id === m.ref.id) || await card(m.ref.src, m.ref.id);
      if (c) {
        const i = out.indexOf(c); if (i >= 0) out.splice(i, 1);
        out.unshift(c);
        if (m.strong) { exact = true; remembered = m.how; }
      }
    } catch (e) {}
  }
  return {parsed: p, candidates: out.slice(0, 8), exact, remembered};
}

// ------------------------------------------------------------------ look-alike check
// Same name, different print (like a regular Mega Absol ex vs. its full-art)? Shrink the photo and each
// print's official picture to a tiny 12×16 color grid and compare them. The closest look goes first.
function sig(im, x, y, w, h) {
  const a = document.createElement("canvas"); a.width = 48; a.height = 64;
  a.getContext("2d").drawImage(im, x, y, w, h, 0, 0, 48, 64);          // two steps shrink more smoothly
  const b = document.createElement("canvas"); b.width = 12; b.height = 16;
  const g = b.getContext("2d"); g.drawImage(a, 0, 0, 12, 16);
  const d = g.getImageData(0, 0, 12, 16).data, out = new Float32Array(12 * 16 * 3);
  let j = 0, mean = 0;
  for (let i = 0; i < d.length; i += 4) { out[j++] = d[i]; out[j++] = d[i + 1]; out[j++] = d[i + 2]; }
  for (const v of out) mean += v / out.length;
  for (let i = 0; i < out.length; i++) out[i] -= mean;                     // ignore overall brightness (room lighting)
  return out;
}
const lookDist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
async function rankByLook(im, x, y, w, h, cands) {
  if (!cands || cands.length < 2) return cands;
  let me; try { me = sig(im, x, y, w, h); } catch (e) { return cands; }
  const scored = await Promise.all(cands.map(async (c, i) => {
    if (!c.img) return {c, i, d: Infinity};
    try { const ci = await loadImg(c.img); return {c, i, d: lookDist(me, sig(ci, 0, 0, ci.width, ci.height))}; }
    catch (e) { return {c, i, d: Infinity}; }                              // some card sites don't allow this; keep their order
  }));
  // if any picture couldn't be compared, the comparison isn't fair: keep the original order
  if (scored.some(s => s.d === Infinity)) return cands;
  return scored.sort((p, q) => (p.d - q.d) || (p.i - q.i)).map(s => s.c);
}

// ------------------------------------------------------------------ the scanner: picture match + text check
// 1. Find each card in the photo and straighten it (vision.js).
// 2. Picture match: compare it with every card's official picture → the closest cards.
// 3. Text check: read the card number and name from the straightened card (much easier than from the raw photo).
// 4. Decide: both agree → found. Same artwork printed in several sets → the number decides.
//    They disagree or neither is sure → you pick, with the likeliest cards first.
// How far the best picture match must stand out. Measured on 300+ test photos: wrong matches scored up to about 10, so a
// picture alone only decides at 15+. Below that, the name or number read off the card has to agree.
const STAND_OK = 4.5, STAND_SKIP_TEXT = 15;
// Reprints with the same artwork score within about .03 of each other on a clean picture (a different card is ~.5 lower),
// but blur can widen that, so anything with the same name within .2 counts as "same artwork": the number decides.
const TWIN = .2;

/** Shrink a photo so its long side is at most `max` pixels (phones take 12+ megapixel photos). */
function shrink(im, max = 2000) {
  const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement("canvas");
  c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
  return c;
}
const thumbOf = (cnv, size = 160) => { const t = document.createElement("canvas"), k = size / Math.max(cnv.width, cnv.height); t.width = Math.round(cnv.width * k); t.height = Math.round(cnv.height * k); t.getContext("2d").drawImage(cnv, 0, 0, t.width, t.height); return t.toDataURL("image/jpeg", 0.7); };
const pkIdOf = c => c && c.src === "tcgdex" ? c.id : null;

/** Combine the picture match (vm) with the text check (ocr) for one card. */
export async function decide(vm, ocr) {
  const list = (vm && vm.list) || [], o = (ocr && ocr.candidates) || [];
  const vIds = list.map(x => x.id);
  const get = async ids => (await Promise.all(ids.map(id => card("tcgdex", id).catch(() => null)))).filter(Boolean);
  // the picture's best match is kept with what was read, so a fix can be remembered even when no text was read
  const pic = vm && vm.list[0] && vm.stand >= STAND_OK ? vm.list[0].id : null;
  const res = {parsed: {...(ocr ? ocr.parsed : {}), ...(pic ? {pic} : {})}, remembered: ocr && ocr.remembered, how: ""};
  const uniq = arr => { const s = new Set(); return arr.filter(c => c && !s.has(c.src + c.id) && s.add(c.src + c.id)); };
  // A fix you (or a checked report) made before always wins
  if (ocr && ocr.remembered) return {...res, candidates: ocr.candidates, exact: ocr.exact, how: "remembered"};
  const fix = pic && !(ocr && ocr.exact) && recall({pic});   // a clearly read code beats a fix remembered by picture
  if (fix) { const c = await card(fix.ref.src, fix.ref.id).catch(() => null); if (c) return {...res, candidates: uniq([c, ...await get(vIds.slice(0, 3))]), exact: true, remembered: fix.how, how: "remembered"}; }
  // Not a Pokémon card (One Piece, Lorcana, Yu-Gi-Oh! codes are exact): trust the code
  if (ocr && ocr.exact && o[0] && o[0].src !== "tcgdex") return {...res, candidates: o, exact: true, how: "code"};
  const stand = vm ? vm.stand : 0, top = list[0];
  if (ocr && ocr.exact && o[0]) {
    const oid = pkIdOf(o[0]);
    // the number and the picture agree (same card, or a reprint with the same artwork)
    if (vIds.slice(0, 8).includes(oid) || (top && top.name === o[0].name && stand >= STAND_OK)) return {...res, candidates: uniq([o[0], ...await get(vIds.slice(0, 3))]), exact: true, how: "both"};
    // they disagree: show both, you pick
    if (top && stand >= STAND_OK) return {...res, candidates: uniq([...await get([top.id]), o[0], ...await get(vIds.slice(1, 3)), ...o.slice(1, 3)]), exact: false, how: "disagree"};
    return {...res, candidates: o, exact: true, how: "code"};
  }
  if (top && stand >= STAND_OK) {
    // same artwork in several sets (reprints): if the number was read, it decides; otherwise you pick
    const twins = list.filter(x => x.name === top.name && top.s - x.s < TWIN);
    const num = ocr && ocr.parsed && (ocr.parsed.num || (ocr.parsed.pkCode && ocr.parsed.pkCode.pre + ocr.parsed.pkCode.n));
    let pick = top;
    if (twins.length > 1 && num) pick = twins.find(x => normNum(x.num) === normNum(num) || numKey(x.num) === numKey(num)) || top;
    const cands = await get([pick.id, ...vIds.filter(id => id !== pick.id).slice(0, 4)]);
    // which reprint it is must be settled: only one with this artwork, or the number picked one
    const settled = twins.length === 1 || (!!num && (normNum(pick.num) === normNum(num) || numKey(pick.num) === numKey(num)));
    // the text agrees: the number matches, or the name was read on the card
    const textAgrees = (!!num && (normNum(pick.num) === normNum(num) || numKey(pick.num) === numKey(num))) || !!(ocr && ocr.parsed && nameMatch(top.name, ocr.parsed.words || []));
    const sure = settled && (stand >= STAND_SKIP_TEXT || textAgrees);
    return {...res, candidates: uniq([...cands, ...o.slice(0, 2)]), exact: sure, how: textAgrees ? "both" : "picture"};
  }
  // nobody is sure: picture matches first, then text matches
  return {...res, candidates: uniq([...await get(vIds.slice(0, 4)), ...o.slice(0, 4)]).slice(0, 8), exact: false, how: "unsure"};
}

/**
 * Scan a photo. layout = [rows, cols]: [1,1] for one card, otherwise a binder page (cards are found
 * automatically; the layout is only used if they can't be). onCell(index, total, result) after each card.
 */
export async function scanPhoto(blob, layout, gameHint, onCell = () => {}) {
  const im = shrink(await loadImg(blob));
  const worker = await getWorker();
  const usePicture = gameHint === "auto" || gameHint === "pokemon";
  let found = null;
  if (usePicture) {
    try {
      const one = layout[0] * layout[1] === 1;
      const page = await findCards(im, false);
      // "One card" picked, but the photo clearly holds several cards (a binder page, or cards laid out on a table): scan every card.
      // Two or more separate card-shaped outlines of about the same size, each a fair part of the photo, means several cards.
      const cardish = page.filter(p => !p.filled && p.ratio > .6 && p.ratio < .82 && p.area > .02);
      const areas = cardish.map(p => p.area), similar = cardish.length >= 2 && Math.max(...areas) < Math.min(...areas) * 1.8;
      found = !one || page.length >= 3 || similar ? (page.length ? page.map(p => [p]) : null) : [await findCards(im, true)];
    } catch (e) { found = null; }   // no internet for the card finder, or it failed: read the text the old way
  }
  if (!found || !found.length) return scanGrid(im, layout, gameHint, onCell, worker);
  const results = [];
  for (let i = 0; i < found.length; i++) {
    let res;
    try {
      let vm = null; try { vm = await matchCard("pokemon", found[i]); } catch (e) {}
      const chosen = vm ? vm.found : found[i][0];
      const big = chosen.big, top = vm && vm.list[0];
      // Very sure picture match, and no other printing shares the artwork: no need for the slow text check
      const twins = vm ? vm.list.filter(x => top && x.name === top.name && top.s - x.s < TWIN).length : 0;
      let text = "", ocr = null;
      if (!(vm && vm.stand >= STAND_SKIP_TEXT && twins === 1)) {
        text = await readCell(worker, big, 0, 0, big.width, big.height);
        ocr = {...await identify(text, gameHint), text};
        // the picture match isn't sure (maybe it isn't a Pokémon card): also read the whole photo the old way
        if ((!vm || vm.stand < STAND_OK) && !ocr.exact && found.length === 1) {
          const t2 = await readCell(worker, im, 0, 0, im.width, im.height), o2 = {...await identify(t2, gameHint), text: t2};
          if (o2.exact || o2.candidates.length > ocr.candidates.length) { ocr = o2; text = t2; }
        }
      }
      res = {...await decide(vm, ocr), text, vision: vm ? {stand: +vm.stand.toFixed(2), top: vm.list.slice(0, 3).map(x => x.id)} : null};
      res.thumb = thumbOf(chosen.canvas);
    } catch (e) { res = {parsed: {}, candidates: [], text: "", error: e.message, thumb: thumbOf(found[i][0].canvas)}; }
    results.push(res);
    onCell(i, found.length, res);
  }
  return results;
}

/** The old way: split the photo into pockets and read the text in each. Used when the cards can't be found. */
async function scanGrid(im, layout, gameHint, onCell, worker) {
  const [rows, cols] = layout;
  const cw = im.width / cols, ch = im.height / rows, total = rows * cols, results = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    const inset = total > 1 ? 0.04 : 0;   // ignore binder-pocket edges
    const x = c * cw + cw * inset, y = r * ch + ch * inset, w = cw * (1 - 2 * inset), h = ch * (1 - 2 * inset);
    let res;
    try {
      const text = await readCell(worker, im, x, y, w, h); res = {...await identify(text, gameHint), text};
      if (!res.remembered) res.candidates = await rankByLook(im, x, y, w, h, res.candidates);   // a remembered fix stays first
    }
    catch (e) { res = {parsed: {}, candidates: [], text: "", error: e.message}; }
    const t = document.createElement("canvas"), k = 160 / Math.max(w, h);
    t.width = Math.round(w * k); t.height = Math.round(h * k);
    t.getContext("2d").drawImage(im, x, y, w, h, 0, 0, t.width, t.height);
    res.thumb = t.toDataURL("image/jpeg", 0.7);
    results.push(res);
    onCell(i, total, res);
  }
  return results;
}