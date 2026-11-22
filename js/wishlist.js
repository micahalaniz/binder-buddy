// Wishlist: cards you're hunting, with the most you'd pay. Shows when the market drops to your price.
import { GAMES, priceLinks } from "./logic.js";
import { wants, db } from "./store.js";
import { logPrice } from "./catalog.js";
import { $, esc, newId, toast, openSheet, closeSheet } from "./util.js";
import { money, moneyOr, signed, on, emit } from "./ui.js";
import { openPicker } from "./picker.js";
import { openEdit, linkFields } from "./binder.js";

let editing = null, link = null;
const saveWant = w => { wants.set(w.id, w); return db.put("wants", w); };
export const wantStatus = w => {
  if (!(+w.max > 0) || w.market === "" || w.market == null) return null;
  return +w.market <= +w.max ? {ok: true, text: "✅ At or under your price. Good time to buy!"} : {ok: false, text: `Wait: ${money(w.market - w.max)} over your price`};
};

export function renderWishes() {
  const list = [...wants.values()].sort((a, b) => {
    const r = w => (+w.max > 0 && +w.market > 0 ? w.market / w.max : 9);
    return r(a) - r(b);
  });
  const ready = list.filter(w => { const s = wantStatus(w); return s && s.ok; }).length;
  $("wishSum").textContent = list.length ? `${list.length} card${list.length > 1 ? "s" : ""} on your list${ready ? ` · ${ready} at or under your price right now` : ""}.` : "";
  if (!list.length) { $("wishOut").innerHTML = `<div class="empty">Nothing on your wishlist yet.<br>Add the cards you're chasing, plus the most you'd pay.</div>`; return; }
  $("wishOut").innerHTML = list.map(w => {
    const s = wantStatus(w), buy = priceLinks(w)[0];
    return `<div class="card${w.img ? " withpic" : ""}" data-w="${w.id}">
      ${w.img ? `<img class="thumb" src="${esc(w.img)}" alt="${esc(w.name)}" loading="lazy">` : ""}
      <div><div class="nm">${esc(w.name)}</div>
        <div class="meta">${esc([GAMES[w.game] ? GAMES[w.game].name : "", w.set, w.num].filter(Boolean).join(" · "))}</div>
        <div class="meta">${w.rarity ? `<span class="tag soft">${esc(w.rarity)}</span>` : ""}${w.note ? esc(w.note) : ""}</div></div>
      <div style="text-align:right;font-weight:800"><div class="note">market</div>${moneyOr(w.market, "?")}</div>
      <div class="money">
        <span>My price: <b>${+w.max > 0 ? money(w.max) : "not set"}</b></span>
        ${s ? `<span class="${s.ok ? "up" : "stale"}">${s.text}</span>` : ""}
        <a href="${esc(buy.url)}" target="_blank" rel="noopener">Shop ↗</a>
        <button class="linkbtn" data-a="got">I got it!</button>
        <button class="linkbtn" data-a="edit">Edit</button>
      </div></div>`;
  }).join("");
}

export function addWant(text = "") {
  openPicker({title: "Add a card I want", text, onPick: r => openWant(null, r), onManual: (g, t) => openWant(null, {game: g, name: t}), manualLabel: "Can't find it? Type the name"});
}
function openWant(id, pre = {}) {
  editing = id;
  const w = id ? wants.get(id) : null;
  link = w ? (w.ref ? w : null) : (pre.src ? {...linkFields(pre), game: pre.game, set: pre.set, num: pre.num, rarity: pre.rarity} : null);
  $("w-title").textContent = id ? "Edit wishlist card" : "Add to wishlist";
  $("w-name").value = w ? w.name : pre.name || "";
  $("w-max").value = w ? w.max ?? "" : "";
  $("w-mkt").value = w ? w.market ?? "" : link ? link.market ?? "" : "";
  $("w-note").value = w ? w.note || "" : "";
  $("w-linked").innerHTML = link ? `<div class="linked">${link.img ? `<img src="${esc(link.img)}" alt="">` : ""}<span>🔗 ${esc([link.set, link.num].filter(Boolean).join(" · "))}<br>Market price updates by itself every day.</span></div>` : "";
  $("w-del").hidden = !id;
  pre.game && ($("w-name").dataset.game = pre.game);
  openSheet("m-want", "#w-max");
}
$("w-save").onclick = async () => {
  const name = $("w-name").value.trim(); if (!name) return toast("Give it a name first.");
  const old = editing ? wants.get(editing) : {};
  const w = {...old, id: editing || newId("w"), name, max: $("w-max").value === "" ? "" : +$("w-max").value,
    market: $("w-mkt").value === "" ? "" : +$("w-mkt").value, note: $("w-note").value.trim(), added: old.added || new Date().toISOString(),
    game: old.game || (link && link.game) || $("w-name").dataset.game || "pokemon"};
  if (link && !editing) Object.assign(w, {ref: link.ref, img: link.img, imgLg: link.imgLg, tcgId: link.tcgId, variants: link.variants, set: link.set, num: link.num, rarity: link.rarity, priced: link.priced});
  logPrice(w);
  await saveWant(w); closeSheet("m-want"); renderWishes(); toast(editing ? "Saved" : "Added to your wishlist");
};
$("w-del").onclick = async () => { wants.delete(editing); await db.del("wants", editing); closeSheet("m-want"); renderWishes(); toast("Removed"); };
$("wishAdd").onclick = () => addWant();
$("wishOut").addEventListener("click", e => {
  const a = e.target.closest("[data-a]"), host = e.target.closest("[data-w]"); if (!a || !host) return;
  const w = wants.get(host.dataset.w);
  if (a.dataset.a === "edit") openWant(w.id);
  if (a.dataset.a === "got") {
    const pre = w.ref ? {src: w.ref.src, id: w.ref.id, game: w.game, name: w.name, set: w.set, num: w.num, rarity: w.rarity, img: w.img, imgLg: w.imgLg, tcgId: w.tcgId, variants: w.variants || {}, market: w.market}
      : {game: w.game, name: w.name, market: w.market};
    openEdit(null, pre, async () => { wants.delete(w.id); await db.del("wants", w.id); renderWishes(); toast("Nice pull! Moved to your binder 🎉"); });
  }
});
on("want:add", t => { emit("tab", "wish"); addWant(t); });
on("data", renderWishes);

/** Add a card straight to the wishlist (from set progress). r: a card-database card. */
export async function quickWant(r) {
  const have = [...wants.values()].find(w => w.ref && w.ref.id === r.id);
  if (have) { toast("Already on your wishlist"); return false; }
  const w = {id: newId("w"), game: r.game, name: r.name, set: r.set, num: r.num, rarity: r.rarity, max: "", note: "", added: new Date().toISOString(), ...linkFields(r)};
  logPrice(w); await saveWant(w); emit("data");
  return true;
}
