// Customize, backup/import, spreadsheets, bulk add, bundle value, welcome tour, sample cards, support.
import { GAMES, CONDS, AFF, bundle, parseBulkLine } from "./logic.js";
import { S, THEMES, DEFAULTS, saveS, replaceS, cards, wants, db, history, saveLocal, loadLocal, dropPhotos } from "./store.js";
import { card as fetchCard, logPrice } from "./catalog.js";
import { $, esc, newId, toast, seg, openSheet, closeSheet, copyText, download } from "./util.js";
import { money, signed, gameColor, condColor, condLabel, applyTheme, emit, on, VERSION } from "./ui.js";
import { visible, filt, linkFields, saveCard, render, updatePrices } from "./binder.js";
import { learnedCount, clearLearned, reportURL } from "./learn.js";

/** Set this to a Ko-fi (or similar) page to show a tip button. Empty = hidden. */
export const SUPPORT_URL = "";

// ================================================================== customize
function changed() { saveS(); applyTheme(); drawSettings(); render(); emit("data"); }
export function drawSettings() {
  $("themes").innerHTML = themeTiles(S.theme);
  $("c-bg").value = S.bg; $("c-accent").value = S.accent; $("c-dark").value = String(S.dark);
  seg($("colorBy"), [["game", "Game"], ["rarity", "Rarity"], ["condition", "Condition"], ["tag", "Tag"], ["none", "No colors"]], S.colorBy, v => { S.colorBy = v; changed(); });
  seg($("groupBy"), [["none", "Don't group"], ["game", "Game"], ["set", "Set"], ["rarity", "Rarity"], ["condition", "Condition"], ["tag", "Tag"]], S.groupBy, v => { S.groupBy = v; changed(); });
  seg($("layout"), [["list", "List"], ["compact", "Compact list"], ["grid", "Picture grid"]], S.layout, v => { S.layout = v; changed(); });
  seg($("gamesOn"), Object.entries(GAMES).map(([k, g]) => [k, (S.games.includes(k) ? "✓ " : "") + g.name]), "", v => {
    S.games = S.games.includes(v) ? S.games.filter(x => x !== v) : [...S.games, v];
    if (!S.games.length) S.games = [v];
    if (!S.games.includes(filt.game)) filt.game = "all";
    changed();
  });
  let ed = "";
  if (S.colorBy === "game") ed = Object.entries(GAMES).map(([k, g]) => `<div class="colrow"><span>${g.name}</span><input type="color" data-gc="${k}" value="${gameColor(k)}" aria-label="${g.name} color"></div>`).join("");
  if (S.colorBy === "condition") ed = CONDS.map(c => `<div class="colrow"><span>${c}</span><input type="color" data-cc="${c}" value="${condColor(c)}" aria-label="${c} color"></div>`).join("");
  if (S.colorBy === "rarity") ed = `<p class="note">Rarer cards get warmer colors: grey → green → blue → purple → pink → orange → gold.</p>`;
  if (S.colorBy === "tag") ed = `<p class="note">Each card uses its first tag's color. Change tag colors below.</p>`;
  $("colorEditors").innerHTML = ed;
  $("tagList").innerHTML = S.tags.map(t => `<div class="colrow"><input type="color" data-tc="${t.id}" value="${t.color}" style="width:52px" aria-label="Tag color"><input data-tn="${t.id}" value="${esc(t.name)}" aria-label="Tag name"><button class="btn ghost small" data-tdel="${t.id}" aria-label="Delete tag ${esc(t.name)}">✕</button></div>`).join("");
  $("p-crop").value = String(S.crop); $("p-q").value = String(S.quality); $("p-cam").value = String(S.camera); $("cur").value = S.cur; $("titleIn").value = S.title; $("autoPrice").value = String(S.autoPrice);
}
const themeTiles = (cur, custom = true) => Object.entries(THEMES).map(([k, t]) => `<button type="button" class="theme ${cur === k ? "on" : ""}" data-k="${k}">
    <div class="sw" style="background:linear-gradient(135deg,${t.accent} 0 45%,${t.bg} 45%)"></div>${t.name}</button>`).join("") + (!custom ? "" :
  `<button type="button" class="theme ${cur === "custom" ? "on" : ""}" data-k="custom"><div class="sw" style="background:conic-gradient(#f44,#fc0,#4c4,#0cf,#a4f,#f44)"></div>My own</button>`);
