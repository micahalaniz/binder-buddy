// Keep people's binders safe. Everything lives only on this device, so:
// 1. iPhone/iPad in Safari: Safari can erase a website's saved data if it isn't opened for about a week.
//    Apps added to the Home Screen don't have that limit, so we suggest it.
// 2. Everyone: a gentle backup reminder once you have real cards and haven't backed up in a month.
import { S, saveS, cards } from "./store.js";
import { $ } from "./util.js";
import { on, emit } from "./ui.js";

const DAY = 864e5;
const isiOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installed = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
const since = iso => iso ? (Date.now() - Date.parse(iso)) / DAY : Infinity;

export function drawCare() {
  const box = $("care"); if (!box) return;
  const real = [...cards.values()].filter(c => !c.demo).length;
  let msg = "", act = "", key = "";
  if (isiOS() && !installed() && real >= 3 && since(S.careIos) > 14) {
    key = "careIos";
    msg = "📱 <b>Keep your binder safe on iPhone:</b> tap the Share button, then <b>Add to Home Screen</b>. In Safari, a website's saved data can be erased if you don't open it for about a week.";
  } else if (real >= 10 && since(S.lastBackup) > 30 && since(S.careBackup) > 30) {
    key = "careBackup";
    msg = `💾 <b>Your binder only lives on this device.</b> ${S.lastBackup ? "It's been a while since your last backup." : "You haven't made a backup yet."} A backup file lets you get everything back if your phone is lost or reset.`;
    act = `<button class="btn small" id="care-go">Make a backup</button>`;
  }
  box.innerHTML = msg ? `<div class="care" role="status"><p>${msg}</p><div class="acts" style="justify-content:flex-start;margin-top:6px">${act}<button class="btn ghost small" id="care-x">Not now</button></div></div>` : "";
  if (!msg) return;
  $("care-x").onclick = () => { S[key] = new Date().toISOString(); saveS(); drawCare(); };
  if ($("care-go")) $("care-go").onclick = () => { emit("tab", "more"); $("m-backupBtn").click(); };
}
on("data", drawCare);
on("render", drawCare);
setTimeout(drawCare, 1500);
