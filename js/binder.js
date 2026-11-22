// The binder: list, "Do I have it?", value + chart, card details with price history, add/edit, photos.
import { GAMES, CONDS, rarIndex, isHit, priceLinks } from "./logic.js";
import { S, cards, wants, db, photoURL, dropPhotos, history, recordValue, saveS } from "./store.js";
import { card as fetchCard, refreshPrices, onePieceHistory, VARIANT_NAMES, pickVariant, logPrice } from "./catalog.js";
import { $, esc, newId, toast, seg, openSheet, closeSheet, loadImg, toJpeg } from "./util.js";
import { money, moneyOr, signed, gameColor, condColor, condLabel, stripe, tagsHTML, cardImg, fillPhotos, daysOld, move, emit, on } from "./ui.js";
import { lineChart } from "./chart.js";
import { openPicker } from "./picker.js";

export const filt = {game: "all", tag: "", hits: false};
export const saveCard = c => { cards.set(c.id, c); return db.put("cards", c); };

// ================================================================== list
function matches(c, words) {
  const g = GAMES[c.game];
  const hay = [c.name, c.set, c.num, c.rarity, c.notes, c.grade, c.lang, g ? g.name : "", ...(c.tags || []).map(t => (S.tags.find(x => x.id === t) || {}).name)].join(" ").toLowerCase();
  return words.every(w => hay.includes(w));
}
function groupKey(c) {
  if (S.groupBy === "game") return [GAMES[c.game] ? GAMES[c.game].name : "Other", gameColor(c.game)];
  if (S.groupBy === "set") return [c.set || "No set", ""];
  if (S.groupBy === "rarity") return [c.rarity || "No rarity", S.colorBy === "rarity" ? stripe(c) : ""];
  if (S.groupBy === "tag") { const t = S.tags.find(x => (c.tags || []).includes(x.id)); return t ? [t.name, t.color] : ["No tag", ""]; }
  if (S.groupBy === "condition") return [c.cond, condColor(c.cond)];
  return ["", ""];
}
const rarRel = c => { const g = GAMES[c.game]; return g ? rarIndex(c) / g.rar.length : -1; };

export function visible() {
  const raw = $("q").value.trim().toLowerCase(), words = raw ? raw.split(/\s+/) : [];
  let rows = [...cards.values()].filter(c => S.games.includes(c.game) || !GAMES[c.game]);
  if (filt.game !== "all") rows = rows.filter(c => c.game === filt.game);
  if (filt.tag) rows = rows.filter(c => (c.tags || []).includes(filt.tag));
  if (filt.hits) rows = rows.filter(isHit);
  if (words.length) rows = rows.filter(c => matches(c, words));
  const s = $("sort").value;
  const mv = c => { const m = move(c); return m ? Math.abs(m.abs) * (+c.qty || 1) : -1; };
  rows.sort((a, b) => s === "value" ? (b.market * b.qty || 0) - (a.market * a.qty || 0)
    : s === "new" ? String(b.added).localeCompare(String(a.added))
    : s === "rarity" ? rarRel(b) - rarRel(a)
    : s === "mover" ? mv(b) - mv(a)
    : s === "stale" ? daysOld(b) - daysOld(a)
    : String(a.name).localeCompare(String(b.name)));
  return rows;
}

