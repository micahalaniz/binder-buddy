// "📖 Card info": everything the free card databases know about a card (HP, attacks, text, artist, legality,
// special/secret set, versions printed). Loaded when you open it, never saved in your binder.
import { rawCard } from "./catalog.js";
import { pkSpecial } from "./logic.js";
import { esc } from "./util.js";

const yes = b => b ? "Yes" : "No";
const join = a => (a || []).filter(x => x != null && x !== "").join(", ");
/** "Fire, Fire, Colorless" → "Fire ×2, Colorless" */
const cost = a => { const n = {}; for (const x of a || []) n[x] = (n[x] || 0) + 1; return Object.entries(n).map(([k, v]) => v > 1 ? `${k} ×${v}` : k).join(", ") || "Free"; };

/** Turn a database card into rows: {facts: [[label, value]], texts: [[title, body]]}. Pure: easy to test. */
export function describe(src, r) {
  const facts = [], texts = [];
  const f = (k, v) => { if (v != null && v !== "" && !(Array.isArray(v) && !v.length)) facts.push([k, Array.isArray(v) ? join(v) : String(v)]); };
  const t = (k, v) => { if (v) texts.push([k, String(v)]); };
  if (!r) return {facts, texts};
  if (src === "tcgdex") {
    const s = r.set || {}, cc = s.cardCount || {};
    f("Special set", pkSpecial(r.localId, cc.official));
    f("Card", [r.category, r.trainerType, r.energyType].filter(Boolean).join(" · "));
    f("HP", r.hp); f("Type", r.types); f("Stage", r.stage && (r.stage.replace(/(\D)(\d)/, "$1 $2") + (r.evolveFrom ? ` (evolves from ${r.evolveFrom})` : "")));
    f("Pokédex #", r.dexId);
    f("Set", s.name && `${s.name}${cc.official ? ` (${cc.official} cards${cc.total > cc.official ? `, ${cc.total} counting secret rares` : ""})` : ""}`);
    f("Number", r.localId); f("Rarity", r.rarity);
    const v = r.variants || {};
    f("Printed as", [v.firstEdition && "1st Edition", v.normal && "Regular", v.holo && "Holo", v.reverse && "Reverse holo", v.wPromo && "W Promo stamp"].filter(Boolean));
    f("Weakness", (r.weaknesses || []).map(w => `${w.type} ${w.value || ""}`.trim()));
    f("Resistance", (r.resistances || []).map(w => `${w.type} ${w.value || ""}`.trim()));
    f("Retreat", r.retreat);
    f("Regulation mark", r.regulationMark);
    if (r.legal) f("Tournament legal", `Standard: ${yes(r.legal.standard)} · Expanded: ${yes(r.legal.expanded)}`);
    f("Illustrator", r.illustrator);
    for (const a of r.abilities || []) t(`${a.type || "Ability"}: ${a.name}`, a.effect);
    for (const a of r.attacks || []) t(`⚔️ ${a.name}${a.damage != null && a.damage !== "" ? ` · ${a.damage}` : ""}`, `Cost: ${cost(a.cost)}${a.effect ? ". " + a.effect : ""}`);
    t("Card text", r.effect); t("Rule", r.item && r.item.effect); t("Pokédex", r.description);
  } else if (src === "lorcast") {
    f("Ink", r.inks || r.ink); f("Cost", r.cost); f("Inkwell", r.inkwell != null ? yes(r.inkwell) : null);
    f("Type", r.type); f("Classifications", r.classifications);
    f("Strength", r.strength); f("Willpower", r.willpower); f("Lore", r.lore); f("Move cost", r.move_cost);
    f("Set", r.set && r.set.name); f("Number", r.collector_number); f("Rarity", r.rarity); f("Released", r.released_at);
    f("Illustrator", r.illustrators);
    if (r.legalities) f("Legal in", Object.entries(r.legalities).filter(([, v]) => v === "legal").map(([k]) => k[0].toUpperCase() + k.slice(1)));
    t("Card text", r.text && r.text.replace(/\{I\}/g, "⬡").replace(/\{S\}/g, "¤").replace(/\{L\}/g, "◊").replace(/\{E\}/g, "⟳"));
    t("Flavor", r.flavor_text);
  } else if (src === "scryfall") {
    const faces = r.card_faces && r.card_faces.length > 1 && !r.oracle_text ? r.card_faces : [r];
    f("Set", r.set_name && `${r.set_name} (${String(r.set || "").toUpperCase()})`); f("Number", r.collector_number); f("Rarity", r.rarity); f("Released", r.released_at);
    f("Printed as", r.finishes && r.finishes.map(x => ({nonfoil: "Regular", foil: "Foil", etched: "Foil etched"})[x] || x));
    f("Artist", r.artist);
    if (r.legalities) f("Legal in", ["standard", "pioneer", "modern", "legacy", "vintage", "commander", "pauper"].filter(k => r.legalities[k] === "legal").map(k => k[0].toUpperCase() + k.slice(1)));
    f("Reserved list", r.reserved ? "Yes (never reprinted)" : null);
    for (const x of faces) {
      t(`${faces.length > 1 ? x.name + " · " : ""}${x.type_line || ""}${x.mana_cost ? " · " + x.mana_cost : ""}${x.power != null ? ` · ${x.power}/${x.toughness}` : ""}${x.loyalty != null ? ` · Loyalty ${x.loyalty}` : ""}`, x.oracle_text || " ");
      t("Flavor", x.flavor_text);
    }
  } else if (src === "ygo") {
    f("Card", r.humanReadableCardType || r.type); f("Attribute", r.attribute);
    f(/xyz/i.test(r.frameType || "") ? "Rank" : "Level", r.level); f("Link rating", r.linkval); f("Pendulum scale", r.scale);
    f("Type", r.typeline || r.race); f("ATK / DEF", r.atk != null ? `${r.atk} / ${r.def != null ? r.def : "–"}` : null);
    f("Archetype", r.archetype); f("Printed in", (r.card_sets || []).length ? `${r.card_sets.length} printings` : null);
    t("Card text", r.desc);
  } else if (src === "optcg") {
    f("Color", r.card_color); f("Card", r.card_type); f("Cost", r.card_cost); f("Power", r.card_power);
    f("Counter", r.counter_amount ? "+" + r.counter_amount : null); f("Life", r.life); f("Attribute", r.attribute); f("Types", r.sub_types);
    f("Set", r.set_name); f("Number", r.card_set_id); f("Rarity", r.rarity);
    t("Card text", r.card_text && r.card_text !== "NULL" ? r.card_text : "");
  }
  return {facts, texts};
}

export function infoHTML(d) {
  if (!d.facts.length && !d.texts.length) return `<p class="note">The card database doesn't have more details for this card.</p>`;
  return `<dl class="kv">${d.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` +
    d.texts.map(([k, v]) => `<div class="itext"><b>${esc(k)}</b><p>${esc(v)}</p></div>`).join("");
}

/** Fill a <details> element the first time it's opened. */
export function wireInfo(el, c) {
  if (!el || !c.ref || !c.ref.src) return;
  let done = false;
  el.addEventListener("toggle", async () => {
    if (!el.open || done) return;
    const body = el.querySelector(".ibody");
    body.innerHTML = `<p class="note"><span class="spin"></span> Getting card info…</p>`;
    try { body.innerHTML = infoHTML(describe(c.ref.src, await rawCard(c.ref.src, c.ref.id))); done = true; }
    catch (e) { body.innerHTML = `<p class="note">Couldn't reach the card database. Check your internet and open this again.</p>`; }
  });
}
