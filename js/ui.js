// Display helpers shared by every screen.
import { GAMES, rarLevel } from "./logic.js";
import { S, photoURL } from "./store.js";
import { $, esc, mix, lum } from "./util.js";

export const VERSION = "2.7.1";

// tiny event bus: screens tell each other when data changes
const subs = {};
export const on = (ev, fn) => (subs[ev] = subs[ev] || []).push(fn);
export const emit = (ev, data) => (subs[ev] || []).forEach(fn => fn(data));

export const money = n => S.cur + (Math.round((+n || 0) * 100) / 100).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
export const moneyOr = (n, dash = "no price yet") => n === "" || n == null ? dash : money(n);
export const signed = n => (n >= 0 ? "+" : "−") + money(Math.abs(n));

export const gameColor = g => S.gameColors[g] || (GAMES[g] && GAMES[g].color) || "#999";
const COND_COL = {"Near Mint": "#1a8a4a", "Lightly Played": "#3d8fe0", "Moderately Played": "#c99400", "Heavily Played": "#e06a14", "Damaged": "#d23a33", "Graded": "#8b5cf6"};
export const condColor = c => S.condColors[c] || COND_COL[c] || "#999";
export const condLabel = c => c.kind === "sealed" ? "📦 " + (c.product || "Sealed") : c.cond === "Graded" && c.grade ? c.grade : (c.cond || "Near Mint");
const RAR_PAL = ["#9aa0b8", "#59b36b", "#3d8fe0", "#8b5cf6", "#e0559b", "#f0a020", "#e6b800"];
export function stripe(c) {
  if (S.colorBy === "game") return gameColor(c.game);
  if (S.colorBy === "condition") return condColor(c.cond);
  if (S.colorBy === "rarity") { const l = rarLevel(c); return l < 0 ? "transparent" : RAR_PAL[Math.min(6, Math.floor(l * 6.99))]; }
  if (S.colorBy === "tag") { const t = S.tags.find(x => (c.tags || []).includes(x.id)); return t ? t.color : "transparent"; }
  return "transparent";
}
export const tagsHTML = c => (c.tags || []).map(t => S.tags.find(x => x.id === t)).filter(Boolean)
  .map(t => `<span class="tag" style="background:${t.color}">${esc(t.name)}</span>`).join("");

/** <img> for a card: my own photo first, then the official picture. */
export function cardImg(c, cls = "thumb", attrs = "") {
  const ph = c.photos && c.photos[0];
  if (ph) return `<img class="${cls}" data-ph="${ph}" alt="${esc(c.name)}" ${attrs}>`;
  if (c.img) return `<img class="${cls}" src="${esc(c.img)}" alt="${esc(c.name)}" loading="lazy" ${attrs}>`;
  return "";
}
export async function fillPhotos(root) {
  for (const img of root.querySelectorAll("img[data-ph]")) { const u = await photoURL(img.dataset.ph); if (u) img.src = u; }
}

export const daysOld = c => c.priced ? (Date.now() - Date.parse(c.priced)) / 864e5 : 999;
/** Change since the oldest point in the card's own price log (last 30 days). */
export function move(c) {
  const ph = c.ph || [];
  if (ph.length < 2 || !(+c.market > 0)) return null;
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const base = ph.find(p => p.d >= cutoff) || ph[0];
  if (!base || !(base.v > 0) || base === ph[ph.length - 1]) return null;
  return {abs: +c.market - base.v, pct: Math.round((+c.market - base.v) / base.v * 100), since: base.d};
}

export function applyTheme() {
  const r = document.documentElement.style, dark = +S.dark === 1;
  r.setProperty("--bg", S.bg);
  r.setProperty("--accent", S.accent);
  // pick whichever text color reads better on the main color (WCAG contrast ratio)
  const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), L = relLum(S.accent);
  r.setProperty("--accent-ink", cr(L, 1) >= cr(L, relLum("#1f2340")) ? "#ffffff" : "#1f2340");
  r.setProperty("--surface", dark ? mix(S.bg, "#ffffff", 0.08) : "#ffffff");
  r.setProperty("--ink", dark ? "#eef0ff" : "#1f2340");
  r.setProperty("--soft", dark ? "#a9aecd" : "#5a5f84");
  r.setProperty("--line", dark ? mix(S.bg, "#ffffff", 0.18) : mix(S.bg, "#9aa3c7", 0.25));
  r.setProperty("--ok", dark ? "#3fc77a" : "#1a8a4a");
  r.setProperty("--bad", dark ? "#ff6b63" : "#d23a33");
  r.setProperty("--warn", dark ? "#f0b93a" : "#9a6a00");
  r.colorScheme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = S.accent;
  $("appTitle").textContent = S.title || "📒 Binder Buddy";
  document.body.classList.toggle("compact", S.layout === "compact");
}

/** WCAG relative luminance of a #rrggbb color. */
function relLum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
