// Scalper Shield: is this asking price fair? Singles compare to market value, sealed to store price (MSRP).
import { priceVerdict, priceLinks } from "./logic.js";
import { $, esc, seg } from "./util.js";
import { money } from "./ui.js";
import { openPicker } from "./picker.js";

// Usual US store prices. Some sets and stores differ, so the box stays editable.
const PRESETS = [
  {label: "Pokémon booster pack", msrp: 4.49},
  {label: "Pokémon Elite Trainer Box (standard)", msrp: 49.99},
  {label: "Pokémon Center Elite Trainer Box", msrp: 59.99},
  {label: "Something else (type the store price)", msrp: ""},
];
let kind = "single", picked = null;

function drawKind() {
  seg($("pc-kind"), [["single", "A single card"], ["sealed", "Sealed packs or boxes"]], kind, v => { kind = v; drawKind(); check(); });
  $("pc-single").hidden = kind !== "single"; $("pc-sealed").hidden = kind !== "sealed";
}
$("pc-preset").innerHTML = PRESETS.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join("");
$("pc-preset").onchange = () => { const p = PRESETS[+$("pc-preset").value]; $("pc-msrp").value = p.msrp; check(); };
$("pc-msrp-note").textContent = "These are usual US store prices. Some products cost a bit more, so check the shelf tag or the official store and change the number if needed.";
$("pc-msrp").value = PRESETS[0].msrp;

$("pc-find").onclick = () => openPicker({title: "Which card are you buying?", onPick: r => {
  picked = r;
  $("pc-card").innerHTML = `<div class="linked">${r.img ? `<img src="${esc(r.img)}" alt="">` : ""}<span>${esc(r.name)}<br><span class="note">${esc([r.set, r.num].filter(Boolean).join(" · "))}</span></span></div>`;
  if (r.market != null) $("pc-market").value = r.market;
  check();
}});
["pc-market", "pc-msrp", "pc-ask"].forEach(id => $(id).addEventListener("input", check));

function gauge(v) {
  const cuts = kind === "sealed" ? [1.0, 1.2, 1.5, 1.9] : [0.85, 1.1, 1.3, 1.7];
  const w = [cuts[0], cuts[1] - cuts[0], cuts[2] - cuts[1], cuts[3] - cuts[2]];
  const pos = Math.min(cuts[3], v.ratio) / cuts[3] * 100;
  const lbl = (x, t) => `<span class="lbl" style="left:${x / cuts[3] * 100}%">${t}</span>`;
  return `<div class="gauge" style="grid-template-columns:${w.map(x => x + "fr").join(" ")}" aria-hidden="true"><i></i><i></i><i></i><i></i>
    <span class="needle" style="left:calc(${pos}% - 2px)"></span>${lbl(cuts[0], Math.round(cuts[0] * 100) + "%")}${lbl(cuts[1], Math.round(cuts[1] * 100) + "%")}${lbl(cuts[2], Math.round(cuts[2] * 100) + "%")}</div>`;
}
function check() {
  const ask = +$("pc-ask").value, ref = kind === "sealed" ? +$("pc-msrp").value : +$("pc-market").value;
  const v = priceVerdict(ask, ref, kind);
  const base = kind === "sealed" ? "store price" : "market value";
  if (!v) {
    $("pc-out").innerHTML = ask > 0 ? `<p class="note">Add the ${base} to compare.</p>` : "";
  } else {
    const said = {
      steal: kind === "sealed" ? "At or under store price. Grab it!" : "Under market. That's a good buy.",
      fair: "Close to what it's worth. A normal price.",
      high: `More than it's worth. Try to haggle down to about ${money(ref)}.`,
      scalper: `Way over. Walk away. It's ${money(v.over)} over the ${base}.`,
    }[v.key];
    $("pc-out").innerHTML = `<div class="verdict ${v.tone}"><div class="vh">${v.emoji} ${v.label}</div>
      <p style="margin:6px 0 0;font-weight:700">${said}</p>
      <p class="note" style="margin:4px 0 0">Asking ${money(ask)} = <b>${v.pct}%</b> of the ${base} (${money(ref)}).</p>${gauge(v)}</div>`;
  }
  const c = picked ? {...picked} : null;
  $("pc-links").innerHTML = kind === "single" && c ? `<h3>Double-check what it sold for</h3><div class="plinks">${priceLinks(c).map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("")}</div>` : "";
}
drawKind();
