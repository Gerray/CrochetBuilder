/**
 * Preview model of "Anleitung einfügen": the pasted text read by the engine's
 * `parsePatternText`, validated per part and laid out as compact German lines ("Runde 5–8:
 * 24 fM (24)") with a status per line and the source line it came from.
 *
 * Plain data in, plain data out (no React, no DOM): it runs in a Web Worker for large pastes
 * and directly in tests.
 */

import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_MAX_STITCHES,
  detectNotationLocale,
  parsePatternText,
  renderOps,
  rowLabel,
  rowOrdinals,
  validate,
  type Finding,
  type Finish,
  type ImportedColor,
  type ImportIssue,
  type ImportIssueCode,
  type NotationLocale,
  type Placement,
  type Row,
  type Stuffing,
} from "@crochetbuilder/engine";
import { importIssueMessage, unreadRowLabel } from "../state/import-messages.js";
import { findingMessage } from "../state/messages.js";

/** "auto": detected from the text; otherwise chosen (and so confirmed) by the person. */
export type LocaleChoice = "auto" | NotationLocale;

/**
 * Status of a preview line: read without remarks; a remark worth knowing (colour change,
 * repeat interpreted); a stitch count or validation problem; text that stayed unread.
 */
export type LineStatus = "ok" | "info" | "mismatch" | "unread";

export interface PreviewMessage {
  severity: "info" | "warning" | "error";
  text: string;
}

export interface PreviewLine {
  /** First and last row index (inclusive) of the part covered by this line. */
  first: number;
  last: number;
  kind: "stitches" | "note";
  /** "Runde 3", "Runde 5–8", "Hinweis", "Nicht gelesen". */
  label: string;
  /** "6× (1 fM, 1 Zun) (18)", or the note text. */
  text: string;
  status: LineStatus;
  messages: PreviewMessage[];
  /** 1-based line of the pasted text, when known. */
  source?: number;
  /** The colour the work switches to at this row (format v2), as a chip. */
  color?: ImportedColor;
}

export interface PreviewPart {
  /** The part's id in the import (`assembly` refers to it; replaced on import when taken). */
  id: string;
  name: string;
  quantity: number;
  /** The rows as they will be imported (ids are replaced on import). */
  rows: Row[];
  lines: PreviewLine[];
  /** Rows with stitches (rounds and rows). */
  stitchRows: number;
  finish?: Finish;
  stuffing?: Stuffing;
}

export interface GeneralIssue {
  code: ImportIssueCode;
  line: number;
  text: string;
  severity: "info" | "warning";
  message: string;
}

export interface PreviewCounts {
  parts: number;
  stitchRows: number;
  /** Every stitch row is a turned row ("Reihen" instead of "Runden"). */
  onlyRows: boolean;
  /** Lines and general issues worth a look (excluding unread text, preamble, skipped lines). */
  notices: number;
  /** Rows that stayed unread text. */
  unread: number;
}

export interface PastePreview {
  /** Locale the text was read with. */
  locale: NotationLocale;
  choice: LocaleChoice;
  /** What the detection says about the text (also shown after a manual choice). */
  detected: { locale: NotationLocale; confidence: number };
  /** Detected with low confidence and not yet confirmed: import waits for a choice. */
  localeUncertain: boolean;
  parts: PreviewPart[];
  preamble: string[];
  /** Issues that belong to no row (numbering gaps, skipped lines, the locale). */
  general: GeneralIssue[];
  counts: PreviewCounts;
  /** First preamble line when it looks like the pattern's title. */
  title?: string;
  /** Colours named in the text (palette ids as in `Row.color`). */
  colors: ImportedColor[];
  /** Placements read from the text (part ids of `parts`, row ids of their rows). */
  assembly: Placement[];
}

const KEY = (part: number, row: number) => `${part}:${row}`;