function pickTheme(k) { S.theme = k; if (THEMES[k]) Object.assign(S, {bg: THEMES[k].bg, accent: THEMES[k].accent, dark: THEMES[k].dark}); changed(); }
$("openSettings").onclick = $("m-custom").onclick = () => { drawSettings(); openSheet("m-set"); };
$("themes").onclick = e => { const t = e.target.closest("[data-k]"); if (t) pickTheme(t.dataset.k); };
$("c-bg").oninput = e => { S.bg = e.target.value; S.theme = "custom"; saveS(); applyTheme(); };
$("c-accent").oninput = e => { S.accent = e.target.value; S.theme = "custom"; saveS(); applyTheme(); };
$("c-bg").onchange = $("c-accent").onchange = () => changed();
$("c-dark").onchange = e => { S.dark = +e.target.value; S.theme = "custom"; changed(); };
$("colorEditors").addEventListener("input", e => {
  if (e.target.dataset.gc) S.gameColors[e.target.dataset.gc] = e.target.value;
  if (e.target.dataset.cc) S.condColors[e.target.dataset.cc] = e.target.value;
  saveS(); render();
});
$("tagList").addEventListener("input", e => {
  const t = S.tags.find(x => x.id === (e.target.dataset.tc || e.target.dataset.tn)); if (!t) return;
  if (e.target.dataset.tc) t.color = e.target.value; else t.name = e.target.value.slice(0, 24);
  saveS(); render();
});
$("tagList").addEventListener("click", e => {
  const b = e.target.closest("[data-tdel]"); if (!b) return;
  S.tags = S.tags.filter(t => t.id !== b.dataset.tdel); if (filt.tag === b.dataset.tdel) filt.tag = ""; changed();
});
$("addTag").onclick = () => {
  const n = $("newTag").value.trim(); if (!n) return;
  S.tags.push({id: newId("t"), name: n.slice(0, 24), color: $("newTagCol").value}); $("newTag").value = ""; changed();
};
$("p-crop").onchange = e => { S.crop = +e.target.value; saveS(); };
$("p-q").onchange = e => { S.quality = +e.target.value; saveS(); };
$("p-cam").onchange = e => { S.camera = +e.target.value; saveS(); };
$("autoPrice").onchange = e => { S.autoPrice = +e.target.value; saveS(); };
$("cur").onchange = e => { S.cur = e.target.value; changed(); };
$("titleIn").oninput = e => { S.title = e.target.value || DEFAULTS.title; saveS(); applyTheme(); };

