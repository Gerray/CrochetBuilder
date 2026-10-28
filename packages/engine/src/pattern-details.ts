/**
 * Pattern details beyond the rows (format v2) — what the whole-pattern import reads from the
 * instruction sentences of a pasted pattern:
 *
 *   colorChangeOf("In grey.")                                → { name: "Grey" }
 *   stuffingOf("Stuff the head firmly.")                     → { value: "firm", specific: true, … }
 *   finishOf("Fasten off and close the hole.")               → "gather"
 *   placementOf("Insert the eyes between rounds 8 and 9, 6 sts apart.")
 *                                                            → { kind: "eyes", round: 8, spacing: 6, … }
 *
 * Each reader looks at one sentence (`sentencesOf`) in English or German and returns null when
 * the sentence says nothing of the kind. When in doubt they return null: a missed detail stays
 * readable in the instruction row, a wrong one would be a silent misreading.
 *
 * Pure functions, no I/O, no framework imports.
 */

import type { PlacementKind } from "./assembly.js";
import type { Finish, Stuffing } from "./schema.js";

// ---------------------------------------------------------------------------
// Sentences and words
// ---------------------------------------------------------------------------

/**
 * The sentences of an instruction: split after `.`, `!`, `?`, `;` and `:` when the next word
 * does not start in lower case ("between 13 and 14. rounds" stays one sentence).
 */
export function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/gu, " ")
    .split(/(?<=[.!?;:])\s+(?!\p{Ll})/u)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Lower-case stem for comparing part names: "Ears" → "ear", "Ohren" → "ohr", "Arme" → "arm". */
function stem(word: string): string {
  return word.toLowerCase().replace(/(?:es|en|e|s|n)$/u, "");
}

/** Words of a part name that do not identify it. */
const NAME_FILLER = new Set(
  "and und the der die das for für left right linke linker linkes rechte rechter rechtes front back small big kleine große teil part".split(
    " ",
  ),
);

/**
 * The part a word of a sentence names ("ears" → the part "Ears", "head" → "Head and Body",
 * "Kopf" → "Kopf"), or undefined when none or more than one part fits equally well. A part
 * whose whole name is the word wins over parts that only contain it ("body": "Body" before
 * "Head and Body").
 */
