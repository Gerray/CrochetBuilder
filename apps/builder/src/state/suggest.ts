/**
 * The next round the editor suggests for an empty row (Enter at the last row creates one):
 *
 *   - no stitch row before it            → "1 MR, 6 fM" (magic-ring start)
 *   - increase progression               → the next increase round with the same number
 *     (6, 12, 18 … — two equal increases;   of increases, spread evenly: after 6, 12, 18
 *     a ring row counts as "from 0")        comes "6× (2 fM, 1 Zun)" (24)
 *   - the last round decreased           → the next decrease round of the same size, the
 *                                           mirror pattern: after 24 → 18 comes
 *                                           "6× (1 fM, 1 Abn)" (12)
 *   - otherwise                          → an even round: a copy of the previous round when
 *                                           it was a plain one ("24 fM", "1 Lm, 20 fM",
 *                                           "24 hStb"), else "N fM" with N = its count
 *
 * One decrease is enough to continue (after the even rounds of a ball the decreases run to
 * the end); an increase needs two in a row, because a single one is often followed by even
 * rounds (a body widening once).
 */

import { anchorsConsumed, anchorsOffered, isRingRow, renderOps, type Op, type Row } from "@crochetbuilder/engine";
import {
  decreaseRound,
  increaseRound,
  isStitchRow,
  plainRound,
  ringStart,
  rowCount,
  type RoundSpec,
} from "./rounds.js";

export type SuggestionKind = "start" | "increase" | "decrease" | "even";

export interface RowSuggestion extends RoundSpec {
  /** The ops as the row's text field shows them ("6× (2 fM, 1 Zun)"). */
  text: string;
  kind: SuggestionKind;
}

const PLAIN_CODES = new Set(["CH", "SL_ST", "SC", "HDC", "DC", "TR", "DTR", "ST"]);

function plainOnly(ops: readonly Op[]): boolean {
  return ops.every((op) => (op.kind === "stitch" ? PLAIN_CODES.has(op.code) : plainOnly(op.ops)));
}

/** A round without shaping: no ring, no increases or decreases, one stitch into each. */
function isEvenRound(row: Row): boolean {
  return !isRingRow(row) && plainOnly(row.ops) && rowCount(row) > 0 && anchorsConsumed(row) === rowCount(row);
}

function suggestion(spec: RoundSpec, kind: SuggestionKind): RowSuggestion {
  return { ...spec, ops: structuredClone(spec.ops), text: renderOps(spec.ops, "de"), kind };
}

/** The suggestion for the row at `index` of `rows` (the rows of one part). */
export function suggestNextRow(rows: readonly Row[], index: number): RowSuggestion {
  const stitchRows = rows.slice(0, Math.max(0, index)).filter(isStitchRow);
  const last = stitchRows[stitchRows.length - 1];
  if (!last) return suggestion(ringStart(6), "start");

  const count = rowCount(last);
  // A foundation chain makes no stitches of its own but offers one per chain.
  if (count === 0) return suggestion(plainRound(Math.max(1, anchorsOffered(last))), "even");

  const before = stitchRows[stitchRows.length - 2];
  const beforeBefore = stitchRows[stitchRows.length - 3];
  // Stitches before the last round; a ring round grows from nothing.
  const previous = isRingRow(last) ? 0 : before ? rowCount(before) : undefined;
  const previous2 = before === undefined ? undefined : isRingRow(before) ? 0 : beforeBefore ? rowCount(beforeBefore) : undefined;

  if (previous !== undefined) {
    const delta = count - previous;
    if (delta > 0 && (isRingRow(last) || (previous2 !== undefined && previous - previous2 === delta))) {
      const next = increaseRound(count, delta);
      if (next) return suggestion(next, "increase");
    }
    if (delta < 0) {
      const next = decreaseRound(count, -delta);
      if (next) return suggestion(next, "decrease");
    }
  }

  if (isEvenRound(last)) return suggestion({ ops: last.ops, count }, "even");
  return suggestion(plainRound(count), "even");
}
