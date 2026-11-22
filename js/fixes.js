// Fixes everyone gets. When someone reports a wrong scan (🚩 Report), a person checks it, adds a line here
// and a test, and the next update makes the scanner smarter for everyone. Fixes are checked by a person
// first, so pranks can't teach the scanner wrong answers.
//
// k:   what the scanner read: "pk:180/132" (Pokémon number), "op:OP01-120" (One Piece code), "lor:1/207" (Lorcana set/number)
// ref: the right card in the card database: {src: "tcgdex" | "optcg" | "lorcast" | "scryfall", id}
// why: a short note on what went wrong
export const FIXES = [
  // example: {k: "pk:160/132", ref: {src: "tcgdex", id: "<set id>-<number>"}, why: "the 8 reads as a 6 next to the gold stars"},
];
