/**
 * Join phrases of the row notation (format v2, `StitchOp.from` / `.through`): how a joined
 * stitch op is written after its stitch, and how such phrases are found in typed or pasted text.
 *
 *   render (de):    "18 fM aus Teil Bein 1", "21 fM aus Teil Kürbis (Runde 12)",
 *                   "6 fM aus Teil Robbe (Runde 15, ab M 7)", "5 fM zusammen mit Teil Arm"
 *   render (en):    "18 sc from part Leg 1", "6 sc from part Seal (round 15, from st 7)",
 *                   "5 sc together with part Arm"
 *   parse, besides: "18 fM um Bein 1", "18 fM um das erste Bein", "18 sc around leg 1",
 *                   "18 sc around the second leg", "5 fM mit dem Arm", "4 sc on the arm",
 *                   "5 sc through the arm and body", "5 sc through both layers of the arm"
 *
 * A phrase is only read when it names a part of the document (`JoinNotationPart`, by name,
 * a simple plural or singular of it, or id); anything else stays text for the stitch parser
 * (and is an unknown term there). Rows are written by their number in the other part
 * ("Runde 12"), a start by its 1-based stitch ("ab M 7").
 *
 * Pure functions, no UI or framework imports.
 */

import { rowOrdinals } from "./expand.js";
import type { JoinRef, Row } from "./schema.js";

type Locale = "de" | "en_us" | "en_uk";

/** A part as the notation sees it: id (what `from.part` stores), name, copies, rows. */
export interface JoinNotationPart {
  id: string;
  name?: string;
  quantity?: number;
  rows?: readonly Row[];
}

const WORDS = {
  de: { from: "aus Teil", through: "zusammen mit Teil", round: "Runde", row: "Reihe", start: "ab M", line: "Zeile" },
  en: { from: "from part", through: "together with part", round: "round", row: "row", start: "from st", line: "line" },
} as const;
const words = (locale: Locale) => (locale === "de" ? WORDS.de : WORDS.en);

/** Name of a part in text: its name, else "Teil n" / "part n" (1-based position), else the id. */
function partName(parts: readonly JoinNotationPart[] | undefined, id: string, locale: Locale): string {
  const i = parts?.findIndex((p) => p.id === id) ?? -1;
  if (i < 0) return id;
  const name = parts![i]!.name?.trim();
  return name || `${locale === "de" ? "Teil" : "Part"} ${i + 1}`;
}

