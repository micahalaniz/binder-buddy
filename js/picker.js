// "Find your card": search the free card databases and hand back a card with its picture and price.
import { GAMES } from "./logic.js";
import { search, card } from "./catalog.js";
import { S } from "./store.js";
import { $, esc, seg, openSheet, closeSheet, toast } from "./util.js";
import { money } from "./ui.js";

let opts = null, game = "pokemon", token = 0, results = [];

/**
 * @param {{title?:string, game?:string, onPick:(card)=>void, onManual?:(game:string, text:string)=>void, manualLabel?:string}} o
 */
export function openPicker(o) {
  opts = o;
  game = o.game && GAMES[o.game] ? o.game : (S.games[0] || "pokemon");
  $("pk-title").textContent = o.title || "Find your card";
  $("pk-manual").hidden = !o.onManual;
  $("pk-manual").textContent = o.manualLabel || "Can't find it? Type it in myself";
  $("pk-q").value = o.text || "";
  $("pk-out").innerHTML = "";
  drawGames();
  openSheet("m-pick", "#pk-q");
  if (o.text) run();
}
function drawGames() {
  seg($("pk-game"), Object.keys(GAMES).filter(g => S.games.includes(g) || g === game).map(g => [g, GAMES[g].name]), game, v => {
    game = v; drawGames(); if ($("pk-q").value.trim()) run();
  });
  $("pk-hint").textContent = {pokemon: 'Try "Pikachu ex 238" or "Charizard 151".', onepiece: 'Try "Shanks", "Luffy" or a code like "OP01-120".', lorcana: 'Try "Elsa", "Stitch" or "Mickey Mouse 207".'}[game];
}

async function run() {
  const q = $("pk-q").value.trim(), my = ++token;
  if (!q) return;
  $("pk-out").innerHTML = `<p class="note"><span class="spin"></span> Searching ${esc(GAMES[game].name)} cards…</p>`;
  try {
    results = await search(game, q);
    if (my !== token) return;
    if (!results.length) { $("pk-out").innerHTML = `<p class="note">No cards found for "${esc(q)}". Check the spelling, try just the name, or type it in yourself.</p>`; return; }
    $("pk-out").innerHTML = `<p class="note">${results.length === 60 ? "Showing the first 60. Add the card number to narrow it down." : results.length + " found. Tap yours."}</p><div class="results">` +
      results.map((r, i) => `<button class="res" data-i="${i}" type="button">
        ${r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy">` : `<div class="nopic"></div>`}
        <b>${esc(r.name)}</b><span>${esc(r.set)}${r.num ? " · " + esc(r.num) : ""}</span>${r.market != null ? `<span>${money(r.market)}</span>` : ""}</button>`).join("") + `</div>`;
  } catch (e) {
    if (my === token) $("pk-out").innerHTML = `<p class="note">Couldn't reach the card database. Check your internet and try again, or type the card in yourself.</p>`;
  }
}
$("pk-go").onclick = run;
$("pk-q").addEventListener("keydown", e => { if (e.key === "Enter") run(); });
let typeTimer;
$("pk-q").addEventListener("input", () => { clearTimeout(typeTimer); typeTimer = setTimeout(() => { if ($("pk-q").value.trim().length >= 3) run(); }, 550); });

$("pk-out").addEventListener("click", async e => {
  const b = e.target.closest(".res"); if (!b) return;
  let r = results[+b.dataset.i];
  if (r.partial) {
    b.querySelector("b").innerHTML = `<span class="spin"></span> Getting price…`;
    try { r = await card(r.src, r.id) || r; } catch (err) { toast("Couldn't get the price right now. You can add it later."); }
  }
  closeSheet("m-pick");
  opts.onPick(r);
});
$("pk-manual").onclick = () => { closeSheet("m-pick"); opts.onManual && opts.onManual(game, $("pk-q").value.trim()); };
