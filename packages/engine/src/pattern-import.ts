/**
 * Whole-pattern import — turn a pattern pasted from a PDF or a web page into parts and rows.
 *
 *   parsePatternText(text) → { locale, parts: [{ id, name, quantity, rows, finish?, stuffing? }],
 *                              issues, preamble, colors, assembly }
 *
 * Plain data, not a BuilderExport: the caller decides what to keep. Nothing of the input is
 * dropped silently — every piece of text ends up in a stitch row, an instruction row
 * (`ops: []`, `note`), the `preamble`, or an `IGNORED` issue (page numbers, "… continued").
 *
 * Format v2 details are read from the instruction sentences in addition (`pattern-details`),
 * the sentences stay instruction rows: colour changes ("In grey.", "cc to white", "With Color
 * A:", "Farbwechsel zu Rot") fill `colors` and set `Row.color` on the next stitch row (the
 * colour then holds, as in the format); "close the hole" / "fold flat and sc through both
 * layers" / "leave open" set `finish`, "stuff firmly / lightly / do not stuff" `stuffing` of the
 * part the section (or the sentence: "stuff the head") is about; "insert the eyes between
 * rounds 8 and 9, 6 sts apart" and "sew the ears to the head between rounds 3 and 5" become
 * `assembly` placements when part, target and round can be found (the angle of a sewn-on part
 * is unknown: 0 and an `ASSEMBLY_ANGLE_GUESSED` info).
 *
 * How the text is read:
 *   - Lines are normalised (NBSP, tabs, CRLF). Materials, abbreviations, notes, size,
 *     copyright and the prose before the first part go to `preamble` (one `PREAMBLE` info
 *     issue per line). Page numbers are ignored with an `IGNORED` issue.
 *   - Part headers: a short header line ("HEAD", "Ears (make 2)", "Legs – make 2",
 *     "For the right leg", "Kopf", "Ohren (2×)", "2 Ohren"), a header at the start of a line
 *     ("Head R 1. …", "EARS The main color 1. …"), or the round numbering restarting at 1
 *     (the header is then searched in the text just before the label). Assembly/finishing
 *     headers do not start a part; their text stays with the current part.
 *   - Row labels may sit anywhere in a line (PDF text often has a whole part on one line):
 *     `R1:`, `R 1.`, `Rnd 1:`, `Round 5:`, `Row 9:`, `Runde 3:`, `Rd. 3`, `1.`, `1)`,
 *     `4 rnd.`, `5.7 sc` (round 5, "7 sc"), ranges `R5-R8`, `Rnd 8 – 9`, `6-8.`,
 *     `Rounds 8-14:`, `R18+R19`, `2-3 rnd.`, `2526.` (= 25–26). A label is accepted when its
 *     number fits the running numbering (next round, a restart at 1, or a word label at the
 *     start of the numbering); mentions like "between Rnd 10 and 11" are not labels.
 *   - A range gives one Row per round. "(4 rounds)" after a range is checked against it
 *     (`RANGE_MISMATCH`); after a single label it expands it.
 *   - The text after a label is split into the longest prefix `parseRowText` reads (with the
 *     previous row's stitch count as context) and the rest, which becomes instruction rows
 *     or further unlabelled rows ("… = 12. (3 sc, inc) × 3 = 15.").
 *   - Stitch groups ("3 sc in next st", "hdc inc"), bobbles, puffs, popcorns, picots and relief
 *     stitches are read into format v2 rows (`parseRowText`).
 *   - Joins to parts read before (`StitchOp.from` / `.through`, B5b) when the text names such
 *     a part: "18 sc around the first leg", "join to the second leg, 18 sc around it", "5 sc
 *     through both layers of the arm and the body"; "N sc with / on / at the arm" is worked
 *     into it when N is all stitches of its last round, else through it; left / right are
 *     copy 1 / 2, a part named twice in a row without a copy is copy 1, then 2 (a copy beyond
 *     the part's quantity raises it, `JOIN_QUANTITY_RAISED`). "N sc in ch" / "on the other
 *     side of the chain" in such a round work into a chain bridge before it (the round is
 *     marked `around` when it needs both sides).
 *   - Text the format cannot represent yet becomes an instruction row with the raw text and
 *     an issue: `UNSUPPORTED_JOIN` (also a round split into branches, "sc the round in
 *     half"), `UNSUPPORTED_SPECIAL_STITCH` (clusters, bullions, shells
 *     …), `UNSUPPORTED_CHAIN_SPACE`; a round closed with a slip stitch is
 *     `UNSUPPORTED_ROUND_JOIN` (info, imported as a spiral round), a colour change without a
 *     name `COLOR_UNNAMED` (info). Unreadable stitch text is `UNREADABLE`.
 *   - A first row "ch 10, 9 sc …" is split into the foundation chain and the row worked
 *     into it (that is how the stitch graph represents a foundation chain).
 *   - Oval starts — a round worked around both sides of a foundation chain ("sc in 2nd ch
 *     from hook, 4 sc, 3 sc in last ch, working on the other side of the chain: 4 sc, inc",
 *     "on the opposite side", "on the back of the chain", "crochet around the ch", "unroll"
 *     right after a chain, "auf der anderen Seite der Luftmaschenkette weiter", "um die Kette
 *     herum") — become one round with `Row.around` after the chain: the side-switch phrases
 *     are dropped, a second half on a line of its own is added to the first. One that names
 *     the other side but has no chain before it or does not read stays an instruction with
 *     `UNSUPPORTED_FOUNDATION_OVAL`; a mere mention without stitches is a plain note.
 *     Elsewhere "unroll the crochet" between stitches turns the work.
 *   - The declared stitch count is kept as `stitchCountTarget` even when it is wrong, so
 *     `validate` reports the author's mistake. Without a declared count the computed count
 *     is used.
 *
 * Deterministic: ids come from `options.makeId` (default: "import-1", "import-2", …).
 * Pure function, no I/O, no framework imports.
 */

import type { Placement } from "./assembly.js";
import { LOCALE_CONFIDENCE_THRESHOLD, detectNotationLocale } from "./detect-locale.js";
import { rowOrdinals } from "./expand.js";
import { extractJoins, type JoinNotationPart } from "./join-notation.js";
import { parseRowText, resolveStitchTerm, type NotationLocale, type ParseRowResult } from "./notation.js";
import {
  MAX_DETAIL_SENTENCE,
  colorChangeOf,
  colorKey,
  eyeSizeOf,
  findPartByWord,
  finishStatementOf,
  hexFromMaterials,
  hexOfColor,
  placementOf,
  sentencesOf,
  slugOf,
  stuffingsOf,
  type PlacementDraft,
  type StuffingStatement,
} from "./pattern-details.js";
import type { Finish, JoinRef, Op, Row, Stuffing } from "./schema.js";
import { computeRowStitches } from "./stitch-count.js";
import { anchorsConsumed, anchorsOffered, isChainRow, rowWorksFromOtherPart } from "./validate.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ImportIssueCode =
  /** Looks like stitches but could not be read; kept as an instruction row. */
  | "UNREADABLE"
  /**
   * A stitch the format has no code for: clusters (several stitches closed together),
   * bullions, spike stitches, "lump of 5 dc", and shells / V-stitches that only the pattern's
   * own abbreviations define. (Bobble, puff, popcorn, picot, relief stitches and stitch groups
   * are read since format v2.)
   */
  | "UNSUPPORTED_SPECIAL_STITCH"
  /**
   * Joining parts while crocheting that could not be read: the text names no part of the
   * pattern ("5 sc with the leg" without a part "leg"), or the row does not read. Joins that
   * name a part are read since B5b ("18 sc around the first leg", "5 sc with the arm").
   */
  | "UNSUPPORTED_JOIN"
  /**
   * A join named a copy of a part that has fewer ("6 sc with the right leg" on "Legs" without
   * "make 2"): the part's quantity was raised to that copy (informational).
   */
  | "JOIN_QUANTITY_RAISED"
  /** Working into chain spaces. */
  | "UNSUPPORTED_CHAIN_SPACE"
  /**
   * An oval start (a round worked around both sides of a foundation chain) that could not be
   * read: no chain before it, or stitches that do not read.
   */
  | "UNSUPPORTED_FOUNDATION_OVAL"
  /** A colour change without a colour the importer can name ("change colour"); informational. */
  | "COLOR_UNNAMED"
  /** An attached part was placed at the front (angle 0): the text gives no angle (informational). */
  | "ASSEMBLY_ANGLE_GUESSED"
  /**
   * A stuffing, finish or placement sentence that names no part it can be given to (an
   * assembly section without a named part, "stuff the tip", "sew on the tail" without where);
   * it stays text only (informational).
   */
  | "DETAIL_UNASSIGNED"
  /** A placement at a round its part does not have (with stitches); it stays text only (informational). */
  | "PLACEMENT_ROUND_UNKNOWN"
  /** A round closed with a slip stitch; imported as a spiral round (informational). */
  | "UNSUPPORTED_ROUND_JOIN"
  /** "sc around" / "(…)*" without a known previous stitch count. */
  | "NEEDS_PREVIOUS_COUNT"
  /** "To the end of the round" does not fit the previous stitch count. */
  | "FILL_MISMATCH"
  /** A range label and its "(n rounds)" note disagree. */
  | "RANGE_MISMATCH"
  /** The round numbering skips numbers. */
  | "LABEL_GAP"
  /** The line was moved to `preamble` (materials, abbreviations, intro …). */
  | "PREAMBLE"
  /** The line was ignored (page number, "… continued"). */
  | "IGNORED"
  /** The notation (DE/US/UK) was guessed with low confidence; the user should confirm it. */
  | "LOCALE_UNCERTAIN"
  /** A repeat's scope or count was decided by the written stitch count (informational). */
  | "REPEAT_GUESSED"
  /** A repeat can be read two ways and the written count does not decide it. */
  | "AMBIGUOUS_REPEAT"
  /** "3 hdc inc" without a written count: read as three HDC increases, may be "3 hdc, inc". */
  | "AMBIGUOUS_INCREASE";

export type ImportIssueSeverity = "info" | "warning";

export interface ImportIssue {
  /** 1-based line number in the input text. */
  line: number;
  /** The text the issue is about (as written). */
  text: string;
  code: ImportIssueCode;
  severity: ImportIssueSeverity;
  message?: string;
  partIndex?: number;
  rowIndex?: number;
}

export interface ImportedPart {
  /**
   * Stable id within the import ("head", "ears", "head-and-body", "teil-1"), derived from the
   * name and unique; `assembly` refers to parts by it.
   */
  id: string;
  name: string;
  quantity: number;
  /** Rows; `Row.color` holds a colour change (palette id of `colors`) from that row on. */
  rows: Row[];
  /** From "close the hole" (gather), "fold flat and sc through both layers" (flat), "leave open" (open). */
  finish?: Finish;
  /** From "stuff firmly" / "stuff lightly" / "do not stuff" / "stuff as you go" (firm). */
  stuffing?: Stuffing;
}

export interface PatternImport {
  locale: NotationLocale;
  /** Confidence of the locale detection (1 when the locale was given). */
  localeConfidence: number;
  parts: ImportedPart[];
  issues: ImportIssue[];
  /** Lines that are not pattern content: materials, abbreviations, notes, intro text. */
  preamble: string[];
  /**
   * Palette of the colours named in colour changes ("In grey.", "cc to white", "With Color A:",
   * "Farbwechsel zu Rot"), in order of appearance. Ids are slugs of the names ("grey",
   * "main-color"); `hex` only for common colour names.
   */
  colors: ImportedColor[];
  /**
   * Placements read from the text: safety eyes ("insert the eyes between rounds 8 and 9, 6 st
   * apart") and sewn-on parts ("sew the ears to the head between rounds 3 and 5"). `part` and
   * `target` are `ImportedPart.id`s, `row` a row id of the target. The sentences also stay as
   * instruction rows.
   */
  assembly: Placement[];
}

/** A palette colour of the import (the shape of `BuilderOverview.colors` entries). */
export interface ImportedColor {
  id: string;
  name: string;
  hex?: string;
}

export interface ParsePatternOptions {
  /** Notation locale; detected from the text when omitted. */
  locale?: NotationLocale;
  /** Row id generator (inject `crypto.randomUUID` in apps; the default is deterministic). */
  makeId?: () => string;
}

