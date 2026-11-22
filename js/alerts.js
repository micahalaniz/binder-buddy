// Price alerts: after prices update, point out wishlist cards that reached your price and binder cards that
// moved a lot. Shown when you open the app (there's no server, so there are no push notifications).
import { cards, wants, db, loadLocal, saveLocal } from "./store.js";
import { $, esc } from "./util.js";
import { money, on, emit } from "./ui.js";

const KEY = "bb-alerts";
export const MOVE_PCT = 15, MOVE_MIN = 1;   // a "big move": at least 15% and at least $1 since the last price

/** Compare against the last check and collect new alerts. Call right after prices update. */
export async function checkAlerts() {
  const found = [];
  for (const w of wants.values()) {
    const hit = +w.max > 0 && w.market !== "" && w.market != null && +w.market <= +w.max;
    if (hit && !w.alerted) { found.push({kind: "want", id: w.id, name: w.name, text: `is ${money(w.market)}, at or under the ${money(w.max)} you'd pay`}); w.alerted = new Date().toISOString(); await db.put("wants", w); }
    if (!hit && w.alerted) { delete w.alerted; await db.put("wants", w); }   // re-arm for the next time it drops
  }
  for (const c of cards.values()) {
    const ph = c.ph || []; if (ph.length < 2 || c.cond === "Graded" || c.demo) continue;
    const a = +ph[ph.length - 2].v, b = +ph[ph.length - 1].v, d = b - a;
    if (a > 0 && Math.abs(d) >= MOVE_MIN && Math.abs(d / a * 100) >= MOVE_PCT && c.moveSeen !== ph[ph.length - 1].d) {
      found.push({kind: "move", id: c.id, name: c.name, up: d > 0, text: `${d > 0 ? "▲ up" : "▼ down"} ${Math.round(Math.abs(d / a) * 100)}% to ${money(b)} (was ${money(a)})`});
      c.moveSeen = ph[ph.length - 1].d; await db.put("cards", c);
    }
  }
  if (found.length) {
    const ids = new Set(found.map(a => a.kind + a.id));   // newest alert per card replaces an older one
    saveLocal(KEY, [...found, ...loadLocal(KEY, []).filter(a => !ids.has(a.kind + a.id))].slice(0, 30));
  }
  drawAlerts();
  return found.length;
}

export function drawAlerts() {
  const A = loadLocal(KEY, []).filter(a => (a.kind === "want" ? wants : cards).has(a.id));
  const box = $("alerts"); if (!box) return;
  $("wishDot").hidden = !A.some(a => a.kind === "want");
  if (!A.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="alerts" role="status"><b>🔔 Price alerts</b>
    <ul>${A.slice(0, 5).map(a => `<li><button type="button" class="linkbtn" data-al="${a.kind}:${esc(a.id)}">${a.kind === "want" ? "⭐ " : ""}${esc(a.name)}</button> ${esc(a.text)}</li>`).join("")}</ul>
    ${A.length > 5 ? `<p class="note">+${A.length - 5} more</p>` : ""}<button type="button" class="btn ghost small" id="al-clear">Got it, clear these</button></div>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-al]");
  if (b) { const [kind, id] = b.dataset.al.split(":"); if (kind === "want") emit("tab", "wish"); else emit("detail", id); return; }
  if (e.target.id === "al-clear") { saveLocal(KEY, []); drawAlerts(); }
});
on("prices:updated", checkAlerts);
on("data", drawAlerts);
