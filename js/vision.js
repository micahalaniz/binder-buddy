// Picture matching: find each card in a photo, straighten it, and compare its "colour fingerprint" with
// every card's official picture. Works on blurry, angled and glary photos, and on whole binder pages.
//
// How it works, in plain words:
// 1. OpenCV (free, open-source, runs on the phone) finds card-shaped outlines and straightens each card.
// 2. Each straightened card is shrunk to a tiny 12×16 grid of colours (plus a 16×12 grid of the artwork),
//    corrected for room lighting. That is its fingerprint.
// 3. The fingerprint is compared with a pre-made list of every card's fingerprint (data/pk-index.*).
//    Small shifts and zooms are tried, and white glare spots are ignored, so a rough photo still lines up.
// Photos never leave the phone.
import { cacheGet, cacheSet } from "./store.js";

const OPENCV = "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js";
export const CW = 245, CH = 342;      // a straightened card (the size of the database pictures)
const MG = .08;                        // extra border kept around a found card for fine-tuning

// ------------------------------------------------------------------ loading
let cvP = null;
export function loadCV() {
  if (!cvP) cvP = new Promise((res, rej) => {
    if (window.cv && window.cv.Mat) return res(true);
    const s = document.createElement("script"); s.src = OPENCV; s.async = true;
    s.onload = async () => {
      // OpenCV gets ready a moment after it downloads (it compiles itself): wait until it is
      // careful: OpenCV looks like a promise to JavaScript, so it must never be handed back through one (that loops forever)
      for (let i = 0; i < 600; i++) { if (window.cv && window.cv.Mat) return res(true); await new Promise(r => setTimeout(r, 100)); }
      cvP = null; rej(new Error("The card finder took too long to start. Try again."));
    };
    s.onerror = () => { cvP = null; rej(new Error("Couldn't load the card finder. Check your internet.")); };
    document.head.appendChild(s);
  });
  return cvP;
}

const indexes = new Map();
/** The fingerprint list for a game ("pokemon"). Downloaded once, then kept on the phone. */
export function loadIndex(game) {
  if (!indexes.has(game)) indexes.set(game, (async () => {
    const file = {pokemon: "pk"}[game]; if (!file) return null;
    const base = new URL(`../data/${file}-index`, import.meta.url).href;
    const meta = await (await fetch(base + ".json", {cache: "no-cache"})).json();
    // one saved copy per game: a newer list replaces the old one instead of piling up
    const ver = `${meta.v}:${meta.built || ""}:${meta.cards.length}:${meta.dims}`, saved = await cacheGet("vidx:" + file, 365 * 864e5);
    let buf = saved && saved.ver === ver ? saved.buf : null;
    if (!buf) { buf = await (await fetch(base + ".bin")).arrayBuffer(); cacheSet("vidx:" + file, {ver, buf}); }
    // kept compact (1 byte per number) so it fits comfortably in a phone's memory
    const all = new Int8Array(buf), n = meta.cards.length, [dg, da] = meta.dims, D = dg + da, k = 1 / meta.scale;
    if (all.length !== n * D) { cacheSet("vidx:" + file, null); throw new Error("picture list download was incomplete"); }
    // a coarse 6×8 version of the overall look, for a very fast first pass over every card
    const cz = new Float32Array(n * 144), tmp = new Float32Array(dg);
    for (let i = 0; i < n; i++) { for (let j = 0; j < dg; j++) tmp[j] = all[i * D + j] * k; cz.set(coarse(tmp), i * 144); }
    return {meta, n, dg, da, D, k, all, cz, ids: meta.cards.map(c => c[0]), names: meta.cards.map(c => c[1]), nums: meta.cards.map(c => c[2])};
  })().catch(e => { indexes.delete(game); throw e; }));
  return indexes.get(game);
}

