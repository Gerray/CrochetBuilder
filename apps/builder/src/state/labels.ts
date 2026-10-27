/**
 * Row labels as the editor shows them — one helper for the row list and the preview, so
 * the same row is never called "Runde 3" in one place and "Runde 4" in the other.
 */

import { rowLabel, rowOrdinals, type Op, type Row } from "@crochetbuilder/engine";

/**
 * A free instruction row as the editor shows it: no stitches, but a note field (possibly
 * still empty). An empty row without a note is a stitch row that is being written.
 */
export function isInstructionLike(row: Row): boolean {
  return row.ops.length === 0 && row.note !== undefined;
}

const PLACEHOLDER_OP: Op = { kind: "stitch", code: "ST", count: 1 };

/**
 * Automatic label per row ("Runde 3", "Reihe 2", "Hinweis"), ignoring own labels, via
 * `rowOrdinals`/`rowLabel`. A stitch row that is still empty already counts as the next
 * round ("Runde 9" while typing it).
 */
export function autoRowLabels(rows: readonly Row[]): string[] {
  const counted = rows.map((r) => ({
    ...r,
    label: undefined,
    ops: r.ops.length === 0 && !isInstructionLike(r) ? [PLACEHOLDER_OP] : r.ops,
  }));
  const ordinals = rowOrdinals(counted);
  return counted.map((r, i) => rowLabel(r, ordinals[i] ?? 0, "de"));
}

/** Display label per row: the own label if set, else the automatic one. */
export function displayRowLabels(rows: readonly Row[]): string[] {
  const auto = autoRowLabels(rows);
  return rows.map((r, i) => r.label?.trim() || auto[i] || "");
}
