// A small single-series line chart in SVG: 2px line in the theme's main color, soft area,
// recessive grid, hover/touch crosshair with a tooltip, and a hidden table for screen readers.
import { esc } from "./util.js";

/**
 * @param {HTMLElement} el   container
 * @param {{label:string, v:number}[]} pts
 * @param {(n:number)=>string} fmt   money formatter
 * @param {string} title  accessible name
 */
export function lineChart(el, pts, fmt, title) {
  if (!pts.length) { el.innerHTML = ""; return; }
  const W = 600, H = 170, L = 8, R = 8, T = 16, B = 22;
  const vs = pts.map(p => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < 0.01) { lo = lo * 0.95; hi = hi * 1.05 + 0.01; }
  const pad = (hi - lo) * 0.12; lo = Math.max(0, lo - pad); hi += pad;
  const x = i => L + (pts.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (pts.length - 1));
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = `${line}L${x(pts.length - 1).toFixed(1)},${H - B}L${x(0).toFixed(1)},${H - B}Z`;
  const grid = [0.25, 0.5, 0.75].map(k => `<line x1="${L}" x2="${W - R}" y1="${(T + k * (H - T - B)).toFixed(1)}" y2="${(T + k * (H - T - B)).toFixed(1)}" class="ch-grid"/>`).join("");
  const last = pts[pts.length - 1];
  el.innerHTML = `
    <div class="ch-wrap">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(title)}" class="ch">
        ${grid}
        <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="ch-base"/>
        <path d="${area}" class="ch-area"/>
        <path d="${line}" class="ch-line" vector-effect="non-scaling-stroke"/>
        <line class="ch-cross" y1="${T - 6}" y2="${H - B}" x1="0" x2="0" visibility="hidden" vector-effect="non-scaling-stroke"/>
      </svg>
      <span class="ch-dot" style="left:${x(pts.length - 1) / W * 100}%;top:${y(last.v) / H * 100}%"></span>
      <span class="ch-dot hov" hidden></span>
      <div class="ch-tip" hidden></div>
      <div class="ch-x"><span>${esc(pts[0].label)}</span><span>${esc(last.label)}</span></div>
    </div>
    <table class="sr-only"><caption>${esc(title)}</caption><tr><th>Date</th><th>Value</th></tr>
      ${pts.map(p => `<tr><td>${esc(p.label)}</td><td>${esc(fmt(p.v))}</td></tr>`).join("")}</table>`;
  const wrap = el.querySelector(".ch-wrap"), tip = el.querySelector(".ch-tip"), cross = el.querySelector(".ch-cross"), dot = el.querySelector(".ch-dot.hov");
  const show = e => {
    const r = wrap.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round((px - L) / ((W - L - R) / Math.max(1, pts.length - 1)))));
    const p = pts[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    dot.hidden = false; dot.style.left = x(i) / W * 100 + "%"; dot.style.top = y(p.v) / H * 100 + "%";
    tip.hidden = false; tip.innerHTML = `<b>${esc(fmt(p.v))}</b><span>${esc(p.label)}</span>`;
    const left = x(i) / W * r.width;
    tip.style.left = Math.max(4, Math.min(r.width - tip.offsetWidth - 4, left - tip.offsetWidth / 2)) + "px";
  };
  const hide = () => { tip.hidden = true; dot.hidden = true; cross.setAttribute("visibility", "hidden"); };
  wrap.addEventListener("pointermove", show);
  wrap.addEventListener("pointerdown", show);
  wrap.addEventListener("pointerleave", hide);
}
