/**
 * Deterministic stitch-count check — the load-bearing guarantee layer for the
 * import pipeline (PLAN.md "Import-Pipeline" step 4 + "%-Basis-Test").
 *
 * Server-side Zod parsing validates the *shape* of a PartContent, but a recursive
 * RepeatGroup tree cannot enforce that a row actually works the declared number of
 * stitches. This module closes that gap: it expands every row's op-tree and compares
 * the computed actual count against the author-declared `stitchCountTarget`.
 *
 * Stitch-count properties come from STITCH_PROPERTIES in the canonical schema
 * (TMC-54) — deliberately NOT from the render glossary (TMC-55), so the numeric
 * guarantee stays independent of any display/language concern.
 */

import { STITCH_PROPERTIES } from "./schema.js";
import type { Op, PartContent, Row } from "./schema.js";

/**
 * Stitches produced by a single op, recursing into repeat groups.
 *
 *   - stitch op: `count × producesStitches(code)`. Modifiers (BLO/FLO/TOG) and the
 *     display-only `into` note never change the count.
 *   - repeat group: `times × Σ(producesStitches of its ops)`, recursing so nested
 *     groups multiply through.
 *   - stitch group: `Σ(producesStitches of its ops)` ("3 SC in one stitch" → 3).
 */
function computeOpStitches(op: Op): number {
  if (op.kind === "stitch") {
    return op.count * STITCH_PROPERTIES[op.code].producesStitches;
  }
  // RepeatGroup: sum the body once, then multiply by how often it repeats. A stitch group
  // (format v2) produces the sum of its stitches, all worked into one stitch.
  const perIteration = op.ops.reduce((sum, inner) => sum + computeOpStitches(inner), 0);
  return op.kind === "group" ? perIteration : op.times * perIteration;
}

/**
 * Actual stitch count a row produces, by expanding its op-tree.
 *
 * @example
 *   computeRowStitches({ ..., ops: [{ kind: "stitch", code: "INC", count: 6 }] }) // 12
 */
export function computeRowStitches(row: Row): number {
  return row.ops.reduce((sum, op) => sum + computeOpStitches(op), 0);
}

/** Per-row comparison of the computed actual count against the declared target. */
export interface RowStitchCheck {
  /** The row's stable id (carries through editor reordering). */
  rowId: string;
  /** Author-declared `stitchCountTarget` for the row. */
  expected: number;
  /** Computed stitch count from expanding the row's ops. */
  actual: number;
  /** `true` when `actual === expected`. */
  ok: boolean;
}

/**
 * Check every row in a part: computed actual vs. declared `stitchCountTarget`.
 * Returns one finding per row, in document order, each keyed by `rowId` so the
 * editor can flag the exact offending row.
 */
export function checkPart(content: PartContent): RowStitchCheck[] {
  return content.rows.map((row) => {
    const actual = computeRowStitches(row);
    const expected = row.stitchCountTarget;
    return { rowId: row.id, expected, actual, ok: actual === expected };
  });
}
