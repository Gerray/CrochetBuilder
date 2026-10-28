/**
 * Notation locale detection — guess whether a pasted pattern is written in German, US or UK
 * terms, from its vocabulary.
 *
 *   - An explicit mention ("US terms", "written in UK terminology", "amerikanische
 *     Begriffe") wins (confidence 1). If both are mentioned, the first mention wins.
 *   - German vs English: German stitch abbreviations (fM, Lm, Km, Kettm, Stb, hStb, Zun, Abn)
 *     and words (Runde, Reihe, Maschen, und, mit …) against English stitch terms and words.
 *   - US vs UK: "sc"/"hdc"/"single crochet" only exist in US terms; "htr"/"ss" only in UK
 *     terms; "dc" without any "sc" is the UK single crochet (amigurumi are mostly sc).
 *
 * `confidence` is in [0, 1]: 0 means no signal at all (the result is then the default "de"),
 * values near 1 a clear majority. Pure function, no I/O.
 */

import type { NotationLocale } from "./notation.js";

export interface LocaleDetection {
  locale: NotationLocale;
  /** 0 … 1; 1 for an explicit "US/UK terms" mention. */
  confidence: number;
}

const EXPLICIT: Array<[RegExp, NotationLocale]> = [
  [/\b(?:US|U\.S\.|American|amerikanisch\w*)\s+(?:crochet\s+)?(?:terms|terminology|notation|abbreviations|Begriffe|Schreibweise|Häkelbegriffe)\b/i, "en_us"],
  [/\b(?:UK|U\.K\.|British|britisch\w*|englisch\w*)\s+(?:crochet\s+)?(?:terms|terminology|notation|abbreviations|Begriffe|Schreibweise|Häkelbegriffe)\b/i, "en_uk"],
];

/** German stitch abbreviations, matched case-sensitively as written in German patterns. */
const DE_STITCHES = new Set(["fM", "FM", "Lm", "LM", "Km", "Kettm", "Stb", "hStb", "Zun", "Abn", "uAbn", "Fadenring"]);
const DE_WORDS = new Set([
  "runde",
  "runden",
  "reihe",
  "reihen",
  "maschen",
  "masche",
  "feste",
  "luftmaschen",
  "luftmasche",
  "kettmaschen",
  "stäbchen",
  "zunahme",
  "zunahmen",
  "abnahme",
  "abnahmen",
  "und",
  "mit",
  "die",
  "der",
  "das",
  "jede",
  "nicht",
  "häkeln",
  "füllen",
  "wiederholen",
  "rundherum",
]);
const EN_WORDS = new Set([
  "the",
  "and",
  "with",
  "each",
  "around",
  "round",
  "rounds",
  "rnd",
  "row",
  "rows",
  "stitch",
  "stitches",
  "stuff",
  "repeat",
  "times",
  "increase",
  "decrease",
  "chain",
  "into",
  "make",
]);

/** Guess the notation locale of a pattern text. */
export function detectNotationLocale(text: string): LocaleDetection {
  let explicit: { locale: NotationLocale; index: number } | undefined;
  for (const [re, locale] of EXPLICIT) {
    const hit = re.exec(text);
    if (hit && (!explicit || hit.index < explicit.index)) explicit = { locale, index: hit.index };
  }
  if (explicit) return { locale: explicit.locale, confidence: 1 };

  let de = 0;
  let en = 0;
  let us = 0;
  let uk = 0;
  let sc = 0;
  let dc = 0;
  const lower = text.toLowerCase();
  for (const word of text.match(/[\p{L}]+/gu) ?? []) {
    const w = word.toLowerCase();
    if (DE_STITCHES.has(word)) de += 2;
    else if (DE_WORDS.has(w)) de += 1;
    else if (EN_WORDS.has(w)) en += 1;
    if (w === "sc" || w === "hdc") {
      us += 2;
      en += 1;
      sc++;
    } else if (w === "htr" || w === "ss") {
      uk += 2;
      en += 1;
    } else if (w === "dc") {
      dc++;
      en += 1;
    }
  }
  const single = (lower.match(/\bsingle crochets?\b/g) ?? []).length;
  us += 2 * single;
  sc += single;
  // UK patterns write "ss"; a "ch 3" turning chain belongs to a US double crochet (a UK
  // "dc" is a US single crochet, turned with ch 1).
  us += (lower.match(/\bsl\.?\s*st\b|\bslip\s+stitch/g) ?? []).length;
  us += (lower.match(/\bch(?:ain)?\s*3\b/g) ?? []).length;
  const ukStrong = uk > 0;
  if (sc === 0 && dc > 0) uk += dc;

  if (de === 0 && en === 0) return { locale: "de", confidence: 0 };
  // Little evidence (a single "6 sc") cannot give full confidence.
  const evidence = Math.min(1, (de + en) / 8);
  const language = (evidence * Math.abs(de - en)) / (de + en);
  if (de > en) return { locale: "de", confidence: round(language) };
  if (us === 0 && uk === 0) return { locale: "en_us", confidence: round(language * 0.5) };
  const dialect = Math.abs(us - uk) / (us + uk);
  const confidence = round(Math.min(language, dialect));
  if (uk > us) {
    // "dc" without "sc" is only a hint: US patterns with double crochets look the same.
    return { locale: "en_uk", confidence: ukStrong ? confidence : Math.min(confidence, DC_ONLY_UK_CONFIDENCE) };
  }
  return { locale: "en_us", confidence };
}

/** Highest confidence of a UK guess that rests only on "dc" without "sc". */
export const DC_ONLY_UK_CONFIDENCE = 0.4;

/** Below this confidence the importer asks for the locale (`LOCALE_UNCERTAIN`). */
export const LOCALE_CONFIDENCE_THRESHOLD = 0.5;

const round = (x: number) => Math.round(x * 100) / 100;