const SEVERITY: Record<ImportIssueCode, ImportIssueSeverity> = {
  UNREADABLE: "warning",
  UNSUPPORTED_SPECIAL_STITCH: "warning",
  UNSUPPORTED_JOIN: "warning",
  JOIN_QUANTITY_RAISED: "info",
  UNSUPPORTED_CHAIN_SPACE: "warning",
  UNSUPPORTED_FOUNDATION_OVAL: "warning",
  COLOR_UNNAMED: "info",
  ASSEMBLY_ANGLE_GUESSED: "info",
  DETAIL_UNASSIGNED: "info",
  PLACEMENT_ROUND_UNKNOWN: "info",
  UNSUPPORTED_ROUND_JOIN: "info",
  NEEDS_PREVIOUS_COUNT: "warning",
  FILL_MISMATCH: "warning",
  RANGE_MISMATCH: "warning",
  LABEL_GAP: "info",
  PREAMBLE: "info",
  IGNORED: "info",
  LOCALE_UNCERTAIN: "warning",
  REPEAT_GUESSED: "info",
  AMBIGUOUS_REPEAT: "warning",
  AMBIGUOUS_INCREASE: "warning",
};

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Words that name a crocheted part (lower case; matched capitalised in headers). */
const PART_WORDS = new Set(
  (
    "head body ear ears arm arms leg legs foot feet hand hands paw paws tail muzzle snout nose eye eyes " +
    "eyelid eyelids cheek cheeks wing wings fin fins horn horns antler antlers hat cap scarf mane hair beak " +
    "mouth tooth teeth belly tummy stem leaf leaves pumpkin finger fingers toe toes heel handle handles shell " +
    "base top bottom flower petal petals sleeve sleeves collar bow spot spots eyebrow eyebrows bill " +
    "kopf körper rumpf ohr ohren arme bein beine fuß füße hände pfote pfoten schwanz schnauze nase auge augen " +
    "wange wangen flügel flosse flossen hörner mütze schal mähne haare schnabel bauch stiel blatt blätter " +
    "kürbis zeh zehen ferse henkel blüte blüten ärmel kragen schleife"
  ).split(" "),
);

/** Header words of an assembly/finishing section: no new part, text stays with the part. */
const ASSEMBLY = /^(?:assembly|assembling|finishing|finish|making\s+up|montage|zusammennähen|zusammensetzen|fertigstellung|fertigstellen)\b/iu;

/** Shouty words that are not part headers. */
const NOT_HEADER_CAPS = new Set([
  "NOTE",
  "NOTES",
  "TIP",
  "TIPS",
  "IMPORTANT",
  "CONGRATS",
  "CONGRATULATIONS",
  "END",
  "BLO",
  "FLO",
  "INC",
  "DEC",
  "USA",
  "PDF",
  "DIY",
  "WICHTIG",
  "HINWEIS",
  "ENDE",
]);

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  ten: 10,
  ein: 1,
  eine: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  zehn: 10,
};
const NUMBER_WORD = Object.keys(NUMBER_WORDS).join("|");

const numberOf = (word: string): number => {
  const n = Number(word);
  return Number.isFinite(n) && n > 0 ? n : (NUMBER_WORDS[word.toLowerCase()] ?? 1);
};

