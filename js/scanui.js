// Scanner screen: photo of one card or a whole binder page -> confirm matches -> add to binder.
import { GAMES } from "./logic.js";
import { S, cards } from "./store.js";
import { card as fetchCard, logPrice } from "./catalog.js";
import { scanPhoto } from "./scan.js";
import { $, esc, newId, toast, seg, openSheet, closeSheet } from "./util.js";
import { money, emit, VERSION } from "./ui.js";
import { remember, scanReport } from "./learn.js";
import { openPicker } from "./picker.js";
import { linkFields, saveCard } from "./binder.js";

const LAYOUTS = {"1x1": [1, 1], "2x2": [2, 2], "3x3": [3, 3], "3x4": [3, 4]};
let layout = "1x1", game = "auto", rows = [], busy = false;

export function openScan() {
  if (busy) { openSheet("m-scan"); return; }
  $("sc-setup").hidden = false; $("sc-run").hidden = true;
  seg($("sc-layout"), [["1x1", "One card"], ["2x2", "4 cards"], ["3x3", "Binder page (9)"], ["3x4", "Binder page (12)"]], layout, v => { layout = v; openScanDraw(); });
  openScanDraw();
  openSheet("m-scan");
}
function openScanDraw() {
  seg($("sc-layout"), [["1x1", "One card"], ["2x2", "4 cards"], ["3x3", "Binder page (9)"], ["3x4", "Binder page (12)"]], layout, v => { layout = v; openScanDraw(); });
  seg($("sc-game"), [["auto", "Figure it out"], ...Object.keys(GAMES).filter(g => S.games.includes(g)).map(g => [g, GAMES[g].name])], game, v => { game = v; openScanDraw(); });
}
const pickFile = cam => { const f = $("sc-file"); if (cam) f.setAttribute("capture", "environment"); else f.removeAttribute("capture"); f.click(); };
$("sc-gallery").onclick = () => pickFile(false);
$("sc-camera").onclick = () => pickFile(true);
$("sc-again").onclick = () => { if (!busy) { $("sc-setup").hidden = false; $("sc-run").hidden = true; } };

$("sc-file").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = ""; if (!file) return;
  busy = true; rows = [];
  $("sc-setup").hidden = true; $("sc-run").hidden = false; $("sc-rows").innerHTML = ""; $("sc-add").disabled = true;
  $("sc-bar").style.width = "3%";
  $("sc-status").innerHTML = `<span class="spin"></span> Getting the scanner ready (the first time takes a few seconds)…`;
  const [r, c] = LAYOUTS[layout];
  try {
    await scanPhoto(file, [r, c], game, (i, total, res) => {
      rows.push({res, sel: res.candidates.length ? 0 : -1, skip: false, top: res.candidates[0] || null, searched: false});
      $("sc-bar").style.width = Math.round((i + 1) / total * 100) + "%";
      $("sc-status").innerHTML = i + 1 < total ? `<span class="spin"></span> Reading card ${i + 2} of ${total}…` : "Done! Check each match, then add.";
      drawRows();
    });
  } catch (err) {
    $("sc-status").textContent = err.message || "Scanning didn't work. Check your internet (the scanner downloads once) and try again.";
  }
  busy = false;
  drawRows();
});

function drawRows() {
  $("sc-rows").innerHTML = rows.map((row, i) => {
    const {res} = row;
    const head = !res.candidates.length ? "Couldn't read this one." : res.remembered === "you" ? "Remembered from your fix ✓" : res.remembered ? "Fixed by a checked report ✓" : res.exact ? "Found it by the card code ✓" : "Best guesses. Pick the right one";
    return `<div class="scanrow" data-r="${i}"><img src="${res.thumb}" alt="Scanned card ${i + 1}">
      <div><div class="note" style="margin-bottom:6px">${row.skip ? "Skipped" : esc(head)}</div>
      ${row.skip ? "" : `<div class="cands">${res.candidates.map((c, k) => `<button type="button" class="cand ${row.sel === k ? "on" : ""}" data-k="${k}" aria-pressed="${row.sel === k}">
        ${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy">` : ""}${esc(c.name)}<br><span class="muted">${esc(c.set || "")} ${esc(c.num || "")}</span>${c.market != null ? `<br>${money(c.market)}` : ""}</button>`).join("")}</div>`}
      <div class="acts" style="justify-content:flex-start;margin-top:6px"><button class="btn ghost small" data-a="search">🔎 Not right? Search</button><button class="btn ghost small" data-a="skip">${row.skip ? "Undo skip" : "Skip"}</button><button class="btn ghost small" data-a="report" title="Tell us what went wrong so the scanner gets smarter for everyone">🚩 Report</button></div></div></div>`;
  }).join("");
  const n = rows.filter(r => !r.skip && r.sel >= 0).length;
  $("sc-add").disabled = !n || busy;
  $("sc-add").textContent = n ? `Add ${n} card${n > 1 ? "s" : ""} to binder` : "Add to binder";
}
$("sc-rows").addEventListener("click", e => {
  const host = e.target.closest("[data-r]"); if (!host) return;
  const row = rows[+host.dataset.r];
  const cand = e.target.closest("[data-k]");
  if (cand) { row.sel = row.sel === +cand.dataset.k ? -1 : +cand.dataset.k; drawRows(); return; }
  const a = e.target.closest("[data-a]"); if (!a) return;
  if (a.dataset.a === "skip") { row.skip = !row.skip; drawRows(); }
  if (a.dataset.a === "report") {
    const pick = row.sel >= 0 && (row.searched || row.res.candidates[row.sel] !== row.top) ? row.res.candidates[row.sel] : null;
    window.open(scanReport(row.res, pick, VERSION), "_blank", "noopener");
    toast("Check the report, then press Submit. No photos are sent. Under 13? Ask a parent.", 6000);
  }
  if (a.dataset.a === "search") openPicker({title: "Which card is it?", game: game !== "auto" ? game : undefined, onPick: r => {
    row.res.candidates.unshift(r); row.sel = 0; row.skip = false; row.searched = true; drawRows(); openSheet("m-scan");
  }});
});
$("sc-add").onclick = async () => {
  $("sc-add").disabled = true;
  let added = 0, learned = 0;
  for (const row of rows) {
    if (row.skip || row.sel < 0) continue;
    let r = row.res.candidates[row.sel];
    // a fix teaches the scanner: next time it reads the same thing, it picks this card
    if (row.searched || r !== row.top) learned += remember(row.res.parsed || {}, r) ? 1 : 0;
    else if (!row.res.exact) remember(row.res.parsed || {}, r);   // you confirmed a guess: remember that too
    if (r.partial || r.market == null) { try { r = await fetchCard(r.src, r.id) || r; } catch (e) {} }
    const same = [...cards.values()].find(c => c.ref && c.ref.id === r.id && c.cond === "Near Mint" && !c.demo);
    if (same) { same.qty = (+same.qty || 0) + 1; await saveCard(same); }
    else {
      const c = {id: newId("c"), game: r.game, name: r.name, set: r.set, num: r.num, rarity: r.rarity, lang: "English", cond: "Near Mint", grade: "",
        qty: 1, paid: "", notes: "", tags: [], photos: [], added: new Date().toISOString(), ...linkFields(r)};
      logPrice(c); await saveCard(c);
    }
    added++;
  }
  closeSheet("m-scan"); emit("render"); emit("data");
  toast(`Added ${added} card${added === 1 ? "" : "s"} with today's prices 🎉${learned ? ` The scanner learned from ${learned} fix${learned === 1 ? "" : "es"}.` : ""}`, 4000);
};