/** Read `text` and build the preview (see module doc). Never throws. */
export function buildPastePreview(text: string, choice: LocaleChoice = "auto"): PastePreview {
  const result = parsePatternText(text, choice === "auto" ? {} : { locale: choice });
  const detected =
    choice === "auto" ? { locale: result.locale, confidence: result.localeConfidence } : detectNotationLocale(text);

  const byRow = new Map<string, ImportIssue[]>();
  const general: GeneralIssue[] = [];
  for (const issue of result.issues) {
    if (issue.partIndex !== undefined && issue.rowIndex !== undefined) {
      const key = KEY(issue.partIndex, issue.rowIndex);
      byRow.set(key, [...(byRow.get(key) ?? []), issue]);
    } else if (issue.code !== "PREAMBLE") {
      general.push({
        code: issue.code,
        line: issue.line,
        text: issue.text,
        severity: issue.severity,
        message: importIssueMessage(issue),
      });
    }
  }

  const parts = result.parts.map((part, p): PreviewPart => {
    // Unread text gets a visible label, so it stands out in the editor afterwards too.
    const rows = part.rows.map((row, r) => {
      if (row.ops.length > 0) return row;
      const label = unreadRowLabel((byRow.get(KEY(p, r)) ?? []).map((i) => i.code));
      return label ? { ...row, label } : row;
    });
    const findings = validate(
      { schemaVersion: CURRENT_SCHEMA_VERSION, rows },
      { maxStitches: DEFAULT_MAX_STITCHES, palette: result.colors },
    );
    const out: PreviewPart = {
      id: part.id,
      name: part.name,
      quantity: part.quantity,
      rows,
      lines: previewLines(rows, findings, (r) => byRow.get(KEY(p, r)) ?? [], result.colors),
      stitchRows: rows.filter((r) => r.ops.length > 0).length,
    };
    if (part.finish) out.finish = part.finish;
    if (part.stuffing) out.stuffing = part.stuffing;
    return out;
  });
  locateSources(text, parts);

  const lines = parts.flatMap((p) => p.lines);
  const stitchRows = parts.reduce((sum, p) => sum + p.stitchRows, 0);
  const counts: PreviewCounts = {
    parts: parts.length,
    stitchRows,
    onlyRows: stitchRows > 0 && parts.every((p) => p.rows.every((r) => r.ops.length === 0 || r.type === "row")),
    notices:
      lines.filter((l) => l.status === "mismatch" || l.status === "info").length +
      general.filter((g) => g.code !== "IGNORED").length,
    unread: lines.filter((l) => l.status === "unread").length,
  };

  const preview: PastePreview = {
    locale: result.locale,
    choice,
    detected,
    localeUncertain: result.issues.some((i) => i.code === "LOCALE_UNCERTAIN"),
    parts,
    preamble: result.preamble,
    general,
    counts,
    colors: result.colors,
    assembly: result.assembly,
  };
  const title = titleCandidate(text, result.preamble);
  if (title) preview.title = title;
  return preview;
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString("de-DE")} ${n === 1 ? one : many}`;

/** "5 Teile, 87 Runden, 3 Hinweise – 2 Stellen konnten nicht gelesen werden". */
export function summaryText(counts: PreviewCounts): string {
  const head = [
    count(counts.parts, "Teil", "Teile"),
    counts.onlyRows ? count(counts.stitchRows, "Reihe", "Reihen") : count(counts.stitchRows, "Runde", "Runden"),
    count(counts.notices, "Hinweis", "Hinweise"),
  ].join(", ");
  const tail =
    counts.unread === 0
      ? "alles gelesen"
      : counts.unread === 1
        ? "1 Stelle konnte nicht gelesen werden"
        : `${count(counts.unread, "Stelle", "Stellen")} konnten nicht gelesen werden`;
  return `${head} – ${tail}`;
}

/** German words for a part's finish and stuffing (badges in the preview). */
export const FINISH_LABELS: Record<Finish, string> = {
  gather: "zusammengezogen",
  flat: "flach geschlossen",
  open: "offen",
};
export const STUFFING_LABELS: Record<Stuffing, string> = {
  firm: "fest gefüllt",
  light: "leicht gefüllt",
  none: "ungefüllt",
};

/**
 * "Montage: 2 Augen, 4 Teile angenäht, 1 Stickerei" — what the text says about the assembly,
 * or undefined when it says nothing. Sewn-on parts count with their quantity (two ears are
 * two parts), a placement of eyes is a pair.
 */
export function assemblySummary(preview: Pick<PastePreview, "assembly" | "parts">, quantities?: (index: number) => number): string | undefined {
  let eyes = 0;
  let attached = 0;
  let embroidery = 0;
  for (const p of preview.assembly) {
    if (p.kind === "eyes") eyes += 2;
    else if (p.kind === "embroidery") embroidery++;
    else {
      const index = preview.parts.findIndex((part) => part.id === p.part);
      attached += index < 0 ? 1 : (quantities?.(index) ?? preview.parts[index]!.quantity);
    }
  }
  const items = [
    eyes > 0 ? count(eyes, "Auge", "Augen") : "",
    attached > 0 ? `${count(attached, "Teil", "Teile")} angenäht` : "",
    embroidery > 0 ? count(embroidery, "Stickerei", "Stickereien") : "",
  ].filter((s) => s !== "");
  return items.length > 0 ? `Montage: ${items.join(", ")}` : undefined;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

function sameRow(a: Row, b: Row): boolean {
  return (
    a.type === b.type &&
    a.stitchCountTarget === b.stitchCountTarget &&
    a.note === undefined &&
    b.note === undefined &&
    a.label === undefined &&
    b.label === undefined &&
    // A colour change starts a line of its own (it shows as a chip there).
    b.color === undefined &&
    JSON.stringify(a.ops) === JSON.stringify(b.ops)
  );
}

function findingText(finding: Finding, row: Row): string {
  if (finding.code === "STITCH_COUNT_MISMATCH") return `Maschenzahl stimmt nicht: Soll ${finding.expected}, Ist ${finding.actual}.`;
  return findingMessage(finding, row);
}

/**
 * One line per row; consecutive identical stitch rows without remarks collapse into a range
 * ("Runde 5–8"), as patterns write them. A row that changes the colour carries the colour of
 * `colors` it switches to.
 */
export function previewLines(
  rows: readonly Row[],
  findings: readonly Finding[],
  issuesOf: (rowIndex: number) => readonly ImportIssue[],
  colors: readonly ImportedColor[] = [],
): PreviewLine[] {
  const ordinals = rowOrdinals(rows);
  const findingsOf = new Map<string, Finding[]>();
  for (const f of findings) findingsOf.set(f.rowId, [...(findingsOf.get(f.rowId) ?? []), f]);

  const lines: PreviewLine[] = [];
  rows.forEach((row, i) => {
    const issues = issuesOf(i);
    const rowFindings = findingsOf.get(row.id) ?? [];
    const messages: PreviewMessage[] = [
      ...rowFindings.map((f): PreviewMessage => ({ severity: f.severity, text: findingText(f, row) })),
      ...issues.map((issue): PreviewMessage => ({ severity: issue.severity, text: importIssueMessage(issue) })),
    ];
    const stitches = row.ops.length > 0;
    let status: LineStatus = "ok";
    if (!stitches && row.label !== undefined && issues.some((x) => x.severity === "warning")) status = "unread";
    else if (rowFindings.length > 0 || issues.some((x) => x.severity === "warning")) status = "mismatch";
    else if (issues.length > 0) status = "info";

    const previous = lines[lines.length - 1];
    if (
      stitches &&
      status === "ok" &&
      previous &&
      previous.kind === "stitches" &&
      previous.status === "ok" &&
      sameRow(rows[previous.last]!, row)
    ) {
      previous.last = i;
      previous.label = `${rowLabel(rows[previous.first]!, ordinals[previous.first] ?? 0, "de")}–${ordinals[i]}`;
      return;
    }

    const line: PreviewLine = {
      first: i,
      last: i,
      kind: stitches ? "stitches" : "note",
      label: rowLabel(row, ordinals[i] ?? 0, "de"),
      text: stitches ? `${renderOps(row.ops, "de")} (${row.stitchCountTarget})` : (row.note ?? ""),
      status,
      messages,
    };
    if (stitches && row.note) line.text += ` – ${row.note}`;
    const color = row.color === undefined ? undefined : colors.find((c) => c.id === row.color);
    if (color) line.color = color;
    const source = issues[0]?.line;
    if (source !== undefined) line.source = source;
    lines.push(line);
  });
  return lines;
}

// ---------------------------------------------------------------------------
// Source lines
// ---------------------------------------------------------------------------

const ROUND_WORD = "(?:R|Rnds?|Rds?|Rounds?|Rows?|Runden?|Reihen?)";
const DASH = "(?:-|–|—)";
/** "Runde 5", "Rnd 5-8", "R5 – R8" (start, optional end). */
const WORD_LABEL = new RegExp(`(?<![\\p{L}\\d])${ROUND_WORD}\\.?\\s*(\\d{1,3})(?:\\s*${DASH}\\s*(?:${ROUND_WORD}\\.?\\s*)?(\\d{1,3}))?(?!\\d)`, "giu");
/** "5.", "5)", "5:", "5-8.", "5 rnd" at the start of a line. */
const BARE_LABEL = new RegExp(
  `^\\s*(\\d{1,3})(?:\\s*${DASH}\\s*(\\d{1,3}))?\\s*(?:[.):]|\\s(?:rnds?|rounds?|rows?|runden?|reihen?|rd)\\b)`,
  "iu",
);
/** "… (12) 3. (sc, inc) …": a numbered round inside a line (PDF text often has a whole part on one line). */
const INLINE_LABEL = new RegExp(`(?<=^|\\s)(\\d{1,3})(?:\\s*${DASH}\\s*(\\d{1,3}))?[.)](?=\\s)`, "gu");

/** Whether `line` carries a round label covering round `n`. */
function labelsRound(line: string, n: number): boolean {
  const covers = (a: string | undefined, b: string | undefined) => {
    const start = Number(a);
    const end = b === undefined ? start : Number(b);
    return start <= n && n <= Math.max(start, end);
  };
  const bare = BARE_LABEL.exec(line);
  if (bare && covers(bare[1], bare[2])) return true;
  for (const m of line.matchAll(WORD_LABEL)) if (covers(m[1], m[2])) return true;
  for (const m of line.matchAll(INLINE_LABEL)) if (covers(m[1], m[2])) return true;
  return false;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** How far ahead of the last known line a row is looked for. */
const LOOKAHEAD = 60;

/**
 * Fill in `source` for lines without an issue line: notes by their text, stitch rows by their
 * round label ("Runde 7", "7.", "Rnd 5-8"), searching forward from the last known line. Only
 * used to select the text in the dialog — a line that cannot be found stays without source.
 */
export function locateSources(text: string, parts: PreviewPart[]): void {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map(squash);
  let cursor = 0;
  const find = (test: (line: string) => boolean): number | undefined => {
    const end = Math.min(lines.length, cursor + LOOKAHEAD);
    for (let i = cursor; i < end; i++) if (test(lines[i]!)) return i;
    return undefined;
  };
  for (const part of parts) {
    const ordinals = rowOrdinals(part.rows);
    for (const line of part.lines) {
      if (line.source !== undefined) {
        cursor = Math.max(cursor, line.source - 1);
        continue;
      }
      let found: number | undefined;
      if (line.kind === "note") {
        const note = squash(part.rows[line.first]!.note ?? "");
        for (const length of [32, 12]) {
          const needle = note.slice(0, length);
          if (needle.length < 3) break;
          found = find((l) => l.includes(needle));
          if (found !== undefined) break;
        }
      } else {
        const n = ordinals[line.first] ?? 0;
        found = find((l) => labelsRound(l, n));
      }
      if (found !== undefined) {
        line.source = found + 1;
        cursor = found;
      }
    }
  }
}

/**
 * Section headings and preamble starts that are never a title (the engine's preamble words
 * plus the headings patterns use: "Material", "Anleitung", "Pattern", "Hinweise" …).
 */
const NOT_A_TITLE =
  /^\s*(?:materials?|materialien|you\s+will\s+need|you'll\s+need|supplies|tools|abbreviations?|abkürzungen|abkürzung|glossary|legende|notes?|hinweise?|anmerkungen?|tips|anleitung|pattern|gauge|maschenprobe|größe|size|finished\s+size|skill(?:\s+level)?|difficulty|schwierigkeit(?:sgrad)?|yarn|garn|hook(?:\s+size)?|nadel(?:stärke)?|copyright|©|\(c\)|design(?:ed)?\s+by|www\.|https?:)(?![\p{L}])/iu;

/** The first line of the text, when it is in the preamble and reads like a title. */
export function titleCandidate(text: string, preamble: readonly string[]): string | undefined {
  const first = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => squash(l.replace(/ /g, " ")))
    .find((l) => l !== "");
  if (!first || squash(preamble[0] ?? "") !== first) return undefined;
  if (first.length > 60 || /[:;©]|www\.|https?:|\.$/iu.test(first) || NOT_A_TITLE.test(first)) return undefined;
  if (!/\p{L}{2}/u.test(first)) return undefined;
  return first;
}
