/**
 * Whether pasted text looks like a crochet pattern — decides if pasting outside a text field
 * opens "Anleitung einfügen". Cheap and deliberately strict: at least three lines with a round
 * or row label or a stitch term, so a pasted word or URL never opens the dialog.
 */

/** "Runde 3", "Rnd 3", "R3", "Row 9", "3.", "3)", "3:" at the start of a line. */
const LABEL = /^\s*(?:(?:R|Rnds?|Rds?|Rounds?|Rows?|Runden?|Reihen?)\.?\s*\d{1,3}|\d{1,3}\s*(?:[-–—]\s*\d{1,3}\s*)?[.):])/iu;
/** Stitch terms of the German, US and UK notations. */
const STITCH =
  /(?<![\p{L}])(?:fM|FM|Lm|Km|Kettm|Stb|hStb|Zun|Abn|Fadenring|sc|hdc|dc|tr|htr|ch|sl\s?st|inc|dec|MR|magic\s+ring)(?![\p{L}])/u;

export const MIN_PATTERN_LINES = 3;

export function looksLikePattern(text: string): boolean {
  let hits = 0;
  for (const line of text.split(/\r\n?|\n/)) {
    if (line.length > 2000) continue;
    if (LABEL.test(line) || STITCH.test(line)) hits++;
    if (hits >= MIN_PATTERN_LINES) return true;
  }
  return false;
}