// ------------------------------------------------------------------ fingerprints
/** Shrink part of a picture to a w×h colour grid, corrected for brightness and contrast (room lighting). */
export function grid(src, w, h, x0 = 0, y0 = 0, x1 = 1, y1 = 1) {
  const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
  const a = document.createElement("canvas"); a.width = w * 4; a.height = h * 4;
  a.getContext("2d").drawImage(src, x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H, 0, 0, w * 4, h * 4);   // two steps shrink more smoothly
  const b = document.createElement("canvas"); b.width = w; b.height = h; const g = b.getContext("2d", {willReadFrequently: true}); g.drawImage(a, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, o = new Float32Array(w * h * 3);
  for (let c = 0; c < 3; c++) {
    let m = 0, v = 0;
    for (let i = 0; i < w * h; i++) m += d[i * 4 + c];
    m /= w * h;
    for (let i = 0; i < w * h; i++) v += (d[i * 4 + c] - m) ** 2;
    const sd = Math.sqrt(v / (w * h)) + 8;
    for (let i = 0; i < w * h; i++) o[i * 3 + c] = (d[i * 4 + c] - m) / sd;
  }
  let n = 0; for (const x of o) n += x * x; n = Math.sqrt(n) || 1;
  for (let i = 0; i < o.length; i++) o[i] /= n;
  return o;
}
/** Which cells are washed out by glare (bright and colourless). 1 = use it, 0 = ignore it. */
function glareMask(src, w, h, x0, y0, x1, y1) {
  const W = src.width, H = src.height, c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", {willReadFrequently: true}); g.drawImage(src, x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const mx = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]), mn = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); m[i] = mx > 225 && mx - mn < 40 ? 0 : 1; }
  return m;
}
export const ART = [.08, .1, .92, .52];   // where the artwork sits on most cards
function fingerprint(src, x0 = 0, y0 = 0, x1 = 1, y1 = 1, masks = false) {
  const L = t => x0 + (x1 - x0) * t, T = t => y0 + (y1 - y0) * t;
  const f = {g: grid(src, 12, 16, x0, y0, x1, y1), a: grid(src, 16, 12, L(ART[0]), T(ART[1]), L(ART[2]), T(ART[3]))};
  if (masks) { f.mg = glareMask(src, 12, 16, x0, y0, x1, y1); f.ma = glareMask(src, 16, 12, L(ART[0]), T(ART[1]), L(ART[2]), T(ART[3])); }
  return f;
}
/** 12×16 colour grid → 6×8 (average of each 2×2 block), length 1. */
function coarse(v) {
  const o = new Float32Array(144);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 12; x++) for (let c = 0; c < 3; c++) o[((y >> 1) * 6 + (x >> 1)) * 3 + c] += v[(y * 12 + x) * 3 + c];
  let n = 0; for (const x of o) n += x * x; n = Math.sqrt(n) || 1; for (let i = 0; i < 144; i++) o[i] /= n;
  return o;
}
export const rot180 = c => { const o = document.createElement("canvas"); o.width = c.width; o.height = c.height; const g = o.getContext("2d"); g.translate(c.width, c.height); g.rotate(Math.PI); g.drawImage(c, 0, 0); return o; };

