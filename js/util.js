// Small helpers shared by every screen.

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[c]));
export const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const today = () => new Date().toISOString().slice(0, 10);

export function toast(text, ms = 2600) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), ms);
}

/** Blend two #rrggbb colors; k = 0 gives a, k = 1 gives b. */
export function mix(a, b, k) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, "0")).join("");
}
export const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** A row of toggle buttons. opts = [[value, label], ...] */
export function seg(el, opts, cur, onPick) {
  el.innerHTML = opts.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${String(cur) === String(v) ? "on" : ""}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join("");
  el.onclick = e => { const b = e.target.closest("[data-v]"); if (b) onPick(b.dataset.v); };
}

// ---- sheets (modals): Escape closes, focus moves in and back out
const opened = [];
export function openSheet(id, focusSel) {
  const m = $(id);
  if (m.classList.contains("open")) return;
  opened.push({id, back: document.activeElement});
  m.style.zIndex = 10 + opened.length;   // newest sheet on top (search opened from the scanner was hiding behind it)
  m.classList.add("open");
  document.body.classList.add("locked");
  const f = focusSel ? m.querySelector(focusSel) : m.querySelector(".sheet");
  setTimeout(() => f && f.focus({preventScroll: true}), 30);
}
export function closeSheet(id) {
  const m = $(id);
  if (!m.classList.contains("open")) return;
  m.classList.remove("open"); m.style.zIndex = "";
  const i = opened.findIndex(o => o.id === id);
  const o = i >= 0 ? opened.splice(i, 1)[0] : null;
  if (!opened.length) document.body.classList.remove("locked");
  if (o && o.back && o.back.focus) o.back.focus({preventScroll: true});
  m.dispatchEvent(new Event("closed"));
}
export const topSheet = () => opened.length ? opened[opened.length - 1].id : null;
document.addEventListener("keydown", e => { if (e.key === "Escape" && topSheet()) closeSheet(topSheet()); });

export async function copyText(text, okMsg = "Copied!") {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch (e) { toast("Couldn't copy on this device."); }
}

export function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function loadImg(src) {
  return new Promise((res, rej) => {
    const blob = src instanceof Blob, u = blob ? URL.createObjectURL(src) : src, im = new Image();
    if (!blob) im.crossOrigin = "anonymous";
    im.onload = () => { if (blob) URL.revokeObjectURL(u); res(im); };
    im.onerror = () => { if (blob) URL.revokeObjectURL(u); rej(new Error("image failed")); };
    im.src = u;
  });
}
export const toJpeg = (cv, q = 0.86) => new Promise(r => cv.toBlob(r, "image/jpeg", q));
