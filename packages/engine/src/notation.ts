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

import { STITCH_PROPERTIES, type Mod, type Op, type Row, type StitchCode, type StitchOp } from "./schema.js";

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
 * an increase or decrease (sc2tog yes, "inc tog" no).
 */
export function modifierAllowed(code: StitchCode, mod: Mod): boolean {
  const consumes = STITCH_PROPERTIES[code].consumesStitches;
  if (mod === "TOG") return consumes === 1 && code !== "INC";
  return consumes > 0;
}

/**
 * Normalise a modifier list for `code`: duplicates removed (first occurrence kept).
 * Returns null when the list is contradictory (BLO with FLO) or contains a modifier that
 * does not apply to the code.
 */
export function normalizeModifiers(code: StitchCode, mods: readonly Mod[]): Mod[] | null {
  const unique = [...new Set(mods)];
  if (unique.includes("BLO") && unique.includes("FLO")) return null;
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
  },
  en_us: {
    slst: "SL_ST",
    ss: "SL_ST",
    "magic circle": "MR",
    "magic circles": "MR",
    sts: "ST",
  },
  en_uk: {
    "sl st": "SL_ST",
    slst: "SL_ST",
    "magic circle": "MR",
    "magic circles": "MR",
    sts: "ST",
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

function renderStitch(op: StitchOp, locale: NotationLocale): string {
  const text = `${op.count} ${STITCH_ABBREVIATIONS[op.code][locale]}`;
  if (!op.modifiers || op.modifiers.length === 0) return text;
  return `${text} (${op.modifiers.map((m) => MOD_ABBREVIATIONS[m][locale]).join(", ")})`;
}

/** Render a single op (a stitch or a repeat group). */
export function renderOp(op: Op, locale: NotationLocale): string {
  if (op.kind === "stitch") return renderStitch(op, locale);
  if (op.kind === "group") return `(${renderOps(op.ops, locale)}) ${GROUP_WORDS[locale]}`;
  return `${op.times}${TIMES_SIGN[locale]} (${renderOps(op.ops, locale)})`;
}

/** Render an op list as a comma-separated instruction, e.g. `6× (1 fM, 1 Zun)`. */
export function renderOps(ops: readonly Op[], locale: NotationLocale): string {
  return ops.map((op) => renderOp(op, locale)).join(", ");
}

/** Render a row's ops. A row without ops (free instruction) renders to "". */
export function renderRow(row: Row, locale: NotationLocale): string {
  return renderOps(row.ops, locale);
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
  | "invalid-modifier";

export type ParseRowResult =
  | {
      ok: true;
      ops: Op[];
      /** Stitch count written at the end of the text, e.g. the `18` of `… (18)`. */
      stitchCountTarget?: number;
    }
  | {
      ok: false;
      code: ParseRowErrorCode;
      /** The offending term (for `unknown-term` / `invalid-modifier`), as written. */
      term?: string;
      /** 0-based character offset of the problem in the input text. */
      position?: number;
      /** The exceeded maximum (for `too-large`). */
      limit?: number;
    };

type Token =
  | { t: "num"; value: number; pos: number }
  | { t: "word"; text: string; pos: number; end: number }
  | { t: "times"; pos: number }
  | { t: "lp"; pos: number }
  | { t: "rp"; pos: number }
  | { t: "sep"; pos: number }
  | { t: "end"; pos: number }
  | { t: "bad"; pos: number };

const WORD_CHAR = /[\p{L}.\-]/u;
const SPACE = /[\s ]/u;

function tokenize(text: string): Token[] {
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
    } else if (ch === "(" || ch === "[") {
      tokens.push({ t: "lp", pos: i++ });
    } else if (ch === ")" || ch === "]") {
      tokens.push({ t: "rp", pos: i++ });
    } else if (ch === "," || ch === ";") {
      tokens.push({ t: "sep", pos: i++ });
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

class Parser {
  private i = 0;
  stitchCountTarget: number | undefined;

  constructor(
    private readonly tokens: Token[],
    private readonly text: string,
    private readonly locale: NotationLocale,
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
      ops.push(this.parseItem(depth));
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

  /** `( list )` of a repeat group; `()` is an empty group (rendered as `N× ()`). */
  private parseGroupBody(depth: number): Op[] {
    const open = this.next(); // "("
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

    // Postfix repeat: "(1 sc, 1 inc) x6", "(1 fM, 1 Zun) 6 mal"
    if (tok.t === "lp") {
      const ops = this.parseGroupBody(depth);
      let times: number;
      if (this.isTimes(this.peek())) {
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
      return this.parseStitch(this.count(this.next()), depth);
    }

    if (tok.t === "word") return this.parseStitch(1, depth);
    this.fail(tok);
  }

  private parseStitch(count: number, depth: number): StitchOp {
    const first = this.peek();
    if (first.t !== "word") this.fail(first);
    let end = first.end;
    this.next();
    while (this.peek().t === "word") end = (this.next() as { end: number }).end;
    const term = this.text.slice(first.pos, end);
    const code = resolveStitchTerm(term, this.locale);
    if (!code) throw new ParseFailure("unknown-term", first.pos, term);

    const op: StitchOp = { kind: "stitch", code, count };
    if (this.peek().t !== "lp" || (depth === 0 && this.atTrailingCount() !== undefined)) return op;

    // Modifier list: "(hMG)", "(BLO, tog)" — duplicates collapse, contradictions fail.
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
    return op;
  }
}

/**
 * Parse compact row text into ops. `locale` decides terms that differ between notations
 * (UK "dc" = single crochet, US "dc" = double crochet). Errors carry the 0-based position
 * of the problem, and for `unknown-term` the term as written.
 */
export function parseRowText(text: string, locale: NotationLocale = "de"): ParseRowResult {
  if (text.replace(/[\s ]/g, "") === "") return { ok: false, code: "empty" };
  const parser = new Parser(tokenize(text), text, locale);
  try {
    const ops = parser.parseRow();
    if (countWorkedStitches(ops) > MAX_ROW_STITCHES) {
      return { ok: false, code: "too-large", position: 0, limit: MAX_ROW_STITCHES };
    }
    return parser.stitchCountTarget === undefined
      ? { ok: true, ops }
      : { ok: true, ops, stitchCountTarget: parser.stitchCountTarget };
  } catch (err) {
    if (err instanceof ParseFailure) {
      const failure: ParseRowResult = { ok: false, code: err.code, position: err.position };
      if (err.term !== undefined) failure.term = err.term;
      if (err.limit !== undefined) failure.limit = err.limit;
      return failure;
    }
    throw err;
  }
}