// ------------------------------------------------------------------ comparing
/** Fast first pass: the n closest cards to a straightened card (either way up). */
function shortlist(ix, canvas, n = 40) {
  const best = new Map();
  for (const c of [canvas, rot180(canvas)]) {
    // glare spots carry no information: blank them so they can't pull the right card off the list
    const f = fingerprint(c, 0, 0, 1, 1, true);
    for (const [v, m] of [[f.g, f.mg], [f.a, f.ma]]) for (let i = 0; i < m.length; i++) if (!m[i]) v[i * 3] = v[i * 3 + 1] = v[i * 3 + 2] = 0;
    const q = coarse(f.g);
    // 1. coarse look over every card
    const cs = new Float32Array(ix.n);
    for (let i = 0; i < ix.n; i++) { let s = 0; const o = i * 144; for (let j = 0; j < 144; j++) s += q[j] * ix.cz[o + j]; cs[i] = s; }
    const pre = Array.from(cs.keys()).sort((p, r) => cs[r] - cs[p]).slice(0, 300);
    // 2. full fingerprint on the 300 closest
    for (const i of pre) {
      let s = 0; const og = i * ix.D, oa = og + ix.dg, A = ix.all;
      for (let j = 0; j < ix.dg; j++) s += f.g[j] * A[og + j];
      for (let j = 0; j < ix.da; j++) s += f.a[j] * A[oa + j];
      s *= ix.k;
      if (!best.has(i) || best.get(i) < s) best.set(i, s);
    }
  }
  const order = [...best.entries()].sort((p, r) => r[1] - p[1]);
  return {top: order.slice(0, n).map(x => x[0]), ranked: order.map(([i, s]) => ({i, s}))};
}/** Careful second pass: small shifts/zooms of the outline, glare ignored. Returns [{i, s}] best first. */
function refine(ix, wide, top) {
  const base = 1 + 2 * MG, out = new Map();
  const mdot = (q, arr, off, len, m) => { let s = 0, nq = 0, nx = 0; for (let i = 0; i < m.length; i++) if (m[i]) for (let c = 0; c < 3; c++) { const k = i * 3 + c, x = arr[off + k]; s += q[k] * x; nq += q[k] * q[k]; nx += x * x; } return nq && nx ? s / Math.sqrt(nq * nx) : 0; };
  for (const im of [wide, rot180(wide)])
    for (const sc of [.94, 1, 1.06]) for (const dx of [-.03, 0, .03]) for (const dy of [-.03, 0, .03]) {
      const w = sc / base, x0 = MG / base + (1 / base - w) / 2 + dx / base, y0 = MG / base + (1 / base - w) / 2 + dy / base;
      const f = fingerprint(im, x0, y0, x0 + w, y0 + w, true);
      for (const i of top) {
        const s = mdot(f.g, ix.all, i * ix.D, ix.dg, f.mg) + mdot(f.a, ix.all, i * ix.D + ix.dg, ix.da, f.ma);
        if (!out.has(i) || out.get(i) < s) out.set(i, s);
      }
    }
  return [...out.entries()].map(([i, s]) => ({i, s})).sort((p, q) => q.s - p.s);
}
/**
 * How clearly the best match stands out from the rest (a real card has one clear winner).
 * Reprints of the same card are left out of "the rest": telling those apart is the printed number's job.
 */
function standout(list, names) {
  if (!list.length) return 0;
  const top = names[list[0].i], rest = [];
  for (let j = 1; j < list.length && rest.length < 19; j++) if (names[list[j].i] !== top) rest.push(list[j].s);
  if (!rest.length) return 0;
  const mu = rest.reduce((p, q) => p + q, 0) / rest.length, sd = Math.sqrt(rest.reduce((p, q) => p + (q - mu) ** 2, 0) / rest.length) + 1e-6;
  return (list[0].s - mu) / sd;
}

