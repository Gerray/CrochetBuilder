/**
 * Display grouping of the row list: consecutive identical stitch rows show as one card
 * ("Runde 7–12 · 6 Runden"), like patterns write them. Display only — the rows stay separate
 * in the document with their own ids; edits on a group card go to every row of the group.
 *
 * Rows group when they have the same type, ops, Soll and note, no own label, and none of them
 * was split off by the user ("aufteilen" puts their ids into `split`).
 */

import type { Row } from "@crochetbuilder/engine";
import { isStitchRow } from "./rounds.js";

export interface RowItem {
  /** Index of the first row in the part. */
  start: number;
  /** One row, or the rows of a group (two or more). */
  rows: Row[];
}

function groupKey(row: Row): string | null {
  if (!isStitchRow(row) || row.label?.trim()) return null;
  return JSON.stringify([row.type, row.ops, row.stitchCountTarget, row.note ?? null]);
}

/** Rows → cards: single rows and runs of identical rows. */
export function groupRows(rows: readonly Row[], split: ReadonlySet<string> = new Set()): RowItem[] {
  const items: RowItem[] = [];
  let previousKey: string | null = null;
  rows.forEach((row, i) => {
    const key = split.has(row.id) ? null : groupKey(row);
    const current = items[items.length - 1];
    if (key !== null && key === previousKey && current) current.rows.push(row);
    else items.push({ start: i, rows: [row] });
    previousKey = key;
  });
  return items;
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
