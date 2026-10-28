/**
 * Display grouping of the row list: consecutive identical stitch rows show as one card
 * ("Runde 7–12 · 6 Runden"), like patterns write them. Display only — the rows stay separate
 * in the document with their own ids; edits on a group card go to every row of the group.
 *
 * Rows group when they have the same type, ops, Soll and note, no own label and the same
 * findings (a row whose check differs — the first of a run after a change of count — stands
 * out as its own card, so a finding always names the card it belongs to). A colour change of
 * the row (`Row.color`) may only sit on the first row of a card (E26).
 *
 * Two things keep cards apart that would otherwise group:
 *   - `split`: runs the user split ("aufteilen"), each as the row ids of the run at that time.
 *     A split holds only while exactly these rows still form the run; any change of the run
 *     (an edit, a copy added by "×N", a row removed) groups it again.
 *   - `held`: the rows of the card being edited. They neither join a neighbouring card nor
 *     take one in until the editor releases them (focus leaves the card), so a card never
 *     changes under the cursor.
 */

import type { Finding, Row } from "@crochetbuilder/engine";
import { isStitchRow } from "./rounds.js";

export interface RowItem {
  /** Index of the first row in the part. */
  start: number;
  /** One row, or the rows of a group (two or more). */
  rows: Row[];
  /** On the first card of a split run: the run (to group it again, "zusammenfassen"). */
  splitRun?: readonly string[];
}

export interface GroupOptions {
  split?: readonly (readonly string[])[];
  /** Findings per row id. */
  findings?: ReadonlyMap<string, readonly Finding[]>;
  held?: ReadonlySet<string>;
}

function groupKey(row: Row, findings: readonly Finding[] | undefined): string | null {
  if (!isStitchRow(row) || row.label?.trim()) return null;
  const checks = (findings ?? []).map((f) => [f.code, f.expected ?? null, f.actual ?? null]);
  // Ops compared structurally (stitch groups and colour changes included). The row's own colour
  // is not part of the key: a colour change belongs to the first row of a run (E26), and a later
  // row with a colour of its own starts a new run (see `naturalRuns`).
  return JSON.stringify([row.type, row.ops, row.stitchCountTarget, row.note ?? null, checks]);
}

const sameIds = (a: readonly string[], b: readonly Row[]) => a.length === b.length && a.every((id, i) => b[i]!.id === id);

/** Runs of identical rows, ignoring `split` and `held`. */
export function naturalRuns(rows: readonly Row[], findings: ReadonlyMap<string, readonly Finding[]> = new Map()): RowItem[] {
  const runs: RowItem[] = [];
  let previousKey: string | null = null;
  rows.forEach((row, i) => {
    const key = groupKey(row, findings.get(row.id));
    const current = runs[runs.length - 1];
    // A row that changes colour itself only ever starts a run ("Runde 5–8" in Rosa from round 5).
    if (key !== null && key === previousKey && current && row.color === undefined) current.rows.push(row);
    else runs.push({ start: i, rows: [row] });
    previousKey = key;
  });
  return runs;
}

/** The entries of `split` that still match a run of identical rows (the others are stale). */
export function activeSplits(
  rows: readonly Row[],
  split: readonly (readonly string[])[],
  findings: ReadonlyMap<string, readonly Finding[]> = new Map(),
): Array<readonly string[]> {
  const runs = naturalRuns(rows, findings).filter((run) => run.rows.length > 1);
  return split.filter((ids) => runs.some((run) => sameIds(ids, run.rows)));
}

/** Rows → cards: single rows and runs of identical rows (see the module doc). */
export function groupRows(rows: readonly Row[], options: GroupOptions = {}): RowItem[] {
  const { split = [], held = new Set<string>() } = options;
  const items: RowItem[] = [];
  for (const run of naturalRuns(rows, options.findings)) {
    const splitRun = run.rows.length > 1 ? split.find((ids) => sameIds(ids, run.rows)) : undefined;
    if (splitRun) {
      run.rows.forEach((row, i) => items.push(i === 0 ? { start: run.start, rows: [row], splitRun } : { start: run.start + i, rows: [row] }));
      continue;
    }
    // The card being edited keeps its rows: cut the run where held and free rows meet.
    run.rows.forEach((row, i) => {
      const current = items[items.length - 1];
      const joins = i > 0 && held.has(row.id) === held.has(run.rows[i - 1]!.id);
      if (joins && current) current.rows.push(row);
      else items.push({ start: run.start + i, rows: [row] });
    });
  }
  return items;
}

/** A finding as a list shows it: once for a card (all rows of a group share their findings). */
export interface CardFinding {
  finding: Finding;
  /** The rows of the card it stands for (fixes go to all of them). */
  rowIds: string[];
  /** "Runde 7–12", or the row's own label for a single card. */
  label: string;
}

/**
 * Findings in document order, one entry per card and finding: the rows of a group card have
 * the same findings, so "Runde 5–8: …" stands for all of them. `labels` per row id.
 */
export function cardFindings(
  findings: readonly Finding[],
  items: readonly RowItem[],
  labels: ReadonlyMap<string, string>,
): CardFinding[] {
  const itemOf = new Map<string, RowItem>();
  for (const item of items) for (const row of item.rows) itemOf.set(row.id, item);
  const seen = new Set<string>();
  const out: CardFinding[] = [];
  for (const finding of findings) {
    const item = itemOf.get(finding.rowId);
    if (!item || item.rows.length === 1) {
      out.push({ finding, rowIds: [finding.rowId], label: labels.get(finding.rowId) ?? "" });
      continue;
    }
    const ids = item.rows.map((r) => r.id);
    const key = `${ids[0]}|${finding.code}|${finding.expected}|${finding.actual}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = rangeLabel(labels.get(ids[0]!) ?? "", labels.get(ids[ids.length - 1]!) ?? "");
    out.push({ finding, rowIds: ids, label });
  }
  return out;
}

/**
 * "Runde 7–12" from the labels of the first and last row ("Runde 7", "Runde 12"); labels of
 * another form are joined with a dash.
 */
export function rangeLabel(first: string, last: string): string {
  if (first === last) return first;
  const a = /^(.*\S)\s+(\d+)$/.exec(first);
  const b = /^(.*\S)\s+(\d+)$/.exec(last);
  if (a && b && a[1] === b[1]) return `${a[1]} ${a[2]}–${b[2]}`;
  return `${first} – ${last}`;
}

/** "6 Runden" / "2 Reihen". */
export function countLabel(n: number, type: Row["type"]): string {
  if (type === "row") return `${n} ${n === 1 ? "Reihe" : "Reihen"}`;
  return `${n} ${n === 1 ? "Runde" : "Runden"}`;
}
