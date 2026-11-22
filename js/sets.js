// Set progress: "I have 142 of 191 in Surging Sparks", what's missing, and one tap to add a missing card to the wishlist.
import { GAMES } from "./logic.js";
import { cards, wants, db } from "./store.js";
import { setOf, setList, fillSetCodes, card as fetchCard } from "./catalog.js";
import { $, esc, toast, seg, openSheet, copyText } from "./util.js";
import { money, gameColor, on } from "./ui.js";
import { quickWant } from "./wishlist.js";

let groups = [], view = null, show = "missing", chase = false, unlinked = 0;
const pct = (a, b) => b ? Math.floor(a / b * 100) : 0;
// you have a card if you have it or another printing of it (Yu-Gi-Oh! prints the same card under several region codes)
const owns = (g, c) => g.owned.has(c.id) || (c.also || []).some(id => g.owned.has(id));
const bar = (a, b) => `<div class="pbar" role="progressbar" aria-valuemin="0" aria-valuemax="${b}" aria-valuenow="${a}"><i style="width:${Math.min(100, b ? a / b * 100 : 0)}%"></i></div>`;

function count(g) {
  const L = g.list; if (!L) return null;
  const base = L.cards.filter(c => !c.extra), extra = L.cards.filter(c => c.extra);
  // the printed size can include cards the database lists as extras: never count past what can actually be owned
  return {have: base.filter(c => owns(g, c)).length, base: base.length ? Math.min(L.base || base.length, base.length) : L.base,
    xHave: extra.filter(c => owns(g, c)).length, xAll: extra.length};
}

export async function openSets() {
  view = null;
  $("st-title").textContent = "📚 My sets";
  $("st-body").innerHTML = `<p class="note"><span class="spin"></span> Looking up your sets…</p>`;
  openSheet("m-sets", "#st-title");
  const mine = [...cards.values()].filter(c => (+c.qty || 0) > 0);
  // older Lorcana cards didn't save their set: look it up once and keep it
  const missingCode = mine.filter(c => c.ref && c.ref.src === "lorcast" && !c.setCode);
  if (missingCode.length && await fillSetCodes(missingCode)) for (const c of missingCode) if (c.setCode) await db.put("cards", c);
  const by = new Map(); unlinked = 0;
  for (const c of mine) {
    const s = setOf(c);
    if (!s) { if (c.kind !== "sealed") unlinked++; continue; }
    const k = s.game + ":" + s.set;
    if (!by.has(k)) by.set(k, {key: k, game: s.game, set: s.set, owned: new Set(), mine: [], list: null, failed: false});
    const g = by.get(k); g.owned.add(c.ref.id); g.mine.push(c);
  }
  groups = [...by.values()];
  drawList();
  // load each set's full card list (Lorcana one at a time: Lorcast asks for a pause between calls)
  const load = async g => { try { g.list = await setList(g.game, g.set); if (!g.list) g.failed = true; } catch (e) { g.failed = true; } if (!view) drawList(); };
  const lor = groups.filter(g => g.game === "lorcana"), rest = groups.filter(g => g.game !== "lorcana");
  await Promise.all([Promise.all(rest.map(load)), (async () => { for (const g of lor) { await load(g); await new Promise(r => setTimeout(r, 120)); } })()]);
}

function drawList() {
  const rows = [...groups].sort((a, b) => {
    const A = count(a), B = count(b);
    return (B ? pct(B.have, B.base) : -1) - (A ? pct(A.have, A.base) : -1) || a.key.localeCompare(b.key);
  });
  $("st-body").innerHTML = (rows.length ? `<div class="list">${rows.map(g => {
    const n = count(g), value = g.mine.reduce((s, c) => s + (+c.market || 0) * (+c.qty || 0), 0);
    return `<button type="button" class="card setrow" data-set="${esc(g.key)}" style="--stripe:${gameColor(g.game)}">
      <div><div class="nm">${esc(g.list ? g.list.name : g.set)}</div>
        <div class="meta">${esc(GAMES[g.game].name)} · my cards worth ${money(value)}</div>
        ${n ? `${bar(n.have, n.base)}<div class="meta"><b>${n.have} of ${n.base}</b> (${pct(n.have, n.base)}%)${n.xAll ? ` · chase cards ${n.xHave} of ${n.xAll}` : ""}${n.have >= n.base ? " · 🏆 Complete!" : ""}</div>`
          : g.failed ? `<div class="meta">Couldn't load this set. Check your internet.</div>` : `<div class="meta"><span class="spin"></span> Loading…</div>`}</div>
      <span aria-hidden="true">›</span></button>`;
  }).join("")}</div>` : `<div class="empty">Add cards from the card search or scanner and your sets show up here.</div>`)
    + (unlinked ? `<p class="note">${unlinked} card${unlinked === 1 ? " was" : "s were"} typed in by hand, so ${unlinked === 1 ? "it isn't" : "they aren't"} counted. Edit a card and search for it to link it.</p>` : "");
}

