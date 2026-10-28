/**
 * One-click fixes for validation findings, offered next to the finding (findings panel and
 * the row's inline list). Pure: every fix is an editor action, so it is one undo step.
 *
 *   STITCH_COUNT_MISMATCH → "Soll auf Ist setzen"; and every repeat count that makes the row
 *                           produce the Soll — consuming exactly what the previous row offers
 *                           ("(2 fM, 1 Abn) ×6" declared 27 after 36 → "×9")
 *   CONSUMES_UNDERFLOW    → "Rest mit n fM auffüllen"; a repeat count that uses every stitch
 *   CONSUMES_OVERFLOW     → the nearest (largest) repeat count that fits into the previous
 *                           row; else, when the last stitch can absorb the excess, shortening it
 *
 * Repeat counts are solved arithmetically: a row's stitch count and consumption are linear in
 * the times of any one repeat group (count = rest + times · per).
 */

import {
  MAX_TIMES,
  anchorsConsumed,
  computeRowStitches,
  consumesOf,
  isRingRow,
  type Finding,
  type Op,
  type Row,
} from "@crochetbuilder/engine";
import type { EditorAction } from "./editor.js";
import * as tree from "./op-tree.js";
import { previousCountAt } from "./rounds.js";
import type { OpPath } from "./op-tree.js";

export interface QuickFix {
  /** Button text ("Soll auf Ist setzen"). */
  label: string;
  /** Longer explanation for the button's title. */
  title: string;
  action: EditorAction;
}

/** Paths of all repeat groups in the op tree, outermost first. */
export function repeatPaths(ops: readonly Op[], prefix: OpPath = []): OpPath[] {
  const out: OpPath[] = [];
  ops.forEach((op, i) => {
    if (op.kind !== "repeat") return;
    const path = [...prefix, i];
    out.push(path, ...repeatPaths(op.ops, path));
  });
  return out;
}

function withTimes(row: Row, path: OpPath, times: number): Row {
  return { ...row, ops: tree.updateOp(row.ops, path, (op) => (op.kind === "repeat" ? { ...op, times } : op)) };
}

interface Linear {
  rest: number;
  per: number;
}

/** `metric(row with the group at path worked t times)` = rest + t · per. */
function linear(row: Row, path: OpPath, metric: (r: Row) => number): Linear {
  const one = metric(withTimes(row, path, 1));
  const two = metric(withTimes(row, path, 2));
  return { rest: one - (two - one), per: two - one };
}

/** Whole times t ≥ 1 with rest + t · per = goal, or null. */
function solve({ rest, per }: Linear, goal: number): number | null {
  if (per <= 0) return null;
  const t = (goal - rest) / per;
  return Number.isInteger(t) && t >= 1 && t <= MAX_TIMES ? t : null;
}

function timesAt(row: Row, path: OpPath): number {
  const op = tree.getOp(row.ops, path);
  return op?.kind === "repeat" ? op.times : 0;
}

function repeatFix(row: Row, path: OpPath, times: number): QuickFix {
  return {
    label: `Wiederholung auf ×${times} ändern`,
    title: `Die Wiederholung ${timesAt(row, path)}× statt dessen ${times}× arbeiten`,
    action: { type: "setRowOps", rowId: row.id, ops: withTimes(row, path, times).ops },
  };
}

/** Different repeat counts, at most `limit`, that satisfy `pick` (one per repeat group). */
function repeatFixes(row: Row, pick: (path: OpPath) => number | null, limit = 2): QuickFix[] {
  const fixes: QuickFix[] = [];
  const seen = new Set<string>();
  for (const path of repeatPaths(row.ops)) {
    const times = pick(path);
    if (times === null || times === timesAt(row, path)) continue;
    const fix = repeatFix(row, path, times);
    const key = JSON.stringify(fix.action);
    if (seen.has(key)) continue;
    seen.add(key);
    fixes.push(fix);
    if (fixes.length >= limit) break;
  }
  return fixes;
}

/** `ops` plus `n` single crochets at the end (merged into a trailing plain "fM"). */
function appendSingleCrochets(ops: readonly Op[], n: number): Op[] {
  const last = ops[ops.length - 1];
  if (last?.kind === "stitch" && last.code === "SC" && !last.modifiers && !last.into) {
    return [...ops.slice(0, -1), { ...last, count: last.count + n }];
  }
  return [...ops, { kind: "stitch", code: "SC", count: n }];
}

/** Fixes for `finding`; `rows` are the rows of the finding's part. */
export function quickFixes(finding: Finding, rows: readonly Row[]): QuickFix[] {
  const row = rows.find((r) => r.id === finding.rowId);
  if (!row) return [];
  const offered = finding.expected;
  switch (finding.code) {
    case "STITCH_COUNT_MISMATCH": {
      const target = row.stitchCountTarget;
      const adopt: QuickFix = {
        label: "Soll auf Ist setzen",
        title: `Soll-Maschenzahl auf ${computeRowStitches(row)} setzen`,
        action: { type: "adoptTarget", rowId: row.id },
      };
      // The previous row's offer, if the row is worked into one (not a ring start).
      const index = rows.indexOf(row);
      const anchor = isRingRow(row) ? undefined : previousCountAt(rows, index);
      const fixes = repeatFixes(row, (path) => {
        const times = solve(linear(row, path, computeRowStitches), target);
        if (times === null || anchor === undefined) return times;
        return anchorsConsumed(withTimes(row, path, times)) === anchor ? times : null;
      });
      return [adopt, ...fixes];
    }
    case "CONSUMES_UNDERFLOW": {
      if (offered === undefined || finding.actual === undefined) return [];
      const left = offered - finding.actual;
      const fill: QuickFix = {
        label: `Rest mit ${left} fM auffüllen`,
        title: `${left} feste ${left === 1 ? "Masche" : "Maschen"} ans Ende der Runde setzen`,
        action: { type: "setRowOps", rowId: row.id, ops: appendSingleCrochets(row.ops, left) },
      };
      const fixes = repeatFixes(row, (path) => solve(linear(row, path, anchorsConsumed), offered));
      return [fill, ...fixes];
    }
    case "CONSUMES_OVERFLOW": {
      if (offered === undefined || finding.actual === undefined) return [];
      const fixes = repeatFixes(row, (path) => {
        const { rest, per } = linear(row, path, anchorsConsumed);
        if (per <= 0) return null;
        const times = Math.floor((offered - rest) / per);
        return times >= 1 ? times : null;
      });
      if (fixes.length > 0) return fixes;
      const shorten = shortenLast(row, finding.actual - offered);
      return shorten ? [shorten] : [];
    }
    default:
      return [];
  }
}

/** The last top-level stitch made shorter by `excess` consumed stitches, if it divides. */
function shortenLast(row: Row, excess: number): QuickFix | null {
  const index = row.ops.length - 1;
  const last = row.ops[index];
  if (last?.kind !== "stitch") return null;
  const each = consumesOf(last);
  if (each <= 0 || excess % each !== 0) return null;
  const count = last.count - excess / each;
  if (count < 1) return null;
  const ops = [...row.ops];
  ops[index] = { ...last, count };
  return {
    label: `Auf ${count} statt ${last.count} kürzen`,
    title: `Die letzte Angabe so kürzen, dass die Runde in die Maschen der Vorrunde passt`,
    action: { type: "setRowOps", rowId: row.id, ops },
  };
}