// ================================================================== backup / spreadsheets / bulk add
const b64 = blob => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
async function openBackup() {
  $("bulkMsg").textContent = "";
  try { const est = await navigator.storage.estimate(); $("storageNote").textContent = `Using ${(est.usage / 1048576).toFixed(1)} MB on this device.`; } catch (e) {}
  openSheet("m-backup");
}
$("exportBtn").onclick = async () => {
  toast("Making your backup…");
  const photos = {};
  for (const c of cards.values()) for (const id of c.photos || []) { const b = await db.get("photos", id); if (b) photos[id] = await b64(b); }
  const data = JSON.stringify({app: "binder-buddy", version: 2, saved: new Date().toISOString(), settings: S, cards: [...cards.values()], wants: [...wants.values()], history: history(), learn: loadLocal("bb-learn", []), friends: loadLocal("bb-friends", []), photos});
  download(new Blob([data], {type: "application/json"}), "binder-buddy-backup-" + new Date().toISOString().slice(0, 10) + ".json");
  S.lastBackup = new Date().toISOString(); saveS(); emit("data");
  toast("Backup saved to your downloads");
};
$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== "binder-buddy" || !Array.isArray(d.cards)) throw new Error("not a backup");
    for (const [id, url] of Object.entries(d.photos || {})) { const blob = await (await fetch(url)).blob(); await db.put("photos", blob, id); }
    for (const c of d.cards) if (c && c.id && c.name) { cards.set(c.id, c); await db.put("cards", c); }
    for (const w of d.wants || []) if (w && w.id && w.name) { wants.set(w.id, w); await db.put("wants", w); }
    if (Array.isArray(d.history) && d.history.length > history().length) saveLocal("bb-history", d.history);
    if (Array.isArray(d.learn) && d.learn.length > loadLocal("bb-learn", []).length) saveLocal("bb-learn", d.learn.filter(x => x && typeof x.k === "string" && x.ref && x.ref.src && x.ref.id).slice(0, 400));
    if (Array.isArray(d.friends) && !loadLocal("bb-friends", []).length) saveLocal("bb-friends", d.friends.filter(x => x && typeof x.h === "string").slice(0, 20));
    if (d.settings) { replaceS({...d.settings, welcomed: 1}); applyTheme(); }
    render(); emit("data"); toast(`Loaded ${d.cards.length} cards from your backup`);
  } catch (err) { toast("That file isn't a Binder Buddy backup."); }
};
function sheetRows() {
  const head = ["Game", "Name", "Set", "Number", "Rarity", "Language", "Condition", "Quantity", "Paid each", "Market each", "Market total", "Tags", "Notes"];
  const rows = [...cards.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))).map(c =>
    [GAMES[c.game] ? GAMES[c.game].name : c.game, c.name, c.set, c.num, c.rarity, c.lang, condLabel(c), c.qty, c.paid, c.market,
      ((+c.market || 0) * (+c.qty || 0)).toFixed(2), (c.tags || []).map(t => (S.tags.find(x => x.id === t) || {}).name).filter(Boolean).join(", "), c.notes]);
  return [head, ...rows];
}
$("csvBtn").onclick = () => copyText(sheetRows().map(r => r.map(v => String(v ?? "").replace(/[\t\n]/g, " ")).join("\t")).join("\n"), "Copied! Paste into Google Sheets or Excel.");
$("csvFileBtn").onclick = () => {
  const csv = sheetRows().map(r => r.map(v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
  download(new Blob(["﻿" + csv], {type: "text/csv"}), "binder-buddy-" + new Date().toISOString().slice(0, 10) + ".csv");
};
$("bulkGo").onclick = async () => {
  let n = 0;
  for (const line of $("bulkText").value.split(/\n/)) {
    const p = parseBulkLine(line); if (!p) continue;
    const c = {id: newId("c"), ...p, notes: "", tags: [], photos: [], added: new Date().toISOString(), priced: p.market !== "" ? new Date().toISOString() : ""};
    logPrice(c); await saveCard(c); n++;
  }
  $("bulkMsg").textContent = n ? `Added ${n} card${n > 1 ? "s" : ""}! Tip: open a card and tap 🔗 Get live price for daily prices.` : "Nothing added. Check each line starts with pokemon, onepiece or lorcana.";
  if (n) { $("bulkText").value = ""; render(); }
};
$("m-backup").addEventListener("closed", () => { $("bulkMsg").textContent = ""; });

// ================================================================== bundle value
function drawBundle() {
  const pct = +$("bd-pct").value; $("bd-pctl").textContent = pct;
  seg($("bd-quick"), [[60, "60%"], [70, "70%"], [80, "80%"], [90, "90%"], [100, "Full market"]], pct, v => { $("bd-pct").value = v; drawBundle(); });
  const b = bundle(visible(), pct, +$("bd-min").value || 0);
  $("bd-out").innerHTML = `<div class="stats" style="margin:0">
      <div class="stat"><b>${b.count}</b><span>cards</span></div>
      <div class="stat"><b>${money(b.market)}</b><span>full market</span></div>
      <div class="stat"><b class="up">${money(b.ask)}</b><span>bundle price at ${pct}%</span></div>
      <div class="stat"><b class="${b.ask - b.paid >= 0 ? "up" : "down"}">${signed(b.ask - b.paid)}</b><span>vs. what I paid</span></div></div>
    ${b.noPrice ? `<p class="note">⚠ ${b.noPrice} card${b.noPrice > 1 ? "s have" : " has"} no market price yet, so they count as ${money(0)}.</p>` : ""}`;
}
$("bundleBtn").onclick = () => { drawBundle(); openSheet("m-bundle"); };
$("bd-pct").oninput = drawBundle; $("bd-min").oninput = drawBundle;
$("bd-copy").onclick = () => {
  const pct = +$("bd-pct").value, b = bundle(visible(), pct, +$("bd-min").value || 0);
  copyText(b.rows.map(c => `${c.qty}x ${c.name}${c.set ? " (" + c.set + (c.num ? " " + c.num : "") + ")" : ""} ${condLabel(c)}: ${money(c.market)}`).join("\n") +
    `\n\nMarket total: ${money(b.market)}\nBundle price: ${money(b.ask)}`, "Copied! Paste it in a message or post.");
};

// ================================================================== sample cards (real cards, live prices)
const SAMPLES = [
  {src: "tcgdex", id: "sv08-238", qty: 1, paid: 160, tags: ["t3"]},
  {src: "tcgdex", id: "sv03.5-199", qty: 1, paid: 240},
  {src: "tcgdex", id: "me01-180", qty: 1, paid: 30, tags: ["t1"]},
  {src: "tcgdex", id: "sv03.5-025", qty: 3, paid: 0.5},
  {src: "lorcast", id: "crd_cbc18e77d7ec4d50bf19650a9a559686", qty: 1, paid: 650, v: "foil", tags: ["t3"]},
  {src: "lorcast", id: "crd_78e5de38150f48c5b9813c08cc534dfb", qty: 2, paid: 4, tags: ["t2"]},
  {src: "optcg", id: "OP01-120", qty: 1, paid: 5, tags: ["t2"]},
  {src: "optcg", id: "OP01-024_p1", qty: 1, paid: 20, tags: ["t1"]},
];
const SAMPLE_WANTS = [{src: "tcgdex", id: "sv08.5-161", max: 900}, {src: "optcg", id: "OP01-120_p1", max: 60}];
export async function loadSamples() {
  toast("Loading sample cards with today's prices…", 6000);
  // loading twice would double them, so clear any old samples first
  for (const c of [...cards.values()]) if (c.demo) { cards.delete(c.id); await db.del("cards", c.id); }
  for (const w of [...wants.values()]) if (w.demo) { wants.delete(w.id); await db.del("wants", w.id); }
  let n = 0;
  await Promise.all(SAMPLES.map(async s => {
    try {
      const r = await fetchCard(s.src, s.id); if (!r) return;
      const c = {id: newId("c"), game: r.game, name: r.name, set: r.set, num: r.num, rarity: r.rarity, lang: "English", cond: "Near Mint", grade: "",
        qty: s.qty, paid: s.paid, notes: "", tags: s.tags || [], photos: [], added: new Date().toISOString(), demo: true, ...linkFields(r, s.v)};
      logPrice(c); await saveCard(c); n++;
    } catch (e) {}
  }));
  await Promise.all(SAMPLE_WANTS.map(async s => {
    try {
      const r = await fetchCard(s.src, s.id); if (!r) return;
      const w = {id: newId("w"), game: r.game, name: r.name, set: r.set, num: r.num, rarity: r.rarity, max: s.max, note: "Sample", demo: true,
        added: new Date().toISOString(), ...linkFields(r)};
      wants.set(w.id, w); await db.put("wants", w);
    } catch (e) {}
  }));
  S.lastPriced = new Date().toISOString(); saveS();
  render(); emit("data");
  toast(n ? `Loaded ${n} sample cards. Tap one to see its prices!` : "Couldn't reach the card databases. Check your internet.");
}
export async function clearSamples() {
  for (const c of [...cards.values()]) if (c.demo) { cards.delete(c.id); await db.del("cards", c.id); await dropPhotos(c.photos || []); }
  for (const w of [...wants.values()]) if (w.demo) { wants.delete(w.id); await db.del("wants", w.id); }
  render(); emit("data"); toast("Samples removed. Your binder is all yours.");
}
on("demo:clear", clearSamples);
on("empty:demo", loadSamples);

// ================================================================== welcome
export function openWelcome() {
  const draw = () => {
    seg($("wl-games"), Object.entries(GAMES).map(([k, g]) => [k, (S.games.includes(k) ? "✓ " : "") + g.name]), "", v => {
      S.games = S.games.includes(v) ? (S.games.length > 1 ? S.games.filter(x => x !== v) : S.games) : [...S.games, v]; saveS(); draw();
    });
    $("wl-themes").innerHTML = themeTiles(S.theme, false);
  };
  draw();
  $("wl-themes").onclick = e => { const t = e.target.closest("[data-k]"); if (t && t.dataset.k !== "custom") { pickTheme(t.dataset.k); draw(); } };
  openSheet("m-welcome", "#wl-go");
}
const finishWelcome = () => { S.welcomed = 1; saveS(); closeSheet("m-welcome"); render(); };
$("wl-go").onclick = finishWelcome;
$("wl-demo").onclick = () => { finishWelcome(); loadSamples(); };
$("m-tour").onclick = openWelcome;
$("m-backupBtn").onclick = openBackup;

// ================================================================== support + about
$("supportBox").innerHTML = SUPPORT_URL
  ? `<p class="note" style="margin-top:10px">Binder Buddy is made by one developer. If it helps you, you can chip in for server-free coffee. Totally optional, and every feature stays free.</p>
     <a class="btn ok" href="${esc(SUPPORT_URL)}" target="_blank" rel="noopener">☕ Support Binder Buddy</a>`
  : `<p class="note" style="margin-top:10px">Want to help? Tell a friend at your next league night 💙</p>`;
$("affNote").hidden = !AFF.tcgplayer;
$("ver").textContent = VERSION;

// ================================================================== learning & reports
export function drawLearn() {
  const n = learnedCount();
  $("lr-sum").textContent = n ? `Your scanner has learned from ${n} fix${n === 1 ? "" : "es"} on this device.` : "No scanner fixes yet.";
  $("lr-forget").hidden = !n;
}
$("lr-report").onclick = () => {
  window.open(reportURL("Report: ", ["**What happened?** (a wrong price, a wrong card, something broken, or an idea)", "", "", "**Which card or screen?**", "", ""], VERSION), "_blank", "noopener");
};
$("lr-forget").onclick = () => { clearLearned(); drawLearn(); toast("Scanner fixes forgotten."); };
on("data", drawLearn);
drawLearn();
