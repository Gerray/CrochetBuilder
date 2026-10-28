/**
 * The next round the editor suggests for an empty row (Enter at the last row creates one):
 *
 *   - no stitch row before it            → "1 MR, 6 fM" (magic-ring start); none for a piece
 *                                           worked in rows (it starts with a chain of any length)
 *   - increase progression               → the next increase round with the same number
 *     (6, 12, 18 … — two equal, evenly      of increases, spread evenly: after 6, 12, 18
 *     spread increases; a ring row counts   comes "6× (2 fM, 1 Zun)" (24)
 *     as "from 0")
 *   - an evenly spread decrease          → the next decrease round of the same size, the
 *                                           mirror pattern: after 24 → 18 comes
 *                                           "6× (1 fM, 1 Abn)" (12) — never below 6 stitches
 *   - otherwise                          → an even round: a copy of the previous round when
 *                                           it was a plain one ("24 fM", "1 Lm, 20 fM",
 *                                           "24 hStb" — no modifiers, colour changes, groups or
 *                                           special stitches), else "N fM" with N = its count
 *
 * One decrease is enough to continue (after the even rounds of a ball the decreases run to
 * the end); an increase needs two in a row, because a single one is often followed by even
 * rounds (a body widening once). In a piece worked in rows, generated rows start with the
 * turning chain ("1 Lm, …"), like the potholder demo.
 */

import { anchorsConsumed, anchorsOffered, isRingRow, renderOps, type Op, type Row } from "@crochetbuilder/engine";
import {
  decreaseRound,
  increaseRound,
  isStitchRow,
  plainRound,
  ringStart,
  rowCount,
  withTurningChain,
  type RoundSpec,
} from "./rounds.js";

export type SuggestionKind = "start" | "increase" | "decrease" | "even";

export interface RowSuggestion extends RoundSpec {
  /** The ops as the row's text field shows them ("6× (2 fM, 1 Zun)"). */
  text: string;
  kind: SuggestionKind;
}

/** Decreases stop here (a ball closes at 6). */
export const MIN_DECREASE_COUNT = 6;

const PLAIN_CODES = new Set(["CH", "SL_ST", "SC", "HDC", "DC", "TR", "DTR", "ST"]);

/**
 * Plain stitches only: no shaping, no special stitches (bobble, puff …), no modifiers (BLO,
 * FLO, FP …), no "into" notes, no colour changes, no groups "in dieselbe Masche".
 */
function plainOnly(ops: readonly Op[]): boolean {
  return ops.every((op) => {
    if (op.kind === "group") return false;
    if (op.kind === "repeat") return plainOnly(op.ops);
    return PLAIN_CODES.has(op.code) && !op.modifiers?.length && !op.into && op.color === undefined;
  });
}

/** A round without shaping: no ring, no increases or decreases, one stitch into each. */
function isEvenRound(row: Row): boolean {
  return (
    row.color === undefined &&
    !isRingRow(row) &&
    plainOnly(row.ops) &&
    rowCount(row) > 0 &&
    anchorsConsumed(row) === rowCount(row)
  );
}

const isPlainStitch = (op: Op, code: string) =>
  op.kind === "stitch" && op.code === code && !op.modifiers?.length && !op.into && op.color === undefined;

/**
 * Sections of an evenly spread increase/decrease round ("6 Zun", "6× (2 fM, 1 Abn)", also
 * with a turning chain in front), or null when the round is shaped any other way.
 */
export function evenSpread(ops: readonly Op[], code: "INC" | "DEC"): number | null {
  const body = ops[0] && isPlainStitch(ops[0], "CH") ? ops.slice(1) : ops;
  if (body.length !== 1) return null;
  const op = body[0]!;
  if (op.kind === "stitch") return isPlainStitch(op, code) ? op.count : null;
  if (op.kind === "group") return null;
  const shaped = op.ops.filter((o) => isPlainStitch(o, code));
  const rest = op.ops.filter((o) => !isPlainStitch(o, code));
  if (shaped.length !== 1 || (shaped[0] as { count: number }).count !== 1) return null;
  return rest.every((o) => isPlainStitch(o, "SC")) ? op.times : null;
}

function suggestion(spec: RoundSpec, kind: SuggestionKind, flat = false): RowSuggestion {
  const ops = flat ? withTurningChain(spec.ops) : structuredClone(spec.ops);
  return { ops, count: spec.count, text: renderOps(ops, "de"), kind };
}

/**
 * The suggestion for the row at `index` of `rows` (the rows of one part), or null when there
 * is nothing sensible to offer.
 */
export function suggestNextRow(rows: readonly Row[], index: number): RowSuggestion | null {
  const stitchRows = rows.slice(0, Math.max(0, index)).filter(isStitchRow);
  const last = stitchRows[stitchRows.length - 1];
  const flat = (rows[index]?.type ?? last?.type) === "row";
  if (!last) return flat ? null : suggestion(ringStart(6), "start");

  const count = rowCount(last);
  // A foundation chain makes no stitches of its own but offers one per chain.
  if (count === 0) return suggestion(plainRound(Math.max(1, anchorsOffered(last))), "even", flat);

  const before = stitchRows[stitchRows.length - 2];
  const beforeBefore = stitchRows[stitchRows.length - 3];
  // Stitches before the last round; a ring round grows from nothing.
  const previous = isRingRow(last) ? 0 : before ? rowCount(before) : undefined;
  const previous2 = before === undefined ? undefined : isRingRow(before) ? 0 : beforeBefore ? rowCount(beforeBefore) : undefined;

  if (previous !== undefined) {
    const delta = count - previous;
    const spreadIncrease = isRingRow(last) || evenSpread(last.ops, "INC") === delta;
    if (delta > 0 && spreadIncrease && (isRingRow(last) || (previous2 !== undefined && previous - previous2 === delta))) {
      const next = increaseRound(count, delta);
      if (next) return suggestion(next, "increase", flat);
    }
    if (delta < 0 && evenSpread(last.ops, "DEC") === -delta) {
      const next = decreaseRound(count, -delta);
      if (next && next.count >= MIN_DECREASE_COUNT) return suggestion(next, "decrease", flat);
    }
  }

  if (isEvenRound(last)) return suggestion({ ops: last.ops, count }, "even");
  return suggestion(plainRound(count), "even", flat);
}