/** Lines that are never pattern content, wherever they are. */
const PREAMBLE_START =
  /^\s*(?:materials?|materialien|material|you\s+will\s+need|you'll\s+need|supplies|tools|abbreviations?|abkürzungen|abkürzung|glossary|legende|size|finished\s+size|größe|skill(?:\s+level)?|difficulty|schwierigkeit(?:sgrad)?|gauge|maschenprobe|yarn|garn|hook(?:\s+size)?|nadel(?:stärke)?|copyright|©|\(c\)|pattern\s+by|design(?:ed)?\s+by|www\.|https?:)(?![\p{L}])/iu;
/** Lines that are preamble only before the pattern starts (later they are instructions). */
const PREAMBLE_NOTES = /^\s*(?:notes?|hinweise?|anmerkungen?|helpful\s+tips|tips)(?![\p{L}])/iu;
const PREAMBLE_ANYWHERE = /©|\ball\s+rights\s+reserved\b|\balle\s+rechte\s+vorbehalten\b/iu;
const PAGE_ARTIFACT = /^\s*(?:(?:page|seite|pg\.?|s\.)\s*)?[-–—]?\s*\d{1,3}\s*(?:(?:\/|of|von)\s*\d{1,3})?\s*[-–—]?\s*$/iu;
const CONTINUED = /\b(?:continued|cont\.|fortsetzung|fortgesetzt)\b/iu;

/** Line starts that make a short line an instruction rather than a header. */
const INSTRUCTION_START =
  /^(?:in|with|using|mit|stuff|fill|sew|insert|place|fasten|finish|cut|fold|flatten|change|switch|leave|embroider|attach|pull|close|weave|turn|repeat|continue|work|make|crochet|do|don't|use|join|füllen|annähen|nähe|nähen|schneide|abketten|faden|wechsle|wechseln|augen|weiter|häkle|häkeln|wiederhole)\b/iu;

/** Words that make a text an instruction for the person, not unreadable stitches. */
const INSTRUCTION_WORDS =
  /\b(?:insert|place|eyes?|nose|stuff(?:ing)?|fill|sew|embroider|fasten|attach|fold|flatten|leave|cut|weave|pull|close|between|apart|tail|yarn|thread|needle|layers|füllen|annähen|nähen|Augen?|Nase|zwischen|auseinander|Faden|abketten|zusammennähen|schließen|sticken)\b/iu;

const OVAL_CHAIN = String.raw`(?:the\s+)?(?:foundation\s+)?(?:chains|chain|ch)(?![\p{L}-])`;
const OVAL_THEN = String.raw`(?:\b(?:then|now|and)\s+)?`;
const OVAL_VERB = String.raw`(?:\b(?:continue|work(?:ing)?|crochet(?:ing)?)\s+)?`;
/**
 * Phrases that name an oval start — a round worked around both sides of a foundation chain:
 * "working on the other side of the chain", "on the opposite side", "crochet around the ch",
 * "around the chain:" (the builder's own mark), "both sides of the chain", "auf der anderen
 * Seite der Luftmaschenkette weiter", "um die Kette herum". Not "the back (side) of the
 * chain": that is also where a flat row is worked into the back bumps (`OVAL_WEAK`).
 */
const OVAL_STRONG = new RegExp(
  [
    String.raw`${OVAL_THEN}${OVAL_VERB}\b(?:on|along|into|in|down|up)\s+(?:the\s+)?(?:other|opposite|second|reverse)\s+side(?:\s+of\s+${OVAL_CHAIN})?`,
    String.raw`${OVAL_THEN}(?:\b(?:work(?:ing)?|crochet(?:ing)?)\s+)?\ba?round\s+(?:both\s+sides\s+of\s+)?${OVAL_CHAIN}`,
    String.raw`${OVAL_THEN}${OVAL_VERB}\balong\s+both\s+sides\s+of\s+${OVAL_CHAIN}`,
    String.raw`${OVAL_THEN}${OVAL_VERB}(?:\bon\s+)?\bboth\s+sides\s+of\s+${OVAL_CHAIN}`,
    String.raw`(?:\bund\s+)?\b(?:auf|an)\s+der\s+(?:anderen|gegenüberliegenden)\s+Seite(?:\s+der\s+(?:Lm-?|Luftmaschen-?)?kette)?(?:\s+weiter(?:häkeln)?)?`,
    String.raw`(?:\brund\s+)?\bum\s+die\s+(?:Lm-?|Luftmaschen-?)?Kette(?:\s+herum)?(?:\s+(?:weiter)?häkeln)?`,
  ].join("|"),
  "iu",
);
/**
 * "On the back of the chain": the other side of the chain in an oval start, but also the back
 * bumps a flat row is worked into — an oval only when the round works more places than the
 * chain has.
 */
const OVAL_WEAK = new RegExp(String.raw`${OVAL_THEN}${OVAL_VERB}\b(?:on|along|into|in)\s+the\s+back\s+of\s+${OVAL_CHAIN}`, "iu");
/** A page reference ("pg. 11", "page 3", "Seite 4", "S. 2"). */
const PAGE_REF = /\b(?:pages?|pg|p|seiten?|s)\.?\s*\d+/giu;
/** A foundation chain written in a row's text: "ch 7", "chain 7", "7 ch", "8 Lm". */
const CHAIN_IN_TEXT = /\b(?:ch|chain)\s*\d+|\b\d+\s*(?:ch|chains?|Lm|Luftmaschen?)(?![\p{L}])|\bLm\s*\d+/iu;
/** All oval phrases (`OVAL_STRONG`, `OVAL_WEAK`); global: `ovalText` removes them all. */
const OVAL_PHRASES = new RegExp(`${OVAL_STRONG.source}|${OVAL_WEAK.source}`, "giu");
/** Whether a text names an oval start for sure (`OVAL_STRONG`). */
const OVAL = OVAL_STRONG;
/**
 * "Unroll / unfold (the crochet)": translated patterns say so for turning the chain over to
 * its other side (an oval start, right after a foundation chain) — and for turning the work.
 */
const OVAL_TURN = /\b(?:unroll|unfold)(?:ing)?(?:\s+(?:the\s+)?(?:crochet(?:ing)?|knit(?:ting)?|work(?:ing)?|piece))?(?![\p{L}])/iu;

/**
 * The text of an oval round as one stitch list: the side-switch phrases (`OVAL_PHRASES`,
 * "unroll") and the sentence breaks and colons between the two halves become commas
 * ("Ch 6. Crochet around the ch. 4 sc, 3 sc in last ch. Working on the other side: 3 sc,
 * inc" → "Ch 6, 4 sc, 3 sc in last ch, 3 sc, inc"). German ordinals ("2. Lm") stay.
 */
function ovalText(text: string): string {
  // A count after the first half ("… 3 sc in last ch (8). On the other side: …") is no row end.
  let s = text;
  const counts = [...text.matchAll(COUNT_TERMINATOR)];
  for (const m of counts.slice(0, -1).reverse()) s = `${s.slice(0, m.index)},${s.slice(m.index + m[0].length)}`;
  return s
    .replace(OVAL_PHRASES, ",")
    .replace(new RegExp(OVAL_TURN.source, "giu"), ",")
    .replace(/\n/g, ", ")
    .replace(/(\d*)\.(?=\s)/gu, (m: string, digits: string, at: number, s: string) =>
      digits && /^\s+(?:Lm|Luftmasche|M\b|Masche)/u.test(s.slice(at + m.length)) ? m : `${digits},`,
    )
    .replace(/:(?=\s)/g, ",")
    .replace(/\s*,(?:\s*,)+/g, ",")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,\s*(?=[[(]\s*\d+\s*(?:sts?|stitches|maschen|m)?\s*[\])]\s*$)/iu, " ")
    .replace(/,\s*(?=(?:=|->|→)\s*\d)/u, " ");
}
/**
 * A round split into two openings that are worked on separately ("sc the round in half",
 * "split the round into two circles", "Runde in zwei Hälften teilen"): a branch the importer
 * cannot read yet. Not "fold in half" (a flat finish) or "the last two rounds".
 */
const SPLIT =
  /\b(?:round|circle|opening)\s+in\s+(?:half|two)\b|\bsplit\s+(?:the\s+)?(?:round|circle|work|opening)\b|\binto\s+two\s+(?:separate\s+)?(?:circles|openings|holes|branches)\b|(?<![\p{L}])(?:Runde|Öffnung)\s+(?:in\s+zwei\s+(?:Hälften|Teile|Kreise|Öffnungen)\s+)?teilen(?![\p{L}])|(?<![\p{L}])in\s+zwei\s+(?:Hälften|Kreise|Öffnungen)\s+teilen(?![\p{L}])/iu;
const JOIN =
  /\b\d+\s*(?:sc|fM|sts?|hdc|dc|M|sl\s*st)\s+(?:with|on|onto|at|to|into|from|of|mit|am|an|auf)\s+(?:the\s+|dem\s+|der\s+|den\s+)?(?:(?:left|right|first|second|other|next|1st|2nd|linken|rechten|ersten|zweiten|anderen)\s+)?(?:legs?|arms?|handles?|ears?|foot|feet|fingers?|toes?|body|head|parts?|pieces?|paws?|Bein|Beine|Beinen|Arm|Arme|Armen|Fuß|Körper|Kopf|Teil)\b|\bjoin(?:ing)?\s+(?:the\s+)?(?:two\s+|both\s+)?(?:legs?|arms?|parts?|pieces?)\b|\b(?:Beine|Teile)\s+(?:verbinden|zusammenhäkeln)\b/iu;
/** Words for which copy of a part ×2 is meant: left = first, right = second. */
const SIDE_WORDS: Record<string, string> = {
  left: "first",
  right: "second",
  linken: "ersten",
  linke: "erste",
  linkes: "erste",
  rechten: "zweiten",
  rechte: "zweite",
  rechtes: "zweite",
};
const JOIN_ORDINAL = "left|right|first|second|other|1st|2nd|linken|linke|linkes|rechten|rechte|rechtes|ersten|erste|zweiten|zweite|anderen";
const JOIN_STITCH = "sc|fM|hdc|hStb|dc|Stb|sts?|M|sl\\s*st|Km";
/** Prepositions that say "joined" without saying how: decided by the count (see `joinPhrases`). */
const JOIN_LOOSE = "with|on|onto|at|to|mit|am|an|auf";

/** Provisional id of work part `i` in join references, replaced by its final id in `finish`. */
const workId = (i: number) => `wp${i}`;

/**
 * Join phrases of pattern text in the form the notation reads (`extractJoins`), for the parts
 * `parts` (with their stitch count `count` at the end):
 *   - "N sc with / on / at the (left|right|first|second) X": all stitches of X's last round
 *     → "around X" (worked into it, `from`); fewer → "through X" (through both layers);
 *   - "join to the second leg, 18 sc around (it)" → "18 sc around the second leg";
 *   - left / right become first / second (copy 1 / copy 2).
 */
function joinPhrases(text: string, parts: ReadonlyArray<JoinNotationPart & { count: number }>): string {
  if (parts.length === 0) return text;
  const forms: Array<{ form: string; part: (typeof parts)[number] }> = [];
  for (const p of parts) {
    const name = p.name?.trim().toLowerCase() ?? "";
    if (name.length < 2) continue;
    const set = new Set([name, name.replace(/(?:es|s|e|n)$/u, ""), `${name}s`]);
    for (const f of set) if (f.length >= 2) forms.push({ form: f, part: p });
  }
  if (forms.length === 0) return text;
  forms.sort((a, b) => b.form.length - a.form.length);
  const names = forms.map((f) => f.form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const side = (w: string | undefined) => (w ? `${SIDE_WORDS[w.toLowerCase()] ?? w} ` : "");
  let out = text.replace(
    new RegExp(`\\bjoin(?:ing)?\\s+(?:it\\s+)?to\\s+(?:the\\s+)?(?:(${JOIN_ORDINAL})\\s+)?(${names})\\s*[,;]?\\s*(?:and\\s+)?(?:work\\s+)?(\\d+)\\s*(${JOIN_STITCH})\\s+(?:a?round|in\\s+each\\s+st(?:itch)?)(?:\\s+(?:it|of\\s+it|the\\s+leg))?\\b`, "giu"),
    (_m, ord: string | undefined, name: string, n: string, stitch: string) => `${n} ${stitch} around the ${side(ord)}${name}`,
  );
  // "9 sc in ch", "9 sc on the other side of the chain": into the bridge before the round.
  out = out.replace(
    new RegExp(
      `\\b(\\d+\\s*(?:${JOIN_STITCH}))\\s+(?:in(?:to)?|along|on)\\s+(?:the\\s+|each\\s+)?(?:other\\s+side\\s+of\\s+(?:the\\s+)?)?(?:\\d+\\s+)?(?:ch|chains?|chain\\s+sts?|Lm)\\b`,
      "giu",
    ),
    "$1",
  );
  out = out.replace(
    new RegExp(`\\b(\\d+)\\s*(${JOIN_STITCH})\\s+(?:${JOIN_LOOSE})\\s+(?:the\\s+|dem\\s+|der\\s+|den\\s+|das\\s+)?(?:(${JOIN_ORDINAL})\\s+)?(${names})(?![\\p{L}])`, "giu"),
    (_m, n: string, stitch: string, ord: string | undefined, name: string) => {
      const hit = forms.find((f) => f.form === name.toLowerCase());
      const how = hit && Number(n) === hit.part.count ? "around" : "through";
      return `${n} ${stitch} ${how} the ${side(ord)}${name}`;
    },
  );
  return out;
}

/** Join references of `ops` in working order (a repeat's body once). */
function joinRefsOf(ops: readonly Op[], out: JoinRef[] = []): JoinRef[] {
  for (const op of ops) {
    if (op.kind === "stitch") {
      const ref = op.from ?? op.through;
      if (ref) out.push(ref);
    } else joinRefsOf(op.ops, out);
  }
  return out;
}

/**
 * Stitches the format has no code for (bobble, puff, popcorn, picot, relief stitches and
 * groups are read since format v2): clusters, bullions, spike and crab stitches, "a lump of
 * 5 dc", and shells / V-stitches, which only the pattern's own abbreviations define.
 */
const SPECIAL =
  /\b(?:clusters?|cl\d|bubble|bullion|spike|crab\s+st(?:itch)?|reverse\s+sc|lump\s+of|unbound|shells?|V-?st(?:itch)?(?:es)?|Muschel\w*|Krebsmaschen?)\b/iu;
const CHAIN_SPACE = /\b(?:ch-?sp(?:ace)?s?|chain[- ]spaces?|ch\s+spaces?|ch-loops?|Luftmaschenbogen|Lm-?Bogen|LmB)\b/iu;

/** A slip-stitch join that closes a round — dropped from the row, reported as info. */
const ROUND_JOIN =
  /[,;]?\s*(?:join|close)\s+(?:the\s+round\s+)?with\s+(?:a\s+)?(?:sl\s*st|ss|slip\s+stitch)(?:\s+(?:in|into|to)\s+(?:the\s+)?(?:first|1st|beg(?:inning)?|top)\s+[\p{L}]+)?|[,;]?\s*(?:sl\s*st|ss|slip\s+stitch)\s+(?:in|into|to)\s+(?:the\s+)?(?:first|1st|beg(?:inning)?|top)\s+(?:st|stitch|sc|ch|of\s+[\p{L}]+)(?:\s+to\s+join)?|[,;]?\s*(?:sl\s*st|ss)\s+to\s+join|[,;]?\s*mit\s+(?:einer\s+)?(?:Km|Kettm(?:asche)?)\s+(?:in\s+die\s+erste\s+M(?:asche)?\s+)?schließen/giu;
const RING_WORD = /\b(?:MR|magic\s+(?:ring|circle|loop)|adjustable\s+ring)\b|Fadenring|magische[nmr]?\s+Ring/iu;
/** ", pull tight to close", ", Ring zusammenziehen" after a magic ring start. */
const RING_CLOSE =
  /[,;]\s*(?:and\s+|then\s+)?pull\s+(?:the\s+(?:ring|tail)\s+|it\s+)?(?:tight(?:ly)?|closed)(?:\s+to\s+close)?(?:\s+the\s+(?:ring|MR))?|[,;]\s*(?:den\s+)?(?:Fadenring|Ring)\s+zusammenziehen/giu;
const COUNT_NOTE = /\(\s*(?:does\s+not|doesn't|not)\s+count[^)]*\)|\(\s*zählt\s+nicht[^)]*\)/giu;

/** Count terminators: "(18)", "[18]", "(18 sts)", "= 18", "= [18]", "– 18". */
const COUNT_TERMINATOR =
  /(?:\(\s*\d+\s*(?:sts?|stitches|st\.|m|maschen)?\s*\)|\[\s*\d+\s*(?:sts?|m)?\s*\]|(?:=|–|—|→)\s*[[(]?\s*\d+\s*[\])]?)(?:\s*\(\s*\d+\s*(?:rounds?|rows?|rnds?|runden|reihen)\s*\))?\.?/giu;
const ROUNDS_NOTE = /\(\s*(\d+)\s*(?:rounds?|rows?|rnds?|rds?|runden|reihen)\s*\)/iu;
const FILL_HINT = /\b(?:around|each|every|across|jede|alle|rundherum|rundenende)\b|\*|\bMR\b|magic|fadenring/iu;

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

type LabelKind = "word" | "suffix" | "bare" | "weak" | "fuzzy";

interface LabelHit {
  index: number;
  end: number;
  start: number;
  last: number;
  kind: LabelKind;
  /** Labelled "Row"/"Reihe": a turned row. */
  rowWord: boolean;
  /** "(n rounds)" right after the label. */
  annotated?: number;
  text: string;
  line: number;
}

const ROUND_WORD = "(?:R|Rnds?|Rds?|Rounds?|Rows?|Runden?|Reihen?)";
const DASH = "(?:-|–|—)";
const WORD_LABEL = new RegExp(
  `(?<![\\p{L}\\d])(${ROUND_WORD})\\.?\\s*(\\d{1,3})(?:\\s*(?:${DASH}|to|bis|\\+|&|and|und)\\s*(?:${ROUND_WORD}\\.?\\s*)?(\\d{1,3}))?(?:\\s*\\(\\s*(\\d+)\\s*(?:rounds?|rows?|rnds?|runden|reihen)\\s*\\))?\\s*(?:[:.)]|${DASH}(?!\\s*\\d)|(?=\\s)|$)`,
  "giu",
);
const SUFFIX_LABEL = new RegExp(
  `(?<![\\p{L}\\d.(])(\\d{1,3})(?:\\s*${DASH}\\s*(\\d{1,3}))?\\.?\\s*(?:rnds?|rounds?|rows?|runden?|reihen?|rd)\\.?(?![\\p{L}])\\s*:?`,
  "giu",
);
const BARE_LABEL = new RegExp(
  `(?<![\\p{L}\\d.,])(\\d{1,4})(?:\\.?\\s*${DASH}\\s*(\\d{1,3}))?\\s*([.):])(?=\\s|\\d|\\(|$)`,
  "gu",
);
const WEAK_LABEL = /(?:^|(?<=[)\]]\s?))\s*(\d{1,3})(?=\s*\()/gu;
const FUZZY_LABEL = /(?<![\p{L}\d])(R\p{Ll}{1,4})\.?\s+(\d{1,3})\s*:/gu;

const REJECT_BEFORE = new Set(
  (
    "between and und zwischen repeat rep wiederhole wiederholen from to bis of after nach before vor until " +
    "rounds rows round row rnds rnd runden runde reihen reihe in on at with mit see siehe pg page photo step x"
  ).split(" "),
);

function rejectedByContext(line: string, index: number, end: number, kind: LabelKind): boolean {
  // Only the text just around the candidate matters (and long lines stay linear).
  const before = line.slice(Math.max(0, index - 60), index).trimEnd();
  const lastChar = before.slice(-1);
  if (lastChar && "=×*([/".includes(lastChar)) return true;
  const word = /([\p{L}]+)\.?$/u.exec(before)?.[1]?.toLowerCase();
  if (word && REJECT_BEFORE.has(word)) return true;
  // "ab der 2. Lm", "in die 3. Masche": a German ordinal, not a label.
  if (line.slice(index, end).trimEnd().endsWith(".") && /^\s*(?:Lm|Luftmaschen?|M|Maschen?)(?![\p{L}])/u.test(line.slice(end, end + 20))) {
    return true;
  }
  if (kind === "bare" || kind === "suffix") {
    // "3.25 mm", "2. 5 cm": a measurement, not a label.
    if (/^\s*(?:\d+(?:[.,]\d+)?\s*)?(?:(?:mm|cm|g|m|inch|in)(?![\p{L}])|%|"|')/iu.test(line.slice(end, end + 40))) return true;
  }
  return false;
}

function findLabels(line: string, lineNo: number): LabelHit[] {
  const hits: LabelHit[] = [];
  const push = (m: RegExpExecArray, kind: LabelKind, a: string, b: string | undefined, rowWord: boolean, ann?: string) => {
    const start = Number(a);
    let last = b === undefined ? start : Number(b);
    if (last < start) last = start;
    const hit: LabelHit = { index: m.index, end: m.index + m[0].length, start, last, kind, rowWord, text: m[0].trim(), line: lineNo };
    if (ann !== undefined) hit.annotated = Number(ann);
    hits.push(hit);
  };
  for (const m of line.matchAll(WORD_LABEL)) {
    const w = m[1]!.toLowerCase();
    push(m, "word", m[2]!, m[3], w.startsWith("row") || w.startsWith("reihe"), m[4]);
  }
  for (const m of line.matchAll(SUFFIX_LABEL)) {
    push(m, "suffix", m[1]!, m[2], /row|reihe/iu.test(m[0]));
  }
  for (const m of line.matchAll(BARE_LABEL)) {
    // "(12)" is a stitch count, not a label.
    if (m[3] === ")" && line.slice(0, m.index).trimEnd().endsWith("(")) continue;
    push(m, "bare", m[1]!, m[2], false);
  }
  for (const m of line.matchAll(WEAK_LABEL)) {
    const offset = m[0].length - m[0].trimStart().length;
    const hit: LabelHit = {
      index: m.index + offset,
      end: m.index + m[0].length,
      start: Number(m[1]),
      last: Number(m[1]),
      kind: "weak",
      rowWord: false,
      text: m[1]!,
      line: lineNo,
    };
    hits.push(hit);
  }
  for (const m of line.matchAll(FUZZY_LABEL)) push(m, "fuzzy", m[2]!, undefined, false);
  const priority: Record<LabelKind, number> = { word: 0, suffix: 1, fuzzy: 2, bare: 3, weak: 4 };
  return hits.sort((x, y) => x.index - y.index || priority[x.kind] - priority[y.kind]);
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

interface Header {
  name: string;
  quantity: number;
  assembly: boolean;
}

function titleCase(name: string): string {
  const letters = name.replace(/[^\p{L}]/gu, "");
  const fixed = letters.length > 1 && letters === letters.toUpperCase() ? name.toLowerCase() : name;
  return fixed.charAt(0).toUpperCase() + fixed.slice(1);
}

function parseHeader(text: string): Header {
  let s = text.trim().replace(/\s+/g, " ");
  let quantity = 1;
  const take = (re: RegExp) => {
    const m = re.exec(s);
    if (!m) return false;
    quantity = numberOf(m[1]!);
    s = (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).trim();
    return true;
  };
  take(new RegExp(`\\(\\s*(?:make|mache|häkle|x|×)?\\s*(\\d+|${NUMBER_WORD})\\s*(?:x|×|mal|pcs|pieces|stück|teile)?\\s*\\)`, "iu")) ||
    take(new RegExp(`[-–—,:]?\\s*\\b(?:make|mache|häkle)\\s+(\\d+|${NUMBER_WORD})\\b`, "iu")) ||
    take(/\b(\d+)\s*[x×](?![\p{L}])/u) ||
    take(/(?<![\p{L}])[x×]\s*(\d+)\b/u) ||
    take(new RegExp(`^(\\d+|${NUMBER_WORD})\\s+(?=\\p{L})`, "iu"));
  s = s.replace(/^(?:for|für)\s+(?:the|den|das|die)\s+/iu, "");
  s = s.replace(/[\s:\-–—,.]+$/u, "").replace(/^[\s:\-–—,.]+/u, "").trim();
  const name = s === "" ? "" : titleCase(s);
  return { name, quantity, assembly: ASSEMBLY.test(name) };
}

const isPartWord = (word: string) => PART_WORDS.has(word.toLowerCase());
const isCapsHeaderWord = (word: string, locale: NotationLocale) =>
  word.length >= 3 && /^\p{Lu}+$/u.test(word) && !NOT_HEADER_CAPS.has(word) && !resolveStitchTerm(word, locale);

/** A whole line that is a part header ("Ears (make 2)", "HEAD", "Kopf:", "2 Ohren"). */
function isStandaloneHeader(line: string, locale: NotationLocale): boolean {
  const s = line.trim();
  const core = s.replace(/:$/, "").trim();
  if (core === "" || core.length > 50) return false;
  const words = core.split(/\s+/);
  if (words.length > 6) return false;
  if (INSTRUCTION_START.test(core) || CONTINUED.test(core) || PREAMBLE_START.test(core)) return false;
  if (/[.!?]$/.test(core)) return false;
  if (findLabels(core, 0).some((h) => h.kind === "word" && h.index === 0)) return false;
  if (parseRowText(core, locale).ok) return false;
  const quantity = new RegExp(`\\((?:make|mache|x|×)?\\s*(?:\\d+|${NUMBER_WORD})\\s*(?:x|×)?\\)|\\bmake\\s+(?:\\d+|${NUMBER_WORD})\\b|^(?:\\d+|zwei|two|drei|three)\\s+\\p{L}|\\d\\s*[x×](?![\\p{L}])`, "iu").test(core);
  const bare = core.replace(/\([^)]*\)/g, "").replace(/^(?:for|für)\s+(?:the|den|das|die)\s+/iu, "");
  const letters = bare.match(/[\p{L}]+/gu) ?? [];
  if (letters.length === 0) return false;
  if (!quantity && /\d/.test(bare)) return false;
  if (letters.some((w) => resolveStitchTerm(w, locale) && !isPartWord(w))) return false;
  // Every word must look like part of a name: "Kopf füllen" is an instruction.
  if (!letters.every((w) => /^\p{Lu}/u.test(w) || isPartWord(w) || HEADER_FILLER.test(w))) return false;
  if (letters.some(isPartWord) || isCapsHeaderWord(letters[0]!, locale) || quantity) return true;
  // An unknown name ("Bunny", "Sock Monkey"): up to three capitalised words.
  return letters.length <= 3;
}

/** Lower-case words allowed in a header next to the name. */
const HEADER_FILLER =
  /^(?:and|und|of|the|der|die|das|left|right|front|back|upper|lower|inner|outer|small|big|large|little|first|second|make|mache|häkle|rechte[rsn]?|linke[rsn]?|kleine[rsn]?|große[rsn]?|vordere[rsn]?|hintere[rsn]?|obere[rsn]?|untere[rsn]?|erste[rsn]?|zweite[rsn]?)$/iu;

/**
 * A header at the start of a longer line: "Head R 1. …", "EARS The main color 1. …",
 * "Fins(Make 2): With Color A: …", "Body We continue …". Returns where the header ends.
 */
function lineLeadingHeader(line: string, locale: NotationLocale): { end: number; text: string; continued: boolean } | null {
  const m = new RegExp(
    `^\\s*((?:\\p{Lu}[\\p{L}]*)(?:\\s+(?:and|und|&)\\s+\\p{Lu}[\\p{L}]*)?)\\s*(\\((?:[^)]{0,24})\\)|[-–—]\\s*make\\s+\\S+)?\\s*:?`,
    "u",
  ).exec(line);
  if (!m) return null;
  const words = m[1]!.split(/\s+(?:and|und|&)\s+/u);
  const ok = words.every((w) => isPartWord(w) || isCapsHeaderWord(w, locale) || ASSEMBLY.test(w));
  if (!ok) return null;
  const rest = line.slice(m[0].length);
  const continued = /^\s*\(?(?:continued|cont\.|fortsetzung|fortgesetzt)/iu.test(rest);
  if (!continued && rest.trim() !== "" && !/^\s*(?:\p{Lu}|\d|\(|\[)/u.test(rest) && !m[0].trimEnd().endsWith(":")) {
    return null;
  }
  return { end: m[0].length, text: m[0], continued };
}

/** Last place in `text` where a part header starts (for a numbering restart). */
function lastHeaderStart(text: string, locale: NotationLocale): number {
  let found = -1;
  let assembly = -1;
  for (const m of text.matchAll(/(?<![\p{L}\d])(\p{Lu}[\p{L}]*)/gu)) {
    const w = m[1]!;
    if (ASSEMBLY.test(w)) assembly = m.index;
    if (isCapsHeaderWord(w, locale) || (isPartWord(w) && /^\p{Lu}\p{Ll}/u.test(w))) found = m.index;
  }
  // "Assembly Head and Body:" is one assembly heading, not the part "Body".
  if (assembly >= 0 && (found < 0 || assembly > found || !/[.!?]/.test(text.slice(assembly, found)))) return assembly;
  return found;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function normalizeLine(line: string): string {
  return line.replace(/[\u00a0\u2007\u202f\t]/g, " ").replace(/\s+$/u, "");
}

function looksLikeStitches(text: string, locale: NotationLocale): boolean {
  const words = text.match(/[\p{L}][\p{L}.\-]*/gu) ?? [];
  const numbers = (text.match(/\d+/g) ?? []).length;
  let stitch = 0;
  for (const w of words) {
    if (resolveStitchTerm(w, locale) || /^(?:inc|dec|mr|sts?)$/iu.test(w)) stitch++;
  }
  if (stitch === 0) return false;
  return (stitch + numbers) / (words.length + numbers) >= 0.35;
}

/** Whether `text` has a counted stitch ("3 sc", "6 fM", "2 inc"): stitch text, never a plain note. */
function hasCountedStitch(text: string, locale: NotationLocale): boolean {
  for (const m of text.matchAll(/\b\d+\s*([\p{L}][\p{L}.\-]*)/gu)) {
    const word = m[1]!.replace(/\.$/, "");
    if (resolveStitchTerm(word, locale) || /^(?:inc|dec)$/iu.test(word)) return true;
  }
  return false;
}

/** Count of the last count terminator in `text`, if any. */
function declaredCount(text: string): number | undefined {
  let value: number | undefined;
  for (const m of text.matchAll(COUNT_TERMINATOR)) {
    const n = /(\d+)/.exec(m[0].replace(ROUNDS_NOTE, ""));
    if (n) value = Number(n[1]);
  }
  return value;
}

/**
 * Candidate cut positions, longest first: the end, after count terminators, sentence ends,
 * line breaks, and before a capitalised word ("16 sc For the right leg"). German capitalises
 * every noun, so there only before a part name or an instruction word ("16 fM Kopf füllen"),
 * never inside "…, 4 M Abstand".
 */
function cutPoints(text: string, locale: NotationLocale): number[] {
  const cuts = new Set<number>([text.length]);
  for (const m of text.matchAll(COUNT_TERMINATOR)) cuts.add(m.index + m[0].length);
  for (const m of text.matchAll(new RegExp(ROUNDS_NOTE.source, "giu"))) cuts.add(m.index + m[0].length);
  // After a sentence end; at a line break (so what follows starts on its own line).
  for (const m of text.matchAll(/[.!?;](?=\s+[\p{Lu}\d*([]|\s*\n|\s*$)|\n/gu)) {
    cuts.add(m[0] === "\n" ? m.index : m.index + 1);
  }
  for (const m of text.matchAll(/\s(?=(\p{Lu}\p{Ll}[\p{L}]*))/gu)) {
    const word = m[1]!;
    if (locale !== "de" || isPartWord(word) || INSTRUCTION_START.test(word) || ASSEMBLY.test(word)) cuts.add(m.index);
  }
  return [...cuts].sort((a, b) => b - a).slice(0, 40);
}

/** Clause boundaries where an instruction may end and a row begin (at most 40). */
function clauseBoundaries(text: string): number[] {
  const cuts: number[] = [];
  for (const m of text.matchAll(/[.;:,!?](?=\s)|\n/gu)) {
    cuts.push(m.index + 1);
    if (cuts.length >= 40) break;
  }
  return cuts;
}

const MAX_ROW_TEXT = 400;

interface Split {
  result: Extract<ParseRowResult, { ok: true }>;
  end: number;
}

// ---------------------------------------------------------------------------
// Importer
// ---------------------------------------------------------------------------

interface WorkPart extends Omit<ImportedPart, "id" | "finish" | "stuffing"> {
  implicit: boolean;
  expected: number;
  hasLabels: boolean;
  lastCount?: number;
  lastType: Row["type"];
  /** The heading text that started the part. */
  source?: Piece;
  /** Started in assembly mode and has no stitch rows (yet). */
  assembly?: boolean;
  /** Row id per labelled round number ("Rnd 8" → id), for placements. */
  roundIds: Map<number, string>;
  /** A colour change read in an instruction, for the next stitch row (palette id). */
  pendingColor?: string;
}

/** A stuffing or finish sentence, resolved to a part when the import is finished. */
interface PartStatement {
  section: WorkPart;
  /** Read in an assembly/finishing section: it applies only to a part it names. */
  assembly: boolean;
  stuffings: StuffingStatement[];
  finish?: { finish: Finish; weak: boolean };
  note: string;
  line: number;
  /** Index of the instruction row in `section` when it was read. */
  rowIndex: number;
}

/** What resolving statements and placements needs of the finished import. */
interface Resolve {
  parts: ImportedPart[];
  /** The work part of every final part (same index). */
  kept: WorkPart[];
  finalOf: (work: WorkPart) => { part: ImportedPart; index: number; offset: number } | undefined;
  here: (work: WorkPart, assembly: boolean) => ImportedPart | undefined;
  named: (words: readonly string[], except?: ImportedPart) => ImportedPart | undefined;
  issueAt: (code: ImportIssueCode, work: WorkPart, rowIndex: number, line: number, text: string, message: string) => void;
}

/** A placement sentence, resolved to parts and a row when the import is finished. */
interface PlacementNote {
  section: WorkPart;
  assembly: boolean;
  draft: PlacementDraft;
  note: string;
  line: number;
  rowIndex: number;
}

interface Piece {
  text: string;
  line: number;
}

type Pending = { kind: "round"; label: LabelHit; pieces: Piece[] } | { kind: "free"; pieces: Piece[] };

class Importer {
  readonly parts: WorkPart[] = [];
  readonly issues: ImportIssue[] = [];
  /** Preamble lines with their line numbers (output sorted by line). */
  readonly preamble: Piece[] = [];
  private current: WorkPart | null = null;
  private pending: Pending | null = null;
  /** After an "Assembly"/"Finishing" header, until a part gets stitch rows again. */
  private inAssembly = false;
  /** Palette of the colours named in colour changes, in order of appearance. */
  readonly colors: ImportedColor[] = [];
  private readonly statements: PartStatement[] = [];
  private readonly placements: PlacementNote[] = [];
  /** The next stitch row `stitchRows` adds is an oval round (`Row.around`). */
  private aroundNext = false;

  constructor(
    private readonly locale: NotationLocale,
    private readonly makeId: () => string,
  ) {}

  // -- issues and rows ------------------------------------------------------

  issue(code: ImportIssueCode, line: number, text: string, message?: string, rowIndex?: number): void {
    const issue: ImportIssue = { line, text: text.trim(), code, severity: SEVERITY[code] };
    if (message) issue.message = message;
    if (this.current && code !== "PREAMBLE" && code !== "IGNORED") {
      issue.partIndex = this.parts.indexOf(this.current);
      if (rowIndex !== undefined) issue.rowIndex = rowIndex;
    }
    this.issues.push(issue);
  }

  private part(): WorkPart {
    if (!this.current) this.startPart(null);
    return this.current!;
  }

  /**
   * Start a new part (or name the empty implicit one). An assembly header starts no part:
   * it switches to assembly mode, where parts without stitch rows are merged back into the
   * part before them (see `finish`).
   */
  startPart(header: Header | null, source?: Piece): void {
    const cur = this.current;
    if (header?.assembly) {
      this.inAssembly = true;
      return;
    }
    if (cur && cur.implicit && cur.rows.length === 0) {
      if (header) {
        cur.name = header.name || cur.name;
        cur.quantity = header.quantity;
        cur.implicit = false;
        if (source) cur.source = source;
      }
      return;
    }
    const part: WorkPart = {
      name: header?.name || `Teil ${this.parts.length + 1}`,
      quantity: header?.quantity ?? 1,
      rows: [],
      implicit: !header?.name,
      expected: 1,
      hasLabels: false,
      lastType: "round",
      roundIds: new Map(),
    };
    if (source) part.source = source;
    if (this.inAssembly) part.assembly = true;
    // "Change to pink." right before a new part's header: the new part starts in pink.
    if (cur?.pendingColor) {
      part.pendingColor = cur.pendingColor;
      cur.pendingColor = undefined;
    }
    this.parts.push(part);
    this.current = part;
  }

  /**
   * The finished parts. A heading without any rows (a title, a lone "Assembly") is moved to
   * the preamble; implicit parts are numbered "Teil n" by their final position.
   */
  finish(): { parts: ImportedPart[]; issues: ImportIssue[]; assembly: Placement[] } {
    // Assembly sections ("Fins: 1. Thread your needle …") go back into the part before them.
    const merged: WorkPart[] = [];
    const moved = new Map<number, { index: number; offset: number }>();
    /** Assembly sections merged into the part before them. */
    const mergedSections = new Set<WorkPart>();
    this.parts.forEach((part, i) => {
      const prev = merged[merged.length - 1];
      if (part.assembly && prev) {
        mergedSections.add(part);
        if (part.source) {
          const note = part.source.text.trim();
          prev.rows.push({ id: this.makeId(), type: prev.lastType, ops: [], stitchCountTarget: 0, note });
        }
        moved.set(i, { index: merged.length - 1, offset: prev.rows.length });
        prev.rows.push(...part.rows);
        return;
      }
      moved.set(i, { index: merged.length, offset: 0 });
      merged.push(part);
    });
    for (const issue of this.issues) {
      if (issue.partIndex === undefined) continue;
      const to = moved.get(issue.partIndex)!;
      issue.partIndex = to.index;
      if (issue.rowIndex !== undefined) issue.rowIndex += to.offset;
    }

    const kept: WorkPart[] = [];
    const newIndex = new Map<number, number>();
    merged.forEach((part, i) => {
      if (part.rows.length > 0) {
        newIndex.set(i, kept.length);
        kept.push(part);
      } else if (part.source) {
        this.preamble.push({ text: part.source.text.trim(), line: part.source.line });
        this.issues.push({
          line: part.source.line,
          text: part.source.text.trim(),
          code: "PREAMBLE",
          severity: SEVERITY.PREAMBLE,
          message: "Heading without rows.",
        });
      }
    });
    for (const issue of this.issues) {
      if (issue.partIndex === undefined) continue;
      const mapped = newIndex.get(issue.partIndex);
      if (mapped === undefined) delete issue.partIndex;
      else issue.partIndex = mapped;
    }
    const ids = new Set<string>();
    const parts: ImportedPart[] = kept.map((p, i) => {
      const name = p.implicit ? `Teil ${i + 1}` : p.name;
      return { id: uniqueId(slugOf(name), ids), name, quantity: p.quantity, rows: p.rows };
    });
    // Joins named the work parts by provisional ids: now the final ones.
    const finalId = new Map<string, string>();
    this.parts.forEach((work, i) => {
      const to = moved.get(i);
      const index = to === undefined ? undefined : newIndex.get(to.index);
      if (index !== undefined) finalId.set(workId(i), parts[index]!.id);
    });
    for (const p of parts) {
      for (const row of p.rows) {
        for (const ref of joinRefsOf(row.ops)) {
          const id = finalId.get(ref.part);
          if (id) ref.part = id;
        }
      }
    }

    // Where a work part ended up: the final part, and the offset of its rows there.
    const finalOf = (work: WorkPart): { part: ImportedPart; index: number; offset: number } | undefined => {
      const to = moved.get(this.parts.indexOf(work));
      const index = to === undefined ? undefined : newIndex.get(to.index);
      return index === undefined ? undefined : { part: parts[index]!, index, offset: to!.offset };
    };
    const named = (words: readonly string[], except?: ImportedPart): ImportedPart | undefined => {
      for (const word of words) {
        const hit = findPartByWord(word, parts);
        if (hit && hit !== except) return hit;
      }
      return undefined;
    };

    // Issues about a sentence, at the row it ended up in.
    const flagged = new Set<string>();
    const issueAt = (code: ImportIssueCode, work: WorkPart, rowIndex: number, line: number, text: string, message: string) => {
      const key = `${code}:${line}:${text}`;
      if (flagged.has(key)) return;
      flagged.add(key);
      const issue: ImportIssue = { line, text, code, severity: SEVERITY[code], message };
      const at = finalOf(work);
      if (at) {
        issue.partIndex = at.index;
        issue.rowIndex = rowIndex + at.offset;
      }
      this.issues.push(issue);
    };
    // The part a sentence is about when it names none: the part of its section. In an
    // assembly/finishing section only a sub-section that names a part ("Ears:") — never the
    // part that happened to come last.
    const here = (work: WorkPart, assembly: boolean): ImportedPart | undefined =>
      assembly ? (mergedSections.has(work) ? findPartByWord(work.name, parts) : undefined) : finalOf(work)?.part;
    const ctx: Resolve = { parts, kept, finalOf, here, named, issueAt };
    this.resolveStatements(ctx);
    const assembly = this.resolvePlacements(ctx);
    // "Color A" gets the display colour the materials give it ("Color A: Gray").
    const materials = this.preamble.map((p) => p.text);
    for (const color of this.colors) {
      if (color.hex) continue;
      const hex = hexFromMaterials(color.name, materials);
      if (hex) color.hex = hex;
    }
    const issues = [...this.issues].sort((a, b) => a.line - b.line);
    return { parts, issues, assembly };
  }

  /**
   * Stuffing and finish per part from the sentences that said so (see `PartStatement`).
   * Finish: the last finishing sentence after the part's last stitch row counts (a "close" in
   * the middle of the part is about something else); "leave a tail for sewing" only when no
   * other sentence there closes the part. Stuffing: a clause that names a part
   * applies to that part, one that names something else ("stuff the tip") to none; a specific
   * statement ("do not stuff", "stuff lightly") beats a plain "stuff", the first specific one
   * counts. A sentence that cannot be given a part gets a `DETAIL_UNASSIGNED` issue.
   */
  private resolveStatements(ctx: Resolve): void {
    const lastStitch = (part: ImportedPart) => part.rows.reduce((last, r, i) => (r.ops.length > 0 ? i : last), -1);
    const generic = new Set<ImportedPart>();
    /** Parts whose finish so far only comes from "leave a tail for sewing". */
    const weak = new Set<ImportedPart>();
    const unassigned = (st: PartStatement, what: string) =>
      ctx.issueAt("DETAIL_UNASSIGNED", st.section, st.rowIndex, st.line, st.note, `${what} names no part of the pattern; kept as text only.`);
    for (const st of this.statements) {
      const own = ctx.here(st.section, st.assembly);
      if (st.finish) {
        if (!own) {
          unassigned(st, "The finishing sentence");
        } else {
          const at = ctx.finalOf(st.section);
          const position = st.assembly || !at ? Number.POSITIVE_INFINITY : st.rowIndex + at.offset;
          // The last finishing sentence after the last stitch row wins; a weak one only
          // when nothing else has closed the part.
          if (position > lastStitch(own) && (!st.finish.weak || own.finish === undefined || weak.has(own))) {
            own.finish = st.finish.finish;
            if (st.finish.weak) weak.add(own);
            else weak.delete(own);
          }
        }
      }
      for (const stuffing of st.stuffings) {
        let part: ImportedPart | undefined;
        if (stuffing.object !== undefined) part = findPartByWord(stuffing.object, ctx.parts);
        else part = (stuffing.words ? ctx.named(stuffing.words) : undefined) ?? own;
        if (!part) {
          unassigned(st, "The stuffing sentence");
          continue;
        }
        if (stuffing.specific) {
          if (part.stuffing === undefined || generic.has(part)) {
            part.stuffing = stuffing.value;
            generic.delete(part);
          }
        } else if (part.stuffing === undefined) {
          part.stuffing = stuffing.value;
          generic.add(part);
        }
      }
    }
  }

  /**
   * Placements whose parts and round can be found; the others stay instruction text only and
   * get an issue (`DETAIL_UNASSIGNED`: no part; `PLACEMENT_ROUND_UNKNOWN`: no such round). A
   * part with round labels is matched by its labels only ("between rounds 2 and 3" in a part
   * numbered 13–18 is no round of it), a part without labels by the position of its rows.
   */
  private resolvePlacements(ctx: Resolve): Placement[] {
    const { parts, kept, here, named, issueAt } = ctx;
    const eyeSize = eyeSizeOf(this.preamble.map((p) => p.text));
    const rowOf = (part: ImportedPart, round: number): string | undefined => {
      const work = kept[parts.indexOf(part)];
      if (work && work.roundIds.size > 0) return work.roundIds.get(round);
      const ordinals = rowOrdinals(part.rows);
      const i = part.rows.findIndex((r, k) => r.ops.length > 0 && ordinals[k] === round);
      return i >= 0 ? part.rows[i]!.id : undefined;
    };
    const out: Placement[] = [];
    const eyesOn = new Set<string>();
    for (const p of this.placements) {
      const { draft } = p;
      const own = here(p.section, p.assembly);
      let part: ImportedPart | undefined;
      let target: ImportedPart | undefined;
      if (draft.kind === "attach") {
        target = named(draft.targetWords);
        part = target ? (named(draft.objectWords, target) ?? own) : undefined;
      } else {
        target = named(draft.targetWords) ?? own;
      }
      if (!target || (draft.kind === "attach" && (!part || part === target))) {
        issueAt("DETAIL_UNASSIGNED", p.section, p.rowIndex, p.line, p.note, "The placement does not name the parts it joins; kept as text only.");
        continue;
      }
      const row = rowOf(target, draft.round);
      if (!row) {
        issueAt(
          "PLACEMENT_ROUND_UNKNOWN",
          p.section,
          p.rowIndex,
          p.line,
          p.note,
          `${target.name} has no round ${draft.round} with stitches; the placement is kept as text only.`,
        );
        continue;
      }
      if (draft.kind === "eyes") {
        if (eyesOn.has(target.id)) continue; // one pair of eyes per part; later mentions repeat it
        eyesOn.add(target.id);
      }
      const placement: Placement = { id: `placement-${out.length + 1}`, kind: draft.kind, target: target.id, row, angle: 0 };
      if (part) placement.part = part.id;
      if (draft.spacing !== undefined) placement.spacing = draft.spacing;
      const size = draft.size ?? (draft.kind === "eyes" ? eyeSize : undefined);
      if (size !== undefined && size > 0) placement.size = size;
      // The sentence stays an instruction row anyway; only embroidery needs it to say what.
      if (draft.kind === "embroidery") placement.note = p.note;
      out.push(placement);
      if (draft.kind === "attach") {
        issueAt(
          "ASSEMBLY_ANGLE_GUESSED",
          p.section,
          p.rowIndex,
          p.line,
          p.note,
          `${part!.name} placed on ${target.name} at the front (angle 0); the text gives no angle.`,
        );
      }
    }
    return out;
  }

  /** A palette id for a colour name (`colorKey`: case and spellings of the main colour aside). */
  private colorId(name: string): string {
    const key = colorKey(name);
    const known = this.colors.find((c) => colorKey(c.name) === key);
    if (known) return known.id;
    const color: ImportedColor = { id: uniqueId(slugOf(name), new Set(this.colors.map((c) => c.id))), name };
    const hex = hexOfColor(name);
    if (hex) color.hex = hex;
    this.colors.push(color);
    return color.id;
  }

  /**
   * Read the details of an instruction (format v2): colour changes (for the next stitch row),
   * stuffing, finish and placements. The text itself stays an instruction row. Sentences
   * longer than `MAX_DETAIL_SENTENCE` are not read.
   */
  private harvest(note: string, line: number, rowIndex: number): void {
    const part = this.part();
    const assembly = this.inAssembly;
    let unnamed = false;
    for (const sentence of sentencesOf(note)) {
      if (sentence.length > MAX_DETAIL_SENTENCE) continue;
      const color = colorChangeOf(sentence);
      if (color?.name) part.pendingColor = this.colorId(color.name);
      else if (color) unnamed = true;
      const stuffings = stuffingsOf(sentence);
      const finish = finishStatementOf(sentence);
      if (stuffings.length > 0 || finish) {
        const statement: PartStatement = { section: part, assembly, stuffings, note: sentence, line, rowIndex };
        if (finish) statement.finish = finish;
        this.statements.push(statement);
      }
      const draft = placementOf(sentence);
      if (draft) this.placements.push({ section: part, assembly, draft, note: sentence, line, rowIndex });
    }
    if (unnamed) this.issue("COLOR_UNNAMED", line, note, "A colour change without a colour name.", rowIndex);
  }

  private pushRow(row: Omit<Row, "id">): number {
    const part = this.part();
    part.rows.push({ id: this.makeId(), ...row });
    return part.rows.length - 1;
  }

  private instruction(text: string, line: number, codes: ImportIssueCode[] = []): void {
    const note = text.trim().replace(/\s*\n\s*/g, " ");
    if (note === "") return;
    const part = this.part();
    const rowIndex = this.pushRow({ type: part.lastType, ops: [], stitchCountTarget: 0, note });
    // A row that joins parts but does not read stays a join that was not read.
    if (codes.includes("UNREADABLE") && JOIN.test(note)) codes = [...codes, "UNSUPPORTED_JOIN"];
    // A round split into branches (seal's tail): the rounds after it belong to new parts.
    if (SPLIT.test(note)) codes = [...codes, "UNSUPPORTED_JOIN"];
    for (const code of new Set(codes)) this.issue(code, line, note, undefined, rowIndex);
    this.harvest(note, line, rowIndex);
  }

  /** Issues for stitch-like text that cannot be represented (empty: nothing found). */
  private unsupported(text: string, blockingOnly: boolean): ImportIssueCode[] {
    const codes: ImportIssueCode[] = [];
    // An oval start that is read never gets here (`ovalRound`); a mere mention ("see page 11
    // for working on the other side of the chain") is no stitch text, and without a chain to
    // work around "on the other side" means something else.
    if (OVAL.test(text) && looksLikeStitches(text, this.locale) && this.chainContext(text) && !this.readsJoin(text)) {
      codes.push("UNSUPPORTED_FOUNDATION_OVAL");
    }
    if (JOIN.test(text) && !this.readsJoin(text)) codes.push("UNSUPPORTED_JOIN");
    if (blockingOnly) return codes;
    if (SPECIAL.test(text)) codes.push("UNSUPPORTED_SPECIAL_STITCH");
    if (CHAIN_SPACE.test(text)) codes.push("UNSUPPORTED_CHAIN_SPACE");
    return codes;
  }

  /**
   * Add parsed stitch rows (a range repeats the row), splitting a leading foundation chain.
   * `labelled`: `first`…`last` are round numbers of the text (for placements). A colour
   * change read before goes on the first row.
   */
  private stitchRows(
    result: Split["result"],
    first: number,
    last: number,
    type: Row["type"],
    line: number,
    raw: string,
    labelled = false,
  ): void {
    const part = this.part();
    if (part.assembly) {
      part.assembly = false;
      this.inAssembly = false;
    }
    let ops = result.ops;
    const hasPrevious = part.rows.some((r) => r.ops.length > 0);
    const head = ops[0];
    if (
      !hasPrevious &&
      ops.length > 1 &&
      head?.kind === "stitch" &&
      head.code === "CH" &&
      head.count >= 2 &&
      !JSON.stringify(ops).includes('"MR"')
    ) {
      const chain: Omit<Row, "id"> = { type, ops: [head], stitchCountTarget: 0 };
      if (part.pendingColor) chain.color = part.pendingColor;
      part.pendingColor = undefined;
      this.pushRow(chain);
      ops = ops.slice(1);
    }
    this.settleJoinCopies(ops, line, raw);
    const firstIndex = part.rows.length;
    // An oval round: read by `ovalRound`, or written with the mark ("around the chain: …").
    let around = this.aroundNext || result.around === true;
    this.aroundNext = false;
    // "9 ch, 12 sc around the leg, 9 sc in the ch, 12 sc around the other leg, 9 sc": a round
    // worked into other parts and along both sides of the bridge before it.
    const before = part.rows.filter((r) => r.ops.length > 0);
    const bridge = before[before.length - 1];
    if (!around && type === "round" && bridge && isChainRow(bridge) && joinRefsOf(ops).length > 0) {
      const own = anchorsConsumed({ id: "", type, ops, stitchCountTarget: 0 });
      if (own > anchorsOffered(bridge) && own <= 2 * anchorsOffered(bridge)) around = true;
    }
    for (let n = first; n <= last; n++) {
      const row: Omit<Row, "id"> = { type, ops: JSON.parse(JSON.stringify(ops)) as Op[], stitchCountTarget: 0 };
      if (around && n === first) {
        row.around = true;
        row.type = "round";
      }
      row.stitchCountTarget = result.stitchCountTarget ?? computeRowStitches({ id: "", ...row });
      if (part.pendingColor) row.color = part.pendingColor;
      part.pendingColor = undefined;
      this.pushRow(row);
      if (labelled && !part.roundIds.has(n)) part.roundIds.set(n, part.rows[part.rows.length - 1]!.id);
      part.lastCount = row.stitchCountTarget;
    }
    part.lastType = type;
    for (const warning of result.warnings ?? []) {
      const code: ImportIssueCode =
        warning === "increase-ambiguous"
          ? "AMBIGUOUS_INCREASE"
          : warning.endsWith("-guessed")
            ? "REPEAT_GUESSED"
            : "AMBIGUOUS_REPEAT";
      const message =
        warning === "repeat-scope-guessed"
          ? "Read the repeat as covering the whole row, because only that matches the stitch count."
          : warning === "repeat-count-guessed"
            ? "Chose the number of repeats that matches the stitch count."
            : warning === "increase-ambiguous"
              ? 'Read "3 hdc inc" as three HDC increases; it may also mean "3 hdc, inc". Please check this row.'
              : "The repeat can be read two ways; please check this row.";
      this.issue(code, line, raw, message, firstIndex);
    }
  }

  // -- joins between parts (B5b) -----------------------------------------------

  /**
   * The other parts read so far, as join phrases name them: provisional ids (`workId`),
   * names, quantities, rows and the stitch count of their last row.
   */
  private joinParts(): Array<JoinNotationPart & { count: number }> {
    const out: Array<JoinNotationPart & { count: number }> = [];
    this.parts.forEach((p, i) => {
      if (p === this.current || p.implicit) return;
      const last = [...p.rows].reverse().find((r) => r.ops.length > 0);
      out.push({ id: workId(i), name: p.name, quantity: p.quantity, rows: p.rows, count: last ? anchorsOffered(last) : 0 });
    });
    return out;
  }

  /**
   * Whether `ops`, read with joins, would work only into another part although the current
   * part already has a stitch row of its own (which would then stay unworked).
   */
  private leavesOwnRowUnworked(ops: readonly Op[]): boolean {
    if (joinRefsOf(ops).length === 0) return false;
    const row: Row = { id: "probe", type: "round", ops: [...ops], stitchCountTarget: 0 };
    if (!rowWorksFromOtherPart(row) || anchorsConsumed(row) > 0) return false;
    return this.part().rows.some((r) => r.ops.length > 0);
  }

  /** Whether the join phrases of `text` name parts of the pattern (they are then read). */
  private readsJoin(text: string): boolean {
    const parts = this.joinParts();
    return parts.length > 0 && extractJoins(joinPhrases(text, parts), parts).joins.length > 0;
  }

  /**
   * Copies of a part ×2 named twice in a row without saying which ("12 sc on the leg, …,
   * 12 sc on the leg"): the first is copy 1, the second copy 2. A copy beyond the part's
   * quantity raises it (`JOIN_QUANTITY_RAISED`).
   */
  private settleJoinCopies(ops: readonly Op[], line: number, raw: string): void {
    const refs = joinRefsOf(ops);
    if (refs.length === 0) return;
    const byPart = new Map<string, JoinRef[]>();
    for (const r of refs) byPart.set(r.part, [...(byPart.get(r.part) ?? []), r]);
    for (const [id, list] of byPart) {
      const work = this.parts[Number(id.slice(2))];
      if (!work) continue;
      if (list.length >= 2 && list.every((r) => r.copy === undefined)) list.forEach((r, k) => (r.copy = k + 1));
      const most = Math.max(...list.map((r) => r.copy ?? 1));
      if (most > work.quantity) {
        this.issue("JOIN_QUANTITY_RAISED", line, raw, `A join names copy ${most} of "${work.name}"; its quantity was set to ${most}.`);
        work.quantity = most;
      }
    }
  }

  /**
   * Longest prefix of `text` (at a cut point) that reads as a row. A readable prefix that
   * still names something the format cannot represent is `blocked` instead of accepted.
   */
  private splitPrefix(
    text: string,
    requireSubstance: boolean,
  ): Split | { fill?: ImportIssueCode; blocked?: ImportIssueCode[] } {
    let fill: ImportIssueCode | undefined;
    for (const cut of cutPoints(text, this.locale)) {
      const prefix = text.slice(0, cut).trim();
      if (prefix === "" || prefix.length > MAX_ROW_TEXT) continue;
      if (requireSubstance && !/\d/.test(prefix) && !FILL_HINT.test(prefix)) continue;
      const parts = this.joinParts();
      // Join phrases are read in the form the notation knows ("6 sc with the leg" → "through").
      const result = parseRowText(parts.length > 0 ? joinPhrases(prefix, parts) : prefix, this.locale, {
        previousCount: this.part().lastCount,
        ...(parts.length > 0 ? { parts } : {}),
      });
      if (result.ok) {
        if (result.ops.length === 0) continue;
        const blocked = this.unsupported(prefix, false);
        if (blocked.length > 0) return { blocked };
        // A join in the middle of a part that would leave the own previous row unworked
        // ("12 sc on the head" in a body round) is doubtful: keep it as a hint.
        if (this.leavesOwnRowUnworked(result.ops)) return { blocked: ["UNSUPPORTED_JOIN"] };
        return { result, end: cut };
      }
      if (!fill && result.code === "needs-context") fill = "NEEDS_PREVIOUS_COUNT";
      if (!fill && result.code === "fill-mismatch") fill = "FILL_MISMATCH";
    }
    return fill ? { fill } : {};
  }

  // -- oval start -------------------------------------------------------------

  /** The current part's rows with stitches. */
  private stitchRowsOfPart(): Row[] {
    return this.part().rows.filter((r) => r.ops.length > 0);
  }

  /**
   * Whether `text` has a chain to work around: the part's last stitch row is a foundation
   * chain, or the part has no stitch rows yet and the text names a chain ("ch 7", "8 Lm").
   */
  private chainContext(text: string): boolean {
    const rows = this.stitchRowsOfPart();
    if (rows.length > 0) return isChainRow(rows[rows.length - 1]!);
    return CHAIN_IN_TEXT.test(text);
  }

  /**
   * An oval round (worked around both sides of a foundation chain) in `text`: it names one
   * (`OVAL_STRONG`; or `OVAL_WEAK` / "unroll" when the round works more places than the chain
   * has and its label is no "Row" — else they are back bumps or a turn), and there is a chain
   * to work around — the part's last stitch row, or a chain at the start of the text in a part
   * without stitch rows (`stitchRows` splits it off). Returns the round read as one stitch
   * list (`ovalText`) and the text after its count; `"unread"` when it is one but cannot be
   * read; null when the text is no oval round.
   */
  private ovalRound(text: string, rowLabel = false): { result: Split["result"]; rest: string } | "unread" | null {
    const named = OVAL.test(text);
    if (!named && !OVAL_WEAK.test(text) && !OVAL_TURN.test(text)) return null;
    const rows = this.stitchRowsOfPart();
    const afterChain = rows.length > 0 && isChainRow(rows[rows.length - 1]!);
    if (!afterChain && rows.length > 0) return null;
    const counts = [...text.matchAll(COUNT_TERMINATOR)];
    const lastCount = counts[counts.length - 1];
    const end = lastCount ? lastCount.index + lastCount[0].length : text.length;
    const body = ovalText(text.slice(0, end));
    const result = body.length <= MAX_ROW_TEXT ? parseRowText(body, this.locale) : null;
    if (!result?.ok || result.ops.length === 0 || this.unsupported(body, false).length > 0) {
      return named && afterChain && looksLikeStitches(text, this.locale) ? "unread" : null;
    }
    const head = result.ops[0]!;
    const ownChain = !afterChain && head.kind === "stitch" && head.code === "CH" && head.count >= 2 && result.ops.length > 1;
    if (!afterChain && !ownChain) return null;
    if (!named) {
      // Back bumps or a turn, unless the round works into both sides of the chain.
      const chain = ownChain ? (head as { count: number }).count : anchorsOffered(rows[rows.length - 1]!);
      const consumed = anchorsConsumed({ id: "", type: "round", ops: ownChain ? result.ops.slice(1) : result.ops, stitchCountTarget: 0 });
      if (rowLabel || consumed <= chain) return null;
    }
    return { result, rest: text.slice(end) };
  }

  /**
   * The second half of an oval round on a line of its own ("Working on the other side of the
   * chain: 4 sc, 2 sc in last ch (14)") after its first half, a row worked straight into a
   * foundation chain: added to that row, which becomes the oval round. Returns the text after
   * the half's count, or null when `text` is no such half.
   */
  private ovalSecondHalf(text: string): string | null {
    const rows = this.stitchRowsOfPart();
    const half = rows[rows.length - 1];
    const chain = rows[rows.length - 2];
    if (!half || !chain || !isChainRow(chain) || isChainRow(half) || half.around) return null;
    if (!new RegExp(`^[\\s,;.:]*(?:${OVAL_PHRASES.source}|${OVAL_TURN.source})`, "iu").test(text)) return null;
    const counts = [...text.matchAll(COUNT_TERMINATOR)];
    const lastCount = counts[counts.length - 1];
    const end = lastCount ? lastCount.index + lastCount[0].length : text.length;
    const body = ovalText(text.slice(0, end));
    if (body.length > MAX_ROW_TEXT || this.unsupported(body, false).length > 0) return null;
    const result = parseRowText(body, this.locale);
    if (!result.ok || result.ops.length === 0) return null;
    half.ops.push(...result.ops);
    half.around = true;
    half.type = "round";
    half.stitchCountTarget = result.stitchCountTarget ?? computeRowStitches(half);
    this.part().lastCount = half.stitchCountTarget;
    this.part().lastType = "round";
    return text.slice(end);
  }

  // -- pending text ---------------------------------------------------------

  append(text: string, line: number): void {
    if (text.trim() === "") return;
    if (this.pending) this.pending.pieces.push({ text, line });
    else this.pending = { kind: "free", pieces: [{ text, line }] };
  }

  openRound(label: LabelHit): void {
    this.flush();
    this.pending = { kind: "round", label, pieces: [] };
  }

  flush(): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    if (pending.kind === "round") this.round(pending.label, pending.pieces);
    else for (const piece of pending.pieces) this.free(piece.text, piece.line);
  }

  /** Split the pending text at the last header start; returns the header text, if any. */
  takeHeaderFromPending(): string | null {
    const pieces = this.pending?.pieces ?? [];
    for (let i = pieces.length - 1; i >= 0; i--) {
      const piece = pieces[i]!;
      const at = lastHeaderStart(piece.text, this.locale);
      if (at < 0) continue;
      const header = pieces.slice(i + 1).reduce((s, p) => `${s} ${p.text}`, piece.text.slice(at));
      piece.text = piece.text.slice(0, at);
      pieces.length = i + 1;
      return header;
    }
    return null;
  }

  // -- labelled rounds ------------------------------------------------------

  /** Text after a round, line by line, with the line number of the piece it came from. */
  private freeAfter(rest: string, pieces: readonly Piece[], fallback: number): void {
    for (const segment of rest.split("\n")) {
      const s = segment.trim();
      if (s === "") continue;
      const probe = s.slice(0, 24);
      this.free(s, pieces.find((p) => p.text.includes(probe))?.line ?? fallback);
    }
  }

  /** A "(n rounds)" note in the open round moves the expected number before the next label. */
  private noteExpansion(before: string): void {
    const open = this.pending;
    if (!open || open.kind !== "round" || open.label.last !== open.label.start || !this.current) return;
    const note = ROUNDS_NOTE.exec(`${open.pieces.map((p) => p.text).join(" ")} ${before}`);
    const n = note ? Number(note[1]) : 0;
    if (n > 1) this.current.expected = Math.max(this.current.expected, open.label.start + n);
  }

  /** Whether a label candidate is a real label, given the running numbering. */
  accept(hit: LabelHit, line: string, before: string): boolean {
    if (rejectedByContext(line, hit.index, hit.end, hit.kind)) return false;
    this.noteExpansion(before);
    const part = this.current;
    const expected = part?.expected ?? 1;
    const fresh = !part || !part.hasLabels;
    const atLineStart = hit.index <= Math.max(0, line.search(/\S/u));
    switch (hit.kind) {
      case "word":
      case "suffix":
        return hit.start === expected || hit.start === 1 || fresh || (hit.start > expected && hit.start <= expected + 5 && atLineStart);
      case "fuzzy":
        return hit.start === expected || (fresh && hit.start === 1);
      case "bare":
        if (hit.start === expected || hit.start === 1) return true;
        if (atLineStart && hit.start > expected && hit.start <= expected + 3) return true;
        return this.concatenatedRange(hit, expected);
      case "weak":
        return hit.start === expected && hit.start >= 2;
    }
  }

  /** "2526." with 25 expected is the range 25–26 with a lost dash. */
  private concatenatedRange(hit: LabelHit, expected: number): boolean {
    if (hit.last !== hit.start) return false;
    const digits = String(hit.start);
    const head = String(expected);
    if (!digits.startsWith(head) || digits.length === head.length) return false;
    const tail = Number(digits.slice(head.length));
    if (!(tail > expected && tail <= expected + 60)) return false;
    hit.start = expected;
    hit.last = tail;
    return true;
  }

  /** Book-keeping when a label is accepted: gaps, restarts, the next expected number. */
  labelAccepted(hit: LabelHit): void {
    const part = this.part();
    if (hit.annotated !== undefined && hit.annotated > 1 && hit.last === hit.start) {
      hit.last = hit.start + hit.annotated - 1;
    }
    if (part.hasLabels && hit.start > part.expected) {
      this.issue("LABEL_GAP", hit.line, hit.text, `Rounds ${part.expected}–${hit.start - 1} are missing.`);
    }
    part.hasLabels = true;
    part.expected = hit.last + 1;
  }

  private round(label: LabelHit, pieces: Piece[]): void {
    const part = this.part();
    let raw = pieces.map((p) => p.text).join("\n").trim();
    const line = label.line;
    const noteText = `${label.text} ${raw}`.trim();

    // "(n rounds)" right after the count: check a range, expand a single label.
    let first = label.start;
    let last = label.last;
    const note = ROUNDS_NOTE.exec(raw);
    const annotated = label.annotated ?? (note ? Number(note[1]) : undefined);
    let rangeMismatch: string | undefined;
    if (annotated !== undefined) {
      if (last > first && annotated !== last - first + 1) {
        rangeMismatch = `${label.text} are ${last - first + 1} rounds, the note says ${annotated}.`;
      } else if (last === first && annotated > 1) {
        last = first + annotated - 1;
        part.expected = Math.max(part.expected, last + 1);
      }
    }
    const firstRow = part.rows.length;
    if (rangeMismatch) this.issue("RANGE_MISMATCH", line, noteText, rangeMismatch, firstRow);

    for (const m of raw.matchAll(COUNT_NOTE)) {
      this.issue("IGNORED", line, m[0], "Note on what counts as a stitch removed; check the stitch count.");
    }
    raw = raw.replace(COUNT_NOTE, "");
    // "6 sc in MR, pull tight to close": closing the ring is part of the magic ring.
    if (RING_WORD.test(raw)) raw = raw.replace(RING_CLOSE, "");
    const joined = raw.replace(ROUND_JOIN, "");
    const roundJoin = joined !== raw;
    raw = joined.trim();

    if (raw === "") {
      this.instruction(noteText, line);
      return;
    }

    // An oval start: the round around both sides of the foundation chain.
    // A round around a chain bridge that joins parts ("… on the other side of the chain") is
    // read with its joins (`stitchRows` marks it `around`), not as an oval start.
    const oval = this.readsJoin(raw) ? null : this.ovalRound(raw, label.rowWord);
    if (oval === "unread") {
      this.instruction(noteText, line, ["UNSUPPORTED_FOUNDATION_OVAL"]);
      part.lastCount = declaredCount(raw) ?? part.lastCount;
      return;
    }
    if (oval) {
      this.aroundNext = true;
      this.stitchRows(oval.result, first, last, "round", line, raw, true);
      if (roundJoin) this.issue("UNSUPPORTED_ROUND_JOIN", line, noteText, undefined, part.rows.length - 1);
      if (oval.rest.trim() !== "") this.freeAfter(oval.rest, pieces, line);
      return;
    }
    // A mention of the other side of the chain without stitches ("see page 11 for …") is a
    // note; anything with stitches or counts goes on to be read (or reported unreadable).
    if (OVAL.test(raw) && !looksLikeStitches(raw, this.locale) && !/\d/.test(raw.replace(PAGE_REF, ""))) {
      this.instruction(noteText, line);
      return;
    }
    // Anywhere else "unroll the crochet" between stitches turns the work.
    if (looksLikeStitches(raw, this.locale)) raw = raw.replace(new RegExp(OVAL_TURN.source, "giu"), "turn");
    const type: Row["type"] = label.rowWord || /\b(?:turn|wenden)\b/iu.test(raw) ? "row" : "round";

    const blocking = this.unsupported(raw, true);
    if (blocking.length > 0) {
      this.instruction(noteText, line, blocking);
      part.lastCount = declaredCount(raw) ?? part.lastCount;
      return;
    }

    const split = this.splitPrefix(raw, false);
    if ("blocked" in split && split.blocked) {
      this.instruction(noteText, line, split.blocked);
      part.lastCount = declaredCount(raw) ?? part.lastCount;
      return;
    }
    const accept = (result: Split["result"], consumed: string, rest: string, before = "") => {
      // Stitch content in the rest of the same line would be a second row of this round:
      // that is a misreading waiting to happen, so the whole round stays unread.
      const nl = rest.indexOf("\n");
      const sameLine = nl < 0 ? rest : rest.slice(0, nl);
      const later = nl < 0 ? "" : rest.slice(nl + 1);
      if (sameLine.trim() !== "" && this.containsStitches(sameLine)) {
        const restCodes = this.unsupported(sameLine, false);
        const text = `${label.text} ${before}${consumed}${sameLine}`;
        this.instruction(text, line, restCodes.length > 0 ? restCodes : ["UNREADABLE"]);
        part.lastCount = declaredCount(text) ?? part.lastCount;
        if (later.trim() !== "") this.freeAfter(later, pieces, line);
        return;
      }
      if (before.trim() !== "") this.instruction(`${label.text} ${before}`, line);
      this.stitchRows(result, first, last, type, line, consumed, true);
      if (roundJoin) this.issue("UNSUPPORTED_ROUND_JOIN", line, noteText, undefined, part.rows.length - 1);
      if (rest.trim() !== "") this.freeAfter(rest, pieces, line);
    };
    if ("result" in split) {
      accept(split.result, raw.slice(0, split.end), raw.slice(split.end));
      return;
    }

    const codes = this.unsupported(raw, false);
    if (codes.length === 0) {
      // An instruction before the stitches ("4. 3–4. Sc in each stitch around"): keep the
      // label with the instruction, read the row after it — unless that "instruction" is
      // itself stitches ("ch 1, hdc in same st, sc around"), which stays unread.
      const suffix = this.suffixRow(raw);
      if (suffix) {
        const before = raw.slice(0, suffix.cut);
        if (looksLikeStitches(before, this.locale) || hasCountedStitch(before, this.locale) || this.unsupported(before, false).length > 0) {
          const beforeCodes = this.unsupported(before, false);
          this.instruction(noteText, line, beforeCodes.length > 0 ? beforeCodes : ["UNREADABLE"]);
          part.lastCount = declaredCount(raw) ?? part.lastCount;
          return;
        }
        accept(suffix.split.result, suffix.text, suffix.rest, before);
        return;
      }
      // "16 se [16] Sew the muzzle …": an unreadable row followed by an instruction.
      const terminator = new RegExp(COUNT_TERMINATOR.source, "iu").exec(raw);
      const headEnd = terminator ? terminator.index + terminator[0].length : raw.length;
      const head = raw.slice(0, headEnd);
      // A labelled round that reads like stitches is unread, even with an instruction word in it
      // ("6 sc in MR, pull through"): it must not pass as a plain note.
      const unreadable = looksLikeStitches(head, this.locale) || (!INSTRUCTION_WORDS.test(head) && /\d/.test(head));
      if (split.fill) {
        codes.push(split.fill);
      } else if (unreadable && headEnd < raw.length) {
        this.instruction(`${label.text} ${head}`, line, ["UNREADABLE"]);
        part.lastCount = declaredCount(head) ?? part.lastCount;
        this.freeAfter(raw.slice(headEnd), pieces, line);
        return;
      } else if (unreadable) {
        codes.push("UNREADABLE");
      }
    }
    this.instruction(noteText, line, codes);
    part.lastCount = declaredCount(raw) ?? part.lastCount;
  }

  /** A row that starts after a clause boundary of `s` ("With Color A: Ch 7"). */
  private suffixRow(s: string): { cut: number; split: Split; text: string; rest: string } | null {
    for (const cut of clauseBoundaries(s)) {
      const after = s.slice(cut);
      const rest = after.trim();
      if (rest === "" || rest.length > MAX_ROW_TEXT * 2) continue;
      const split = this.splitPrefix(rest, true);
      if ("result" in split) return { cut, split, text: rest.slice(0, split.end), rest: rest.slice(split.end) };
    }
    return null;
  }

  /** Whether `text` has stitch content: stitch-like words or a readable row somewhere. */
  private containsStitches(text: string): boolean {
    if (looksLikeStitches(text, this.locale) && !INSTRUCTION_WORDS.test(text)) return true;
    const head = this.splitPrefix(text, true);
    return "result" in head || ("blocked" in head && head.blocked !== undefined) || this.suffixRow(text) !== null;
  }

  // -- free text ------------------------------------------------------------

  /** Text outside a labelled round: unlabelled rows and instruction rows. */
  free(text: string, line: number): void {
    let s = text.trim();
    let guard = 0;
    while (s !== "" && guard++ < 50) {
      if (OVAL.test(s) || OVAL_WEAK.test(s) || OVAL_TURN.test(s)) {
        // An oval start: its second half on a line of its own, or the whole round.
        const after = this.ovalSecondHalf(s);
        if (after !== null) {
          s = after.trim();
          continue;
        }
        const oval = this.ovalRound(s);
        if (oval === "unread") {
          this.instruction(s, line, ["UNSUPPORTED_FOUNDATION_OVAL"]);
          return;
        }
        if (oval) {
          this.aroundNext = true;
          this.stitchRows(oval.result, 1, 1, "round", line, s);
          s = oval.rest.trim();
          continue;
        }
        // Anywhere else "unroll the crochet" between stitches turns the work.
        if (looksLikeStitches(s, this.locale)) s = s.replace(new RegExp(OVAL_TURN.source, "giu"), "turn");
      }
      const stitchy = looksLikeStitches(s, this.locale);
      const unsupported = stitchy ? this.unsupported(s, false) : [];
      if (unsupported.length > 0) {
        this.instruction(s, line, unsupported);
        return;
      }
      const head = this.splitPrefix(s, true);
      if ("blocked" in head && head.blocked) {
        this.instruction(s, line, head.blocked);
        return;
      }
      if ("result" in head) {
        const raw = s.slice(0, head.end);
        this.stitchRows(head.result, 1, 1, /\b(?:turn|wenden)\b/iu.test(raw) ? "row" : this.part().lastType, line, raw);
        s = s.slice(head.end).trim();
        continue;
      }
      // An instruction followed by a row: "With Color A: Ch 7", "…, crochet 21 sc."
      const suffix = this.suffixRow(s);
      if (suffix) {
        const before = s.slice(0, suffix.cut);
        if (looksLikeStitches(before, this.locale) || hasCountedStitch(before, this.locale)) {
          // "skip 2 sts, sc 4": the part before the row is stitches we cannot read.
          this.instruction(s, line, ["UNREADABLE"]);
          return;
        }
        this.instruction(before, line);
        const type = /\b(?:turn|wenden)\b/iu.test(suffix.text) ? "row" : this.part().lastType;
        this.stitchRows(suffix.split.result, 1, 1, type, line, suffix.text);
        s = suffix.rest.trim();
        continue;
      }
      const codes: ImportIssueCode[] = [];
      if (head.fill) codes.push(head.fill);
      else if (stitchy && !INSTRUCTION_WORDS.test(s)) codes.push("UNREADABLE");
      this.instruction(s, line, codes);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function defaultIds(): () => string {
  let n = 0;
  return () => `import-${++n}`;
}

/** `base`, or `base-2`, `base-3` … — the first not in `taken` (which receives it). */
function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** Whether a line starts the pattern content (everything before it is preamble). */
function startsContent(line: string, locale: NotationLocale): boolean {
  if (isStandaloneHeader(line, locale) || lineLeadingHeader(line, locale)) return true;
  if (findLabels(line, 0).some((h) => h.kind === "word")) return true;
  if (findLabels(line, 0).some((h) => h.index <= 2 && h.start === 1)) return true;
  if (line.length <= MAX_ROW_TEXT) {
    const r = parseRowText(line, locale);
    if ((r.ok && r.ops.length > 0 && /\d/.test(line)) || (!r.ok && r.code === "needs-context")) return true;
  }
  return false;
}

/**
 * Read a whole pattern text into parts, rows, issues and preamble. See the module doc for
 * what is understood. Never throws on any input; the output is deterministic for a given
 * text, options and id generator.
 */
export function parsePatternText(text: string, options: ParsePatternOptions = {}): PatternImport {
  const detected = options.locale ? { locale: options.locale, confidence: 1 } : detectNotationLocale(text);
  const locale = detected.locale;
  const importer = new Importer(locale, options.makeId ?? defaultIds());
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  let started = false;
  let inPreamble = false;
  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    const line = normalizeLine(rawLine);
    const trimmed = line.trim();
    if (trimmed === "") {
      importer.flush();
      inPreamble = false;
      return;
    }
    if (PAGE_ARTIFACT.test(trimmed)) {
      importer.flush();
      importer.issue("IGNORED", lineNo, trimmed, "Page number.");
      return;
    }
    const preambleStart =
      PREAMBLE_START.test(trimmed) || PREAMBLE_ANYWHERE.test(trimmed) || (!started && PREAMBLE_NOTES.test(trimmed));
    const continuesPreamble =
      inPreamble &&
      !isStandaloneHeader(trimmed, locale) &&
      !lineLeadingHeader(trimmed, locale) &&
      (/^[-•–*·]\s/u.test(trimmed) || !startsContent(trimmed, locale));
    if (preambleStart || continuesPreamble || (!started && !startsContent(trimmed, locale))) {
      importer.flush();
      importer.preamble.push({ text: trimmed, line: lineNo });
      importer.issue("PREAMBLE", lineNo, trimmed);
      inPreamble = inPreamble || preambleStart;
      return;
    }
    inPreamble = false;
    started = true;

    const lead = lineLeadingHeader(line, locale);
    if (!lead && isStandaloneHeader(trimmed, locale)) {
      importer.flush();
      const header = parseHeader(trimmed);
      importer.startPart(header, { text: trimmed, line: lineNo });
      if (header.assembly) importer.append(trimmed, lineNo);
      return;
    }

    let pos = 0;
    if (lead) {
      importer.flush();
      if (lead.continued) {
        const m = /^[^:]*:/u.exec(line);
        const end = m && m[0].length < 60 ? m[0].length : lead.end;
        importer.issue("IGNORED", lineNo, line.slice(0, end), "Continuation heading.");
        pos = end;
      } else {
        const header = parseHeader(lead.text);
        importer.startPart(header, { text: lead.text, line: lineNo });
        pos = lead.end;
        if (header.assembly) {
          // "Assembly Head and Body:" — the whole heading stays one instruction.
          const m = /^[^:.]*:/u.exec(line);
          if (m && m[0].length < 60) pos = m[0].length;
          importer.append(line.slice(0, pos), lineNo);
        }
      }
    }

    for (const hit of findLabels(line, lineNo)) {
      if (hit.index < pos) continue;
      if (!importer.accept(hit, line, line.slice(pos, Math.min(hit.index, pos + 200)))) continue;
      const before = line.slice(pos, hit.index);
      const current = importer.parts[importer.parts.length - 1];
      const restart = hit.start === 1 && current !== undefined && current.hasLabels && hit.kind !== "weak";
      if (restart) {
        const at = lastHeaderStart(before, locale);
        let headerText: string | null = null;
        if (at >= 0) {
          importer.append(before.slice(0, at), lineNo);
          headerText = before.slice(at);
        } else {
          importer.append(before, lineNo);
          headerText = before.trim() === "" ? importer.takeHeaderFromPending() : null;
        }
        importer.flush();
        if (headerText !== null) {
          const lead2 = lineLeadingHeader(headerText, locale);
          const name = lead2 ? lead2.text : headerText.split(/\s+/)[0]!;
          const header = parseHeader(name);
          if (header.assembly) {
            importer.startPart(header);
            importer.append(headerText, lineNo);
          } else {
            importer.startPart(header, { text: name, line: lineNo });
            importer.append(headerText.slice(name.length), lineNo);
          }
        } else {
          importer.startPart(null);
        }
      } else {
        importer.append(before, lineNo);
      }
      importer.labelAccepted(hit);
      importer.openRound(hit);
      pos = hit.end;
    }
    importer.append(line.slice(pos), lineNo);
  });
  importer.flush();

  const { parts, issues, assembly } = importer.finish();
  if (!options.locale && parts.length > 0 && detected.confidence < LOCALE_CONFIDENCE_THRESHOLD) {
    // Above all a UK guess from "dc" alone: the app should ask which terms the pattern uses.
    issues.unshift({
      line: 1,
      text: locale,
      code: "LOCALE_UNCERTAIN",
      severity: SEVERITY.LOCALE_UNCERTAIN,
      message: `Read as ${locale} with low confidence (${detected.confidence}); please confirm the terms.`,
    });
  }
  const preamble = [...importer.preamble].sort((a, b) => a.line - b.line).map((p) => p.text);
  return { locale, localeConfidence: detected.confidence, parts, issues, preamble, colors: importer.colors, assembly };
}
