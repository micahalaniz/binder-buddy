// Trade checker: "I give" vs "I get" at market value, with a fair/ahead/behind call.
import { tradeVerdict, sideTotal } from "./logic.js";
import { cards, loadLocal, saveLocal, db } from "./store.js";
import { $, esc, newId, toast, openSheet, closeSheet, copyText } from "./util.js";
import { money, cardImg, fillPhotos, on, emit } from "./ui.js";
import { openPicker } from "./picker.js";
import { linkFields, saveCard } from "./binder.js";
import { logPrice } from "./catalog.js";

let T = loadLocal("bb-trade", {give: [], get: []});
const save = () => saveLocal("bb-trade", T);

const WHERE = [
  ["🏪 Local game stores & card shows", "The safest way: you see every card in person. Many stores run weekly Pokémon, One Piece and Lorcana nights where people trade."],
  ["🛒 TCGplayer", "Big US marketplace for buying and selling singles, with buyer protection. It's for buying and selling, not swapping."],
  ["🛒 eBay", "Buy and sell anything. Check seller ratings and always pay through eBay checkout. Its sold listings show real prices."],
  ["🇪🇺 Cardmarket & CardTrader", "The big marketplaces in Europe, with protected payments."],
  ["💬 Reddit (r/pkmntcgtrades)", "A busy trading community. Check a trader's history and feedback before you trade."],
  ["💬 Facebook groups & Discord servers", "Lots of local and fan groups. More scams happen here, so ask for references and use protected payments."],
  ["📺 Whatnot", "Live-stream auctions and pack breaks. Fun, but easy to overspend, so set a limit first."],
];
const SAFETY = [
  "Under 18? Trade online only with a parent. Most marketplaces require you to be 18.",
  "Pay with buyer protection (like PayPal Goods & Services or the site's checkout). Never use \"Friends & Family\" with a stranger.",
  "Ask for photos of the real cards with their name and today's date on a paper next to them.",
  "Use tracked shipping, and the person with less trade history usually sends first.",
  "If a deal sounds too good to be true, it is. Walk away.",
];

function itemRow(it, side, i) {
  return `<div class="titem">${cardImg(it, "") || `<div class="nopic"></div>`}
    <div>${it.manual ? `<input data-f="name" data-s="${side}" data-i="${i}" value="${esc(it.name)}" placeholder="Card name" style="width:100%">` : `<b>${esc(it.name)}</b>`}
      <span class="note">${it.qty > 1 ? it.qty + " × " : ""}${it.from === "mine" ? "from my binder" : esc(it.set || "")}</span></div>
    <div style="display:flex;align-items:center;gap:4px"><input type="number" min="0" step="0.01" inputmode="decimal" aria-label="Value of ${esc(it.name || "card")}" data-f="value" data-s="${side}" data-i="${i}" value="${it.value === "" ? "" : it.value}">
      <button class="rm" data-rm="${side}:${i}" aria-label="Remove">✕</button></div></div>`;
}
export function renderTrade() {
  for (const side of ["give", "get"]) {
    $("t-" + side).innerHTML = T[side].length ? T[side].map((it, i) => itemRow(it, side, i)).join("") : `<p class="note">Nothing yet.</p>`;
    $(`t-${side}-total`).textContent = money(sideTotal(T[side]));
    fillPhotos($("t-" + side));
  }
  drawVerdict();
}
function drawVerdict() {
  $("t-give-total").textContent = money(sideTotal(T.give)); $("t-get-total").textContent = money(sideTotal(T.get));
  const v = tradeVerdict(T.give, T.get);
  const box = $("t-verdict");
  if (v.key === "empty") { box.innerHTML = ""; return; }
  const gap = money(Math.abs(v.diff));
  const map = {
    fair: ["ok", "🤝 Fair trade!", `The two sides are within ${Math.max(1, Math.round(v.pct * 100))}% of each other. Nice and even.`],
    ahead: ["warn", "📈 You come out ahead", `You get about ${gap} more. If they're a friend, keep it fair by adding a little to their side.`],
    behind: ["bad", "📉 You'd lose value", `You give about ${gap} more than you get. Ask them to add about ${gap}, or take something off your side.`],
  }[v.key];
  box.innerHTML = `<div class="verdict ${map[0]}"><div class="vh">${map[1]}</div><p style="margin:6px 0 0;font-weight:700">${map[2]}</p>
    <p class="note" style="margin:6px 0 0">I give ${money(v.give)} · I get ${money(v.get)}</p></div>`;
}