// ------------------------------------------------------------------ finding cards in a photo
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function order4(pts) {   // top-left, top-right, bottom-right, bottom-left
  const s = pts.map(p => p[0] + p[1]), d = pts.map(p => p[1] - p[0]);
  return [pts[s.indexOf(Math.min(...s))], pts[d.indexOf(Math.min(...d))], pts[s.indexOf(Math.max(...s))], pts[d.indexOf(Math.max(...d))]];
}
const center = q => [q.pts.reduce((s, p) => s + p[0], 0) / 4, q.pts.reduce((s, p) => s + p[1], 0) / 4];
const inside = (pt, q) => { const P = q.pts; let r = false; for (let i = 0, j = 3; i < 4; j = i++) if ((P[i][1] > pt[1]) !== (P[j][1] > pt[1]) && pt[0] < (P[j][0] - P[i][0]) * (pt[1] - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) r = !r; return r; };

export const getCV = async () => { await loadCV(); return {cv: window.cv}; };
/**
 * Blurry photos lose the card's edge lines, but the card is still a different colour from the table.
 * Learn the table colour from the photo's border and mark everything that differs from it.
 */
function notTable(cv, sm) {
  const W = sm.cols, H = sm.rows, d = sm.data, b = Math.max(4, Math.round(Math.min(W, H) * .03)), rs = [], gs = [], bs = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (x < b || y < b || x >= W - b || y >= H - b) { const i = (y * W + x) * 4; rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); }
  const med = a => a.sort((p, q) => p - q)[a.length >> 1], R = med(rs), G = med(gs), B = med(bs);
  const dm = new cv.Mat(H, W, cv.CV_8UC1), o = dm.data;
  for (let i = 0, j = 0; j < W * H; i += 4, j++) o[j] = Math.min(255, Math.abs(d[i] - R) + Math.abs(d[i + 1] - G) + Math.abs(d[i + 2] - B));
  cv.GaussianBlur(dm, dm, new cv.Size(5, 5), 0);
  cv.threshold(dm, dm, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  const k = cv.Mat.ones(9, 9, cv.CV_8U); cv.morphologyEx(dm, dm, cv.MORPH_CLOSE, k); cv.morphologyEx(dm, dm, cv.MORPH_OPEN, k); k.delete();
  return dm;
}
/** Every card-shaped outline in the photo (in the photo's own pixels). */
function outlines(cv, src) {
  const k = 900 / Math.max(src.cols, src.rows), sm = new cv.Mat();
  cv.resize(src, sm, new cv.Size(Math.round(src.cols * k), Math.round(src.rows * k)), 0, 0, cv.INTER_AREA);
  const gray = new cv.Mat(); cv.cvtColor(sm, gray, cv.COLOR_RGBA2GRAY); cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
  const quads = [], area = sm.cols * sm.rows, maps = [];
  for (const [lo, hi] of [[30, 90], [60, 160], [12, 40]]) { const ed = new cv.Mat(); cv.Canny(gray, ed, lo, hi); const kern = cv.Mat.ones(3, 3, cv.CV_8U); cv.dilate(ed, ed, kern, new cv.Point(-1, -1), 1); kern.delete(); maps.push(ed); }
  { const t1 = new cv.Mat(); cv.adaptiveThreshold(gray, t1, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 31, 4); maps.push(t1);
    const t2 = new cv.Mat(); cv.threshold(gray, t2, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU); maps.push(t2);
    const t3 = new cv.Mat(); cv.bitwise_not(t2, t3); maps.push(t3);
    maps.push(notTable(cv, sm)); }
  for (const ed of maps) {
    const cs = new cv.MatVector(), hier = new cv.Mat(); cv.findContours(ed, cs, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < cs.size(); i++) {
      const c = cs.get(i), a = cv.contourArea(c);
      if (a > area * .012 && a < area * .97) {
        const hull = new cv.Mat(); cv.convexHull(c, hull);
        const ap = new cv.Mat(); cv.approxPolyDP(hull, ap, .03 * cv.arcLength(hull, true), true);
        const ha = cv.contourArea(hull); let pts = null;
        if (ap.rows === 4) { pts = []; for (let j = 0; j < 4; j++) pts.push([ap.data32S[j * 2], ap.data32S[j * 2 + 1]]); }
        else { const rr = cv.minAreaRect(hull); if (ha / (rr.size.width * rr.size.height) > .86) pts = cv.RotatedRect.points(rr).map(p => [p.x, p.y]); }
        if (pts) {
          const o = order4(pts), w = (dist(o[0], o[1]) + dist(o[3], o[2])) / 2, h = (dist(o[0], o[3]) + dist(o[1], o[2])) / 2, r = Math.min(w, h) / Math.max(w, h);
          if (r > .62 && r < .8 && ha > a * .8) quads.push({pts: o.map(([x, y]) => [x / k, y / k]), area: ha / area});
        }
        hull.delete(); ap.delete();
      }
      c.delete();
    }
    cs.delete(); hier.delete(); ed.delete();
  }
  sm.delete(); gray.delete();
  return quads;
}
/** Straighten one outline: a 245×342 card, the same with a border (for fine-tuning) and a big one (for reading the number). */
function straighten(cv, src, pts) {
  let p = pts; if (dist(p[0], p[1]) > dist(p[0], p[3])) p = [p[3], p[0], p[1], p[2]];   // lying sideways: stand it up
  const warp = (W, H, m, border) => {
    const s = cv.matFromArray(4, 1, cv.CV_32FC2, p.flat());
    const d = cv.matFromArray(4, 1, cv.CV_32FC2, [W * m, H * m, W * (1 + m), H * m, W * (1 + m), H * (1 + m), W * m, H * (1 + m)]);
    const M = cv.getPerspectiveTransform(s, d), o = new cv.Mat();
    cv.warpPerspective(src, o, M, new cv.Size(Math.round(W * (1 + 2 * m)), Math.round(H * (1 + 2 * m))), cv.INTER_LINEAR, border ? cv.BORDER_REPLICATE : cv.BORDER_CONSTANT);
    const c = document.createElement("canvas"); cv.imshow(c, o); [s, d, M, o].forEach(x => x.delete()); return c;
  };
  return {canvas: warp(CW, CH, 0), wide: warp(CW, CH, MG, true), big: warp(CW * 3, CH * 3, 0)};
}

/** Given some cards found on a binder page, add the pockets in between that were missed. */
function fillGrid(keep, W, H) {
  const cs = keep.map(center), ws = keep.map(q => (dist(q.pts[0], q.pts[1]) + dist(q.pts[3], q.pts[2])) / 2), hs = keep.map(q => (dist(q.pts[0], q.pts[3]) + dist(q.pts[1], q.pts[2])) / 2);
  const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const w = med(ws), h = med(hs);
  // group centres into rows and columns
  const groups = (vals, gap) => {
    const s = [...vals].sort((a, b) => a - b), out = [];
    for (const v of s) { const g = out.find(g => Math.abs(g.v - v) < gap); if (g) { g.n++; g.v += (v - g.v) / g.n; } else out.push({v, n: 1}); }
    // pockets are at least a card apart: a "column" squeezed between two others came from an outline
    // straddling two cards, so the one with fewer cards in it goes
    const kept = [];
    for (const g of out.sort((a, b) => b.n - a.n)) if (kept.every(k => Math.abs(k.v - g.v) > gap * 1.6)) kept.push(g);
    return kept.map(g => g.v).sort((a, b) => a - b);
  };
  const rows = groups(cs.map(c => c[1]), h * .5), cols = groups(cs.map(c => c[0]), w * .5);
  if (rows.length * cols.length > 16) return keep;
  // drop outlines that aren't on the grid, then fill the empty pockets
  const on = c => rows.some(y => Math.abs(c[1] - y) < h * .5) && cols.some(x => Math.abs(c[0] - x) < w * .5);
  keep = keep.filter((q, i) => on(cs[i]));
  const out = [...keep], cs2 = keep.map(center);
  if (rows.length * cols.length <= keep.length) return out;
  for (const y of rows) for (const x of cols) {
    if (cs2.some(c => Math.abs(c[0] - x) < w * .5 && Math.abs(c[1] - y) < h * .5)) continue;
    if (x - w / 2 < -w * .1 || y - h / 2 < -h * .1 || x + w / 2 > W + w * .1 || y + h / 2 > H + h * .1) continue;
    out.push({pts: [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]], area: keep[0] ? keep[0].area : 0, filled: true});
  }
  return out;
}