export function findPartByWord<T extends { name: string }>(word: string, parts: readonly T[]): T | undefined {
  const key = stem(word);
  if (key.length < 3 || NAME_FILLER.has(word.toLowerCase())) return undefined;
  const words = (p: T) =>
    (p.name.match(/\p{L}+/gu) ?? []).filter((w) => !NAME_FILLER.has(w.toLowerCase())).map(stem);
  const exact = parts.filter((p) => {
    const w = words(p);
    return w.length === 1 && w[0] === key;
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const containing = parts.filter((p) => words(p).includes(key));
  return containing.length === 1 ? containing[0] : undefined;
}

/** "Head and Body" → "head-and-body", "Weiß" → "weiss"; "" → "x". */
export function slugOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/ä/gu, "ae")
    .replace(/ö/gu, "oe")
    .replace(/ü/gu, "ue")
    .replace(/ß/gu, "ss")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug === "" ? "x" : slug;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/** Common colour names (EN/DE, lower case) with a display colour. */
const HEX: Record<string, string> = {
  white: "#ffffff",
  weiß: "#ffffff",
  weiss: "#ffffff",
  black: "#000000",
  schwarz: "#000000",
  grey: "#808080",
  gray: "#808080",
  grau: "#808080",
  "light grey": "#c0c0c0",
  "light gray": "#c0c0c0",
  hellgrau: "#c0c0c0",
  "dark grey": "#505050",
  "dark gray": "#505050",
  dunkelgrau: "#505050",
  brown: "#8b5a2b",
  braun: "#8b5a2b",
  "light brown": "#b5835a",
  hellbraun: "#b5835a",
  "dark brown": "#5c3a1e",
  dunkelbraun: "#5c3a1e",
  beige: "#f5f5dc",
  cream: "#fffdd0",
  creme: "#fffdd0",
  ivory: "#fffff0",
  natur: "#f3ead3",
  tan: "#d2b48c",
  khaki: "#c3b091",
  pink: "#ffc0cb",
  rosa: "#ffc0cb",
  "light pink": "#ffd9e0",
  altrosa: "#c08081",
  red: "#d32f2f",
  rot: "#d32f2f",
  orange: "#ff8c00",
  yellow: "#ffd700",
  gelb: "#ffd700",
  green: "#2e7d32",
  grün: "#2e7d32",
  "light green": "#90ee90",
  hellgrün: "#90ee90",
  "dark green": "#1b4d1f",
  dunkelgrün: "#1b4d1f",
  mint: "#98ff98",
  blue: "#1e5bc6",
  blau: "#1e5bc6",
  "light blue": "#add8e6",
  hellblau: "#add8e6",
  "dark blue": "#0d2c6b",
  dunkelblau: "#0d2c6b",
  navy: "#000080",
  turquoise: "#40e0d0",
  türkis: "#40e0d0",
  teal: "#008080",
  purple: "#800080",
  lila: "#800080",
  violet: "#8a2be2",
  violett: "#8a2be2",
  lilac: "#c8a2c8",
  gold: "#d4af37",
  silver: "#c0c0c0",
  silber: "#c0c0c0",
  peach: "#ffcba4",
  coral: "#ff7f50",
  mustard: "#e1ad01",
  senfgelb: "#e1ad01",
  burgundy: "#800020",
  olive: "#808000",
};

const COLOR_WORDS = Object.keys(HEX)
  .filter((k) => !k.includes(" "))
  .sort((a, b) => b.length - a.length)
  .join("|");
const SHADE = "(?:light|dark|pale|bright|deep|soft)";
/** A plain colour name: "grey", "light pink", "khaki green", "Weiß". */
const PLAIN = `(?:${SHADE}[\\s-]+)?(?:${COLOR_WORDS})(?:[\\s-]+(?:${COLOR_WORDS}))?`;
/** A colour role: "Color A", "Farbe B", "main colour", "MC", "CC", "Hauptfarbe". */
const ROLE = "colou?r\\s+[A-E]|Farbe\\s+[A-E]|main\\s+colou?r|mc|cc|contrast(?:ing)?\\s+colou?r|Hauptfarbe|Grundfarbe|Kontrastfarbe";
const NAME = `(${PLAIN}|${ROLE}|main)`;
const END = "(?![\\p{L}])";

/** The display colour of a common colour name ("grey", "Weiß", "khaki green" → green's), if any. */
export function hexOfColor(name: string): string | undefined {
  const key = name.trim().toLowerCase().replace(/\s+/gu, " ").replace(/-/gu, " ");
  if (HEX[key]) return HEX[key];
  const words = key.split(" ");
  const known = (w: string) => HEX[w] !== undefined || new RegExp(`^${SHADE}$`, "u").test(w);
  if (words.length > 1 && words.every(known)) return HEX[words.slice(-2).join(" ")] ?? HEX[words[words.length - 1]!];
  return undefined;
}

/**
 * The display colour of a colour role ("Color A", "Main color") from the materials, when they
 * say which colour it is: "Color A: Gray", "MC – white", "Farbe B (Rosa)".
 */
export function hexFromMaterials(name: string, lines: readonly string[]): string | undefined {
  const words = name.trim().split(/\s+/u).map((w) => w.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  const alias = /^main\s+colou?r$/iu.test(name) ? "|MC" : /^contrast\s+colou?r$/iu.test(name) ? "|CC" : "";
  const re = new RegExp(`(?<![\\p{L}])(?:${words.join("\\s+")}${alias})\\s*(?::|=|–|-|\\()\\s*(${PLAIN})${END}`, "iu");
  for (const line of lines) {
    const m = re.exec(line);
    if (m) return hexOfColor(m[1]!);
  }
  return undefined;
}

/** "main" / "MC" / "main colour" → "Main color", "cc" → "Contrast color", "grey" → "Grey". */
function colorName(raw: string): string {
  const s = raw.trim().replace(/\s+/gu, " ").replace(/^the\s+/iu, "");
  const lower = s.toLowerCase();
  if (lower === "main" || lower === "mc" || /^main\s+colou?r$/u.test(lower)) return "Main color";
  if (lower === "cc" || /^contrast(?:ing)?\s+colou?r$/u.test(lower)) return "Contrast color";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * What makes two colour names the same palette entry: case is ignored, and the main and the
 * contrast colour have one key in every spelling ("Main color", "main colour", "MC",
 * "Hauptfarbe", "Grundfarbe" → "main").
 */
export function colorKey(name: string): string {
  const lower = name.trim().toLowerCase().replace(/\s+/gu, " ");
  if (/^(?:main(?: colou?r)?|mc|hauptfarbe|grundfarbe)$/u.test(lower)) return "main";
  if (/^(?:cc|contrast(?:ing)?(?: colou?r)?|kontrastfarbe)$/u.test(lower)) return "contrast";
  return lower;
}

/** Longest sentence the readers look at; longer text is not one instruction sentence. */
export const MAX_DETAIL_SENTENCE = 300;

/**
 * Sentences about embroidery, sewing, felt, knots, buttons or eyes name the colour of
 * something else, not the working colour.
 */
const NOT_WORKING_YARN =
  /\b(?:embroider\w*|sew\w*|needle|thread|stitch\s+on|felt|knots?|cut|eyes?|buttons?|beads?|ribbons?)\b|sticken|nähen|Nadel|Filz|Knoten|Augen|Knöpfe|Knopf|schneiden/iu;
/** Words of "same colour", "your colour", "next colour", "a colour of your choice": no colour named. */
const DENY_WORDS =
  "same|any|your|next|other|contrasting|previous|different|matching|chosen|choice|gleiche[nrs]?|andere[nrs]?|nächste[nrs]?|beliebige[nrs]?|eigene[nrs]?|deine[nrs]?";
const COLOR_DENY = new RegExp(`(?<![\\p{L}])(?:${DENY_WORDS})(?![\\p{L}])`, "iu");
/** "the same colour", "a colour of your choice", "die andere Farbe" in a sentence. */
const COLOR_DENY_PHRASE = new RegExp(
  `(?<![\\p{L}])(?:${DENY_WORDS})\\s+(?:\\p{L}+\\s+)?(?:colou?rs?|yarn|Farbe|Garn)(?![\\p{L}])|(?<![\\p{L}])colou?rs?\\s+of\\s+(?:your|the)\\s+choice`,
  "iu",
);
/** "white or pink", "white and pink stripes": a choice or stripes, not one colour. */
const AFTER_COLOR_DENY = /^\s*(?:or|and|oder|und|&|\/|stripes?|striped|Streifen|gestreift)(?![\p{L}])/iu;

const COLOR_CHANGES: RegExp[] = [
  new RegExp(`\\b(?:change|switch)\\s+(?:the\\s+)?(?:colou?r|yarn)\\s+(?:to|for)\\s+(?:the\\s+)?${NAME}${END}`, "iu"),
  new RegExp(`\\b(?:change|switch)\\s+to\\s+(?:the\\s+)?${NAME}${END}`, "iu"),
  new RegExp(`\\b(?:cc|colou?r\\s+change)\\s+(?:to\\s+)?(?:the\\s+)?${NAME}${END}`, "iu"),
  new RegExp(`\\b(?:join|attach|add|pick\\s+up)\\s+(?:the\\s+)?(?:new\\s+)?(${PLAIN})\\s+(?:yarn|colou?r)\\b`, "iu"),
  new RegExp(`\\b(?:join|attach|add)\\s+(?:the\\s+)?(?:new\\s+)?(?:yarn|colou?r)\\s+(?:in\\s+)?${NAME}${END}`, "iu"),
  new RegExp(`\\b(?:with|in|using|mit)\\s+(?:the\\s+|der\\s+)?(${ROLE})${END}`, "iu"),
  new RegExp(`^(?:\\d+[.)]\\s*)?(?:with|in|using)\\s+(?:the\\s+)?(${PLAIN})(?:\\s+(?:yarn|colou?r))?\\s*(?:[.:,]|$)`, "iu"),
  new RegExp(`\\bFarbwechsel\\s*(?:zu|auf|nach|in)?\\s*:?\\s*(?:Farbe\\s+)?${NAME}${END}`, "iu"),
  new RegExp(`\\b(?:wechsle|wechseln|wechselt)\\s+(?:\\p{L}+\\s+){0,2}?(?:zu|auf|in)\\s+(?:(?:die|der)\\s+)?(?:Farbe\\s+)?${NAME}${END}`, "iu"),
  new RegExp(`\\b(?:Farbe|Garn)\\s+(?:wechseln|ändern)\\s*(?:zu|auf|in)?\\s*:?\\s*${NAME}${END}`, "iu"),
  new RegExp(
    `^(?:\\d+[.)]\\s*)?(?:in|mit)\\s+(?:(?:der|dem)\\s+)?(?:Farbe\\s+)?(${PLAIN})(?=\\s*(?:[.:,]|$)|\\s+(?:weiter\\p{L}*|häkeln|häkle|arbeiten|arbeite)(?![\\p{L}]))`,
    "iu",
  ),
];
/** A whole line that names the colour of what follows: "Face color", "The color of the paws", "Color A:". */
const COLOR_ROLE_LINE = /^(?:the\s+)?((?:\p{L}+\s+){0,2}?colou?r(?:\s+of\s+the\s+\p{L}+)?|(?:colou?r|Farbe)\s+[A-E])\s*:?\s*$/iu;
/** Colour change words without a name the importer can take. */
const COLOR_UNNAMED = /\b(?:change|switch)\s+(?:the\s+)?(?:colou?r|yarn)\b|\bcolou?r\s+change\b|\bFarbwechsel\b|\bFarbe\s+wechseln\b/iu;

export interface ColorChange {
  /** The colour as named ("Grey", "Main color", "Color A", "Weiß"); absent when unnamed. */
  name?: string;
}

/**
 * The colour a sentence switches to: "In grey.", "cc to white", "Change color to main",
 * "With Color A:", "Attach the khaki green yarn", "Farbwechsel zu Rot", "In Weiß weiterhäkeln",
 * or a line like "Face color". `{}` for a colour change without a name ("change colour"),
 * null for anything else: thread, felt, knots, buttons or eyes in a colour; "the same / your /
 * next colour"; a choice or stripes ("in red or pink", "in white and pink stripes"); and
 * sentences longer than `MAX_DETAIL_SENTENCE`.
 */
export function colorChangeOf(sentence: string): ColorChange | null {
  const s = sentence.trim();
  if (s.length > MAX_DETAIL_SENTENCE) return null;
  const role = COLOR_ROLE_LINE.exec(s);
  if (role) return COLOR_DENY.test(role[1]!) ? null : { name: colorName(role[1]!) };
  if (NOT_WORKING_YARN.test(s) || COLOR_DENY_PHRASE.test(s)) return null;
  for (const re of COLOR_CHANGES) {
    const m = re.exec(s);
    if (!m) continue;
    const name = m[1]!;
    const end = m.index + m[0].lastIndexOf(name) + name.length;
    if (AFTER_COLOR_DENY.test(s.slice(end))) return null;
    return { name: colorName(name) };
  }
  return COLOR_UNNAMED.test(s) ? {} : null;
}

// ---------------------------------------------------------------------------
// Stuffing and finish
// ---------------------------------------------------------------------------

const STUFF = /\b(?:stuff(?:ing|ed)?|fill(?:ing|ed)?|unstuffed)\b|füllen\b|\bausstopfen\b|\bFüllung\b|\bFüllwatte\b|\bungefüllt\b/iu;
const GERMAN_STUFF = /füllen\b|\bausstopfen\b|\bFüllung\b|\bFüllwatte\b|\bungefüllt\b/iu;
/** "fill in the eyes" (embroidery), "fill the gaps with sc", "before stuffing": not stuffing. */
const NOT_STUFFING =
  /\bfill\b[^.;]{0,80}\bwith\s+(?:\p{L}+\s+)?(?:stitches|sc|yarn|thread)\b|\bfill\s+(?:in|out)\b|\bfill\s+(?:the\s+)?(?:teeth|gaps?|holes?|spaces?|form)\b|\b(?:before|for|after|until|while)\s+(?:you\s+)?(?:stuff|fill)(?:ing)?\b/iu;
/** "not too firmly", "not overly full": still stuffed, just lightly. */
const NOT_TOO = /\bnot\s+(?:too|very|overly|so)\s+(?:firm(?:ly)?|tight(?:ly)?|full|much|hard)\b|\bnicht\s+(?:zu|so)\s+(?:fest|prall|viel)\b/iu;
const NONE =
  /\b(?:do\s+not|don['’]t|does\s+not|doesn['’]t|no\s+need\s+to|never|not|without)\s+(?:\p{L}+\s+)?(?:stuff|fill)|\bunstuffed\b|\bno\s+stuffing\b|\bnicht\s+(?:aus)?(?:füllen|stopfen|gefüllt)|\bohne\s+Füllung|\bungefüllt|\bkeine\s+Füllung/iu;
const LIGHT =
  /\b(?:light(?:ly)?|a\s+(?:little|bit)|slightly|not\s+(?:very\s+|too\s+)?much|loosely|softly|gently|sparingly)\b|\b(?:leicht|wenig|locker|etwas|sparsam)\b/iu;
const FIRM = /\b(?:firm(?:ly)?|tight(?:ly)?|well|fully|generously|very\s+much)\b|\b(?:fest|gut|prall|kräftig)\b/iu;
/**
 * The part a clause names as stuffed: "stuff the head", "do not stuff the fins", "fill only the
 * legs", "the bottom of the legs", "the ears are not stuffed", "leave the neck unstuffed".
 */
const STUFF_OBJECT = [
  /\b(?:stuff|fill)\s+(?:only\s+)?(?:the|both|your)\s+(\p{L}+)(?:\s+of\s+the\s+(\p{L}+))?/iu,
  /\bleave\s+(?:the|both|your)\s+(\p{L}+)\s+unstuffed\b/iu,
  /\b(?:the\s+)?(\p{L}+)\s+(?:are|is|should\s+(?:be|stay|remain)|stays?|remains?)\s+(?:not\s+)?(?:stuffed|filled|unstuffed)\b/iu,
];
/** Clause boundaries: commas, semicolons, "but", "aber". */
const CLAUSE = /\s*[,;]\s*|\s+(?:but|aber|jedoch|doch)\s+/iu;

export interface StuffingStatement {
  value: Stuffing;
  /** False for a plain "stuff", "stuff as you go", "finish stuffing" (firm unless said otherwise). */
  specific: boolean;
  /**
   * The part the clause names ("head" of "stuff the head") — it must be a part of the
   * pattern, else the statement belongs to no part. Absent: the part being described.
   */
  object?: string;
  /** German clauses: words that may name the part ("Kopf" of "Kopf füllen"); none fits → the part being described. */
  words?: string[];
}

/**
 * How firmly a sentence says to stuff, clause by clause ("stuff the body firmly, but do not
 * stuff the arms" gives two statements): "stuff firmly / well / tightly" (firm), "stuff
 * lightly / a little / not too firmly" (light), "do not stuff" (none), a plain "stuff" or "stuff
 * as you go" (firm, not specific). German: "fest / leicht / nicht füllen", "Kopf füllen". A
 * negation counts only in its own clause. "Fill in", "fill the gaps with sc" and "before
 * stuffing" are not stuffing. Empty for anything else.
 */
export function stuffingsOf(sentence: string): StuffingStatement[] {
  const s = sentence.trim();
  if (s.length > MAX_DETAIL_SENTENCE || !STUFF.test(s)) return [];
  const out: StuffingStatement[] = [];
  for (const clause of s.split(CLAUSE)) {
    if (!STUFF.test(clause)) {
      // "Stuff, but not too firmly", "fill the legs, not much": a clause of its own that only
      // says how firmly (a negation here is no "do not stuff").
      const last = out[out.length - 1];
      if (last && (NOT_TOO.test(clause) || LIGHT.test(clause))) Object.assign(last, { value: "light", specific: true });
      else if (last && FIRM.test(clause) && !/\bnot\b|\bnicht\b/iu.test(clause)) Object.assign(last, { value: "firm", specific: true });
      continue;
    }
    if (NOT_STUFFING.test(clause)) continue;
    const statement: StuffingStatement = NOT_TOO.test(clause)
      ? { value: "light", specific: true }
      : NONE.test(clause)
        ? { value: "none", specific: true }
        : LIGHT.test(clause)
          ? { value: "light", specific: true }
          : FIRM.test(clause)
            ? { value: "firm", specific: true }
            : { value: "firm", specific: false };
    for (const re of STUFF_OBJECT) {
      const m = re.exec(clause);
      if (m) {
        statement.object = m[2] ?? m[1]!;
        break;
      }
    }
    if (statement.object === undefined && GERMAN_STUFF.test(clause)) statement.words = clause.match(/\p{L}+/gu) ?? [];
    out.push(statement);
  }
  return out;
}

/** The first stuffing statement of a sentence (see `stuffingsOf`), or null. */
export function stuffingOf(sentence: string): StuffingStatement | null {
  return stuffingsOf(sentence)[0] ?? null;
}

/** Closing a magic ring or a round is no finish of the part. */
const RING_OR_ROUND =
  /\b(?:magic\s+(?:ring|circle|loop)|mr|ring|rounds?|rnds?|rows?|sl\s*st|slip\s+stitch|spiral)\b|Fadenring|\bRunden?\b|\bKm\b|\bKettmasche/iu;
const NEGATED_CLOSE =
  /\b(?:do\s+not|don['’]t|does\s+not|never|without)\s+(?:\p{L}+\s+)?(?:close|closing|join|sew\s+(?:it\s+)?(?:up|closed|shut))\b|\bnicht\s+(?:\p{L}+\s+)?(?:schließen|zuziehen|zunähen)\b/iu;
/** "don't close it yet", "until", "later", "first": closed afterwards. */
const NOT_YET = /\b(?:yet|until|before|later|first|after)\b|\bnoch\s+nicht\b|\berst\b|\bspäter\b/iu;
/** The opening is closed by sewing the part on: "close it when you sew it to the head", "sew to the body". */
const SEW_TO =
  /\bsew(?:s|ing|n)?\s+(?:(?:it|them|on|together)\s+)?(?:on)?to\s+(?:the\s+)?\p{L}|\bwhen\s+(?:you\s+)?sew|\bby\s+sewing\b|^(?:an|am|ans)\s+(?:den|dem|die|das)?\s*\p{L}+\s+(?:an)?nähen\b/iu;
/** Folding a brim, cuff or collar up is shaping, not a flat finish. */
const FLAT_DENY = /\b(?:brim|cuff|collar|hem|up)\b|Krempe|Umschlag|Kragen/iu;

const FLAT = [
  /\b(?:fold|flatten)\b[^.;]{0,80}\b(?:both\s+layers|crochet|sc|single\s+crochet|knit)\b/iu,
  /\b(?:sc|crochet|single\s+crochet)\s+(?:the\s+)?(?:opening|hole|edges?|top)\s+(?:closed|shut|together)\b/iu,
  /\bthrough\s+both\s+layers\b/iu,
  /\bflach\s+(?:zusammen)?(?:legen|drücken|falten)\b|\bdurch\s+beide\s+(?:Lagen|Seiten)\b|(?<![\p{L}])(?:Öffnung|Kante)\s+(?:mit\s+\p{L}+\s+)?zuhäkeln\b/iu,
];
const GATHER = [
  /\b(?:close|closing)\s+(?:up\s+)?(?:the\s+)?(?:remaining\s+)?(?:hole|opening|gap)\b/iu,
  /\b(?:hole|opening|gap)\s+(?:is\s+)?(?:closed|shut)\b/iu,
  /\bpull\b[^.;]{0,40}\bto\s+close\b/iu,
  /\bfasten\s+off\s+and\s+close\b/iu,
  /\b(?:cinch|gather)\s+(?:it\s+|the\s+\p{L}+\s+)?(?:closed|shut|tight)\b/iu,
  /(?<![\p{L}])(?:Öffnung|Loch|Restloch|Rest)\s+(?:\p{L}+\s+)?(?:schließen|zuziehen|zusammenziehen)\b|\bzusammenziehen\b/iu,
];
const OPEN = [
  /\bleave\s+(?:it\s+|the\s+\p{L}+\s+)?open\b/iu,
  /\b(?:do\s+not|don['’]t)\s+close\b/iu,
  /\bleave\s+(?:a\s+)?(?:long\s+)?(?:tail|end|yarn\s+end|yarn\s+tail)\s+(?:for|to)\s+sew(?:ing)?\b/iu,
  /\boffen\s+lassen\b|\bnicht\s+schließen\b|\bFaden\s+(?:zum|für\s+das)\s+Annähen\b/iu,
];

/**
 * How a sentence finishes a part: crocheted flat shut ("fold flat and sc through both layers",
 * "sc the opening closed", "fold in half and crochet together"), gathered ("close the hole",
 * "pull to close", "Öffnung schließen") or left open ("leave open", "leave a long tail for
 * sewing", "do not close", "close it when you sew it to the head"). In this order: a negated
 * close ("do not close" → open; "don't close the hole yet", "do not close the rounds" →
 * nothing), flat (crocheted shut; not for a brim or cuff folded up), sewing the part on (open),
 * gathered (not for a magic ring or a round), open. Null for anything else.
 */
export function finishOf(sentence: string): Finish | null {
  return finishStatementOf(sentence)?.finish ?? null;
}

/** "Leave a long tail for sewing": open, unless the part is closed some other way. */
const TAIL_FOR_SEWING = /\bleave\s+(?:a\s+)?(?:long\s+)?(?:tail|end|yarn\s+end|yarn\s+tail)\b|\bFaden\s+(?:zum|für\s+das)\s+Annähen\b/iu;

/**
 * `finishOf` with how much the sentence says: `weak` for "leave a long tail for sewing", which
 * only means open when no other sentence closes the part ("sc the opening closed, leave a tail
 * for sewing" is flat).
 */
export function finishStatementOf(sentence: string): { finish: Finish; weak: boolean } | null {
  const s = sentence.trim();
  if (s.length > MAX_DETAIL_SENTENCE) return null;
  const strong = (finish: Finish) => ({ finish, weak: false });
  if (NEGATED_CLOSE.test(s)) return RING_OR_ROUND.test(s) || NOT_YET.test(s) ? null : strong("open");
  // Crocheted shut, then sewn on: flat. Only sewn on ("flatten and sew to the head"): open.
  if (!FLAT_DENY.test(s) && FLAT.some((re) => re.test(s))) return strong("flat");
  if (SEW_TO.test(s)) return strong("open");
  if (!RING_OR_ROUND.test(s) && GATHER.some((re) => re.test(s))) return strong("gather");
  if (OPEN.some((re) => re.test(s))) return { finish: "open", weak: TAIL_FOR_SEWING.test(s) && !/\bopen\b|offen/iu.test(s) };
  return null;
}

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------

const RW = "(?:rounds?|rnds?|rows?|rds?|runden?|reihen?|r)";
const SPAN = new RegExp(
  `(?<![\\p{L}])(?:between|zwischen)\\s+(?:(${RW})\\.?\\s*)?(\\d{1,3})\\.?\\s*(?:and|und|&|-|–|—)\\s*(?:${RW}\\.?\\s*)?(\\d{1,3})(?!\\d)\\.?(?:\\s*(${RW})(?![\\p{L}]))?`,
  "iu",
);
const SINGLE = new RegExp(
  `(?<![\\p{L}])(?:at|on|in|into|auf|bei|after|nach)\\s+(?:the\\s+)?(?:(?:rounds?|rnds?|rows?|runden?|reihen?)\\.?\\s*(\\d{1,3})|(\\d{1,3})(?:st|nd|rd|th|\\.)\\s+(?:rounds?|rows?|runden?|reihen?|rnds?))(?!\\d)`,
  "iu",
);
const EYES = /\beyes?\b|augen?\b/iu;
const EYE_VERB =
  /\b(?:insert|place|attach|put|position|set|fix|add|secure|sew)\b|einsetzen|einstecken|anbringen|befestigen|platzieren|setzen|annähen/iu;
const EMBROIDER = /\bembroider\w*|\bsticken\b|aufsticken|sticke\b/iu;
const ATTACH_VERB = /\b(?:sew|attach|pin|stitch|join)\b|annähen|nähen|befestigen|anheften|feststecken/iu;
const SPACING = [
  /(\d{1,3})\s*(?:sts?|stitches|sc|holes?|M|Maschen?)\s+(?:apart|auseinander|Abstand|between|dazwischen)\b/iu,
  /\b(?:Abstand|apart)\s+(?:von\s+|of\s+)?(\d{1,3})\s*(?:sts?|stitches|M|Maschen?)\b/iu,
];
const SIZE = /(\d{1,2}(?:[.,]\d)?)\s*mm\b/iu;
const TARGET_EN = /\b(?:to|onto|on\s+to|on)\s+(?:the\s+)?(?:(?:top|front|back|side|bottom|sides)\s+of\s+(?:the\s+)?)?(\p{L}+)/iu;
const TARGET_DE = /(?<![\p{L}])(?:an|am|ans|auf|zum)\s+(?:(?:den|dem|die|das|der)\s+)?(\p{L}+)/iu;

export interface PlacementDraft {
  kind: PlacementKind;
  /** The round the placement sits after ("between rounds 8 and 9" → 8). */
  round: number;
  /** Words that may name the placed part, to try in order ("ears" of "sew the ears to …"). */
  objectWords: string[];
  /** Words that may name the target part ("head" of "… to the head"). */
  targetWords: string[];
  /** Eyes: stitches between them. */
  spacing?: number;
  /** Size in mm, when the sentence gives one ("12 mm"). */
  size?: number;
}

/** The round a sentence places something at: "between rounds 8 and 9" → 8, "at round 12" → 12. */
export function roundOf(sentence: string): number | undefined {
  const span = SPAN.exec(sentence);
  if (span && (span[1] !== undefined || span[4] !== undefined)) return Number(span[2]);
  const single = SINGLE.exec(sentence);
  if (single) return Number(single[1] ?? single[2]);
  return undefined;
}

/**
 * A placement in a sentence: safety eyes ("Insert the safety eyes between rounds 8 and 9, 6 sts
 * apart", "Sicherheitsaugen zwischen Runde 4 und 5 einsetzen, 5 M auseinander"), a sewn-on part
 * ("Sew the ears to the head between rounds 3 and 5", "sew to the head between 11 and 12
 * rows") or an embroidered detail at a round. Only with a round; which parts the words name is
 * up to the caller.
 */
export function placementOf(sentence: string): PlacementDraft | null {
  const s = sentence.trim();
  if (s.length > MAX_DETAIL_SENTENCE) return null;
  const round = roundOf(s);
  if (round === undefined) return null;
  const size = SIZE.exec(s);
  const sized = (d: PlacementDraft): PlacementDraft => (size ? { ...d, size: Number(size[1]!.replace(",", ".")) } : d);

  if (EYES.test(s) && EYE_VERB.test(s) && !EMBROIDER.test(s)) {
    const draft: PlacementDraft = { kind: "eyes", round, objectWords: [], targetWords: targetWordsOf(s) };
    for (const re of SPACING) {
      const m = re.exec(s);
      if (m) {
        draft.spacing = Number(m[1]);
        break;
      }
    }
    return sized(draft);
  }
  if (EMBROIDER.test(s)) return sized({ kind: "embroidery", round, objectWords: [], targetWords: targetWordsOf(s) });
  const verb = ATTACH_VERB.exec(s);
  if (!verb) return null;
  // "Sew on the tail": "on" belongs to the verb, the tail is the part sewn on.
  const particle = /^\s+on(?=\s)/iu.exec(s.slice(verb.index + verb[0].length));
  const verbEnd = verb.index + verb[0].length + (particle ? particle[0].length : 0);
  const rest = s.slice(verbEnd);
  const targetAfter = TARGET_EN.exec(rest) ?? TARGET_DE.exec(rest);
  const targetBefore = targetAfter ? null : TARGET_DE.exec(s.slice(0, verb.index));
  const target = targetAfter
    ? { index: verbEnd + targetAfter.index, word: targetAfter[1]! }
    : targetBefore
      ? { index: targetBefore.index, word: targetBefore[1]! }
      : null;
  const end = target ? target.index : s.length;
  const afterVerb = verbEnd < end ? s.slice(verbEnd, end) : "";
  const words = (t: string) => t.match(/\p{L}+/gu) ?? [];
  return sized({
    kind: "attach",
    round,
    objectWords: [...words(afterVerb), ...words(s.slice(0, Math.min(end, verb.index)))],
    targetWords: target ? [target.word] : [],
  });
}

function targetWordsOf(sentence: string): string[] {
  const m = TARGET_EN.exec(sentence) ?? TARGET_DE.exec(sentence);
  return m ? [m[1]!] : [];
}

/**
 * Safety-eye size from the materials ("8 mm safety eyes", "Sicherheitsaugen 10 mm"), in mm.
 */
export function eyeSizeOf(lines: readonly string[]): number | undefined {
  const re = /(\d{1,2}(?:[.,]\d)?)\s*mm\s+(?:\p{L}+\s+){0,2}?(?:eyes?\b|\p{L}*augen\b)|(?:eyes?\b|augen\b)\s*(?:\(|:|,)?\s*(\d{1,2}(?:[.,]\d)?)\s*mm/iu;
  for (const line of lines) {
    const m = re.exec(line);
    if (m) return Number((m[1] ?? m[2])!.replace(",", "."));
  }
  return undefined;
}
