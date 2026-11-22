// Trade Links: share the cards you'll trade or sell as a link. No account, no server.
// The whole list is packed (compressed) into the part of the link after "#", which browsers never
// send to any server, not even GitHub Pages. Opening a friend's link shows their cards, what they're
// looking for, and fair trades for both of you. Deals happen off the app, ideally at a card shop.
import { GAMES, matchesAny, suggestTrade } from "./logic.js";
import { S, saveS, cards, wants, db, loadLocal, saveLocal } from "./store.js";
import { $, esc, toast, openSheet, closeSheet, copyText } from "./util.js";
import { money, moneyOr, cardImg, fillPhotos, condLabel, on, emit } from "./ui.js";
import { refreshPrices } from "./catalog.js";
import { setTrade } from "./trade.js";

const MAX_CARDS = 150, MAX_WANTS = 60;
const SRCS = ["tcgdex", "lorcast", "optcg"];
// Only pictures from the card databases are shown, so a link can't load pictures from anywhere else.
const IMG_OK = /^https:\/\/(assets\.tcgdex\.net|cards\.lorcast\.io|optcgapi\.com|www\.optcgapi\.com)\//;
const LABEL = {t: "🔁 For trade", s: "💲 For sale", ts: "🔁💲 Trade or sell"};

// ------------------------------------------------------------------ pack and unpack a link
const b64u = bytes => { let s = ""; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = s => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

export async function pack(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (window.CompressionStream) return "1" + b64u(await pipe(raw, new CompressionStream("deflate-raw")));
  return "0" + b64u(raw);
}
export async function unpack(s) {
  const bytes = unb64u(s.slice(1));
  const raw = s[0] === "1" ? await pipe(bytes, new DecompressionStream("deflate-raw")) : bytes;
  return clean(JSON.parse(new TextDecoder().decode(raw)));
}

const str = (v, n = 80) => typeof v === "string" ? v.slice(0, n) : "";
const num = v => (typeof v === "number" && isFinite(v) && v >= 0 && v < 1e7) ? v : "";
const game = g => GAMES[g] ? g : "pokemon";
const ref = (src, id, v) => SRCS.includes(src) && str(id) ? {src, id: str(id), v: str(v, 40)} : null;
const img = u => IMG_OK.test(str(u, 300)) ? u : "";
/** A link is written by someone else, so check every field and keep only what we expect. */
function clean(o) {
  if (!o || o.v !== 1 || !Array.isArray(o.c)) throw new Error("bad link");
  return {
    name: str(o.n, 24).replace(/[<>]/g, "").trim() || "A collector", pct: Math.min(150, Math.max(10, +o.p || 80)), date: str(o.d, 10),
    cards: o.c.slice(0, MAX_CARDS).filter(Array.isArray).map((a, i) => ({id: "f" + i, game: game(a[0]), ref: ref(a[1], a[2], a[3]), name: str(a[4]) || "Card",
      set: str(a[5]), num: str(a[6], 20), rarity: str(a[7], 50), cond: str(a[8], 30) || "Near Mint", grade: str(a[9], 20), qty: Math.max(1, Math.min(99, Math.round(+a[10] || 1))),
      market: num(a[11]), tl: ["t", "s", "ts"].includes(a[12]) ? a[12] : "t", img: img(a[13])})),
    wants: (Array.isArray(o.w) ? o.w : []).slice(0, MAX_WANTS).filter(Array.isArray).map((a, i) => ({id: "w" + i, game: game(a[0]), ref: ref(a[1], a[2]), name: str(a[3]) || "Card",
      set: str(a[4]), num: str(a[5], 20), img: img(a[6])})),
  };
}

// ------------------------------------------------------------------ my side
export const listed = () => [...cards.values()].filter(c => c.tl && (+c.qty || 0) > 0);
export async function myLink() {
  const mine = listed().sort((a, b) => (+b.market || 0) - (+a.market || 0)).slice(0, MAX_CARDS);
  const obj = {v: 1, n: str(S.tlName, 24), p: +S.tlPct || 80, d: new Date().toISOString().slice(0, 10),
    c: mine.map(c => [c.game, c.ref?.src || "", c.ref?.id || "", c.ref?.v || "", c.name, c.set || "", c.num || "", c.rarity || "", c.cond || "", c.grade || "",
      +c.qty || 1, c.market === "" || c.market == null ? null : +c.market, c.tl, c.img || ""]),
    w: +S.tlWants ? [...wants.values()].slice(0, MAX_WANTS).map(w => [w.game, w.ref?.src || "", w.ref?.id || "", w.name, w.set || "", w.num || "", w.img || ""]) : []};
  return location.origin + location.pathname + "#t=" + await pack(obj);
}

export function drawPanel() {
  const l = listed(), t = l.filter(c => c.tl.includes("t")).length, s = l.filter(c => c.tl.includes("s")).length;
  $("tl-sum").textContent = l.length ? `${t} for trade · ${s} for sale${S.tlName ? " · as " + S.tlName : ""}` : "No cards listed yet.";
  $("tl-share").disabled = !l.length;
  const F = loadLocal("bb-friends", []);
  $("tl-saved").innerHTML = F.length ? `<h3 style="margin:14px 0 6px">Saved trade binders</h3>` + F.map((f, i) =>
    `<div class="friend"><button class="btn ghost small" data-fo="${i}">📒 ${esc(f.name)}</button><span class="note">${f.count} cards · ${esc(f.date || "")}</span><button class="rm" data-fx="${i}" aria-label="Forget ${esc(f.name)}'s binder">✕</button></div>`).join("") : "";
}
$("tl-saved").addEventListener("click", e => {
  const F = loadLocal("bb-friends", []), o = e.target.closest("[data-fo]"), x = e.target.closest("[data-fx]");
  if (o) openFriend(F[+o.dataset.fo].h);
  if (x) { F.splice(+x.dataset.fx, 1); saveLocal("bb-friends", F); drawPanel(); }
});

// choose which cards are listed
function drawList() {
  const q = $("tl-q").value.trim().toLowerCase();
  const all = [...cards.values()].filter(c => (+c.qty || 0) > 0 && (!q || (c.name + " " + c.set + " " + c.num).toLowerCase().includes(q)))
    .sort((a, b) => (!!b.tl - !!a.tl) || (+b.market || 0) - (+a.market || 0));
  $("tl-out").innerHTML = all.length ? all.map(c => `<div class="card${cardImg(c) ? " withpic" : ""}">${cardImg(c)}
      <div><div class="nm">${esc(c.name)}</div><div class="meta">${esc([c.set, c.num].filter(Boolean).join(" · "))} · ${esc(condLabel(c))} · I have ${c.qty}</div><b>${moneyOr(c.market)}</b></div>
      <select data-tl="${c.id}" aria-label="List ${esc(c.name)}" style="width:auto">${[["", "Not listed"], ["t", "🔁 Trade"], ["s", "💲 Sell"], ["ts", "🔁💲 Either"]].map(([v, n]) =>
        `<option value="${v}"${(c.tl || "") === v ? " selected" : ""}>${n}</option>`).join("")}</select></div>`).join("")
    : `<div class="empty">No cards${q ? " match" : " in your binder yet"}.</div>`;
  fillPhotos($("tl-out"));
}
function openList() {
  // first time: start from the "Trade binder" and "For sale" tags people may already use
  if (!S.tlUsed) {
    for (const c of cards.values()) { const t = (c.tags || []).includes("t1"), s = (c.tags || []).includes("t2"); if (!c.tl && (t || s)) { c.tl = (t ? "t" : "") + (s ? "s" : ""); db.put("cards", c); } }
    S.tlUsed = 1; saveS();
  }
  $("tl-name").value = S.tlName || ""; $("tl-pct").value = S.tlPct; $("tl-pctl").textContent = S.tlPct; $("tl-wants").value = String(+S.tlWants);
  $("tl-q").value = ""; drawList();
  openSheet("m-tlist", "#tl-name");
}
$("tl-out").addEventListener("change", async e => {
  const c = cards.get(e.target.dataset.tl); if (!c) return;
  c.tl = e.target.value; await db.put("cards", c); drawPanel(); emit("render");
});
$("tl-q").oninput = drawList;
$("tl-name").oninput = () => { S.tlName = $("tl-name").value.replace(/[<>]/g, "").slice(0, 24); saveS(); drawPanel(); };
$("tl-pct").oninput = () => { S.tlPct = +$("tl-pct").value; $("tl-pctl").textContent = S.tlPct; saveS(); };
$("tl-wants").onchange = () => { S.tlWants = +$("tl-wants").value; saveS(); };
$("tl-pick").onclick = openList;
$("tl-done").onclick = () => { closeSheet("m-tlist"); drawPanel(); };

async function openShare() {
  if (!listed().length) return openList();
  const url = await myLink();
  $("ts-link").value = url;
  const l = listed();
  $("ts-info").textContent = `${l.length} card${l.length === 1 ? "" : "s"}${+S.tlWants && wants.size ? " and your wishlist" : ""}, priced ${new Date().toLocaleDateString()}. The link is a snapshot: share a new one after you change your list.`;
  $("ts-long").hidden = url.length <= 1900;
  $("ts-send").hidden = !navigator.share;
  openSheet("m-tshare", "#ts-copy");
}
$("tl-share").onclick = openShare;
$("ts-copy").onclick = () => copyText($("ts-link").value, "Link copied! Paste it where you trade.");
$("ts-send").onclick = () => navigator.share({title: (S.tlName || "My") + " trade binder", text: "My trade binder on Binder Buddy", url: $("ts-link").value}).catch(() => {});

// ------------------------------------------------------------------ their side
let F = null, pickedGet = new Set(), lastHash = "";
export async function openFriend(hash) {
  try { F = await unpack(hash); } catch (e) { toast("That trade link is broken or cut off. Ask them to send it again."); return false; }
  lastHash = hash;
  const myWants = [...wants.values()];
  pickedGet = new Set(F.cards.filter(c => c.tl.includes("t") && matchesAny(c, myWants)).map(c => c.id));
  drawFriend();
  openSheet("m-friend", "#fr-title");
  return true;
}
function friendRow(c, kind) {
  const sale = kind === "card" && c.tl.includes("s") && c.market !== "" ?Math.round(c.market * F.pct) / 100 : null;
  const onWish = kind === "card" && matchesAny(c, [...wants.values()]);
  const iHave = kind === "want" && [...cards.values()].find(m => (+m.qty || 0) > 0 && matchesAny(m, [c]));
  return `<div class="card${c.img ? " withpic" : ""}${kind === "card" && pickedGet.has(c.id) ? " picked" : ""}">${cardImg(c)}
    <div><div class="nm">${esc(c.name)}${c.qty > 1 ? ` <small>× ${c.qty}</small>` : ""}</div>
      <div class="meta">${esc([GAMES[c.game].name, c.set, c.num].filter(Boolean).join(" · "))}</div>
      <div class="meta">${kind === "card" ? `<span class="tag soft">${LABEL[c.tl]}</span><span class="tag soft">${esc(condLabel(c))}</span>` : ""}${onWish ? `<span class="tag hot">⭐ On your wishlist</span>` : ""}
        ${iHave ? `<span class="tag hot">✓ You have this${iHave.tl ? "" : " (not listed)"}</span>` : ""}</div></div>
    <div class="money"><span>${kind !== "card" ? "" : c.market === "" ? "no price yet" : money(c.market) + " market"}</span>${sale != null ? `<span>💲 ${money(sale)} to buy</span>` : ""}</div>
    ${kind === "card" && c.tl.includes("t") ? `<label class="pickbox"><input type="checkbox" data-get="${c.id}"${pickedGet.has(c.id) ? " checked" : ""}> I want it</label>` : ""}
  </div>`;
}
function suggestion() {
  const get = F.cards.filter(c => pickedGet.has(c.id));
  const want = get.reduce((s, c) => s + (+c.market || 0), 0);
  const cands = [];
  for (const m of listed().filter(c => c.tl.includes("t"))) for (let i = 0; i < Math.min(3, +m.qty || 1); i++) cands.push({id: m.id + "#" + i, card: m, value: +m.market || 0, wanted: matchesAny(m, F.wants)});
  const s = suggestTrade(want, cands, +S.tlGap || 0);
  const give = s ? s.pick.map(id => cands.find(c => c.id === id).card) : [];
  return {get, want, give, s};
}
function drawFriend() {
  const myWants = [...wants.values()];
  const onWish = F.cards.filter(c => matchesAny(c, myWants)).length;
  const theyWant = F.wants.filter(w => [...cards.values()].some(m => (+m.qty || 0) > 0 && matchesAny(m, [w]))).length;
  $("fr-title").textContent = `📒 ${F.name}'s trade binder`;
  $("fr-sub").textContent = `${F.cards.length} card${F.cards.length === 1 ? "" : "s"} · prices from ${F.date || "when they shared it"}${F.cards.some(c => c.tl.includes("s")) ? ` · selling at ${F.pct}% of market` : ""}`;
  const {get, want, give, s} = suggestion();
  const line = c => `${esc(c.name)} <small>${moneyOr(c.market)}</small>`;
  let sug;
  if (!get.length) sug = `<p class="note">Tick "I want it" on their cards and Binder Buddy will build a fair offer from your trade list.</p>`;
  else if (!listed().some(c => c.tl.includes("t"))) sug = `<p class="note">You want ${money(want)} of their cards. List some of your cards for trade so Binder Buddy can build an offer.</p><button class="btn small" id="fr-list">📤 List my cards</button>`;
  else {
    const verdict = !s ? ["bad", "Your trade cards have no prices yet."]
      : !s.fits ? ["bad", s.diff < 0 ? `Your trade list is ${money(-s.diff)} short. List more cards, or ask for fewer.` : `The closest offer gives ${money(s.diff)} more than you get. Raise the extra you're OK giving, or pick more of their cards.`]
      : s.diff > 0.5 ? ["warn", `Fair offer. You give ${money(s.diff)} extra, inside the ${money(S.tlGap)} you said is OK.`]
      : s.diff < -0.5 ? ["ok", `Fair offer. You come out ${money(-s.diff)} ahead, which is within 5%.`]
      : ["ok", "🤝 Fair and even offer."];
    sug = `<div class="sides"><div><h3>I get <span>${money(want)}</span></h3>${get.map(c => `<div>${line(c)}</div>`).join("")}</div>
      <div><h3>I offer <span>${money(s ? s.give : 0)}</span></h3>${give.map(c => `<div>${line(c)}${matchesAny(c, F.wants) ? " ⭐" : ""}</div>`).join("") || "<p class='note'>Nothing fits.</p>"}</div></div>
      <div class="verdict ${verdict[0]}" style="margin-top:8px"><p style="margin:0;font-weight:800">${verdict[1]}</p></div>
      ${give.some(c => matchesAny(c, F.wants)) ? `<p class="note">⭐ = on their wishlist, so they're more likely to say yes.</p>` : ""}
      <div class="acts" style="justify-content:flex-start"><button class="btn small" id="fr-copy">💬 Copy offer message</button><button class="btn ghost small" id="fr-check">🤝 Open in Trade checker</button></div>`;
  }
  const sale = F.cards.filter(c => c.tl.includes("s"));
  $("fr-body").innerHTML = `
    <div class="chips">${onWish ? `<span class="chip hot">⭐ ${onWish} on your wishlist</span>` : ""}${theyWant ? `<span class="chip hot">🎯 They want ${theyWant} of yours</span>` : ""}</div>
    <div class="panel"><h3 style="margin-top:0">✨ Suggested trade</h3>
      <div class="colrow"><span>I'm OK giving up to</span><input id="fr-gap" type="number" min="0" step="1" inputmode="decimal" value="${+S.tlGap || 0}" style="max-width:90px" aria-label="Dollars extra I'm OK giving"><span>extra</span></div>
      ${sug}</div>
    <h3>Their cards</h3><div class="list">${F.cards.map(c => friendRow(c, "card")).join("") || `<div class="empty">No cards in this link.</div>`}</div>
    ${sale.length ? `<p class="note">💲 Want to buy? Their price is ${F.pct}% of market. Pay in person, or only with buyer protection. <button class="btn ghost small" id="fr-buy">Copy "I'd like to buy" message</button></p>` : ""}
    ${F.wants.length ? `<h3>They're looking for</h3><div class="list">${F.wants.map(w => friendRow(w, "want")).join("")}</div>` : ""}
    <div class="where" style="border-color:var(--warn);margin-top:12px"><b>🛡️ Trade safe</b><ul class="tips" style="font-size:13.5px">
      <li>Swap in person, like at a local card shop on trade night. Look at every card before you hand yours over.</li>
      <li>Under 18? Only trade with a parent's OK, and never share your address, school or phone number.</li>
      <li>Prices are from ${esc(F.date || "when they shared it")}. Tap "Today's prices" to check again.</li></ul></div>
    <div class="acts"><button class="btn ghost" id="fr-fresh">🔄 Today's prices</button><button class="btn ghost" id="fr-save">💾 Save this binder</button><button class="btn" data-close>Done</button></div>`;
  fillPhotos($("fr-body"));
  wire();
}
function wire() {
  $("fr-gap").onchange = () => { S.tlGap = Math.max(0, +$("fr-gap").value || 0); saveS(); drawFriend(); };
  const L = $("fr-list"); if (L) L.onclick = () => { closeSheet("m-friend"); openList(); };
  const C = $("fr-copy"); if (C) C.onclick = async () => {
    const {get, want, give, s} = suggestion();
    const mine = listed().length ? "\nMy trade binder: " + await myLink() : "";
    copyText(`Hi ${F.name}! Trade offer${S.tlName ? " from " + S.tlName : ""}:\n\nI'd like:\n${get.map(c => `- ${c.name}${c.num ? " " + c.num : ""} (${money(c.market)})`).join("\n")}\nTotal ${money(want)}\n\nI'd give:\n${give.map(c => `- ${c.name}${c.num ? " " + c.num : ""} (${money(c.market)})`).join("\n")}\nTotal ${money(s ? s.give : 0)}\n\nWant to meet at a local card shop to swap?${mine}\n(Checked with Binder Buddy)`, "Offer copied! Paste it in your chat.");
  };
  const K = $("fr-check"); if (K) K.onclick = () => {
    const {get, give} = suggestion();
    setTrade(give.map(c => c.id), get.map(c => ({name: c.name, set: c.set, num: c.num, rarity: c.rarity, game: c.game, img: c.img, value: c.market, qty: 1,
      link: c.ref ? {ref: c.ref, img: c.img, imgLg: "", tcgId: null, variants: {}, trend: null} : null})));
    closeSheet("m-friend"); emit("tab", "trade");
  };
  const B = $("fr-buy"); if (B) B.onclick = () => {
    const pick = F.cards.filter(c => c.tl.includes("s") && (pickedGet.has(c.id) || !F.cards.some(x => x.tl.includes("s") && pickedGet.has(x.id))));
    const list = pick.filter(c => c.market !== "").map(c => `- ${c.name}${c.num ? " " + c.num : ""}: ${money(Math.round(c.market * F.pct) / 100)}`);
    copyText(`Hi ${F.name}! I'd like to buy:\n${list.join("\n")}\n\nCan we meet at a local card shop?\n(Prices at your ${F.pct}% from Binder Buddy)`, "Message copied!");
  };
  $("fr-save").onclick = () => {
    const L2 = loadLocal("bb-friends", []).filter(f => f.name !== F.name);
    L2.unshift({name: F.name, date: F.date, count: F.cards.length, h: lastHash}); saveLocal("bb-friends", L2.slice(0, 20)); drawPanel(); toast("Saved. Find it on the Trade tab.");
  };
  $("fr-fresh").onclick = async () => {
    toast("Getting today's prices…", 8000);
    const r = await refreshPrices([...F.cards, ...F.wants].filter(c => c.ref));
    F.date = new Date().toISOString().slice(0, 10); drawFriend(); toast(r.failed ? "Some prices couldn't load." : "Prices updated.");
  };
}
$("fr-body").addEventListener("change", e => {
  const id = e.target.dataset.get; if (!id) return;
  if (e.target.checked) pickedGet.add(id); else pickedGet.delete(id);
  drawFriend();
});

on("data", drawPanel);
on("tl:list", openList);
drawPanel();