/** The phrase of a join, with a leading space: " aus Teil Bein 1 (Runde 5, ab M 7)". */
export function renderJoin(kind: "from" | "through", ref: JoinRef, locale: Locale, parts?: readonly JoinNotationPart[]): string {
  const w = words(locale);
  const part = parts?.find((p) => p.id === ref.part);
  let text = ` ${kind === "from" ? w.from : w.through} ${partName(parts, ref.part, locale)}`;
  if (ref.copy !== undefined || (part?.quantity ?? 1) >= 2) text += ` ${ref.copy ?? 1}`;
  const spec: string[] = [];
  if (ref.row !== undefined) {
    const rows = part?.rows;
    const index = rows ? rows.findIndex((r) => r.id === ref.row) : -1;
    if (rows && index >= 0 && rows[index]!.ops.length > 0) {
      const ordinal = rowOrdinals(rows)[index]!;
      spec.push(`${rows[index]!.type === "row" ? w.row : w.round} ${ordinal}`);
    } else spec.push(`${w.line} „${ref.row}“`);
  }
  if (ref.start !== undefined) spec.push(`${w.start} ${ref.start + 1}`);
  if (spec.length > 0) text += ` (${spec.join(", ")})`;
  return text;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** A join found in text. */
export interface FoundJoin {
  kind: "from" | "through";
  ref: JoinRef;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Forms a part is named by: its name, simple plural/singular forms, its id. */
function nameForms(part: JoinNotationPart, index: number): string[] {
  const out = new Set<string>();
  const add = (s: string | undefined) => {
    const t = s?.trim().replace(/\s+/g, " ");
    if (t && t.length >= 2) out.add(t.toLowerCase());
  };
  const name = part.name?.trim();
  if (name) {
    add(name);
    for (const suffix of ["s", "e", "n", "en", "es"]) add(name + suffix);
    for (const suffix of ["es", "en", "s", "e", "n"]) if (name.length > suffix.length + 2 && name.toLowerCase().endsWith(suffix)) add(name.slice(0, -suffix.length));
  }
  add(part.id);
  add(`Teil ${index + 1}`);
  add(`Part ${index + 1}`);
  return [...out];
}

const ORDINALS: Record<string, number> = {
  erste: 1, ersten: 1, erstes: 1, erster: 1, erstem: 1, first: 1, "1st": 1, "1.": 1,
  zweite: 2, zweiten: 2, zweites: 2, zweiter: 2, zweitem: 2, second: 2, "2nd": 2, "2.": 2, other: 2, andere: 2, anderen: 2, anderes: 2,
  dritte: 3, dritten: 3, drittes: 3, dritter: 3, third: 3, "3rd": 3, "3.": 3,
  vierte: 4, vierten: 4, viertes: 4, vierter: 4, fourth: 4, "4th": 4, "4.": 4,
};
const ORDINAL = Object.keys(ORDINALS)
  .sort((a, b) => b.length - a.length)
  .map(escape)
  .join("|");
const ARTICLES = "the|both|dem|den|das|die|der|des|einem|einen|ein";

const FROM_INTRO = "aus\\s+Teil|aus|um|an|from\\s+part|from|a?round|into|in";
const THROUGH_INTRO =
  "zusammen\\s+mit(?:\\s+Teil)?|mit|durch(?:\\s+beide\\s+Lagen(?:\\s+(?:von|vom))?)?|together\\s+with(?:\\s+part)?|with|on|through(?:\\s+both\\s+layers(?:\\s+of)?)?";
const ROW_WORDS = "Runde|Rd\\.?|Reihe|R\\.?|round|rnd\\.?|row|Zeile|line";
const START_WORDS = "ab\\s+(?:M(?:asche)?\\.?|Masche)|from\\s+(?:st(?:itch)?\\.?)|starting\\s+(?:in|at)\\s+st\\.?";

/**
 * Find join phrases after stitch terms in `text` and replace each with a placeholder `§jN§`
 * (N: index into `joins`), so the stitch parser can attach them. Only parts in `parts` (with
 * an id) are recognised. Text without such a phrase comes back unchanged.
 */
export function extractJoins(text: string, parts: readonly JoinNotationPart[] | undefined): { text: string; joins: FoundJoin[] } {
  const joins: FoundJoin[] = [];
  if (!parts || parts.length === 0) return { text, joins };
  const forms: Array<{ form: string; part: number }> = [];
  parts.forEach((p, i) => {
    if (!p.id) return;
    for (const f of nameForms(p, i)) forms.push({ form: f, part: i });
  });
  if (forms.length === 0) return { text, joins };
  forms.sort((a, b) => b.form.length - a.form.length);
  const names = forms.map((f) => escape(f.form).replace(/ /g, "\\s+")).join("|");
  const tail = `(?:\\s+(?:${ARTICLES}))?(?:\\s+(${ORDINAL}))?\\s+(${names})(?![\\p{L}\\d])(?:\\s+(?:Nr\\.?\\s*|#)?(\\d+)(?![\\d.]))?(?:\\s*\\(\\s*((?:${ROW_WORDS})\\s*\\d+|(?:${START_WORDS})\\s*\\d+|(?:Zeile|line)\\s*„[^“]*“)(?:\\s*,\\s*((?:${START_WORDS})\\s*\\d+))?\\s*\\))?`;
  // `through`: "… and (the) body" / "… und (dem) Körper" after the part is the own part.
  const own = "(?:\\s+(?:and|und|&)(?:\\s+(?:the|dem|den|das|die|der))?\\s+[\\p{L}][\\p{L}\\-]*)?";
  const pattern = new RegExp(`(?<=[\\p{L}\\d.)\\]])\\s+(?:(${THROUGH_INTRO})${tail}${own}|(${FROM_INTRO})${tail})(?=\\s*(?:[,;)\\]]|\\(\\s*\\d|=|$|[–-]\\s*\\d))`, "giu");
  const out = text.replace(pattern, (whole, tIntro, tOrd, tName, tCopy, tSpec, tSpec2, fIntro, fOrd, fName, fCopy, fSpec, fSpec2) => {
    const kind: "from" | "through" = tIntro !== undefined ? "through" : "from";
    const name = (kind === "through" ? tName : fName) as string;
    const ordinal = (kind === "through" ? tOrd : fOrd) as string | undefined;
    const copyText = (kind === "through" ? tCopy : fCopy) as string | undefined;
    const specs = [kind === "through" ? tSpec : fSpec, kind === "through" ? tSpec2 : fSpec2].filter((s): s is string => !!s);
    const key = name.toLowerCase().replace(/\s+/g, " ");
    const hit = forms.find((f) => f.form === key);
    if (!hit) return whole;
    const part = parts[hit.part]!;
    const ref: JoinRef = { part: part.id };
    const copy = copyText !== undefined ? Number(copyText) : ordinal !== undefined ? ORDINALS[ordinal.toLowerCase()] : undefined;
    // A number after a part that exists once is not a copy ("in Teil 2" is the name form).
    if (copy !== undefined && copy >= 1 && (copy > 1 || (part.quantity ?? 1) >= 2 || ordinal !== undefined)) ref.copy = copy;
    for (const spec of specs) {
      const start = new RegExp(`^(?:${START_WORDS})\\s*(\\d+)$`, "iu").exec(spec);
      if (start) {
        ref.start = Math.max(0, Number(start[1]) - 1);
        continue;
      }
      const line = /^(?:Zeile|line)\s*„([^“]*)“$/iu.exec(spec);
      if (line) {
        ref.row = line[1]!;
        continue;
      }
      const row = new RegExp(`^(?:${ROW_WORDS})\\s*(\\d+)$`, "iu").exec(spec);
      if (row) {
        const n = Number(row[1]);
        const rows = part.rows ?? [];
        const ordinals = rowOrdinals(rows);
        const index = rows.findIndex((r, i) => r.ops.length > 0 && ordinals[i] === n);
        if (index < 0) return whole;
        ref.row = rows[index]!.id;
      }
    }
    // A copy number on a part that has fewer copies stays as written (validation reports it).
    joins.push({ kind, ref });
    return ` §j${joins.length - 1}§`;
  });
  return { text: out, joins };
}
