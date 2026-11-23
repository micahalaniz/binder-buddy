// Teaching kit: keeps your last scans on this phone (the photo, what the scanner said, and the card you picked),
// so you can send them to the builder to study why a scan went wrong. Nothing leaves the phone unless you press Send.
import { cacheGet, cacheSet } from "./store.js";

const MAX = 80, AGE = 3650 * 864e5;
const ids = async () => (await cacheGet("train", AGE)) || [];

async function shrink(file, max = 2000) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  if (bmp.close) bmp.close();
  return cv.toDataURL("image/jpeg", .9);
}

// Save the photo when a scan starts. Returns the scan's id (or null if saving failed).
export async function logScan(file, info) {
  try {
    const id = "s" + Date.now().toString(36);
    await cacheSet("train:" + id, {id, t: new Date().toISOString(), ...info, photo: await shrink(file)});
    const list = [...(await ids()), id];
    while (list.length > MAX) { const old = list.shift(); cacheSet("train:" + old, null); cacheSet("train:" + old + ":rows", null); }
    await cacheSet("train", list);
    return id;
  } catch (e) { return null; }
}

// What the scanner said for each card, and what you picked (saved every time you tap).
export function logRows(id, rows) {
  if (!id) return;
  cacheSet("train:" + id + ":rows", rows.map(({res, sel, skip, searched}) => ({
    said: res.candidates[0] ? res.candidates[0].id : null, sure: !!res.exact, how: res.how || null, remembered: res.remembered || null,
    shown: res.candidates.slice(0, 6).map(c => c.id), pic: res.parsed && res.parsed.pic || null,
    read: res.parsed ? {num: res.parsed.num || null, words: (res.parsed.words || []).slice(0, 12)} : null,
    picked: skip || sel < 0 ? null : res.candidates[sel].id, skipped: skip, searched,
  })));
}

export const savedCount = async () => (await ids()).length;

export async function clearSaved() {
  for (const id of await ids()) { cacheSet("train:" + id, null); cacheSet("train:" + id + ":rows", null); }
  await cacheSet("train", []);
}

// One file with every saved scan, shared through the phone's share sheet (AirDrop, Save to Files, email to yourself).
export async function sendSaved(version) {
  const scans = [];
  for (const id of await ids()) {
    const s = await cacheGet("train:" + id, AGE); if (!s) continue;
    scans.push({...s, rows: (await cacheGet("train:" + id + ":rows", AGE)) || []});
  }
  if (!scans.length) return "none";
  const day = new Date().toISOString().slice(0, 10);
  const file = new File([JSON.stringify({app: "binder-buddy-teach", version, made: new Date().toISOString(), scans})],
    `binder-buddy-scans-${day}.json`, {type: "application/json"});
  if (navigator.canShare && navigator.canShare({files: [file]})) {
    try { await navigator.share({files: [file], title: "Binder Buddy scans"}); return "shared"; }
    catch (e) { if (e.name === "AbortError") return "cancelled"; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return "downloaded";
}
