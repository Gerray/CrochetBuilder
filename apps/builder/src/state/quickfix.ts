/**
 * One-click fixes for validation findings, offered next to the finding (findings panel and
 * the row's inline list). Pure: every fix is an editor action, so it is one undo step.
 *
 *   STITCH_COUNT_MISMATCH → "Soll auf Ist setzen"; and every repeat count that makes the row
 *                           produce the Soll — consuming exactly what the previous row offers
 *                           ("(2 fM, 1 Abn) ×6" declared 27 after 36 → "×9")
 *   CONSUMES_UNDERFLOW    → "Rest mit n fM auffüllen"; a repeat count that uses every stitch
 *   CONSUMES_OVERFLOW     → a repeat count that uses exactly the previous row's stitches; else
 *                           the nearest one that fits plus the rest in fM (never stitches left
 *                           free); else the last stitch shortened
 *
 * A consumption fix changes the row's stitch count. With an automatic Soll that is fine (it
 * follows). With an explicit Soll, fixes that keep the Soll come first; the others say so in
 * their label ("… (Soll 32)") and set the Soll along with the stitches.
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
import type { OpPath } from "./op-tree.js";
import { previousCountAt } from "./rounds.js";

export interface QuickFix {
  /** Button text ("Soll auf Ist setzen"). */
  label: string;
  /** Longer explanation for the button's title. */
  title: string;
  action: EditorAction;
}

/** A new op list for the row, before the Soll is taken into account. */
interface Candidate {
  label: string;
  title: string;
  ops: Op[];
}

/** Most repeat-count fixes offered for one finding. */
const MAX_REPEAT_FIXES = 2;

/**
 * Paths of all repeat groups in the op tree, outermost first. Stitch groups ("in dieselbe
 * Masche") and the repeats inside them are left alone: they are worked into one stitch, so
 * their times are no lever on how many stitches the row uses.
 */
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

function repeatCandidate(row: Row, path: OpPath, times: number): Candidate {
  return {
    label: `Wiederholung auf ×${times} ändern`,
    title: `Die Wiederholung ${times}× statt ${timesAt(row, path)}× arbeiten`,
    ops: withTimes(row, path, times).ops,
  };
}

