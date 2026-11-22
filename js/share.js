// "Share my hits": draws a picture of your best cards to post or send.
import { isHit } from "./logic.js";
import { S, cards, db } from "./store.js";
import { $, loadImg, toast, openSheet, download } from "./util.js";
import { money } from "./ui.js";
import { visible } from "./binder.js";

const W = 1080, H = 1350;
let lastBlob = null;

function pickCards() {
  const src = $("sh-which").value === "shown" ? visible() : [...cards.values()].filter(c => (+c.qty || 0) > 0 && isHit(c));
  const list = (src.length ? src : [...cards.values()]).filter(c => (+c.qty || 0) > 0);
  return list.sort((a, b) => (+b.market || 0) - (+a.market || 0)).slice(0, 9);
}
async function imageFor(c) {
  try { if (c.photos && c.photos[0]) return await loadImg(await db.get("photos", c.photos[0])); } catch (e) {}
  try { if (c.img && c.img.includes("tcgdex.net")) return await loadImg((c.imgLg || c.img).replace("/high.webp", "/low.webp")); } catch (e) {}
  return null;   // some card sites don't allow their pictures to be redrawn; we draw a name tile instead
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function wrap(g, text, x, y, maxW, lineH, maxLines) {
  const words = String(text).split(" "); let line = "", n = 0;
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y + n * lineH); line = w; if (++n >= maxLines - 1) break; } else line = t;
  }
  g.fillText(line.length > 26 ? line.slice(0, 25) + "…" : line, x, y + n * lineH);
}

export async function drawShare() {
  const list = pickCards(), prices = $("sh-prices").value === "1";
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  await document.fonts.ready;
  const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, S.accent); grd.addColorStop(1, "#1f2340");
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.fillStyle = "#fff"; g.font = "700 64px Fredoka, sans-serif"; g.textAlign = "center";
  g.fillText(list.length ? "My top hits ⭐" : "My binder", W / 2, 100);
  g.font = "800 30px Nunito, sans-serif"; g.globalAlpha = .85;
  const total = list.reduce((s, c) => s + (+c.market || 0) * (+c.qty || 0), 0);
  g.fillText(prices ? `${list.length} cards · ${money(total)}` : `${list.length} of my favorite cards`, W / 2, 148); g.globalAlpha = 1;
  const cols = 3, cw = 300, ch = 420, gap = 40, top = 190, left = (W - (cols * cw + (cols - 1) * gap)) / 2;
  const rowsN = Math.ceil(list.length / cols), capH = prices ? 74 : 46, cellH = ch + capH;
  const scale = Math.min(1, (H - top - 110) / (rowsN * cellH + (rowsN - 1) * 16));
  for (let i = 0; i < list.length; i++) {
    const c = list[i], col = i % cols, row = Math.floor(i / cols);
    const w = cw * scale, h = ch * scale, x = W / 2 + (col - 1) * (w + gap) - w / 2, y = top + row * (cellH * scale + 16);
    const im = await imageFor(c);
    g.save(); rr(g, x, y, w, h, 18 * scale); g.clip();
    if (im) {
      const k = Math.max(w / im.width, h / im.height);
      g.drawImage(im, x + (w - im.width * k) / 2, y + (h - im.height * k) / 2, im.width * k, im.height * k);
    } else {
      g.fillStyle = "rgba(255,255,255,.14)"; g.fillRect(x, y, w, h);
      g.fillStyle = "#fff"; g.font = `700 ${Math.round(34 * scale)}px Fredoka, sans-serif`; wrap(g, c.name, x + w / 2, y + h / 2 - 20 * scale, w - 30, 40 * scale, 3);
    }
    g.restore();
    g.fillStyle = "#fff"; g.font = `800 ${Math.round(26 * scale)}px Nunito, sans-serif`;
    const nm = c.name.length > 22 ? c.name.slice(0, 21) + "…" : c.name;
    g.fillText(nm, x + w / 2, y + h + 32 * scale);
    if (prices && c.market !== "" && c.market != null) { g.globalAlpha = .85; g.fillText(money(c.market), x + w / 2, y + h + 64 * scale); g.globalAlpha = 1; }
  }
  g.font = "800 28px Nunito, sans-serif"; g.globalAlpha = .9;
  g.fillText("📒 Binder Buddy · free card binder · micahalaniz.github.io/binder-buddy", W / 2, H - 44);
  g.globalAlpha = 1;
  lastBlob = await new Promise(r => cv.toBlob(r, "image/png"));
  $("sh-img").src = URL.createObjectURL(lastBlob);
}
export function openShare() {
  if (!cards.size) return toast("Add some cards first.");
  $("sh-img").removeAttribute("src");
  openSheet("m-share");
  drawShare();
}
$("sh-prices").onchange = drawShare; $("sh-which").onchange = drawShare;
$("sh-save").onclick = () => lastBlob && download(lastBlob, "my-binder-hits.png");
$("sh-send").onclick = async () => {
  if (!lastBlob) return;
  const file = new File([lastBlob], "my-binder-hits.png", {type: "image/png"});
  if (navigator.canShare && navigator.canShare({files: [file]})) {
    try { await navigator.share({files: [file], title: "My top hits", text: "Made with Binder Buddy (free card binder)"}); } catch (e) {}
  } else { download(lastBlob, "my-binder-hits.png"); toast("Saved! Post it anywhere."); }
};