function drawSet() {
  const g = groups.find(x => x.key === view); if (!g || !g.list) return;
  const n = count(g), wanted = new Set([...wants.values()].map(w => w.ref && w.ref.id).filter(Boolean));
  const list = g.list.cards.filter(c => (chase || !c.extra) && (show === "all" || (show === "have") === owns(g, c)));
  const missing = g.list.cards.filter(c => (chase || !c.extra) && !owns(g, c));
  const cost = missing.reduce((s, c) => s + (+c.market || 0), 0), priced = missing.filter(c => c.market != null).length;
  $("st-title").textContent = "📚 " + g.list.name;
  $("st-body").innerHTML = `<button class="btn ghost small" id="st-back">← All my sets</button>
    <div style="margin:10px 0">${bar(n.have, n.base)}<p style="font-weight:800;margin:6px 0">${n.have} of ${n.base} (${pct(n.have, n.base)}%)${n.xAll ? ` · chase cards ${n.xHave} of ${n.xAll}` : ""}</p>
      ${priced && missing.length ? `<p class="note">The ${priced === missing.length ? "" : priced + " priced "}missing cards cost about <b>${money(cost)}</b> at market.</p>` : ""}</div>
    <div class="seg" id="st-show"></div>
    <label class="pickbox" style="margin:8px 0"><input type="checkbox" id="st-chase"${chase ? " checked" : ""}> Include chase cards (secret rares, enchanted, parallels)</label>
    <div class="acts" style="justify-content:flex-start;margin-top:0"><button class="btn ghost small" id="st-copy">Copy my missing list</button></div>
    <div class="setgrid">${list.map(c => {
      const own = owns(g, c);
      return `<div class="scard${own ? "" : " miss" + (g.list.keepImages ? " keep" : "")}">${c.img ? `<img src="${esc(c.img)}" alt="${esc(c.name)}" loading="lazy">` : `<div class="nopic">${esc(c.name)}</div>`}
        <b>${esc(c.num)}</b> <span>${esc(c.name)}</span>${c.market != null ? `<span>${money(c.market)}</span>` : ""}
        ${own ? `<span class="have">✓ Have</span>` : wanted.has(c.id) ? `<span class="have">⭐ Wishlist</span>` : `<button type="button" class="btn ghost small" data-want="${esc(c.id)}" aria-label="Add ${esc(c.name)} to my wishlist">☆ Want</button>`}</div>`;
    }).join("") || `<div class="empty">${show === "missing" ? "Nothing missing. 🏆" : "No cards here."}</div>`}</div>`;
  seg($("st-show"), [["missing", `Missing (${missing.length})`], ["have", "I have"], ["all", "All"]], show, v => { show = v; drawSet(); });
  $("st-back").onclick = () => { view = null; $("st-title").textContent = "📚 My sets"; drawList(); };
  $("st-chase").onchange = e => { chase = e.target.checked; drawSet(); };
  $("st-copy").onclick = () => copyText(`Missing from ${g.list.name} (${n.have} of ${n.base}):\n` + missing.map(c => `${c.num} ${c.name}`).join("\n"), "Missing list copied!");
}

$("st-body").addEventListener("click", async e => {
  const row = e.target.closest("[data-set]");
  if (row) { const g = groups.find(x => x.key === row.dataset.set); if (g && g.list) { view = g.key; show = "missing"; drawSet(); $("st-title").focus(); } return; }
  const w = e.target.closest("[data-want]");
  if (w) {
    w.disabled = true;
    const g = groups.find(x => x.key === view), c = g.list.cards.find(x => x.id === w.dataset.want);
    try {
      const r = await fetchCard(c.src, c.id);
      if (r && await quickWant(r)) toast(`⭐ ${r.name} added to your wishlist`);
    } catch (err) { toast("Couldn't reach the card database. Try again."); }
    drawSet();
  }
});
$("setsBtn").onclick = openSets;
on("sets:open", openSets);