/**
 * Find the cards in a photo. one = true: the photo is of one card (the best outline wins, and the whole photo
 * is tried too in case the card fills it). Returns [{canvas, wide, big, at:[x,y], whole}].
 */
export async function findCards(image, one) {
  await loadCV(); const cv = window.cv;
  const cnv = document.createElement("canvas"); cnv.width = image.width; cnv.height = image.height; cnv.getContext("2d").drawImage(image, 0, 0);
  const src = cv.imread(cnv);
  try {
    const quads = outlines(cv, src);
    let keep;
    if (one) {
      const distinct = [];
      for (const q of quads.sort((a, b) => b.area - a.area)) { const c = center(q); if (!distinct.some(d => dist(center(d), c) < Math.max(src.cols, src.rows) * .01 && Math.abs(d.area - q.area) < d.area * .08)) distinct.push(q); }
      keep = distinct.slice(0, 10);
      // a box inside a bigger card-shaped box is usually the picture or text box, not the card
      for (const q of keep) q.inner = keep.some(o => o !== q && o.area > q.area * 1.5 && inside(center(q), o));
      const W = src.cols, H = src.rows;
      for (const t of [0, .04, .08]) keep.push({pts: [[W * t, H * t], [W * (1 - t), H * t], [W * (1 - t), H * (1 - t)], [W * t, H * (1 - t)]], area: (1 - 2 * t) ** 2, whole: true});
    } else {
      // a card-shaped thing with 3+ separate boxes inside it is the binder page itself.
      // (a card has only 2 inside it, its picture box and its text box, so a card isn't mistaken for a page)
      const boxesIn = q => { const inner = quads.filter(o => o !== q && o.area < q.area * .6 && o.area > q.area * .03 && inside(center(o), q)).sort((a, b) => b.area - a.area), top = [];
        for (const o of inner) if (!top.some(t => inside(center(o), t) || inside(center(t), o))) top.push(o); return top.length; };
      const notPage = quads.filter(q => boxesIn(q) < 3);
      notPage.sort((a, b) => b.area - a.area);
      keep = [];
      for (const q of notPage) if (!keep.some(k2 => inside(center(q), k2))) keep.push(q);
      if (keep.length > 1) {
        const med = [...keep].sort((a, b) => a.area - b.area)[Math.floor(keep.length / 2)].area;
        keep = keep.filter(q => q.area > med * .45 && q.area < med * 2.2);
        // two outlines overlapping (say one that spans two cards): keep the one closest to a normal card's size
        const size = q => [(dist(q.pts[0], q.pts[1]) + dist(q.pts[3], q.pts[2])) / 2, (dist(q.pts[0], q.pts[3]) + dist(q.pts[1], q.pts[2])) / 2];
        const solo = [];
        for (const q of keep.sort((a, b) => Math.abs(Math.log(a.area / med)) - Math.abs(Math.log(b.area / med)))) {
          const [w, h] = size(q), c = center(q);
          if (!solo.some(o => { const oc = center(o); return Math.abs(oc[0] - c[0]) < w * .8 && Math.abs(oc[1] - c[1]) < h * .8; })) solo.push(q);
        }
        keep = solo;
      }
      keep = keep.slice(0, 16);
      // binder pockets sit in a neat grid: if some cards weren't found, fill in the gaps of the grid
      if (keep.length >= 3) keep = fillGrid(keep, src.cols, src.rows);
      // reading order: top to bottom, then left to right
      const rowH = keep.length ? Math.sqrt(keep[0].area) * Math.max(src.cols, src.rows) * .5 : 1;
      keep.sort((a, b) => Math.round(center(a)[1] / rowH) - Math.round(center(b)[1] / rowH) || center(a)[0] - center(b)[0]);
    }
    return keep.map(q => ({...straighten(cv, src, q.pts), at: center(q), whole: !!q.whole, inner: !!q.inner, filled: !!q.filled, area: q.area}));
  } finally { src.delete(); }
}