const totalValue = list => list.reduce((s, c) => s + (+c.qty || 0) * (+c.market || 0), 0);
function renderStats() {
  let kinds = 0, qty = 0, paid = 0, hits = 0;
  const all = [...cards.values()], shown = all.filter(c => filt.game === "all" || c.game === filt.game);
  for (const c of shown) { const n = +c.qty || 0; if (n > 0) kinds++; qty += n; paid += n * (+c.paid || 0); if (n > 0 && isHit(c)) hits++; }
  const val = totalValue(shown);
  $("s-kinds").textContent = kinds; $("s-qty").textContent = qty; $("s-hits").textContent = hits; $("s-val").textContent = money(val);
  const g = val - paid;
  $("s-gain").textContent = signed(g); $("s-gain").className = g >= 0 ? "up" : "down";
  // the history chart always tracks the whole binder
  if (all.length && !all.every(c => c.demo)) recordValue(totalValue(all));
  const h = history();
  const fmtD = d => new Date(d + "T12:00:00").toLocaleDateString(undefined, {month: "short", day: "numeric"});
  if (filt.game === "all" && h.length >= 2) {
    const first = h[0].v, last = h[h.length - 1].v, d = last - first;
    $("s-delta").innerHTML = `<span class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${signed(d)}${first > 0 ? ` (${Math.round(d / first * 100)}%)` : ""}</span> <span class="muted">since ${fmtD(h[0].d)}</span>`;
    lineChart($("valueChart"), h.map(p => ({label: fmtD(p.d), v: p.v})), money, "My collection value over time");
  } else {
    $("s-delta").innerHTML = cards.size ? `<span class="muted">Your value chart grows a dot each day you open the app.</span>` : "";
    $("valueChart").innerHTML = "";
  }
  $("s-priced").textContent = S.lastPriced ? "Prices from " + new Date(S.lastPriced).toLocaleString(undefined, {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"}) : "";
  $("refreshBtn").hidden = ![...cards.values(), ...wants.values()].some(c => c.ref);
}
function renderChips() {
  const games = Object.keys(GAMES).filter(g => S.games.includes(g));
  $("gameChips").innerHTML = (games.length > 1 ? `<button class="fchip ${filt.game === "all" ? "on" : ""}" data-g="all">All games</button>` : "") +
    games.map(g => `<button class="fchip ${filt.game === g ? "on" : ""}" data-g="${g}"><i style="background:${gameColor(g)}"></i>${GAMES[g].name}</button>`).join("");
  $("tagFilter").innerHTML = `<option value="">All tags</option>` + S.tags.map(t => `<option value="${t.id}" ${filt.tag === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  $("hitsBtn").classList.toggle("ok", filt.hits); $("hitsBtn").classList.toggle("ghost", !filt.hits); $("hitsBtn").setAttribute("aria-pressed", filt.hits);
  const demo = [...cards.values()].some(c => c.demo);
  $("demoBanner").innerHTML = demo ? `<div class="banner"><span>👀 You're looking at sample cards with real, live prices. Add your own whenever you're ready.</span><button class="btn small" id="clearDemo">Remove samples</button></div>` : "";
}

let renderToken = 0;
export async function render() {
  renderStats(); renderChips();
  const rows = visible(), out = $("out"), token = ++renderToken;
  if (!cards.size) {
    out.innerHTML = `<div class="empty">Your binder is empty.<br>Add a card, scan a binder page, or look around with sample cards.
      <div class="acts"><button class="btn ok" data-empty="add">+ Add a card</button><button class="btn" data-empty="scan">📷 Scan</button><button class="btn ghost" data-empty="demo">Try sample cards</button></div></div>`;
    return;
  }
  if (!rows.length) { out.innerHTML = `<div class="empty">No cards match.</div>`; return; }
  const groups = new Map();
  for (const c of rows) { const [k, col] = groupKey(c); if (!groups.has(k)) groups.set(k, {col, items: []}); groups.get(k).items.push(c); }
  const grid = S.layout === "grid";
  let html = "";
  for (const [k, g] of groups) {
    if (k) html += `<div class="grouph">${g.col ? `<i style="background:${g.col}"></i>` : ""}${esc(k)} <small>${g.items.reduce((s, c) => s + (+c.qty || 0), 0)} cards · ${money(totalValue(g.items))}</small></div>`;
    html += `<div class="${grid ? "grid" : "list"}">` + g.items.map(c => grid ? gridCard(c) : listCard(c)).join("") + `</div>`;
  }
  out.innerHTML = html;
  for (const img of out.querySelectorAll("img[data-ph]")) { const u = await photoURL(img.dataset.ph); if (token !== renderToken) return; if (u) img.src = u; }
}
function listCard(c) {
  const n = +c.qty || 0, each = +c.market || 0, gain = (each - (+c.paid || 0)) * n, img = cardImg(c), old = daysOld(c), m = move(c);
  return `<div class="card${img ? " withpic" : ""}" data-id="${c.id}" style="--stripe:${stripe(c)}" role="button" tabindex="0" aria-label="${esc(c.name)} details">
    ${img}
    <div><div class="nm">${esc(c.name)}</div>
      <div class="meta">${esc([S.games.length > 1 && GAMES[c.game] ? GAMES[c.game].name : "", c.set, c.num].filter(Boolean).join(" · "))}</div>
      <div class="meta">${c.rarity ? `<span class="tag soft">${esc(c.rarity)}</span>` : ""}<span class="tag" style="background:${condColor(c.cond)}">${esc(condLabel(c))}</span>${c.lang && c.lang !== "English" ? `<span class="tag soft">${esc(c.lang)}</span>` : ""}${c.tl ? `<span class="tag soft">${{t: "🔁 Trade", s: "💲 Sale", ts: "🔁💲 Trade or sell"}[c.tl] || ""}</span>` : ""}${tagsHTML(c)}</div></div>
    <div class="qty"><button data-a="minus" aria-label="One less ${esc(c.name)}">−</button><b>${n}</b><button data-a="plus" aria-label="One more ${esc(c.name)}">+</button></div>
    <div class="money">
      <span>${moneyOr(c.market)}${c.market !== "" && c.market != null ? ` each · <b>${money(each * n)}</b>` : ""}</span>
      ${m && Math.abs(m.pct) >= 1 ? `<span class="${m.abs >= 0 ? "up" : "down"}">${m.abs >= 0 ? "▲" : "▼"} ${Math.abs(m.pct)}% lately</span>` : ""}
      ${c.paid !== "" && c.paid != null ? `<span class="${gain >= 0 ? "up" : "down"}">${gain >= 0 ? "+" : "−"}${money(Math.abs(gain))} vs paid</span>` : ""}
      ${old > 30 && !c.ref ? `<span class="stale">${old > 900 ? "add a price" : "price " + Math.round(old) + " days old"}</span>` : ""}
    </div></div>`;
}
function gridCard(c) {
  const img = cardImg(c, "");
  return `<div class="gcard" data-id="${c.id}" style="--stripe:${stripe(c)}" role="button" tabindex="0" aria-label="${esc(c.name)} details">
    ${img || `<div class="nopic">No photo yet</div>`}
    <b>${esc(c.name)}</b><span>${esc(c.rarity || condLabel(c))}</span><br><span>${moneyOr(c.market, "")}${(+c.qty || 0) > 1 ? " × " + c.qty : ""}</span></div>`;
}

// "Do I have it?"
export function answer() {
  const raw = $("q").value.trim(), box = $("answer");
  render();
  if (!raw) { box.className = "answer"; return; }
  const words = raw.toLowerCase().split(/\s+/);
  const hits = [...cards.values()].filter(c => matches(c, words) && (+c.qty || 0) > 0);
  if (hits.length) {
    const total = hits.reduce((s, c) => s + (+c.qty || 0), 0);
    box.className = "answer yes";
    box.innerHTML = `<span class="big">YES! You have ${total}</span>` + hits.slice(0, 6).map(c =>
      `<div class="hit">${cardImg(c, "") || "•"}<span>${c.qty} × ${esc(c.name)}${c.set ? " (" + esc(c.set) + (c.num ? " " + esc(c.num) : "") + ")" : ""}: ${esc(condLabel(c))}, ${moneyOr(c.market)} each</span></div>`).join("") +
      (hits.length > 6 ? `<div class="hit">…and ${hits.length - 6} more below</div>` : "");
    fillPhotos(box);
  } else {
    box.className = "answer no";
    box.innerHTML = `<span class="big">NO, not in your binder</span><div class="hit"><button class="linkbtn" id="ans-find">Look it up and see its price</button> · <button class="linkbtn" id="ans-want">Add it to my wishlist</button></div>`;
    $("ans-find").onclick = () => openPicker({text: raw, game: filt.game !== "all" ? filt.game : undefined, onPick: r => openEdit(null, r), onManual: (g, t) => openEdit(null, {game: g, name: t || raw})});
    $("ans-want").onclick = () => emit("want:add", raw);
  }
}

// ================================================================== prices
let refreshing = false;
export async function updatePrices(quiet = false) {
  if (refreshing) return;
  const items = [...cards.values(), ...wants.values()];
  if (!items.some(i => i.ref)) { if (!quiet) toast("Pick cards from the search to get automatic prices."); return; }
  refreshing = true;
  const btn = $("refreshBtn"), label = btn.textContent;
  btn.disabled = true;
  try {
    const res = await refreshPrices(items, (d, t) => { btn.textContent = `🔄 ${d}/${t}`; });
    for (const c of cards.values()) if (c.ref) await db.put("cards", c);
    for (const w of wants.values()) if (w.ref) await db.put("wants", w);
    S.lastPriced = new Date().toISOString(); saveS();
    if (!quiet || res.failed) toast(res.failed ? `Updated ${res.total - res.failed} prices. ${res.failed} couldn't be reached, try again later.` : `Prices updated for ${res.total} cards`);
  } catch (e) { if (!quiet) toast("Couldn't update prices right now."); }
  btn.textContent = label; btn.disabled = false; refreshing = false;
  render(); emit("data");
}

// ================================================================== card details
export async function openDetail(id) {
  const c = cards.get(id); if (!c) return;
  const n = +c.qty || 0, m = move(c), pics = [...(c.photos || [])];
  const art = c.photos && c.photos[0] ? `<img class="art" data-ph="${c.photos[0]}" data-zoom alt="${esc(c.name)}">`
    : c.imgLg || c.img ? `<img class="art" src="${esc(c.imgLg || c.img)}" data-zoom alt="${esc(c.name)}">` : `<div class="art"></div>`;
  $("d-body").innerHTML = `
    <div class="detail">
      <div>${art}${pics.length > 1 || (pics.length && c.img) ? `<div class="thumbs">${pics.map((p, i) => `<img data-ph="${p}" data-zoom="${i}" alt="My photo ${i + 1}">`).join("")}${c.img ? `<img src="${esc(c.img)}" data-zoom="official" alt="Official picture">` : ""}</div>` : ""}</div>
      <div>
        <h2 id="d-name" style="margin:0">${esc(c.name)}</h2>
        <div class="meta">${esc([GAMES[c.game] ? GAMES[c.game].name : "", c.set, c.num].filter(Boolean).join(" · "))}</div>
        <div class="meta">${c.rarity ? `<span class="tag soft">${esc(c.rarity)}</span>` : ""}<span class="tag" style="background:${condColor(c.cond)}">${esc(condLabel(c))}</span>${c.ref && c.ref.v && VARIANT_NAMES[c.ref.v] && Object.keys(c.variants || {}).length > 1 ? `<span class="tag soft">${esc(VARIANT_NAMES[c.ref.v])}</span>` : ""}${tagsHTML(c)}</div>
        <div class="pricebig" style="margin-top:10px">${moneyOr(c.market)}</div>
        <div class="note">${c.market !== "" && c.market != null ? `market value each${n > 1 ? ` · ${n} × = <b>${money(n * c.market)}</b>` : ""}` : ""}${c.ref ? " · updates daily" : ""}</div>
        ${m ? `<div class="${m.abs >= 0 ? "up" : "down"}" style="font-weight:800;margin-top:4px">${m.abs >= 0 ? "▲" : "▼"} ${signed(m.abs)} (${m.pct}%) since ${esc(m.since)}</div>` : ""}
        <dl class="kv">
          <dt>I have</dt><dd>${n}</dd>
          ${c.paid !== "" && c.paid != null ? `<dt>I paid</dt><dd>${money(c.paid)} each (${signed((+c.market || 0) * n - c.paid * n)} total)</dd>` : ""}
          ${c.lang && c.lang !== "English" ? `<dt>Language</dt><dd>${esc(c.lang)}</dd>` : ""}
          ${c.notes ? `<dt>Notes</dt><dd>${esc(c.notes)}</dd>` : ""}
        </dl>
        <div class="acts" style="justify-content:flex-start">
          <button class="btn" id="d-edit">✏️ Edit</button><button class="btn ghost" id="d-trade">🤝 Trade it</button>
          ${c.ref ? "" : `<button class="btn ghost" id="d-link">🔗 Get live price</button>`}
        </div>
      </div>
    </div>
    <h3>📈 Price history</h3>
    <div id="d-hist"><p class="note"><span class="spin"></span> Loading…</p></div>
    <h3>🔎 Check real sold prices</h3>
    <p class="note">The best check is what it actually <b>sold</b> for: TCGplayer's chart for the trend, then eBay sold listings and 130point for real sales${c.cond === "Graded" ? " in the same grade" : ""}.</p>
    <div class="plinks">${priceLinks(c).map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("")}</div>`;
  fillPhotos($("d-body"));
  $("d-edit").onclick = () => { closeSheet("m-detail"); openEdit(c.id); };
  $("d-trade").onclick = () => { closeSheet("m-detail"); emit("trade:give", c.id); };
  if ($("d-link")) $("d-link").onclick = () => linkExisting(c);
  $("d-body").querySelectorAll("[data-zoom]").forEach(el => el.onclick = () => openLB(c.id, el.dataset.zoom === "official" ? pics.length : +el.dataset.zoom || 0));
  openSheet("m-detail");
  drawHistory(c);
}
async function drawHistory(c) {
  const box = $("d-hist"), parts = [];
  const fmtD = d => new Date(d + "T12:00:00").toLocaleDateString(undefined, {month: "short", day: "numeric"});
  if ((c.ph || []).length >= 2) parts.push({title: "Tracked by Binder Buddy on this device", pts: c.ph.map(p => ({label: fmtD(p.d), v: p.v}))});
  if (c.ref && c.ref.src === "optcg") {
    try {
      const code = (c.num || c.ref.id).split("_")[0];
      const pts = await onePieceHistory(c.ref.id, code);
      if (pts.length >= 2) parts.push({title: "TCGplayer market price, last 2 weeks", pts: pts.map(p => ({label: p.d === 0 ? "today" : -p.d + "d ago", v: p.v}))});
    } catch (e) {}
  }
  if (!box.isConnected) return;
  const change = pts => {
    const a = pts[0].v, b = pts[pts.length - 1].v, d = b - a;
    if (Math.abs(d) < 0.005) return `<b>No change</b> (steady at ${money(b)})`;
    return `<b class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "▲" : "▼"} ${signed(d)}${a > 0 ? ` (${Math.round(d / a * 100)}%)` : ""}</b> from ${money(a)} to ${money(b)}`;
  };
  let html = parts.map((p, i) => `<p class="note" style="margin:8px 0 0">${esc(p.title)}: ${change(p.pts)}</p><div id="d-ch${i}"></div>`).join("");
  if (c.trend) {
    const t = c.trend, cls = t.pct >= 0 ? "up" : "down";
    html += `<p class="note" style="margin-top:10px">Cardmarket (Europe) average: €${t.from.toFixed(2)} over 30 days → €${t.to.toFixed(2)} over 7 days <b class="${cls}">${t.pct >= 0 ? "▲" : "▼"} ${Math.abs(t.pct)}%</b></p>`;
  }
  if (!html) html = `<p class="note">${c.ref ? "Binder Buddy saves this card's price every day, so a chart appears here over time. For the long-term chart, open TCGplayer below." : "Link this card to get daily prices and a history chart: tap 🔗 Get live price."}</p>`;
  box.innerHTML = html;
  parts.forEach((p, i) => lineChart($("d-ch" + i), p.pts, money, c.name + ": " + p.title));
}
function linkExisting(c) {
  closeSheet("m-detail");
  openPicker({title: "Which card is it?", game: c.game, text: [c.name, (c.num || "").split("/")[0]].filter(Boolean).join(" "), onPick: async r => {
    Object.assign(c, linkFields(r, c.ref && c.ref.v));
    if (!c.set) c.set = r.set; if (!c.num) c.num = r.num; if (!c.rarity) c.rarity = r.rarity;
    logPrice(c); await saveCard(c); render(); toast("Linked! This card's price now updates daily."); openDetail(c.id);
  }});
}
/** The fields a card gets from a database match. */
export function linkFields(r, wantV) {
  const v = pickVariant(r.variants || {}, wantV);
  return {ref: {src: r.src, id: r.id, v}, img: r.img || "", imgLg: r.imgLg || "", tcgId: r.tcgId || null, variants: r.variants || {}, trend: r.trend || null,
    market: v && r.variants[v] != null ? r.variants[v] : (r.market ?? ""), priced: new Date().toISOString()};
}

// ================================================================== lightbox
let lb = {id: null, i: 0, list: []};
async function openLB(id, i) {
  const c = cards.get(id); if (!c) return;
  const list = [...(c.photos || []).map(p => ({ph: p})), ...(c.imgLg || c.img ? [{url: c.imgLg || c.img}] : [])];
  if (!list.length) return;
  lb = {id, i: (i + list.length) % list.length, list};
  const it = list[lb.i];
  $("lb-img").src = it.ph ? await photoURL(it.ph) : it.url;
  $("lb-img").alt = c.name;
  $("lb-cap").innerHTML = `${esc(c.name)}${c.rarity ? " · " + esc(c.rarity) : ""}<br>${esc(condLabel(c))} · ${moneyOr(c.market)}` + (list.length > 1 ? `<br>${it.ph ? "my photo" : "official picture"} · ${lb.i + 1} of ${list.length}` : "");
  $("lb-prev").style.visibility = $("lb-next").style.visibility = list.length > 1 ? "visible" : "hidden";
  $("lb").classList.add("open");
}
$("lb-close").onclick = () => $("lb").classList.remove("open");
$("lb").addEventListener("click", e => { if (e.target.id === "lb") $("lb").classList.remove("open"); });
$("lb-prev").onclick = () => openLB(lb.id, lb.i - 1);
$("lb-next").onclick = () => openLB(lb.id, lb.i + 1);
document.addEventListener("keydown", e => {
  if (!$("lb").classList.contains("open")) return;
  if (e.key === "Escape") $("lb").classList.remove("open");
  if (e.key === "ArrowLeft") openLB(lb.id, lb.i - 1);
  if (e.key === "ArrowRight") openLB(lb.id, lb.i + 1);
});

// ================================================================== add / edit
let editing = null, form = null, delArmed = false, afterSave = null;
/** openEdit(id) edits a saved card. openEdit(null, prefill) starts a new one (prefill can be a database match). */
export function openEdit(id, pre = {}, onSaved = null) {
  editing = id || null; delArmed = false; afterSave = onSaved;
  const base = {game: filt.game !== "all" ? filt.game : (S.games[0] || "pokemon"), name: "", set: "", num: "", rarity: "", lang: "English",
    cond: "Near Mint", grade: "", qty: 1, paid: "", market: "", notes: "", tags: filt.tag ? [filt.tag] : [], photos: []};
  let c;
  if (id) c = cards.get(id);
  else if (pre.src) c = {...base, game: pre.game, name: pre.name, set: pre.set, num: pre.num, rarity: pre.rarity, ...linkFields(pre), qty: pre.qty || 1, paid: pre.paid ?? ""};
  else c = {...base, ...pre};
  form = {game: c.game, photos: [...(c.photos || [])], tags: [...(c.tags || [])], newPhotos: [], removed: [], uploading: 0,
    link: c.ref ? {ref: {...c.ref}, img: c.img, imgLg: c.imgLg, tcgId: c.tcgId, variants: c.variants || {}, trend: c.trend || null} : null};
  $("e-title").textContent = id ? "Edit card" : "Add a card";
  $("f-name").value = c.name || ""; $("f-set").value = c.set || ""; $("f-num").value = c.num || "";
  $("f-lang").value = c.lang || "English"; $("f-cond").value = c.cond || "Near Mint"; $("f-grade").value = c.grade || "";
  $("f-qty").value = c.qty ?? 1; $("f-tl").value = c.tl || ""; $("f-paid").value = c.paid ?? ""; $("f-mkt").value = c.market ?? ""; $("f-notes").value = c.notes || "";
  drawGameSeg(); fillRarity(c.rarity); drawTags(); drawPhotos(); drawLinked();
  $("f-del").style.display = id ? "" : "none"; $("f-del").textContent = "Delete"; $("f-msg").textContent = "";
  syncForm();
  openSheet("m-edit", id || pre.src ? "#f-qty" : "#f-name");
}
function drawLinked() {
  const L = form.link;
  if (!L) {
    $("e-linked").innerHTML = `<div class="linked"><span>🔎 Pick it from the card list to fill this in and get daily prices.</span><button class="btn small" id="e-find">Find card</button></div>`;
    $("e-find").onclick = () => openPicker({game: form.game, text: $("f-name").value.trim(), onPick: r => {
      form.link = linkFields(r); form.link.ref = {src: r.src, id: r.id, v: form.link.ref.v};
      form.game = r.game; $("f-name").value = r.name; $("f-set").value = r.set; $("f-num").value = r.num;
      drawGameSeg(); fillRarity(r.rarity); if (form.link.market !== "") $("f-mkt").value = form.link.market;
      drawLinked(); syncForm();
    }});
    $("f-vbox").hidden = true;
    return;
  }
  $("e-linked").innerHTML = `<div class="linked">${L.img ? `<img src="${esc(L.img)}" alt="">` : ""}<span>🔗 Linked to the card list. The price updates by itself every day.</span><button class="btn ghost small" id="e-unlink">Unlink</button></div>`;
  $("e-unlink").onclick = () => { form.link = null; drawLinked(); };
  const vs = Object.keys(L.variants || {});
  $("f-vbox").hidden = vs.length < 2;
  $("f-v").innerHTML = vs.map(v => `<option value="${v}" ${v === L.ref.v ? "selected" : ""}>${esc(VARIANT_NAMES[v] || v)} · ${money(L.variants[v])}</option>`).join("");
}
$("f-v").onchange = e => { form.link.ref.v = e.target.value; $("f-mkt").value = form.link.variants[e.target.value]; };
function drawGameSeg() {
  seg($("f-game"), Object.keys(GAMES).filter(g => S.games.includes(g) || g === form.game).map(g => [g, GAMES[g].name]), form.game, v => {
    if (v === form.game) return;
    form.game = v; form.link = null; drawGameSeg(); fillRarity(""); drawLinked(); syncForm();
  });
}
function fillRarity(v) {
  const g = GAMES[form.game];
  $("f-rar").innerHTML = `<option value="">(not set)</option>` + g.rar.map(r => `<option ${r === v ? "selected" : ""}>${esc(r)}</option>`).join("") + `<option ${v === "Other" ? "selected" : ""}>Other</option>`;
}
function drawTags() {
  $("f-tags").innerHTML = S.tags.length ? S.tags.map(t => `<button type="button" data-t="${t.id}" class="${form.tags.includes(t.id) ? "on" : ""}" style="background:${t.color}" aria-pressed="${form.tags.includes(t.id)}">${esc(t.name)}</button>`).join("")
    : `<span class="note">Make tags in 🎨 Make it yours.</span>`;
}
$("f-tags").addEventListener("click", e => {
  const b = e.target.closest("[data-t]"); if (!b) return;
  const t = b.dataset.t; form.tags = form.tags.includes(t) ? form.tags.filter(x => x !== t) : [...form.tags, t]; drawTags();
});
function syncForm() { $("gradeBox").style.visibility = $("f-cond").value === "Graded" ? "visible" : "hidden"; }
$("f-cond").addEventListener("input", syncForm);

async function drawPhotos() {
  const items = await Promise.all(form.photos.map(async (id, i) => `<div class="ph${i === 0 ? " cover" : ""}"><img src="${await photoURL(id)}" alt="My photo ${i + 1}">
      <button type="button" class="px" data-i="${i}" aria-label="Remove photo">×</button><button type="button" class="pr" data-i="${i}" aria-label="Rotate photo">⟳</button>
      ${i > 0 ? `<button type="button" class="pc" data-i="${i}" aria-label="Make cover photo">★</button>` : ""}</div>`));
  $("f-photos").innerHTML = items.join("") + (form.uploading ? `<div class="addph">Adding…</div>` : "") +
    (form.photos.length + form.uploading < 6 ? `<button type="button" class="addph" id="ph-add">📷<br>Add photo</button>` : "");
  const add = $("ph-add");
  if (add) add.onclick = () => { const f = $("f-file"); if (+S.camera) f.setAttribute("capture", "environment"); else f.removeAttribute("capture"); f.click(); };
}
$("f-photos").addEventListener("click", async e => {
  const b = e.target.closest("button[data-i]"); if (!b) return;
  const i = +b.dataset.i;
  if (b.classList.contains("px")) { form.removed.push(form.photos[i]); form.photos.splice(i, 1); }
  if (b.classList.contains("pc")) { const [p] = form.photos.splice(i, 1); form.photos.unshift(p); }
  if (b.classList.contains("pr")) {
    const old = form.photos[i], rotated = await rotate(await db.get("photos", old)), nid = newId("p");
    await db.put("photos", rotated, nid); form.newPhotos.push(nid); form.removed.push(old); form.photos[i] = nid;
  }
  drawPhotos();
});
export async function prepPhoto(file) {
  const im = await loadImg(file);
  let sx = 0, sy = 0, sw = im.width, sh = im.height;
  if (+S.crop) {   // center-crop to a trading card's 5:7 shape (7:5 if the photo is sideways)
    const want = im.width > im.height ? 7 / 5 : 5 / 7;
    if (sw / sh > want) { sw = sh * want; sx = (im.width - sw) / 2; } else { sh = sw / want; sy = (im.height - sh) / 2; }
  }
  const k = Math.min(1, (+S.quality || 1200) / Math.max(sw, sh));
  const cv = document.createElement("canvas"); cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
  cv.getContext("2d").drawImage(im, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return toJpeg(cv);
}
async function rotate(blob) {
  const im = await loadImg(blob), cv = document.createElement("canvas");
  cv.width = im.height; cv.height = im.width;
  const g = cv.getContext("2d"); g.translate(cv.width, 0); g.rotate(Math.PI / 2); g.drawImage(im, 0, 0);
  return toJpeg(cv);
}
$("f-file").addEventListener("change", async e => {
  const files = [...e.target.files].slice(0, 6 - form.photos.length); e.target.value = "";
  for (const f of files) {
    form.uploading++; drawPhotos();
    try { const b = await prepPhoto(f), id = newId("p"); await db.put("photos", b, id); form.photos.push(id); form.newPhotos.push(id); }
    catch (err) { $("f-msg").textContent = "Couldn't read that photo. Try a different one."; }
    form.uploading--; drawPhotos();
  }
});
function cancelEdit() { if (form) dropPhotos(form.newPhotos); form = null; }
$("f-cancel").onclick = () => closeSheet("m-edit");
$("m-edit").addEventListener("closed", () => { if (form) cancelEdit(); });
$("f-save").onclick = async () => {
  const name = $("f-name").value.trim();
  if (!name) { $("f-msg").textContent = "Give the card a name first."; return; }
  if (form.uploading) { $("f-msg").textContent = "Wait for the photo to finish."; return; }
  const old = editing ? cards.get(editing) : null;
  const market = $("f-mkt").value === "" ? "" : +$("f-mkt").value;
  const L = form.link;
  const c = {...(old || {}), id: editing || newId("c"), game: form.game, name, set: $("f-set").value.trim(), num: $("f-num").value.trim(),
    rarity: $("f-rar").value, lang: $("f-lang").value, cond: $("f-cond").value, grade: $("f-cond").value === "Graded" ? $("f-grade").value.trim() : "",
    qty: Math.max(0, Math.round(+$("f-qty").value || 0)), paid: $("f-paid").value === "" ? "" : +$("f-paid").value, market,
    tl: $("f-tl").value, notes: $("f-notes").value.trim(), tags: form.tags, photos: form.photos, added: old ? old.added : new Date().toISOString(),
    priced: market === "" ? (old ? old.priced : "") : (old && +old.market === market && old.priced ? old.priced : new Date().toISOString()),
    ref: L ? L.ref : null, img: L ? L.img : "", imgLg: L ? L.imgLg : "", tcgId: L ? L.tcgId : null, variants: L ? L.variants : {}, trend: L ? L.trend : null};
  delete c.demo;
  logPrice(c);
  await saveCard(c);
  await dropPhotos(form.removed.filter(id => !form.photos.includes(id)));
  form = null;
  closeSheet("m-edit"); answer(); toast(old ? "Saved" : "Added to your binder");
  if (afterSave) afterSave(c);
  emit("data");
};
$("f-del").onclick = async () => {
  if (!delArmed) { delArmed = true; $("f-del").textContent = "Tap again to delete"; return; }
  const c = cards.get(editing);
  cards.delete(editing); await db.del("cards", editing);
  await dropPhotos([...(c.photos || []), ...form.newPhotos]); form = null;
  closeSheet("m-edit"); answer(); toast("Deleted"); emit("data");
};

// ================================================================== list clicks
const qtyTimers = new Map();
function bumpQty(id, d) {
  const c = cards.get(id); if (!c) return;
  c.qty = Math.max(0, (+c.qty || 0) + d); render();
  clearTimeout(qtyTimers.get(id));
  qtyTimers.set(id, setTimeout(() => db.put("cards", c), 400));
}
$("out").addEventListener("click", e => {
  const emp = e.target.closest("[data-empty]");
  if (emp) return emit("empty:" + emp.dataset.empty);
  const host = e.target.closest("[data-id]"); if (!host) return;
  const a = e.target.closest("[data-a]");
  if (a && a.dataset.a === "plus") bumpQty(host.dataset.id, 1);
  else if (a && a.dataset.a === "minus") bumpQty(host.dataset.id, -1);
  else openDetail(host.dataset.id);
});
$("out").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-id]")) { e.preventDefault(); openDetail(e.target.dataset.id); } });
$("q").addEventListener("input", answer);
$("sort").addEventListener("change", render);
$("tagFilter").addEventListener("change", e => { filt.tag = e.target.value; render(); });
$("hitsBtn").onclick = () => { filt.hits = !filt.hits; render(); };
$("gameChips").addEventListener("click", e => { const b = e.target.closest("[data-g]"); if (b) { filt.game = b.dataset.g; render(); } });
$("refreshBtn").onclick = () => updatePrices(false);
$("demoBanner").addEventListener("click", e => { if (e.target.id === "clearDemo") emit("demo:clear"); });
$("addBtn").onclick = () => openPicker({game: filt.game !== "all" ? filt.game : undefined, onPick: r => openEdit(null, r), onManual: (g, t) => openEdit(null, {game: g, name: t})});
on("render", render);
export { CONDS };
