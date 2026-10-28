/**
 * Row notation — render a row's op tree as compact text and parse such text back.
 *
 *   render: [MR ×1, SC ×6]                 → "1 MR, 6 fM"          (de)
 *           [repeat 6 → [SC ×1, INC ×1]]   → "6× (1 fM, 1 Zun)"    (de)
 *                                          → "6x (1 sc, 1 inc)"    (en_us)
 *           [SC ×2 BLO]                    → "2 dc (BLO)"          (en_uk)
 *
 *   parse:  the inverse, tolerant of what people actually type: any case, `×`/`x`/`X`/`*`
 *           (and "mal"/"times") as the times sign, a count of 1 may be omitted, NBSP counts
 *           as a space, long names ("Luftmaschen", "single crochet") next to abbreviations,
 *           postfix repeats ("(1 sc, 1 inc) x6") and a trailing stitch count ("… (18)").
 *           A second, lenient pass reads what pasted patterns write ("6 sc in MR",
 *           "sc around", "(…) repeat 6 times", "= [36]", "BLO: …"), see `parseRowText`.
 *
 * Round trip: `parseRowText(renderOps(ops, l), l)` yields `ops` again for every locale,
 * except for the display-only `into` note (never rendered) and empty modifier arrays.
 *
 * Locales: `de` (German), `en_us` (US terms), `en_uk` (UK terms). The UK "false friend"
 * — UK "dc" is a US single crochet — is resolved by the locale the text is read in; a term
 * from another locale is only understood when it means the same stitch everywhere.
 *
 * Pure functions, no I/O, no framework imports.
 */