/** One candidate per repeat group whose new times `pick` returns (unchanged times skipped). */
function repeatCandidates(row: Row, pick: (path: OpPath) => Candidate | null): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const path of repeatPaths(row.ops)) {
    const candidate = pick(path);
    if (!candidate) continue;
    const key = JSON.stringify(candidate.ops);
    if (seen.has(key) || key === JSON.stringify(row.ops)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

/** `ops` plus `n` single crochets at the end (merged into a trailing plain "fM"). */
function appendSingleCrochets(ops: readonly Op[], n: number): Op[] {
  const last = ops[ops.length - 1];
  if (last?.kind === "stitch" && last.code === "SC" && !last.modifiers?.length && !last.into && last.color === undefined) {
    return [...ops.slice(0, -1), { ...last, count: last.count + n }];
  }
  return [...ops, { kind: "stitch", code: "SC", count: n }];
}

/** The row's Soll was declared (typed or imported, > 0) rather than following the Ist. */
export function hasExplicitTarget(row: Row, pinned: readonly string[]): boolean {
  if (row.stitchCountTarget === 0) return false;
  return pinned.includes(row.id) || row.stitchCountTarget !== computeRowStitches(row);
}

/**
 * Candidates → fixes. With an explicit Soll, the ones that keep it come first; the others set
 * the Soll too and say so.
 */
function finish(row: Row, candidates: readonly Candidate[], explicit: boolean, limit: number): QuickFix[] {
  const target = row.stitchCountTarget;
  const fixes = candidates.map((c) => {
    const count = computeRowStitches({ ...row, ops: c.ops });
    const keepsTarget = !explicit || count === target;
    const fix: QuickFix = keepsTarget
      ? { label: c.label, title: c.title, action: { type: "setRowOps", rowId: row.id, ops: c.ops } }
      : {
          label: `${c.label} (Soll ${count})`,
          title: `${c.title}; das Soll ändert sich dabei von ${target} auf ${count}`,
          action: { type: "setRowOps", rowId: row.id, ops: c.ops, target: count },
        };
    return { fix, keepsTarget };
  });
  // Stable: fixes that keep the Soll first.
  return [...fixes.filter((f) => f.keepsTarget), ...fixes.filter((f) => !f.keepsTarget)]
    .slice(0, limit)
    .map((f) => f.fix);
}

/**
 * Fixes for `finding`; `rows` are the rows of the finding's part, `pinned` the rows whose
 * Soll was set explicitly.
 */
export function quickFixes(finding: Finding, rows: readonly Row[], pinned: readonly string[] = []): QuickFix[] {
  const row = rows.find((r) => r.id === finding.rowId);
  if (!row) return [];
  const offered = finding.expected;
  const explicit = hasExplicitTarget(row, pinned);
  switch (finding.code) {
    case "STITCH_COUNT_MISMATCH": {
      const target = row.stitchCountTarget;
      const adopt: QuickFix = {
        label: "Soll auf Ist setzen",
        title: `Soll-Maschenzahl auf ${computeRowStitches(row)} setzen`,
        action: { type: "adoptTarget", rowId: row.id },
      };
      // The previous row's offer, if the row is worked into one (not a ring start, and not
      // around a chain: both sides of it, with the usual skips at the ends).
      const anchor = isRingRow(row) || row.around ? undefined : previousCountAt(rows, rows.indexOf(row));
      const candidates = repeatCandidates(row, (path) => {
        const times = solve(linear(row, path, computeRowStitches), target);
        if (times === null) return null;
        if (anchor !== undefined && anchorsConsumed(withTimes(row, path, times)) !== anchor) return null;
        return repeatCandidate(row, path, times);
      });
      // Every candidate makes exactly the Soll.
      return [adopt, ...finish(row, candidates, false, MAX_REPEAT_FIXES)];
    }
    case "CONSUMES_UNDERFLOW": {
      if (offered === undefined || finding.actual === undefined) return [];
      const left = offered - finding.actual;
      const fill: Candidate = {
        label: `Rest mit ${left} fM auffüllen`,
        title: `${left} feste ${left === 1 ? "Masche" : "Maschen"} ans Ende setzen`,
        ops: appendSingleCrochets(row.ops, left),
      };
      const repeats = repeatCandidates(row, (path) => {
        const times = solve(linear(row, path, anchorsConsumed), offered);
        return times === null ? null : repeatCandidate(row, path, times);
      });
      return finish(row, [fill, ...repeats], explicit, 1 + MAX_REPEAT_FIXES);
    }
    case "CONSUMES_OVERFLOW": {
      if (offered === undefined || finding.actual === undefined) return [];
      const exact = repeatCandidates(row, (path) => {
        const times = solve(linear(row, path, anchorsConsumed), offered);
        return times === null ? null : repeatCandidate(row, path, times);
      });
      if (exact.length > 0) return finish(row, exact, explicit, MAX_REPEAT_FIXES);
      // No repeat count fits exactly: the nearest smaller one, the rest in single crochets.
      const nearest = repeatCandidates(row, (path) => {
        const { rest, per } = linear(row, path, anchorsConsumed);
        if (per <= 0) return null;
        const times = Math.min(MAX_TIMES, Math.floor((offered - rest) / per));
        if (times < 1) return null;
        const fitted = withTimes(row, path, times);
        const left = offered - anchorsConsumed(fitted);
        if (left === 0) return repeatCandidate(row, path, times);
        return {
          label: `Wiederholung auf ×${times}, Rest mit ${left} fM`,
          title: `Die Wiederholung ${times}× statt ${timesAt(row, path)}× arbeiten und ${left} fM ans Ende setzen`,
          ops: appendSingleCrochets(fitted.ops, left),
        };
      });
      if (nearest.length > 0) return finish(row, nearest, explicit, MAX_REPEAT_FIXES);
      const shorten = shortenLast(row, finding.actual - offered);
      return shorten ? finish(row, [shorten], explicit, 1) : [];
    }
    default:
      return [];
  }
}

/** The last top-level stitch made shorter by `excess` consumed stitches, if it divides. */
function shortenLast(row: Row, excess: number): Candidate | null {
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
    title: "Die letzte Angabe so kürzen, dass sie genau in die Maschen davor passt",
    ops,
  };
}
