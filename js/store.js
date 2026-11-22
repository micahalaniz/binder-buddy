// Everything is saved on this device: IndexedDB for cards, photos, wishlist and cached card data,
// localStorage for small settings. Nothing is sent anywhere.
import { today } from "./util.js";

// ------------------------------------------------------------------ settings
export const THEMES = {
  classic:  {name: "Classic",  bg: "#eef2fb", accent: "#3466af", dark: 0},
  pokeball: {name: "Poké Red", bg: "#fdf0ef", accent: "#d8322c", dark: 0},
  grass:    {name: "Grass",    bg: "#edf8ef", accent: "#2b8f50", dark: 0},
  ocean:    {name: "Ocean",    bg: "#e9f6fb", accent: "#16799c", dark: 0},
  pirate:   {name: "Pirate",   bg: "#fff5e6", accent: "#b8352a", dark: 0},
  inkwell:  {name: "Inkwell",  bg: "#f5f1e8", accent: "#7a5c1e", dark: 0},
  candy:    {name: "Candy",    bg: "#fff0f7", accent: "#d93d84", dark: 0},
  midnight: {name: "Midnight", bg: "#12141f", accent: "#8b7bff", dark: 1},
  galaxy:   {name: "Galaxy",   bg: "#0f1a2b", accent: "#21c7a8", dark: 1},
};
export const DEFAULTS = {
  theme: "classic", bg: "#eef2fb", accent: "#3466af", dark: 0, colorBy: "game", groupBy: "none", layout: "list",
  tags: [{id: "t1", name: "Trade binder", color: "#ff7a59"}, {id: "t2", name: "For sale", color: "#1f9d55"}, {id: "t3", name: "Keep forever", color: "#8b5cf6"}],
  games: ["pokemon", "onepiece", "lorcana"], gameColors: {}, condColors: {}, crop: 1, quality: 1200, camera: 0, cur: "$",
  title: "📒 Binder Buddy", autoPrice: 1, welcomed: 0, lastPriced: "",
};
export let S = load("bb-settings", {});
S = {...DEFAULTS, ...S};
export const saveS = () => save("bb-settings", S);
export function replaceS(obj) { S = {...DEFAULTS, ...obj}; saveS(); return S; }
export const getS = () => S;

function load(k, fb) { try { return JSON.parse(localStorage.getItem(k) || "null") ?? fb; } catch (e) { return fb; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
export const loadLocal = load, saveLocal = save;

// ------------------------------------------------------------------ value history (one point per day)
export function history() { return load("bb-history", []); }
export function recordValue(value) {
  const h = history(), d = today(), v = Math.round(value * 100) / 100;
  if (h.length && h[h.length - 1].d === d) h[h.length - 1].v = v; else h.push({d, v});
  save("bb-history", h.slice(-730));
}

// ------------------------------------------------------------------ IndexedDB
let DB;
export function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("binder-buddy", 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const [name, opt] of [["cards", {keyPath: "id"}], ["photos"], ["wants", {keyPath: "id"}], ["cache"]])
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opt);
    };
    r.onsuccess = () => { DB = r.result; res(DB); };
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = DB.transaction(store, mode), out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => rej(t.error);
  });
}
export const db = {
  put: (store, v, key) => tx(store, "readwrite", s => key === undefined ? s.put(v) : s.put(v, key)),
  del: (store, key) => tx(store, "readwrite", s => s.delete(key)),
  get: (store, key) => tx(store, "readonly", s => s.get(key)),
  all: (store) => tx(store, "readonly", s => s.getAll()),
  clear: (store) => tx(store, "readwrite", s => s.clear()),
};

// cached web data with an age limit (card lists, set names...)
export async function cacheGet(key, maxAgeMs) {
  try { const v = await db.get("cache", key); if (v && Date.now() - v.t < maxAgeMs) return v.data; } catch (e) {}
  return null;
}
export const cacheSet = (key, data) => db.put("cache", {t: Date.now(), data}, key).catch(() => {});

// ------------------------------------------------------------------ in-memory state shared by screens
export const cards = new Map();   // the binder
export const wants = new Map();   // the wishlist

// photos: blobs on this device, shown through object URLs
const urls = new Map();
export async function photoURL(id) {
  if (urls.has(id)) return urls.get(id);
  const b = await db.get("photos", id);
  if (!b) return "";
  const u = URL.createObjectURL(b); urls.set(id, u); return u;
}
export async function dropPhotos(ids) {
  for (const id of ids) {
    try { await db.del("photos", id); } catch (e) {}
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  }
}
