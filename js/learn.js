// The scanner learns from mistakes.
// 1. Your fixes: when you pick a different card than the scanner's first guess, it remembers what it read
//    and which card was right, on this device, and gets it right next time.
// 2. Everyone's fixes: reports that a person has checked ship in js/fixes.js with each update.
// 3. Reports: the 🚩 button writes up what went wrong (what it read and what was right, never your photo)
//    so it can be fixed for everyone.
import { normNum } from "./logic.js";
import { FIXES } from "./fixes.js";
import { loadLocal, saveLocal } from "./store.js";

const KEY = "bb-learn", MAX = 400, REPO = "https://github.com/micahalaniz/binder-buddy";

/** Strong keys come from the printed card code. One means one exact card. */
export function codeKeys(p) {
  const k = [];
  if (p.opId) k.push("op:" + p.opId);
  if (p.ygoCode) k.push("ygo:" + p.ygoCode);
  if (p.lorSet && p.lorNum) k.push("lor:" + p.lorSet + "/" + p.lorNum);
  if (p.num && p.total) k.push("pk:" + normNum(p.num) + "/" + normNum(p.total));
  return k;
}
/** A weak key comes from the name text. It only says "this card might be one of these". */
export function wordKey(p) {
  const w = (p.words || []).map(x => x.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(x => x.length >= 4)[0];
  return w ? "w:" + w : null;
}

const mem = () => loadLocal(KEY, []);
export const learnedCount = () => mem().length;
export function clearLearned() { saveLocal(KEY, []); }

/** Has anyone fixed this read before? Returns {ref, how: "you" | "everyone", strong} or null. */
export function recall(p) {
  const m = mem(), codes = codeKeys(p);
  for (const k of codes) { const hit = m.find(x => x.k === k); if (hit) return {ref: hit.ref, how: "you", strong: true}; }
  for (const k of codes) { const hit = FIXES.find(x => x.k === k); if (hit) return {ref: hit.ref, how: "everyone", strong: true}; }
  const w = wordKey(p), hit = w && m.find(x => x.k === w);
  return hit ? {ref: hit.ref, how: "you", strong: false} : null;
}

/** Remember that this read was really this card. The newest fix wins. */
export function remember(p, card) {
  if (!card || !card.src || !card.id) return 0;
  const keys = [...codeKeys(p), wordKey(p)].filter(Boolean);
  if (!keys.length) return 0;
  const m = mem().filter(x => !keys.includes(x.k));
  for (const k of keys) m.unshift({k, ref: {src: card.src, id: card.id}, name: card.name, t: Date.now()});
  saveLocal(KEY, m.slice(0, MAX));
  return keys.length;
}

// ------------------------------------------------------------------ reports
let lastError = "";
window.addEventListener("error", e => { lastError = String(e.message || "").slice(0, 300); });
window.addEventListener("unhandledrejection", e => { lastError = String(e.reason && e.reason.message || e.reason || "").slice(0, 300); });

/** Open a ready-to-send report. Nothing is sent unless the person presses Submit on GitHub. */
export function reportURL(title, lines, version) {
  const body = [...lines, "", "---", `App version: ${version}`, `Browser: ${navigator.userAgent.slice(0, 160)}`, lastError ? `Last error: ${lastError}` : ""]
    .filter(x => x !== null).join("\n").slice(0, 6000);
  return `${REPO}/issues/new?title=${encodeURIComponent(title.slice(0, 120))}&body=${encodeURIComponent(body)}`;
}
export function scanReport(res, chosen, version) {
  const c = (res.candidates || []).slice(0, 4).map((x, i) => `${i + 1}. ${x.name} ${x.set || ""} ${x.num || ""} (${x.src}:${x.id})`);
  return reportURL(`Wrong scan: ${chosen ? chosen.name : "couldn't find the card"}`, [
    "**What the scanner suggested**", ...(c.length ? c : ["(nothing)"]), "",
    "**The right card**", chosen ? `${chosen.name} ${chosen.set || ""} ${chosen.num || ""} (${chosen.src}:${chosen.id})` : "(please type the card name, set and number here)", "",
    "**What the scanner read**", "Codes: " + (codeKeys(res.parsed || {}).join(", ") || "none"), "Words: " + ((res.parsed && res.parsed.words) || []).join(", "),
    "```", String(res.text || "").replace(/`/g, "'").slice(-700), "```",
  ], version);
}
