// Scan cards from photos, on this device. Tesseract.js (open-source OCR) reads the small printed
// code on each card (like 238/191, OP01-120 or 207/204 • EN • 1) plus the name, then we look the
// card up in the free card databases. Photos never leave the phone; only the OCR program itself is
// downloaded (once) from the jsDelivr CDN the first time you scan.
import { parseCardText, normNum } from "./logic.js";
import { search, card, onePieceByCode, lorcanaBySetNum, pokemonSetsByTotal } from "./catalog.js";
import { loadImg } from "./util.js";
import { recall } from "./learn.js";

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
  if (!out.length && p.lorSet && allow("lorcana")) { try { add([await lorcanaBySetNum(p.lorSet, p.lorNum)]); } catch (e) {} }
  if (!out.length && p.num && p.total && allow("pokemon")) {
    // "025/165": find sets with 165 cards, then ask for card 025 in each
    try {
      const sets = (await pokemonSetsByTotal(p.total)).slice(0, 6);
      const nums = [...new Set([p.num, normNum(p.num)])];
      const found = (await Promise.all(sets.flatMap(s => nums.map(n => card("tcgdex", s.id + "-" + n).catch(() => null))))).filter(Boolean);
      const words = p.words.map(w => w.toLowerCase());
      found.sort((a, b) => score(b) - score(a));
      function score(c) { const n = c.name.toLowerCase(); return words.some(w => n.includes(w) || w.includes(n.split(" ")[0])) ? 1 : 0; }
      add(found);
    } catch (e) {}
  }
  if (!out.length && p.num && allow("pokemon")) {
    for (const w of [...p.words].sort((a, b) => b.length - a.length).slice(0, 4)) {
      try {
        const hits = (await search("pokemon", w + " " + p.num)).filter(c => !p.total || normNum(String(c.num).split("/")[1]) === normNum(p.total));
        add(hits);
        if (out.length) break;
      } catch (e) {}
    }
  }
  let exact = out.length > 0;
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
  return scored.sort((p, q) => (p.d - q.d) || (p.i - q.i)).map(s => s.c);
}

/**
 * Scan a photo. layout = [rows, cols]: [1,1] for one card, [3,3] for a 9-pocket binder page, [3,4] for 12-pocket.
 * onCell(index, total, result) is called as each pocket finishes.
 */
export async function scanPhoto(blob, layout, gameHint, onCell = () => {}) {
  const [rows, cols] = layout;
  const im = await loadImg(blob);
  const worker = await getWorker();
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
    // a thumbnail of the pocket so you can see which card is which
    const t = document.createElement("canvas"), k = 160 / Math.max(w, h);
    t.width = Math.round(w * k); t.height = Math.round(h * k);
    t.getContext("2d").drawImage(im, x, y, w, h, 0, 0, t.width, t.height);
    res.thumb = t.toDataURL("image/jpeg", 0.7);
    results.push(res);
    onCell(i, total, res);
  }
  return results;
}