function addMine() {
  const draw = () => {
    const q = $("mi-q").value.trim().toLowerCase();
    const list = [...cards.values()].filter(c => (+c.qty || 0) > 0 && (!q || (c.name + " " + c.set + " " + c.num).toLowerCase().includes(q)))
      .sort((a, b) => (+b.market || 0) - (+a.market || 0)).slice(0, 80);
    $("mi-out").innerHTML = list.length ? list.map(c => `<div class="card${cardImg(c) ? " withpic" : ""}" data-id="${c.id}" role="button" tabindex="0">${cardImg(c)}
      <div><div class="nm">${esc(c.name)}</div><div class="meta">${esc([c.set, c.num].filter(Boolean).join(" · "))} · I have ${c.qty}</div></div><b>${money(c.market)}</b></div>`).join("")
      : `<div class="empty">No cards in your binder${q ? " match" : " yet"}.</div>`;
    fillPhotos($("mi-out"));
  };
  $("mi-q").value = ""; $("mi-q").oninput = draw; draw();
  openSheet("m-mine", "#mi-q");
}
function giveCard(id) {
  const c = cards.get(id); if (!c) return;
  const have = T.give.find(x => x.cardId === id);
  if (have) { if (have.qty < (+c.qty || 1)) have.qty++; else toast(`You only have ${c.qty}.`); }
  else T.give.push({from: "mine", cardId: id, name: c.name, set: c.set, img: c.img, photos: (c.photos || []).slice(0, 1), value: +c.market || "", qty: 1});
  save(); renderTrade();
}
$("mi-out").addEventListener("click", e => { const h = e.target.closest("[data-id]"); if (!h) return; closeSheet("m-mine"); giveCard(h.dataset.id); });
const findFor = side => openPicker({title: side === "give" ? "Find a card I'm giving" : "Find a card I'm getting", onPick: r => {
  T[side].push({from: "db", name: r.name, set: r.set, num: r.num, rarity: r.rarity, game: r.game, img: r.img, value: r.market ?? "", qty: 1, link: linkFields(r)});
  save(); renderTrade();
}, onManual: (g, t) => { T[side].push({manual: true, name: t || "", game: g, value: "", qty: 1}); save(); renderTrade(); }});

$("t-give-add").onclick = addMine;
$("t-give-find").onclick = () => findFor("give");
$("t-get-find").onclick = () => findFor("get");
$("t-get-manual").onclick = () => { T.get.push({manual: true, name: "", value: "", qty: 1, game: "pokemon"}); save(); renderTrade(); };
$("v-trade").addEventListener("input", e => {
  const f = e.target.dataset.f; if (!f) return;
  const it = T[e.target.dataset.s][+e.target.dataset.i];
  it[f] = f === "value" ? (e.target.value === "" ? "" : +e.target.value) : e.target.value;
  save(); drawVerdict();
});
$("v-trade").addEventListener("click", e => {
  const rm = e.target.closest("[data-rm]"); if (!rm) return;
  const [side, i] = rm.dataset.rm.split(":"); T[side].splice(+i, 1); save(); renderTrade();
});
$("t-clear").onclick = () => { T = {give: [], get: []}; save(); renderTrade(); };
$("t-copy").onclick = () => {
  const line = it => `${it.qty > 1 ? it.qty + "x " : ""}${it.name || "Card"}${it.set ? " (" + it.set + ")" : ""}: ${money(it.value)}`;
  const v = tradeVerdict(T.give, T.get);
  copyText(`TRADE\nI give:\n${T.give.map(line).join("\n") || "-"}\nTotal ${money(v.give)}\n\nI get:\n${T.get.map(line).join("\n") || "-"}\nTotal ${money(v.get)}\n\nChecked with Binder Buddy`, "Copied! Paste it in your chat.");
};
$("t-done").onclick = async () => {
  if (!T.give.length && !T.get.length) return toast("Add some cards first.");
  for (const it of T.give) if (it.cardId && cards.get(it.cardId)) { const c = cards.get(it.cardId); c.qty = Math.max(0, (+c.qty || 0) - it.qty); await db.put("cards", c); }
  let added = 0;
  for (const it of T.get) {
    if (!it.name) continue;
    const same = it.link && [...cards.values()].find(c => c.ref && c.ref.id === it.link.ref.id && c.cond === "Near Mint");
    if (same) { same.qty = (+same.qty || 0) + it.qty; await db.put("cards", same); }
    else {
      const c = {id: newId("c"), game: it.game || "pokemon", name: it.name, set: it.set || "", num: it.num || "", rarity: it.rarity || "", lang: "English", cond: "Near Mint", grade: "",
        qty: it.qty, paid: "", notes: "From a trade " + new Date().toLocaleDateString(), tags: [], photos: [], added: new Date().toISOString(), ...(it.link || {}), market: it.value};
      logPrice(c); await saveCard(c);
    }
    added++;
  }
  T = {give: [], get: []}; save(); renderTrade(); emit("render"); toast(`Binder updated: ${added} card${added === 1 ? "" : "s"} added 🎉`);
};
$("whereList").innerHTML = WHERE.map(([t, d]) => `<div class="where"><b>${t}</b><p>${d}</p></div>`).join("") +
  `<div class="where" style="border-color:var(--warn)"><b>🛡️ Trade safe</b><ul class="tips" style="font-size:13.5px">${SAFETY.map(s => `<li>${esc(s)}</li>`).join("")}</ul></div>`;
on("trade:give", id => { emit("tab", "trade"); giveCard(id); });