/**
 * Match straightened cards against a game's fingerprint list.
 * found: from findCards (several outlines when one = true: the one whose match stands out most wins).
 * Returns {i: index position, list: [{id, name, num, s}], stand, gap} or null.
 */
export async function matchCard(game, found) {
  const ix = await loadIndex(game); if (!ix) return null;
  let best = null;
  // check the likeliest outlines carefully (refining all of them takes too long)
  const first = found.map(f => { const sl = shortlist(ix, f.canvas, 40); return {f, sl, quick: standout(sl.ranked.slice(0, 40), ix.names) * (.75 + .5 * Math.sqrt(f.area || 1)) * (f.inner ? .8 : 1)}; })
    .sort((a, b) => b.quick - a.quick).slice(0, 4);
  for (const {f, sl} of first) {
    const ref = refine(ix, f.wide, sl.top), stand = standout(ref, ix.names), rank = stand * (f.inner ? .8 : 1);
    if (!best || rank > best.rank) best = {f, ref, stand, rank};
  }
  if (!best) return null;
  const list = best.ref.slice(0, 8).map(r => ({id: ix.ids[r.i], name: ix.names[r.i], num: ix.nums[r.i], s: r.s}));
  return {list, stand: best.stand, gap: list.length > 1 ? list[0].s - list[1].s : 1, found: best.f};
}