import {
  STITCH_PROPERTIES,
  consumesOf,
  consumesOfGroup,
  isPostStitch,
  type Mod,
  type GroupOp,
  type Op,
  type Row,
  type StitchCode,
  type StitchOp,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Limits and modifier rules (shared by the parser and editors)
// ---------------------------------------------------------------------------

/** Largest `count` of a single stitch op an editor accepts. */
export const MAX_COUNT = 999;
/** Largest `times` of a repeat group an editor accepts. */
export const MAX_TIMES = 999;
/** Largest number of worked stitches (expanded atoms) in one row. */
export const MAX_ROW_STITCHES = 10_000;
/** Largest declared stitch count of a row (an INC row produces at most twice its atoms). */
export const MAX_STITCH_COUNT_TARGET = 2 * MAX_ROW_STITCHES;

/**
 * Worked stitches of an op list (what `expandRow` would produce) without expanding it, so
 * oversized input can be rejected cheaply.
 */
export function countWorkedStitches(ops: readonly Op[]): number {
  let total = 0;
  for (const op of ops) {
    total += op.kind === "stitch" ? op.count : (op.kind === "group" ? 1 : op.times) * countWorkedStitches(op.ops);
  }
  return total;
}

/** Whether every count, every repeat and the row total stay within the editor limits. */
export function opsWithinLimits(ops: readonly Op[]): boolean {
  const inner = (list: readonly Op[]): boolean =>
    list.every((op) =>
      op.kind === "stitch" ? op.count <= MAX_COUNT : (op.kind === "group" || op.times <= MAX_TIMES) && inner(op.ops),
    );
  return inner(ops) && countWorkedStitches(ops) <= MAX_ROW_STITCHES;
}

/**
 * Whether `mod` makes sense on `code`: loops (BLO/FLO) need a stitch worked into the
 * previous row (not MR/CH); TOG needs a stitch worked into one stitch that is not already
 * an increase or decrease (sc2tog yes, "inc tog" no); relief (FP/BP) needs a post stitch
 * (SC, HDC, DC, TR, DTR — `isPostStitch`, as `checkModifiers` in validation).
 */
export function modifierAllowed(code: StitchCode, mod: Mod): boolean {
  const consumes = STITCH_PROPERTIES[code].consumesStitches;
  if (mod === "TOG") return consumes === 1 && code !== "INC";
  if (mod === "FP" || mod === "BP") return isPostStitch(code);
  return consumes > 0;
}

/**
 * Normalise a modifier list for `code`: duplicates removed (first occurrence kept).
 * Returns null when the list is contradictory (BLO with FLO, FP with BP) or contains a
 * modifier that does not apply to the code.
 */
export function normalizeModifiers(code: StitchCode, mods: readonly Mod[]): Mod[] | null {
  const unique = [...new Set(mods)];
  if (unique.includes("BLO") && unique.includes("FLO")) return null;
  if (unique.includes("FP") && unique.includes("BP")) return null;
  if (!unique.every((m) => modifierAllowed(code, m))) return null;
  return unique;
}

/** Display/notation locales. */
export type NotationLocale = "de" | "en_us" | "en_uk";

export const NOTATION_LOCALES: readonly NotationLocale[] = ["de", "en_us", "en_uk"];

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Compact abbreviation per code and locale — what `renderOps` writes. German abbreviations
 * follow the TellmeCrochet glossary so both apps speak the same notation.
 */
export const STITCH_ABBREVIATIONS: Record<StitchCode, Record<NotationLocale, string>> = {
  CH: { de: "Lm", en_us: "ch", en_uk: "ch" },
  SL_ST: { de: "Km", en_us: "sl st", en_uk: "ss" },
  SC: { de: "fM", en_us: "sc", en_uk: "dc" },
  HDC: { de: "hStb", en_us: "hdc", en_uk: "htr" },
  DC: { de: "Stb", en_us: "dc", en_uk: "tr" },
  TR: { de: "DStb", en_us: "tr", en_uk: "dtr" },
  DTR: { de: "DDStb", en_us: "dtr", en_uk: "trtr" },
  MR: { de: "MR", en_us: "MR", en_uk: "MR" },
  INC: { de: "Zun", en_us: "inc", en_uk: "inc" },
  DEC: { de: "Abn", en_us: "dec", en_uk: "dec" },
  INVDEC: { de: "uAbn", en_us: "invdec", en_uk: "invdec" },
  ST: { de: "M", en_us: "st", en_uk: "st" },
  BOBBLE: { de: "Noppe", en_us: "bobble", en_uk: "bobble" },
  PUFF: { de: "Büschel", en_us: "puff", en_uk: "puff" },
  POPCORN: { de: "Popcorn", en_us: "popcorn", en_uk: "popcorn" },
  PICOT: { de: "Pikot", en_us: "picot", en_uk: "picot" },
};

/** Full stitch name per code and locale (for pickers and tooltips). */
export const STITCH_NAMES: Record<StitchCode, Record<NotationLocale, string>> = {
  CH: { de: "Luftmasche", en_us: "chain", en_uk: "chain" },
  SL_ST: { de: "Kettmasche", en_us: "slip stitch", en_uk: "slip stitch" },
  SC: { de: "Feste Masche", en_us: "single crochet", en_uk: "double crochet" },
  HDC: { de: "Halbes Stäbchen", en_us: "half double crochet", en_uk: "half treble crochet" },
  DC: { de: "Stäbchen", en_us: "double crochet", en_uk: "treble crochet" },
  TR: { de: "Doppelstäbchen", en_us: "treble crochet", en_uk: "double treble crochet" },
  DTR: { de: "Dreifachstäbchen", en_us: "double treble crochet", en_uk: "triple treble crochet" },
  MR: { de: "Magischer Ring", en_us: "magic ring", en_uk: "magic ring" },
  INC: { de: "Zunahme", en_us: "increase", en_uk: "increase" },
  DEC: { de: "Abnahme", en_us: "decrease", en_uk: "decrease" },
  INVDEC: { de: "Unsichtbare Abnahme", en_us: "invisible decrease", en_uk: "invisible decrease" },
  ST: { de: "Masche", en_us: "stitch", en_uk: "stitch" },
  BOBBLE: { de: "Noppe", en_us: "bobble stitch", en_uk: "bobble stitch" },
  PUFF: { de: "Büschelmasche", en_us: "puff stitch", en_uk: "puff stitch" },
  POPCORN: { de: "Popcornmasche", en_us: "popcorn stitch", en_uk: "popcorn stitch" },
  PICOT: { de: "Pikot", en_us: "picot", en_uk: "picot" },
};

/** Modifier abbreviation per locale, rendered in parentheses after a stitch. */
export const MOD_ABBREVIATIONS: Record<Mod, Record<NotationLocale, string>> = {
  BLO: { de: "hMG", en_us: "BLO", en_uk: "BLO" },
  FLO: { de: "vMG", en_us: "FLO", en_uk: "FLO" },
  TOG: { de: "zus", en_us: "tog", en_uk: "tog" },
  FP: { de: "Relief v", en_us: "FP", en_uk: "FP" },
  BP: { de: "Relief h", en_us: "BP", en_uk: "BP" },
};

/** Full modifier name per locale. */
export const MOD_NAMES: Record<Mod, Record<NotationLocale, string>> = {
  BLO: { de: "nur hinteres Maschenglied", en_us: "back loop only", en_uk: "back loop only" },
  FLO: { de: "nur vorderes Maschenglied", en_us: "front loop only", en_uk: "front loop only" },
  TOG: { de: "zusammen abmaschen", en_us: "together", en_uk: "together" },
  FP: { de: "Relief von vorne", en_us: "front post", en_uk: "front post" },
  BP: { de: "Relief von hinten", en_us: "back post", en_uk: "back post" },
};

/** Times sign used when rendering repeat groups. */
const TIMES_SIGN: Record<NotationLocale, string> = { de: "×", en_us: "x", en_uk: "x" };

/** Suffix of a rendered stitch group (format v2): all its stitches into one stitch. */
const GROUP_WORDS: Record<NotationLocale, string> = { de: "in dieselbe M", en_us: "in same st", en_uk: "in same st" };

const MOD_ALIASES: Record<string, Mod> = {
  "hinteres maschenglied": "BLO",
  "hinteres mg": "BLO",
  "back loop": "BLO",
  "vorderes maschenglied": "FLO",
  "vorderes mg": "FLO",
  "front loop": "FLO",
  zusammen: "TOG",
  "front post": "FP",
  "back post": "BP",
  "relief vorne": "FP",
  "relief hinten": "BP",
  "von vorne": "FP",
  "von hinten": "BP",
};

/** Words that act as a times sign next to a repeat group. */
const TIMES_WORDS = new Set(["x", "mal", "times"]);

/** Normalise a term for lookup: lowercase, dots removed, whitespace collapsed. */
function termKey(term: string): string {
  return term.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
}

/**
 * Extra spellings understood when parsing, beyond the abbreviation and the full name.
 * Singular/plural and short forms of the English names ("double", "trebles") are generated
 * in `nameForms`; German plurals are listed here.
 */
const STITCH_ALIASES: Record<NotationLocale, Record<string, StitchCode>> = {
  de: {
    luftmaschen: "CH",
    kettmaschen: "SL_ST",
    kettm: "SL_ST",
    "feste maschen": "SC",
    "halbe stäbchen": "HDC",
    "halbes stb": "HDC",
    "doppelte stäbchen": "TR",
    "doppeltes stäbchen": "TR",
    "dreifache stäbchen": "DTR",
    "dreifaches stäbchen": "DTR",
    "doppeltes doppelstäbchen": "DTR",
    "doppelte doppelstäbchen": "DTR",
    magischer: "MR",
    "magische ringe": "MR",
    fadenring: "MR",
    "magischer fadenring": "MR",
    zunahmen: "INC",
    abnahmen: "DEC",
    "unsichtbare abnahmen": "INVDEC",
    maschen: "ST",
    noppen: "BOBBLE",
    büschelmaschen: "PUFF",
    popcornmaschen: "POPCORN",
    picot: "PICOT",
    picots: "PICOT",
    pikots: "PICOT",
  },
  en_us: {
    slst: "SL_ST",
    "sl-st": "SL_ST",
    ss: "SL_ST",
    "magic circle": "MR",
    "magic circles": "MR",
    "adjustable ring": "MR",
    "inv dec": "INVDEC",
    "invisible dec": "INVDEC",
    sts: "ST",
    bobbles: "BOBBLE",
    "bobble st": "BOBBLE",
    "bobble sts": "BOBBLE",
    puffs: "PUFF",
    "puff st": "PUFF",
    "puff sts": "PUFF",
    popcorns: "POPCORN",
    "popcorn st": "POPCORN",
    "popcorn sts": "POPCORN",
    picots: "PICOT",
  },
  en_uk: {
    "sl st": "SL_ST",
    "sl-st": "SL_ST",
    slst: "SL_ST",
    "magic circle": "MR",
    "magic circles": "MR",
    "adjustable ring": "MR",
    "inv dec": "INVDEC",
    "invisible dec": "INVDEC",
    sts: "ST",
    bobbles: "BOBBLE",
    "bobble st": "BOBBLE",
    "bobble sts": "BOBBLE",
    puffs: "PUFF",
    "puff st": "PUFF",
    "puff sts": "PUFF",
    popcorns: "POPCORN",
    "popcorn st": "POPCORN",
    "popcorn sts": "POPCORN",
    picots: "PICOT",
  },
};

/** English plural of the last word ("stitch" → "stitches"/"stitchs", "chain" → "chains"). */
function pluralEn(phrase: string): string[] {
  const words = phrase.split(" ");
  const last = words.pop()!;
  const plurals = /(ch|sh|s|x)$/.test(last) ? [`${last}es`, `${last}s`] : [`${last}s`];
  return plurals.map((p) => [...words, p].join(" "));
}

/**
 * All spellings of a full stitch name: the name, its plural and, for English names ending
 * in "crochet", the short form ("double crochet" → "double", "doubles").
 */
function nameForms(name: string, locale: NotationLocale): string[] {
  if (locale === "de") return [name];
  const forms = [name, ...pluralEn(name)];
  const short = name.replace(/ crochet$/, "");
  if (short !== name) forms.push(short, ...pluralEn(short));
  return forms;
}

function buildStitchVocab(locale: NotationLocale): Map<string, StitchCode> {
  const vocab = new Map<string, StitchCode>();
  const add = (term: string, code: StitchCode) => {
    const key = termKey(term);
    const existing = vocab.get(key);
    if (existing && existing !== code) {
      throw new Error(`notation: "${key}" means both ${existing} and ${code} in ${locale}`);
    }
    vocab.set(key, code);
  };
  for (const code of Object.keys(STITCH_ABBREVIATIONS) as StitchCode[]) {
    add(STITCH_ABBREVIATIONS[code][locale], code);
    for (const form of nameForms(STITCH_NAMES[code][locale], locale)) add(form, code);
  }
  for (const [term, code] of Object.entries(STITCH_ALIASES[locale])) add(term, code);
  return vocab;
}

const STITCH_VOCAB: Record<NotationLocale, Map<string, StitchCode>> = {
  de: buildStitchVocab("de"),
  en_us: buildStitchVocab("en_us"),
  en_uk: buildStitchVocab("en_uk"),
};

/** Every spelling the parser understands for `locale` (for tests and tooling). */
export function stitchVocabulary(locale: NotationLocale): ReadonlyMap<string, StitchCode> {
  return STITCH_VOCAB[locale];
}

const MOD_VOCAB: Map<string, Mod> = (() => {
  const vocab = new Map<string, Mod>();
  for (const mod of Object.keys(MOD_ABBREVIATIONS) as Mod[]) {
    for (const locale of NOTATION_LOCALES) {
      vocab.set(termKey(MOD_ABBREVIATIONS[mod][locale]), mod);
      vocab.set(termKey(MOD_NAMES[mod][locale]), mod);
    }
  }
  for (const [term, mod] of Object.entries(MOD_ALIASES)) vocab.set(termKey(term), mod);
  return vocab;
})();

/**
 * Locales whose terms are also understood when reading `locale`. US and UK terms are never
 * mixed: the same words mean different stitches there ("double", "treble", "dc").
 */
const FALLBACK_LOCALES: Record<NotationLocale, readonly NotationLocale[]> = {
  de: ["en_us", "en_uk"],
  en_us: ["de"],
  en_uk: ["de"],
};

/**
 * Resolve a stitch term in a locale. The locale's own vocabulary wins; a term of a
 * fallback locale is accepted only if all fallback locales that know it agree on the
 * stitch (so in German, "dc" is never guessed).
 */
export function resolveStitchTerm(term: string, locale: NotationLocale): StitchCode | undefined {
  const key = termKey(term);
  const own = STITCH_VOCAB[locale].get(key);
  if (own) return own;
  const hits = new Set<StitchCode>();
  for (const other of FALLBACK_LOCALES[locale]) {
    const hit = STITCH_VOCAB[other].get(key);
    if (hit) hits.add(hit);
  }
  return hits.size === 1 ? [...hits][0] : undefined;
}

/** Resolve a modifier term (any locale). */
export function resolveModTerm(term: string): Mod | undefined {
  return MOD_VOCAB.get(termKey(term));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Word of a rendered colour change: `[Farbe: Weiß]`, `[Color: White]`, `[Colour: White]`. */
const COLOR_WORDS: Record<NotationLocale, string> = { de: "Farbe", en_us: "Color", en_uk: "Colour" };

/** Options of the render functions. */
export interface RenderOptions {
  /**
   * Render colour changes (format v2): `[Farbe: Weiß] 6 fM`. A change shows the name of the
   * palette colour with that id, else the id itself. Without this option colour changes are
   * not rendered. `parseRowText` reads the marks back (`ParseRowContext.colors`).
   */
  colors?: readonly { id: string; name?: string }[];
}

/** A rendered colour change (with a trailing space), or "" when there is none to render. */
function colorMark(id: string | undefined, locale: NotationLocale, opts: RenderOptions): string {
  if (id === undefined || !opts.colors) return "";
  const name = opts.colors.find((c) => c.id === id)?.name?.trim() || id;
  return `[${COLOR_WORDS[locale]}: ${name.replace(/[[\]]/g, "")}] `;
}

function renderStitch(op: StitchOp, locale: NotationLocale, opts: RenderOptions): string {
  const text = `${colorMark(op.color, locale, opts)}${op.count} ${STITCH_ABBREVIATIONS[op.code][locale]}`;
  if (!op.modifiers || op.modifiers.length === 0) return text;
  return `${text} (${op.modifiers.map((m) => MOD_ABBREVIATIONS[m][locale]).join(", ")})`;
}

/**
 * Render a single op: a stitch, a repeat group (`6× (…)`) or a stitch group
 * (`(2 Stb, 1 Lm, 2 Stb) in dieselbe M`, `(…) in same st`).
 */
export function renderOp(op: Op, locale: NotationLocale, opts: RenderOptions = {}): string {
  if (op.kind === "stitch") return renderStitch(op, locale, opts);
  if (op.kind === "group") return `(${renderOps(op.ops, locale, opts)}) ${GROUP_WORDS[locale]}`;
  return `${op.times}${TIMES_SIGN[locale]} (${renderOps(op.ops, locale, opts)})`;
}

/** Render an op list as a comma-separated instruction, e.g. `6× (1 fM, 1 Zun)`. */
export function renderOps(ops: readonly Op[], locale: NotationLocale, opts: RenderOptions = {}): string {
  return ops.map((op) => renderOp(op, locale, opts)).join(", ");
}

/**
 * Render a row's ops. A row without ops (free instruction) renders to "". With
 * `opts.colors` a row colour comes first: `[Farbe: Weiß] 6 fM`.
 */
export function renderRow(row: Row, locale: NotationLocale, opts: RenderOptions = {}): string {
  const text = renderOps(row.ops, locale, opts);
  const mark = colorMark(row.color, locale, opts);
  if (!mark) return text;
  return text ? `${mark}${text}` : mark.trim();
}

const ROW_WORDS: Record<NotationLocale, { round: string; row: string; note: string }> = {
  de: { round: "Runde", row: "Reihe", note: "Hinweis" },
  en_us: { round: "Round", row: "Row", note: "Note" },
  en_uk: { round: "Round", row: "Row", note: "Note" },
};

/**
 * Display label of a row: its own `label` if set, otherwise "Runde n" / "Reihe n" (from the
 * 1-based `ordinal`, see `rowOrdinals`), or "Hinweis" for a row without stitches.
 */
export function rowLabel(row: Row, ordinal: number, locale: NotationLocale): string {
  const own = row.label?.trim();
  if (own) return own;
  const words = ROW_WORDS[locale];
  if (row.ops.length === 0) return words.note;
  return `${row.type === "round" ? words.round : words.row} ${ordinal}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type ParseRowErrorCode =
  | "empty"
  | "unknown-term"
  | "syntax"
  /** A count, repeat or the row total exceeds the limits (`limit` says which maximum). */
  | "too-large"
  /** A modifier that contradicts another one or does not apply to the stitch (`term`). */
  | "invalid-modifier"
  /**
   * The text says "to the end of the round" ("sc around", "(…)*", "Zun in jede M"), but the
   * stitch count of the previous row is not known (`ParseRowContext.previousCount`).
   */
  | "needs-context"
  /**
   * "To the end of the round" does not fit the previous row: its stitch count (`limit`)
   * minus the rest of the row is not a whole number of repeats.
   */
  | "fill-mismatch";

/**
 * A guess the lenient pass made where the text allows two readings:
 *   - `repeat-scope-guessed`: "sc, inc x6 (18)" — the "x6" was applied to the whole row
 *     because only that matches the written count.
 *   - `repeat-scope-ambiguous`: "sc, inc x6" — read as "sc, 6 inc", but it may mean the
 *     whole row six times (no count, or neither reading matches it).
 *   - `repeat-count-guessed`: "*…; rep from * 5 times" — read as 6 repeats because only that
 *     matches the written count (or as 5 when the count says so although "more" was written).
 *   - `repeat-count-ambiguous`: "*…; rep from * 5 times" without a count that decides
 *     between 5 and 6 repeats; read as 5 ("more times": 6).
 */
export type ParseRowWarning =
  | "repeat-scope-guessed"
  | "repeat-scope-ambiguous"
  | "repeat-count-guessed"
  | "repeat-count-ambiguous"
  /**
   * "3 hdc inc" without a written count: read as three HDC increases (three groups of two
   * HDC), but it may mean "3 hdc, inc".
   */
  | "increase-ambiguous";

export type ParseRowResult =
  | {
      ok: true;
      ops: Op[];
      /** Stitch count written at the end of the text, e.g. the `18` of `… (18)`. */
      stitchCountTarget?: number;
      /** "(4 rounds)" written after the row: the row stands for this many rounds. */
      rounds?: number;
      /** Guesses of the lenient pass (see `ParseRowWarning`); absent when there were none. */
      warnings?: ParseRowWarning[];
    }
  | {
      ok: false;
      code: ParseRowErrorCode;
      /** The offending term (for `unknown-term` / `invalid-modifier`), as written. */
      term?: string;
      /** 0-based character offset of the problem in the input text. */
      position?: number;
      /** The exceeded maximum (for `too-large`), the previous row's count (`fill-mismatch`). */
      limit?: number;
    };

/** What the parser may know about the surroundings of the row. */
export interface ParseRowContext {
  /**
   * Stitch count of the previous row. Needed to resolve "to the end of the round" phrases:
   * `sc around`, `inc in each st`, `(1 sc, inc)*`, `fM rundherum`, `Zun in jede M`.
   */
  previousCount?: number;
  /**
   * The palette (`overview.colors`) for colour changes written as `[Farbe: Weiß]` /
   * `[Color: White]`: a name or id of the palette becomes that colour's id; anything else is
   * kept as written (validation then reports it as an unknown colour).
   */
  colors?: readonly { id: string; name?: string }[];
}

type Token =
  | { t: "num"; value: number; pos: number }
  | { t: "word"; text: string; pos: number; end: number }
  | { t: "times"; pos: number }
  | { t: "lp"; pos: number }
  | { t: "rp"; pos: number }
  | { t: "sep"; pos: number }
  /** "to the end of the round" marker — only produced by the lenient pre-pass (`@`). */
  | { t: "fill"; pos: number }
  /** A colour change `[Farbe: Weiß]` (format v2); `name` as written. */
  | { t: "color"; name: string; pos: number }
  | { t: "end"; pos: number }
  | { t: "bad"; pos: number };

/** `[Farbe: Weiß]`, `[Farbwechsel zu Weiß]`, `[Color: White]`, `[Colour change to white]`. */
const COLOR_MARK = /^\[\s*(?:Farbe|Farbwechsel(?:\s+zu)?|Colou?r(?:\s+change(?:\s+to)?)?)\s*:?\s*([^\]]*[^\]\s])\s*\]/iu;

/**
 * The words after `(…)` that make it a stitch group (format v2): `in dieselbe M`, `in same
 * st`, `in the same stitch`, `in die gleiche Masche`, `in one st`.
 */
const GROUP_PHRASE =
  /^in(?:to)?\s+(?:(?:the\s+)?(?:same|next|last|first)|dieselbe|derselben|die\s+gleiche|der\s+gleichen|die\s+nächste|der\s+nächsten|one|1|eine|einer)\s+(?:sts?|stitch|M|Masche)$/iu;

/** Whether an op list contains a stitch group (at any depth). */
function containsGroup(ops: readonly Op[]): boolean {
  return ops.some((op) => op.kind === "group" || (op.kind === "repeat" && containsGroup(op.ops)));
}

/** Put a colour change on the first stitch of `op`; false when it has none. */
function applyColor(op: Op, color: string): boolean {
  if (op.kind === "stitch") {
    op.color = color;
    return true;
  }
  return op.ops.length > 0 && applyColor(op.ops[0]!, color);
}

/** Map colour changes as written (a palette name or id) to palette ids. */
function resolveColors(ops: readonly Op[], palette: ParseRowContext["colors"]): void {
  if (!palette) return;
  const key = (s: string) => s.trim().toLowerCase();
  for (const op of ops) {
    if (op.kind !== "stitch") {
      resolveColors(op.ops, palette);
      continue;
    }
    if (op.color === undefined) continue;
    const written = op.color;
    const hit =
      palette.find((c) => c.id === written) ??
      palette.find((c) => c.name !== undefined && key(c.name) === key(written)) ??
      palette.find((c) => key(c.id) === key(written));
    if (hit) op.color = hit.id;
  }
}

const WORD_CHAR = /[\p{L}.\-]/u;
const SPACE = /[\s ]/u;

function tokenize(text: string, lenient: boolean): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (SPACE.test(ch)) {
      i++;
    } else if (ch >= "0" && ch <= "9") {
      const start = i;
      while (i < text.length && text[i]! >= "0" && text[i]! <= "9") i++;
      tokens.push({ t: "num", value: Number(text.slice(start, i)), pos: start });
    } else if (ch === "×" || ch === "*") {
      tokens.push({ t: "times", pos: i++ });
    } else if (ch === "[" && COLOR_MARK.test(text.slice(i))) {
      const m = COLOR_MARK.exec(text.slice(i))!;
      tokens.push({ t: "color", name: m[1]!, pos: i });
      i += m[0].length;
    } else if (ch === "(" || ch === "[") {
      tokens.push({ t: "lp", pos: i++ });
    } else if (ch === ")" || ch === "]") {
      tokens.push({ t: "rp", pos: i++ });
    } else if (ch === "," || ch === ";") {
      tokens.push({ t: "sep", pos: i++ });
    } else if (lenient && ch === "@") {
      tokens.push({ t: "fill", pos: i++ });
    } else if (WORD_CHAR.test(ch)) {
      const start = i;
      while (i < text.length && WORD_CHAR.test(text[i]!)) i++;
      tokens.push({ t: "word", text: text.slice(start, i), pos: start, end: i });
    } else {
      tokens.push({ t: "bad", pos: i++ });
    }
  }
  tokens.push({ t: "end", pos: text.length });
  return tokens;
}

/** Thrown inside the parser, turned into a ParseRowResult at the boundary. */
class ParseFailure {
  constructor(
    readonly code: Exclude<ParseRowErrorCode, "empty">,
    readonly position: number,
    readonly term?: string,
    readonly limit?: number,
  ) {}
}

/** An op whose count/times is "to the end of the round", resolved after parsing. */
interface FillMark {
  op: Op;
  /** Count written before a stitch fill ("1 fM in jede M", "2 sc in each st"). */
  explicitCount?: number;
  depth: number;
  pos: number;
}

/** Deepest nesting of repeat groups the parser accepts. */
const MAX_NESTING = 50;

class Parser {
  private i = 0;
  stitchCountTarget: number | undefined;
  readonly fills: FillMark[] = [];
  /** A top-level stitch whose count came from a postfix "x N" ("sc, inc x6"). */
  postfixTimes: { op: StitchOp; times: number } | undefined;

  constructor(
    private readonly tokens: Token[],
    private readonly text: string,
    private readonly locale: NotationLocale,
    /** Lenient mode: postfix counts ("sc 2", "inc x 6") and fill markers. */
    private readonly lenient = false,
  ) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const tok = this.peek();
    if (this.i < this.tokens.length - 1) this.i++;
    return tok;
  }

  private fail(tok: Token): never {
    throw new ParseFailure("syntax", tok.pos);
  }

  private isTimes(tok: Token): boolean {
    return tok.t === "times" || (tok.t === "word" && TIMES_WORDS.has(tok.text.toLowerCase()));
  }

  /** Whether `tok` ends an item (what may follow a postfix count). */
  private endsItem(tok: Token): boolean {
    return tok.t === "sep" || tok.t === "end" || tok.t === "rp" || tok.t === "fill";
  }

  /** `( N [stitch word…] )` as the very last thing of the text — a stitch-count note. */
  private atTrailingCount(): number | undefined {
    if (this.peek().t !== "lp") return undefined;
    const num = this.peek(1);
    if (num.t !== "num") return undefined;
    let k = 2;
    const words: string[] = [];
    while (this.peek(k).t === "word") {
      words.push((this.peek(k) as { text: string }).text);
      k++;
    }
    if (this.peek(k).t !== "rp" || this.peek(k + 1).t !== "end") return undefined;
    if (words.length > 0 && resolveStitchTerm(words.join(" "), this.locale) !== "ST") return undefined;
    return k + 1;
  }

  parseRow(): Op[] {
    const ops = this.parseList(0);
    const end = this.peek();
    if (end.t !== "end") this.fail(end);
    return ops;
  }

  /** item (sep item)* — stops before `)` or the end. */
  private parseList(depth: number): Op[] {
    const ops: Op[] = [];
    for (;;) {
      // A colour change applies from the first stitch of the item it precedes.
      const mark = this.peek();
      if (mark.t === "color") this.next();
      const item = this.parseItem(depth);
      if (mark.t === "color" && !applyColor(item, mark.name)) this.fail(mark);
      ops.push(item);
      if (depth === 0) {
        const span = this.atTrailingCount();
        if (span !== undefined) {
          this.stitchCountTarget = this.limited(this.peek(1), MAX_STITCH_COUNT_TARGET, 0);
          for (let k = 0; k < span; k++) this.next();
          return ops;
        }
      }
      const tok = this.peek();
      if (tok.t === "sep") {
        this.next();
        continue;
      }
      if (tok.t === "end" || tok.t === "rp") return ops;
      this.fail(tok);
    }
  }

  /**
   * Number of tokens from here that spell "into the same stitch" (`GROUP_PHRASE`), up to the
   * next separator, bracket or the end; 0 when they do not.
   */
  private groupPhraseLength(): number {
    const first = this.peek();
    if (first.t !== "word" || !["in", "into"].includes(first.text.toLowerCase())) return 0;
    const words: string[] = [];
    let k = 0;
    for (;;) {
      const tok = this.peek(k);
      if (tok.t === "word") words.push(tok.text.replace(/\.$/, ""));
      else if (tok.t === "num") words.push(String(tok.value));
      else break;
      k++;
    }
    return GROUP_PHRASE.test(words.join(" ")) ? k : 0;
  }

  /** `( list )` of a repeat group; `()` is an empty group (rendered as `N× ()`). */
  private parseGroupBody(depth: number): Op[] {
    const open = this.next(); // "("
    if (depth + 1 > MAX_NESTING) this.fail(open); // no stack overflow on "((((((…"
    if (this.peek().t === "rp") {
      this.next();
      return [];
    }
    const ops = this.parseList(depth + 1);
    const close = this.next();
    if (close.t !== "rp") this.fail(close.t === "end" ? close : open);
    return ops;
  }

  /** A number token within `min..max`; above `max` is a `too-large` failure. */
  private limited(tok: Token, max: number, min = 1): number {
    if (tok.t !== "num" || tok.value < min) this.fail(tok);
    if (tok.value > max) throw new ParseFailure("too-large", tok.pos, undefined, max);
    return tok.value;
  }

  private count(tok: Token): number {
    return this.limited(tok, MAX_COUNT);
  }

  private times(tok: Token): number {
    return this.limited(tok, MAX_TIMES);
  }

  private parseItem(depth: number): Op {
    const tok = this.peek();

    // Lenient: "@ 1 fM" ("in jede M 1 fM") — a stitch worked into every stitch.
    if (this.lenient && tok.t === "fill") {
      this.next();
      const counted = this.peek().t === "num" ? this.count(this.next()) : undefined;
      const op = this.parseStitch(1, depth, false);
      this.fills.push({ op, explicitCount: counted, depth, pos: tok.pos });
      return op;
    }

    // Postfix repeat: "(1 sc, 1 inc) x6", "(1 fM, 1 Zun) 6 mal"
    if (tok.t === "lp") {
      const ops = this.parseGroupBody(depth);
      // "(3 fM) in dieselbe M", "(2 dc, ch 1, 2 dc) in same st": a stitch group (format v2).
      const phrase = this.groupPhraseLength();
      if (phrase > 0) {
        if (containsGroup(ops)) this.fail(tok); // groups do not nest
        for (let k = 0; k < phrase; k++) this.next();
        return { kind: "group", ops: ops as GroupOp[] };
      }
      let times: number;
      if (this.isTimes(this.peek()) && this.peek(1).t === "num") {
        this.next();
        times = this.times(this.next());
      } else if (this.lenient && this.isTimes(this.peek()) && this.endsItem(this.peek(1))) {
        // "(1 sc, inc)*" — repeat to the end of the round.
        const at = this.next();
        if (this.peek().t === "fill") this.next();
        const op: Op = { kind: "repeat", times: 1, ops };
        this.fills.push({ op, depth, pos: at.pos });
        return op;
      } else if (this.lenient && this.peek().t === "fill") {
        const at = this.next();
        const op: Op = { kind: "repeat", times: 1, ops };
        this.fills.push({ op, depth, pos: at.pos });
        return op;
      } else if (this.isTimes(this.peek())) {
        this.next();
        times = this.times(this.next());
      } else if (this.peek().t === "num") {
        times = this.times(this.next());
        if (this.isTimes(this.peek())) this.next();
      } else {
        this.fail(this.peek());
      }
      return { kind: "repeat", times, ops };
    }

    if (tok.t === "num") {
      // Prefix repeat: "6× (…)", "6 x (…)", "6 mal (…)", or plain "6 (…)"
      const repeat = (this.isTimes(this.peek(1)) && this.peek(2).t === "lp") || this.peek(1).t === "lp";
      if (repeat) {
        const times = this.times(this.next());
        if (this.isTimes(this.peek())) this.next();
        return { kind: "repeat", times, ops: this.parseGroupBody(depth) };
      }
      return this.parseStitch(this.count(this.next()), depth, true);
    }

    if (tok.t === "word") return this.parseStitch(1, depth, false);
    this.fail(tok);
  }

  /** In lenient mode a times word followed by a count ends a stitch term ("inc x 6"). */
  private stopsTerm(tok: Token): boolean {
    if (!this.lenient || !this.isTimes(tok)) return false;
    const after = this.peek(1);
    return after.t === "num" || this.endsItem(after);
  }

  private parseStitch(count: number, depth: number, explicit: boolean): Op {
    const first = this.peek();
    if (first.t !== "word") this.fail(first);
    let end = first.end;
    this.next();
    while (this.peek().t === "word" && !this.stopsTerm(this.peek())) {
      end = (this.next() as { end: number }).end;
    }
    const term = this.text.slice(first.pos, end);
    const code = resolveStitchTerm(term, this.locale);
    if (!code) throw new ParseFailure("unknown-term", first.pos, term);

    const op: StitchOp = { kind: "stitch", code, count };
    if (this.peek().t === "lp" && !(depth === 0 && this.atTrailingCount() !== undefined)) {
      this.parseModifiers(op, code);
    }
    return this.lenient ? this.parsePostfix(op, depth, explicit) : op;
  }

  /** Modifier list: "(hMG)", "(BLO, tog)" — duplicates collapse, contradictions fail. */
  private parseModifiers(op: StitchOp, code: StitchCode): void {
    const open = this.next();
    const modifiers: Mod[] = [];
    for (;;) {
      const w = this.peek();
      if (w.t !== "word") this.fail(w);
      let wEnd = w.end;
      this.next();
      while (this.peek().t === "word") wEnd = (this.next() as { end: number }).end;
      const modTerm = this.text.slice(w.pos, wEnd);
      const mod = resolveModTerm(modTerm);
      if (!mod) throw new ParseFailure("unknown-term", w.pos, modTerm);
      if (normalizeModifiers(code, [...modifiers, mod]) === null) {
        throw new ParseFailure("invalid-modifier", w.pos, modTerm);
      }
      if (!modifiers.includes(mod)) modifiers.push(mod);
      const sep = this.next();
      if (sep.t === "rp") break;
      if (sep.t !== "sep") this.fail(sep.t === "end" ? open : sep);
    }
    op.modifiers = modifiers;
  }

  /**
   * Lenient postfix forms after a stitch: "sc 2", "inc x 6", "Dec × 9", "sc @" (to the
   * end of the round). On an explicitly counted stitch only a times sign makes a repeat
   * ("2 sc x 3"); a bare number there ("6 inc 12", "18 sc 18") is not read.
   */
  private parsePostfix(op: StitchOp, depth: number, explicit: boolean): Op {
    const tok = this.peek();
    if (tok.t === "fill") {
      this.next();
      this.fills.push({ op, explicitCount: explicit ? op.count : undefined, depth, pos: tok.pos });
      op.count = 1;
      return op;
    }
    let n: Token | undefined;
    let timesSign = false;
    if (this.isTimes(tok) && this.peek(1).t === "num" && this.endsItem(this.peek(2))) {
      this.next();
      n = this.next();
      timesSign = true;
    } else if (!explicit && tok.t === "num" && this.endsItem(this.peek(1))) {
      n = this.next();
    }
    if (!n) return op;
    if (!explicit) {
      op.count = this.count(n);
      if (timesSign && depth === 0) this.postfixTimes = { op, times: op.count };
      return op;
    }
    return { kind: "repeat", times: this.times(n), ops: [op] };
  }
}

/** Stitches of the previous row an op list works into (TOG-aware). */
function consumedByOps(ops: readonly Op[]): number {
  let total = 0;
  for (const op of ops) {
    total += op.kind === "stitch" ? op.count * consumesOf(op) : op.kind === "group" ? consumesOfGroup(op) : op.times * consumedByOps(op.ops);
  }
  return total;
}

/** Resolve "to the end of the round" markers against the previous row's stitch count. */
function resolveFills(ops: Op[], fills: readonly FillMark[], previousCount: number | undefined): void {
  if (fills.length === 0) return;
  const mark = fills[0]!;
  if (fills.length > 1 || mark.depth > 0) throw new ParseFailure("syntax", (fills[1] ?? mark).pos);
  if (previousCount === undefined) throw new ParseFailure("needs-context", mark.pos);
  const op = mark.op;
  if (op.kind === "stitch" && mark.explicitCount !== undefined && mark.explicitCount > 1) {
    // "2 sc in each st" is an increase in each stitch; 3+ into one stitch is not representable.
    if (mark.explicitCount !== 2 || op.code !== "SC" || op.modifiers?.includes("TOG")) {
      throw new ParseFailure("syntax", mark.pos);
    }
    op.code = "INC";
  }
  const per = op.kind === "stitch" ? consumesOf(op) : consumedByOps(op.ops);
  const rest = consumedByOps(ops) - per; // the marked op counts once so far
  const remaining = previousCount - rest;
  if (per <= 0 || remaining <= 0 || remaining % per !== 0) {
    throw new ParseFailure("fill-mismatch", mark.pos, undefined, previousCount);
  }
  const n = remaining / per;
  if (op.kind === "stitch") {
    if (n > MAX_COUNT) throw new ParseFailure("too-large", mark.pos, undefined, MAX_COUNT);
    op.count = n;
  } else if (op.kind === "repeat") {
    if (n > MAX_TIMES) throw new ParseFailure("too-large", mark.pos, undefined, MAX_TIMES);
    op.times = n;
  }
}

/**
 * Add a row-level loop modifier ("BLO: …") to every stitch it applies to. Returns how many
 * stitch ops received it.
 */
function applyRowModifier(ops: readonly Op[], mod: Mod): number {
  let applied = 0;
  for (const op of ops) {
    if (op.kind !== "stitch") {
      applied += applyRowModifier(op.ops, mod);
    } else if (modifierAllowed(op.code, mod)) {
      const merged = normalizeModifiers(op.code, [...(op.modifiers ?? []), mod]);
      if (merged) {
        op.modifiers = merged;
        applied++;
      }
    }
  }
  return applied;
}

// ---------------------------------------------------------------------------
// Lenient pre-pass: rewrite what real patterns write into the compact notation
// ---------------------------------------------------------------------------

interface LenientText {
  text: string;
  stitchCountTarget?: number;
  rowModifier?: Mod;
  /** "(4 rounds)" after the row. */
  rounds?: number;
  /** "*…, rep from * N (more) times" was rewritten into the first repeat group. */
  repFrom?: { n: number; more: boolean };
  /** "3 hdc inc" (space, no hyphen) was read as three increases — see `increase-ambiguous`. */
  increaseAmbiguous?: boolean;
}

/** Count words of stitch groups ("three dc in next st", "drei Stb in eine M"). */
const GROUP_COUNT_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  sechs: 6,
  sieben: 7,
};
const GROUP_COUNT = `(\\d+|${Object.keys(GROUP_COUNT_WORDS).join("|")})`;
const groupCount = (word: string): number => GROUP_COUNT_WORDS[word.toLowerCase()] ?? Number(word);

/**
 * "into one stitch": the next, same, first, last, one stitch (or loop, chain) — what makes
 * "3 sc in next st" a stitch group (format v2).
 */
const INTO_ONE =
  "(?:in|into|im)\\s+(?:the\\s+)?(?:next|same|one|1|a|this|that|last|first|single|eine[rm]?|ein|dieselbe|derselben|die\\s+gleiche|der\\s+gleichen|die\\s+nächste|der\\s+nächsten|die\\s+letzte|die\\s+erste|nächste|letzte)\\s+(?:sts?|stitch(?:es)?|M|Masche|loop|ch|chain|Lm|Luftmasche|Schlinge|Einstichstelle)\\b";

/** Stitches a group increase is made of: "hdc inc" = two HDC into one stitch. */
const GROUP_INC_TERMS = "hdc|htr|dc|tr|dtr|hStb|Stb|DStb";
/** Loops of a bobble-family stitch written in its name: "5-dc bobble", "Noppe aus 5 Stb". */
const LOOP_SPEC_TERMS = "sc|hdc|htr|dc|tr|dtr|fM|hStb|Stb|DStb|ch|Lm";
const BOBBLE_WORDS = "bobbles?|popcorns?|puffs?|Noppen?|Popcorns?|Büschel(?:maschen?)?|Popcornmaschen?";

const RING_TERMS =
  "MR|magic\\s+ring|magic\\s+circle|magic\\s+loop|adjustable\\s+ring|AR|Fadenring|magische[nr]?\\s+(?:Faden)?ring|Magic\\s+Ring";
const ARTICLE = "(?:a|an|the|einen|den|dem|einem|ein)\\s+";
const ST_WORD = "(?:sts?|stitch(?:es)?|M|Maschen?)";
/**
 * A stitch term as written (letters, dots, hyphens, inner spaces), at most four words — the
 * bound keeps the regexes that use it linear on long texts.
 */
const TERM = "[\\p{L}][\\p{L}.\\-]*(?:\\s+[\\p{L}][\\p{L}.\\-]*){0,3}?";

const LOOP_PHRASE =
  "(?:BLO|FLO|hMG|vMG|(?:back|front)\\s+loops?(?:\\s+only)?|(?:nur\\s+)?(?:(?:in|durch)\\s+)?(?:(?:das|die)\\s+)?(?:hintere|vordere)[sn]?\\s+(?:Maschenglied(?:er)?|MG))";
const LOOP_PREFIX = new RegExp(
  `^(?:(?:work|crochet|häkle|arbeite)\\s+)?(?:(?:in|into|through|durch)\\s+(?:the\\s+)?)?(${LOOP_PHRASE})(?:\\s+only)?\\s*[:,.\\-]?\\s*`,
  "iu",
);
const LOOP_SUFFIX_BODY = `(?:(?:work(?:ed)?|crochet(?:ed)?)\\s+)?(?:(?:in|into|through|durch)\\s+(?:the\\s+)?)?(${LOOP_PHRASE})(?:\\s+only)?`;
const LOOP_SUFFIX = new RegExp(`(?:\\(\\s*${LOOP_SUFFIX_BODY}\\s*\\)|[,;]?\\s*${LOOP_SUFFIX_BODY})$`, "iu");

function loopModOf(phrase: string): Mod {
  return /^(?:BLO|hMG|back|(?:nur\s+)?(?:(?:in|durch)\s+)?(?:(?:das|die)\s+)?hinter)/iu.test(phrase.trim()) ? "BLO" : "FLO";
}

/** Phrases meaning "into every stitch / to the end of the round" → `@`. */
const FILL_PHRASES: RegExp[] = [
  new RegExp(`\\b(?:in|into)\\s+(?:each|every|all(?:\\s+the)?)\\s+(?:sts?|stitch(?:es)?|sc)\\b(?:\\s+(?:all\\s+)?(?:around|across))?`, "giu"),
  /\b(?:all\s+)?around\b|\bacross\b/giu,
  /\b(?:to|until)\s+(?:the\s+)?end(?:\s+of\s+(?:the\s+)?(?:round|row|rnd))?\b/giu,
  /(?:\bin\s+)?\b(?:jede|alle|jeder)\s+(?:M|Masche|Maschen)\b(?:\s+der\s+Vor(?:runde|reihe))?/giu,
  /\brundherum\b|\bin\s+der\s+ganzen\s+Runde\b/giu,
  /\bbis\s+(?:zum\s+)?(?:Runden|Reihen)?ende\b|\bbis\s+zum\s+Ende(?:\s+der\s+(?:Runde|Reihe))?\b/giu,
];

/**
 * Rewrite a real-world row instruction into the compact notation the strict parser reads.
 * Returns the trailing stitch count and a row-level loop modifier separately.
 */
function rewriteLenient(input: string, locale: NotationLocale): LenientText {
  const sc = STITCH_ABBREVIATIONS.SC[locale];
  const inc = STITCH_ABBREVIATIONS.INC[locale];
  let s = input
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "")
    .trim();
  let stitchCountTarget: number | undefined;
  let rowModifier: Mod | undefined;
  let rounds: number | undefined;
  let repFrom: LenientText["repFrom"];

  // Trailing annotations, repeatedly: "(4 rounds)", "= 18", "– 18", "[18]", "(18 sts)", "turn".
  for (let changed = true; changed; ) {
    changed = false;
    const before = s;
    s = s
      .replace(/\(\s*(\d+)\s*(?:rounds?|rows?|rnds?|rds?|runden|reihen|r)\s*\)\s*$/iu, (_m, n: string) => {
        rounds ??= Number(n);
        return "";
      })
      .trim();
    s = s.replace(/[,;]?\s*\b(?:turn|wenden)\b\.?$/iu, "").trim();
    const eq = /(?:^|\s|(?<=[\])\p{L}\d]))(?:=|->|→|-)\s*[[(]?\s*(\d+)\s*(?:sts?|stitches|maschen|m)?\s*[\])]?$/iu.exec(s);
    const br = eq ? null : /[[(]\s*(\d+)\s*(?:sts?|stitches|st|maschen|m)?\s*[\])]$/iu.exec(s);
    const hit = eq ?? br;
    if (hit && stitchCountTarget === undefined) {
      stitchCountTarget = Number(hit[1]);
      s = s.slice(0, hit.index).trim();
    }
    s = s.replace(/\.+$/, "").trim();
    if (s !== before) changed = true;
  }

  // Row-level loop modifier: "BLO: …", "through back loops only, …", "… in BLO".
  const pre = LOOP_PREFIX.exec(s);
  if (pre && pre[0].length < s.length) {
    rowModifier = loopModOf(pre[1]!);
    s = s.slice(pre[0].length).trim();
  } else {
    const post = LOOP_SUFFIX.exec(s);
    if (post && post.index > 0 && /\d|\p{L}/u.test(s.slice(0, post.index))) {
      rowModifier = loopModOf((post[1] ?? post[2])!);
      s = s.slice(0, post.index).trim();
    }
  }

  // Leading verbs and articles: "Make 6 sc …", "crochet 21 sc", "Make a magic ring, …".
  s = s.replace(/^(?:(?:make|work|crochet|then|now|häkle|häkeln|arbeite)\s+)+/iu, "");
  s = s.replace(/^(?:a|an|einen|ein)\s+(?=(?:MR|magic|adjustable|Fadenring|magisch))/iu, "");

  // Magic ring starts.
  let ring = false;
  const withoutRing = s.replace(
    new RegExp(`\\s*\\b(?:in|into|im)\\s+(?:${ARTICLE})?(?:${RING_TERMS})\\b`, "giu"),
    "",
  );
  if (withoutRing !== s) {
    ring = true;
    s = withoutRing;
  }
  const ringCount = new RegExp(`^(?:${RING_TERMS})\\s*(?:[:,]|\\bmit\\b|\\bwith\\b)?\\s*(\\d+)$`, "iu").exec(s);
  if (ringCount) {
    s = `MR, ${ringCount[1]} ${sc}`;
  } else {
    s = s.replace(new RegExp(`^(?:${RING_TERMS})\\s*(?::|\\bmit\\b|\\bwith\\b|(?=\\d))\\s*`, "iu"), () => {
      ring = true;
      return "";
    });
  }
  if (ring && !new RegExp(`(?:^|[\\s,;(])(?:${RING_TERMS})(?:$|[\\s,;)])`, "iu").test(s)) s = `MR, ${s}`;

  // Foundation-chain start notes: the graph already skips the chains next to the hook.
  s = s.replace(
    /[,]?\s*(?:start(?:ing)?\s+)?(?:in|into|from|with)\s+(?:the\s+)?(?:2nd|second|3rd|third|\d+(?:st|nd|rd|th))\s+(?:ch|chain|loop)(?:\s+(?:from|on)\s+(?:the\s+)?hook)?/giu,
    "",
  );
  s = s.replace(/[,]?\s*ab\s+der\s+\d+\.\s*(?:Lm|Luftmasche)(?:\s+von\s+der\s+Nadel(?:\s+aus)?)?/giu, "");

  // "sc2tog" → "sc (tog)".
  s = s.replace(/\b(\p{L}+)2tog\b/giu, "$1 (tog)");

  // Relief stitches: "FPdc", "BPtr", "front post dc", "RStbv", "Reliefstäbchen von hinten".
  s = s.replace(/\b(FP|BP)(sc|hdc|htr|dc|tr|dtr|trtr)\b/giu, (_m, side: string, term: string) => `${term} (${side.toUpperCase()})`);
  s = s.replace(
    /\b(front|back)\s+post\s+((?:half\s+)?(?:single|double|treble|triple)(?:\s+treble)?(?:\s+crochet)?|sc|hdc|htr|dc|tr|dtr)\b/giu,
    (_m, side: string, term: string) => `${term} (${side.toLowerCase() === "front" ? "FP" : "BP"})`,
  );
  s = s.replace(/\bR(?:elief)?Stb\s*([vh])\b\.?/gu, (_m, side: string) => `Stb (Relief ${side})`);
  s = s.replace(
    /\bRelief-?(?:stäbchen|stb)\.?\s+(?:von\s+)?(vorne?|hinten|v|h)\b\.?/giu,
    (_m, side: string) => `Stb (Relief ${side.toLowerCase().startsWith("v") ? "v" : "h"})`,
  );
  s = s.replace(
    /\b(vorder|hinter)e[sn]?\s+Relief-?(?:stäbchen|stb)\b\.?/giu,
    (_m, side: string) => `Stb (Relief ${side.toLowerCase() === "vorder" ? "v" : "h"})`,
  );

  // Bobble family: the loops in the name are the stitch's definition, not stitches of the
  // row — "5-dc bobble", "bobble of 5 dc", "Noppe aus 5 Stb", "Noppe (5 Stb)" are one BOBBLE.
  // Only the hyphenated form is taken: "3 dc bobble" may be "3 dc, bobble".
  s = s.replace(new RegExp(`\\b\\d+-(?:${LOOP_SPEC_TERMS})\\s+(?=(?:${BOBBLE_WORDS})\\b)`, "giu"), "");
  s = s.replace(
    new RegExp(`\\b(${BOBBLE_WORDS})\\s+(?:of|with|aus|mit)\\s+\\d+\\s*(?:${LOOP_SPEC_TERMS})\\b\\.?`, "giu"),
    "$1",
  );
  s = s.replace(new RegExp(`\\b(${BOBBLE_WORDS})\\s*\\(\\s*\\d+\\s*(?:${LOOP_SPEC_TERMS})\\.?\\s*\\)`, "giu"), "$1");
  // Picots: "ch-3 picot", "3-ch picot", "picot of 3 ch", "Pikot aus 3 Lm" are one PICOT.
  s = s.replace(/\b(?:ch-?\d+|\d+-?ch|Lm-?\d+|\d+-?Lm)[\s-]+(?=(?:picots?|pikots?)\b)/giu, "");
  s = s.replace(/\b(picots?|pikots?)\s+(?:of|with|aus|mit)\s+\d+\s*(?:ch|chains?|Lm|Luftmaschen?)\b\.?/giu, "$1");

  // Increases made of taller stitches (format v2 groups): "hdc inc" = two HDC into one
  // stitch; "3 hdc-inc" / "3hdc inc" = three of them (the counts of real patterns agree).
  // Written with a space and a count, "3 hdc inc" might also mean "3 hdc, inc": flagged.
  let increaseAmbiguous = false;
  s = s.replace(
    new RegExp(`(?<![\\p{L}\\d])(?:(\\d+)\\s*)?(${GROUP_INC_TERMS})(\\s*-\\s*|\\s+)(?:inc|increases?|Zun|Zunahmen?)(?![\\p{L}])`, "giu"),
    (_m, n: string | undefined, term: string, sep: string) => {
      // UK "dc inc" is a plain increase (UK dc = single crochet).
      const group = resolveStitchTerm(term, locale) === "SC" ? inc : `(2 ${term}) in same st`;
      if (n === undefined || Number(n) === 1) return group;
      if (!sep.includes("-")) increaseAmbiguous = true;
      return `${n} x (${group})`;
    },
  );

  // Repeats: "*A* …" → "(A) …"; "*A, rep from * N more times"; "repeat N times" → "x N".
  s = s.replace(/\b(rep(?:eat)?\s+from)\s*\*/giu, "$1 ");
  s = s.replace(/\*([^*]*\p{L}[^*]*)\*/gu, "($1)");
  s = s.replace(
    /^\*\s*(.+?)[,;]?\s*\brep(?:eat)?\s+from\s+(\d+)\s+(more\s+)?times?\b/iu,
    (_m, body: string, n: string, more?: string) => {
      repFrom = { n: Number(n), more: Boolean(more) };
      return `(${body}) x ${Number(n) + (more ? 1 : 0)}`;
    },
  );
  s = s.replace(/\b(?:rep(?:eat)?|wiederholen|wdh)\.?\s*(\d+)\s*(?:times|x|×|mal)?(?=$|[\s,;)\]])/giu, "x $1");
  s = s.replace(/(\d+)\s*(?:x|×|mal)\s*(?:wiederholen|wdh)\.?/giu, "x $1");

  // Several stitches into one stitch: "2 sc in next st" is an increase, "3 sc in one st",
  // "2 hdc in next st", "5 dc in same st", "3 fM in 1 M" are stitch groups (format v2);
  // "3 sc in each st" is such a group in every stitch. "sc in next 5 sts" are 5 sc.
  const intoOne = (m: string, n: string, term: string, fill: boolean): string => {
    const count = groupCount(n);
    const code = resolveStitchTerm(term, locale);
    if (!code || count < 1) return m;
    if (count === 1) return fill ? m : term;
    if (count === 2 && code === "SC") return fill ? m : inc;
    return fill ? `((${count} ${term}) in same st) @` : `(${count} ${term}) in same st`;
  };
  s = s.replace(
    new RegExp(
      `(?<![\\p{L}\\d])${GROUP_COUNT}\\s*(${TERM})\\s+(?:(?:in|into)\\s+(?:each|every)\\s+(?:sts?|stitch(?:es)?|sc)(?:\\s+(?:all\\s+)?around)?|in\\s+jede\\s+(?:M|Masche)(?:\\s+der\\s+Vor(?:runde|reihe))?)(?![\\p{L}])`,
      "giu",
    ),
    (m, n: string, term: string) => intoOne(m, n, term, true),
  );
  s = s.replace(new RegExp(`(?<![\\p{L}\\d])${GROUP_COUNT}\\s*(${TERM})\\s+${INTO_ONE}`, "giu"), (m, n: string, term: string) =>
    intoOne(m, n, term, false),
  );
  s = s.replace(
    new RegExp(`(?<!\\d\\s*)\\b(${TERM})\\s+(?:in|into)\\s+(?:the\\s+)?next\\s+(\\d+)\\s*${ST_WORD}\\b`, "giu"),
    (m, term: string, n: string) => (resolveStitchTerm(term, locale) ? `${n} ${term}` : m),
  );
  // Only a single stitch may lose its "in next st": "2 hdc in next st" stays unreadable.
  s = s.replace(
    new RegExp(`(\\b\\d+\\s*)?(${TERM})\\s+(?:in|into)\\s+(?:the\\s+)?next\\s+(?:st|stitch)\\b`, "giu"),
    (m, count: string | undefined, term: string) =>
      count === undefined || Number(count) === 1 ? `${count ?? ""}${term}` : m,
  );

  // "to the end of the round" phrases → "@".
  for (const re of FILL_PHRASES) s = s.replace(re, " @ ");
  s = s.replace(/@(?:\s*@)+/g, "@").replace(/\s+/g, " ").trim();
  s = s.replace(/@\s*(?:rep(?:eat)?|wiederholen|wdh)\.?$/iu, "@").trim();
  const repAround = /^(.*?)[,;]?\s*\b(?:rep(?:eat)?|wiederholen|wdh)\.?\s*(?:from\s*\*?\s*)?@$/iu.exec(s);
  if (repAround) {
    const head = repAround[1]!.replace(/^\*\s*/, "").trim();
    s = /^\([^()]*\)$/.test(head) ? `${head} @` : `(${head}) @`;
  }
  s = s.replace(/^[,;\s]+/, "").replace(/\s+/g, " ").trim();

  const out: LenientText = { text: s };
  if (stitchCountTarget !== undefined) out.stitchCountTarget = stitchCountTarget;
  if (rowModifier) out.rowModifier = rowModifier;
  if (rounds !== undefined) out.rounds = rounds;
  if (repFrom) out.repFrom = repFrom;
  if (increaseAmbiguous) out.increaseAmbiguous = true;
  return out;
}

/** Fabric stitches an op list produces (as `computeRowStitches`). */
function producedByOps(ops: readonly Op[]): number {
  let total = 0;
  for (const op of ops) {
    total +=
      op.kind === "stitch"
        ? op.count * STITCH_PROPERTIES[op.code].producesStitches
        : (op.kind === "group" ? 1 : op.times) * producedByOps(op.ops);
  }
  return total;
}

/** Longest text the lenient pass reads; longer text only gets the strict pass. */
const MAX_LENIENT_TEXT = 1500;

/** What the parser noticed beyond the result (for the lenient pass's ambiguity checks). */
interface ParseInfo {
  postfixTimes?: { op: StitchOp; times: number };
  hadFill?: boolean;
}

/**
 * Settle the readings the lenient pass cannot decide from the text alone, using the written
 * stitch count: "sc, inc x6" (x6 on the last stitch or on the whole row) and
 * "*…; rep from * 5 times" (5 or 6 repeats).
 */
function settleAmbiguities(
  ops: Op[],
  target: number | undefined,
  info: ParseInfo,
  repFrom: LenientText["repFrom"],
  warnings: ParseRowWarning[],
): Op[] {
  const pt = info.postfixTimes;
  if (pt && !info.hadFill && ops.length >= 2 && ops[ops.length - 1] === pt.op) {
    const wrapped: Op[] = [{ kind: "repeat", times: pt.times, ops: [...ops.slice(0, -1), { ...pt.op, count: 1 }] }];
    if (target === undefined) {
      warnings.push("repeat-scope-ambiguous");
    } else if (producedByOps(ops) !== target) {
      if (producedByOps(wrapped) === target) {
        warnings.push("repeat-scope-guessed");
        return wrapped;
      }
      warnings.push("repeat-scope-ambiguous");
    }
  }
  const first = ops[0];
  if (repFrom && first?.kind === "repeat") {
    const chosen = first.times;
    const other = repFrom.more ? repFrom.n : repFrom.n + 1;
    if (target === undefined) {
      if (!repFrom.more) warnings.push("repeat-count-ambiguous");
    } else if (producedByOps(ops) !== target) {
      first.times = other;
      if (producedByOps(ops) === target) {
        warnings.push("repeat-count-guessed");
      } else {
        first.times = chosen;
        warnings.push("repeat-count-ambiguous");
      }
    }
  }
  return ops;
}

function failureResult(err: ParseFailure): ParseRowResult {
  const failure: ParseRowResult = { ok: false, code: err.code, position: err.position };
  if (err.term !== undefined) failure.term = err.term;
  if (err.limit !== undefined) failure.limit = err.limit;
  return failure;
}

function runParser(
  text: string,
  locale: NotationLocale,
  lenient: boolean,
  context: ParseRowContext,
  rowModifier?: Mod,
  info: ParseInfo = {},
): ParseRowResult {
  const parser = new Parser(tokenize(text, lenient), text, locale, lenient);
  try {
    const ops = parser.parseRow();
    if (rowModifier && applyRowModifier(ops, rowModifier) === 0) throw new ParseFailure("syntax", 0);
    resolveFills(ops, parser.fills, context.previousCount);
    resolveColors(ops, context.colors);
    if (parser.postfixTimes) info.postfixTimes = parser.postfixTimes;
    info.hadFill = parser.fills.length > 0;
    if (countWorkedStitches(ops) > MAX_ROW_STITCHES) {
      return { ok: false, code: "too-large", position: 0, limit: MAX_ROW_STITCHES };
    }
    return parser.stitchCountTarget === undefined
      ? { ok: true, ops }
      : { ok: true, ops, stitchCountTarget: parser.stitchCountTarget };
  } catch (err) {
    if (err instanceof ParseFailure) return failureResult(err);
    throw err;
  }
}

/**
 * Parse row text into ops. `locale` decides terms that differ between notations (UK "dc" =
 * single crochet, US "dc" = double crochet). Errors carry the 0-based position of the
 * problem, and for `unknown-term` the term as written.
 *
 * Two passes. The strict pass reads the compact notation (`renderOps` output plus the
 * tolerances listed at the top of this module). If it fails, a lenient pass reads what real
 * patterns write (US/UK/DE):
 *   - counts after the stitch: `sc 2`, `inc x 6`, `Dec × 9`
 *   - repeats: `(…) repeat 6 times`, `*…* 6 times`, `*…, rep from * 5 more times`
 *   - to the end of the round (needs `context.previousCount`): `(…)*`, `(…) around`,
 *     `… rep around`, `sc around`, `sc in each st`, `inc in each st around`,
 *     `fM rundherum`, `in jede M 1 fM`, `Zun in jede M`
 *   - magic ring starts: `6 sc in MR`, `Make 6 sc into a magic ring`, `MR 6`,
 *     `6 fM in einen Fadenring`
 *   - stitch counts: `= 18`, `= [36]`, `– 18`, `(18 sts)`; `(4 rounds)` comes back as `rounds`
 *   - row-level loops: `BLO: …`, `through back loops only, …`, `… in BLO`,
 *     `nur hinteres Maschenglied: …` (added to every stitch it applies to)
 *   - `sl-st`, en/em dashes, a trailing period, a trailing "turn"
 *   - stitch groups (format v2): `3 sc in next st`, `5 dc in same st`, `3 fM in 1 M`,
 *     `(3 dc, ch 2, 3 dc) in next st`, `3 sc in each st` (needs `previousCount`), `hdc inc`
 *     (two HDC into one stitch), `3 hdc-inc`, `2 hStb-Zun`; `2 sc in next st` stays an INC
 *   - bobble family and picots with their definition in the name: `5-dc bobble`,
 *     `bobble of 5 dc`, `popcorn (5 dc)`, `Noppe aus 5 Stb`, `ch-3 picot`, `Pikot aus 3 Lm`
 *   - relief stitches: `FPdc`, `front post dc`, `Reliefstäbchen vorne`, `Relief-Stb h`
 * Where the text allows two readings ("sc, inc x6", "rep from * 5 times", "3 hdc inc") the
 * written stitch count decides, and the result carries `warnings`. Text longer than 1500 characters or
 * containing "@" only gets the strict pass.
 * The strict pass's error is reported when both fail, unless the lenient pass failed for
 * a reason only it can know (`needs-context`, `fill-mismatch`, `too-large`).
 */
export function parseRowText(
  text: string,
  locale: NotationLocale = "de",
  context: ParseRowContext = {},
): ParseRowResult {
  if (text.replace(/[\s ]/g, "") === "") return { ok: false, code: "empty" };
  const strict = runParser(text, locale, false, context);
  if (strict.ok) return strict;
  // "@" is the lenient pass's internal fill marker; long text is never a single row.
  if (text.length > MAX_LENIENT_TEXT || text.includes("@")) return strict;

  const rewritten = rewriteLenient(text, locale);
  if (rewritten.text === "") return strict;
  const info: ParseInfo = {};
  const lenient = runParser(rewritten.text, locale, true, context, rewritten.rowModifier, info);
  if (lenient.ok) {
    const target = rewritten.stitchCountTarget ?? lenient.stitchCountTarget;
    if (target !== undefined && target > MAX_STITCH_COUNT_TARGET) {
      return { ok: false, code: "too-large", position: 0, limit: MAX_STITCH_COUNT_TARGET };
    }
    const warnings: ParseRowWarning[] = [];
    const ops = settleAmbiguities(lenient.ops, target, info, rewritten.repFrom, warnings);
    if (rewritten.increaseAmbiguous && target === undefined) warnings.push("increase-ambiguous");
    if (countWorkedStitches(ops) > MAX_ROW_STITCHES) {
      return { ok: false, code: "too-large", position: 0, limit: MAX_ROW_STITCHES };
    }
    const result: ParseRowResult = { ok: true, ops };
    if (target !== undefined) result.stitchCountTarget = target;
    if (rewritten.rounds !== undefined) result.rounds = rewritten.rounds;
    if (warnings.length > 0) result.warnings = warnings;
    return result;
  }
  if (lenient.code === "needs-context" || lenient.code === "fill-mismatch") {
    const { position: _ignored, ...rest } = lenient;
    return rest;
  }
  if (lenient.code === "too-large") return lenient;
  return strict;
}
