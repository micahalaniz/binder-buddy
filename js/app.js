// Binder Buddy · Sweet Onion Studios
// Starts the app: loads your data from this device, wires up the tabs, and keeps prices fresh.
import { S, openDB, db, cards, wants } from "./store.js";
import { $, toast, closeSheet } from "./util.js";
import { applyTheme, on, emit } from "./ui.js";
import { render, answer, updatePrices, openEdit } from "./binder.js";
import { openPicker } from "./picker.js";
import { renderWishes } from "./wishlist.js";
import { renderTrade } from "./trade.js";
import "./pricecheck.js";
import { openScan } from "./scanui.js";
import { openShare } from "./share.js";
import { openWelcome } from "./more.js";
import { openFriend, drawPanel } from "./tradelink.js";

// ---------------------------------------------------------------- tabs (also reachable as #wish, #trade, #check, #more)
const VIEWS = ["binder", "wish", "trade", "check", "more"];
function showTab(v, push = true) {
  if (v.startsWith("t=")) { openTradeLink(v.slice(2)); return; }
  if (!VIEWS.includes(v)) v = "binder";
  for (const k of VIEWS) $("v-" + k).classList.toggle("on", k === v);
  document.querySelectorAll(".tabs button").forEach(b => { const on = b.dataset.v === v; b.classList.toggle("on", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  if (v === "wish") renderWishes();
  if (v === "trade") { renderTrade(); drawPanel(); }
  if (push) history.replaceState(null, "", v === "binder" ? location.pathname : "#" + v);
  window.scrollTo({top: 0});
}
document.querySelector(".tabs").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (b) showTab(b.dataset.v); });
on("tab", v => showTab(v));
window.addEventListener("hashchange", () => showTab(location.hash.slice(1), false));

// ---------------------------------------------------------------- buttons that open things
const addCard = () => openPicker({onPick: r => openEdit(null, r), onManual: (g, t) => openEdit(null, {game: g, name: t})});
$("scanBtn").onclick = openScan;
$("shareBtn").onclick = openShare;
on("empty:add", addCard);
on("empty:scan", openScan);
document.addEventListener("click", e => { const x = e.target.closest("[data-close]"); if (x) { const m = x.closest(".modal"); if (m) closeSheet(m.id); } });
document.querySelectorAll(".modal").forEach(m => m.addEventListener("click", e => {
  if (e.target === m && !["m-edit", "m-welcome", "m-scan"].includes(m.id)) closeSheet(m.id);
}));

// ---------------------------------------------------------------- start
(async () => {
  applyTheme();
  try {
    await openDB();
    (await db.all("cards")).forEach(c => cards.set(c.id, c));
    (await db.all("wants")).forEach(w => wants.set(w.id, w));
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (e) {
    $("out").innerHTML = `<div class="empty">This browser can't save cards (private mode?). Open Binder Buddy in a normal browser window.</div>`;
    return;
  }
  render();
  const fromLink = location.hash.startsWith("#t=");   // a friend's trade link
  showTab(location.hash.slice(1), false);
  if (fromLink) { /* their binder is showing; the welcome comes after they close it */ }
  else if (!S.welcomed && !cards.size) openWelcome();
  else if (new URLSearchParams(location.search).has("scan")) openScan();   // home-screen shortcut
  // fresh prices once a day, quietly
  const age = S.lastPriced ? Date.now() - Date.parse(S.lastPriced) : Infinity;
  if (+S.autoPrice && navigator.onLine && age > 20 * 3600e3 && [...cards.values(), ...wants.values()].some(c => c.ref)) setTimeout(() => updatePrices(true), 1200);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
window.addEventListener("online", () => toast("Back online"));

// A friend's trade link (#t=...): show their binder on the Trade tab, then tidy the address bar.
async function openTradeLink(hash) {
  showTab("trade", false);
  history.replaceState(null, "", "#trade");
  if (await openFriend(hash) && !S.welcomed && !cards.size) {
    // first visit from a friend's link: after they look, offer the welcome tour
    const m = $("m-friend"), obs = new MutationObserver(() => { if (!m.classList.contains("open")) { obs.disconnect(); openWelcome(); } });
    obs.observe(m, {attributes: true, attributeFilter: ["class"]});
  }
}
