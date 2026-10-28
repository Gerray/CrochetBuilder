/**
 * Validation — everything the engine can say about a part before building a graph.
 *
 * Two deterministic checks, both per row and keyed by the stable row id:
 *
 *   1. Stitch count: the row's expanded ops must produce exactly `stitchCountTarget`
 *      fabric stitches (TellmeCrochet's existing guarantee layer, `checkPart`).
 *   2. Consumes: the stitches a row is worked into must exist. Each worked stitch
 *      consumes `consumesStitches` anchors of the previous stitch row; the previous row
 *      offers as many anchors as it produced fabric stitches — except a foundation chain,
 *      which offers one anchor per chain. A row opened by a magic ring takes its anchors
 *      from the ring and is not checked against a previous row.
 *
 * Consuming more anchors than exist is an error (the pattern cannot be worked). Consuming
 * fewer is a warning (stitches left unworked — legitimate for shaping, often a mistake).
 * A stitch group (format v2) consumes one anchor, whatever its stitches.
 *
 * Further checks: relief modifiers on stitches without a post (`INVALID_MODIFIER`), colours
 * missing from the palette (`UNKNOWN_COLOR`, only when a palette is passed), empty repeats
 * and empty stitch groups (warnings), and optionally the stitch budget of the 3D model.
 *
 * All counts are computed arithmetically from the op tree (never by expanding it), so
 * validation stays cheap on every edit even for patterns with huge repeat counts.
 */

import { countOpAtoms, countRowAtoms, isInstructionRow, type RowStitch } from "./expand.js";
import {
  STITCH_PROPERTIES,
  consumesOf,
  isPostStitch,
  type Op,
  type PartContent,
  type Row,
  type StitchOp,
} from "./schema.js";
import { checkPart, computeRowStitches } from "./stitch-count.js";

export type FindingCode =
  | "STITCH_COUNT_MISMATCH"
  | "CONSUMES_OVERFLOW"
  | "CONSUMES_UNDERFLOW"
  | "NO_ANCHOR_ROW"
  | "TOO_MANY_STITCHES"
  | "EMPTY_REPEAT"
  | "EMPTY_GROUP"
  | "INVALID_MODIFIER"
  | "UNKNOWN_COLOR";

export interface Finding {
  rowId: string;
  severity: "error" | "warning";
  code: FindingCode;
  message: string;
  expected?: number;
  actual?: number;
}

/** Anchors of the previous row that one atom consumes (TOG-aware). */
export function consumesOfAtom(atom: RowStitch): number {
  if (atom.code === "NOTE") return 0;
  const base = STITCH_PROPERTIES[atom.code].consumesStitches;
  if (base === 1 && atom.modifiers?.includes("TOG")) return 2;
  return base;
}

/** `true` when every stitch op in the tree is a chain (vacuously true for empty groups). */
function onlyChains(op: Op): boolean {
  return op.kind === "stitch" ? op.code === "CH" : op.ops.every(onlyChains);
}

/**
 * Anchors one op consumes. A stitch group is worked into one stitch, whatever its stitches
 * are — an empty group (no stitches at all) is worked into none.
 */
function consumedByOp(op: Op): number {
  if (op.kind === "stitch") return op.count * consumesOf(op);
  if (op.kind === "group") return countOpAtoms(op) > 0 ? 1 : 0;
  return op.times * op.ops.reduce((sum, inner) => sum + consumedByOp(inner), 0);
}

function containsRing(op: Op): boolean {
  if (op.kind === "stitch") return op.code === "MR";
  return (op.kind === "group" || op.times > 0) && op.ops.some(containsRing);
}

/** Anchors a row offers to the next row. */
export function anchorsOffered(row: Row): number {
  if (isInstructionRow(row)) return 0;
  const atoms = countRowAtoms(row);
  if (atoms > 0 && row.ops.every(onlyChains)) return atoms; // foundation chain
  return computeRowStitches(row);
}

/** Anchors a row consumes from the previous row. */
export function anchorsConsumed(row: Row): number {
  if (isInstructionRow(row)) return 0;
  return row.ops.reduce((sum, op) => sum + consumedByOp(op), 0);
}

/** A row that opens with a magic ring takes its anchors from the ring. */
export function isRingRow(row: Row): boolean {
  return !isInstructionRow(row) && row.ops.some(containsRing);
}

/** Rows that take part in the consumes chain: anything with stitches. */
function isStitchRow(row: Row): boolean {
  return row.ops.length > 0 && !isInstructionRow(row);
}

/** Per-row consumes check (see module doc). */
export function checkConsumes(content: PartContent): Finding[] {
  const findings: Finding[] = [];
  let previous: Row | undefined;

  for (const row of content.rows) {
    if (!isStitchRow(row)) continue;

    if (!isRingRow(row)) {
      const consumed = anchorsConsumed(row);
      if (consumed > 0) {
        if (!previous) {
          findings.push({
            rowId: row.id,
            severity: "error",
            code: "NO_ANCHOR_ROW",
            message: `Row works into ${consumed} stitches, but there is no previous row, foundation chain or magic ring.`,
            actual: consumed,
          });
        } else {
          const offered = anchorsOffered(previous);
          if (consumed > offered) {
            findings.push({
              rowId: row.id,
              severity: "error",
              code: "CONSUMES_OVERFLOW",
              message: `Row works into ${consumed} stitches, but the previous row only has ${offered}.`,
              expected: offered,
              actual: consumed,
            });
          } else if (consumed < offered) {
            findings.push({
              rowId: row.id,
              severity: "warning",
              code: "CONSUMES_UNDERFLOW",
              message: `Row works into ${consumed} of ${offered} stitches; ${offered - consumed} left unworked.`,
              expected: offered,
              actual: consumed,
            });
          }
        }
      }
    }
    previous = row;
  }
  return findings;
}

/** Stitch-count check as findings (one per mismatching row). */
export function checkStitchCounts(content: PartContent): Finding[] {
  return checkPart(content)
    .filter((c) => !c.ok)
    .map((c) => ({
      rowId: c.rowId,
      severity: "error" as const,
      code: "STITCH_COUNT_MISMATCH" as const,
      message: `Row declares ${c.expected} stitches but its ops produce ${c.actual}.`,
      expected: c.expected,
      actual: c.actual,
    }));
}

/** Stitch budget of the 3D model (`buildGraph` / `buildModel`) unless the caller sets one. */
export const DEFAULT_MAX_STITCHES = 20_000;

/** Total atomic stitches of a part (as `expandPart(content).length`), without expanding. */
export function countPartAtoms(content: PartContent): number {
  return content.rows.reduce((sum, row) => sum + (isInstructionRow(row) ? 0 : countRowAtoms(row)), 0);
}

/**
 * `TOO_MANY_STITCHES` when the part has more stitches than `maxStitches` — keyed by the row
 * at which the budget is crossed. The pattern itself may be fine (a blanket); the finding
 * says that no 3D model is built for it.
 */
export function checkStitchBudget(content: PartContent, maxStitches: number): Finding[] {
  let total = 0;
  for (const row of content.rows) {
    if (isInstructionRow(row)) continue;
    total += countRowAtoms(row);
    if (total > maxStitches) {
      const all = countPartAtoms(content);
      return [
        {
          rowId: row.id,
          severity: "error",
          code: "TOO_MANY_STITCHES",
          message: `The part has ${all} stitches; the 3D model is limited to ${maxStitches}.`,
          expected: maxStitches,
          actual: all,
        },
      ];
    }
  }
  return [];
}

export interface ValidateOptions {
  /**
   * Also report `TOO_MANY_STITCHES` above this many stitches. Off by default: the budget is
   * a limit of the 3D model, not of the pattern (`buildModel` passes its budget here).
   */
  maxStitches?: number;
  /**
   * The export's colour palette (`overview.colors`). When given, colour ids that are not in
   * it are reported as `UNKNOWN_COLOR`; without it colours are not checked.
   */
  palette?: readonly { id: string }[];
}

function countEmptyRepeats(ops: readonly Op[]): number {
  return ops.reduce((n, op) => {
    if (op.kind === "stitch") return n;
    if (op.kind === "group") return n + countEmptyRepeats(op.ops);
    return n + (op.ops.length === 0 ? 1 : countEmptyRepeats(op.ops));
  }, 0);
}

/** Every stitch op of an op tree, depth first, in document order. */
function stitchOps(ops: readonly Op[], out: StitchOp[] = []): StitchOp[] {
  for (const op of ops) {
    if (op.kind === "stitch") out.push(op);
    else stitchOps(op.ops, out);
  }
  return out;
}

function countEmptyGroups(ops: readonly Op[]): number {
  return ops.reduce((n, op) => {
    if (op.kind === "stitch") return n;
    if (op.kind === "group") return n + (countOpAtoms(op) === 0 ? 1 : 0);
    return n + countEmptyGroups(op.ops);
  }, 0);
}

/**
 * Stitch groups without stitches (`()` in one stitch) — legal in the schema, worked into no
 * stitch and producing none; almost always an unfinished edit. One warning per affected row.
 */
export function checkEmptyGroups(content: PartContent): Finding[] {
  return content.rows.flatMap((row) => {
    const empty = countEmptyGroups(row.ops);
    if (empty === 0) return [];
    return [
      {
        rowId: row.id,
        severity: "warning" as const,
        code: "EMPTY_GROUP" as const,
        message: `Row contains ${empty} stitch group${empty === 1 ? "" : "s"} without stitches.`,
        actual: empty,
      },
    ];
  });
}

/**
 * Relief modifiers that cannot be worked: `FP` / `BP` on a code without a post to work around
 * (anything but SC, HDC, DC, TR, DTR — see `isPostStitch`), or both on one stitch. One error
 * per affected row; `actual` is the number of offending stitch ops.
 */
export function checkModifiers(content: PartContent): Finding[] {
  return content.rows.flatMap((row) => {
    const bad = stitchOps(row.ops).filter((op) => {
      const mods = op.modifiers ?? [];
      const fp = mods.includes("FP");
      const bp = mods.includes("BP");
      return (fp || bp) && (!isPostStitch(op.code) || (fp && bp));
    });
    if (bad.length === 0) return [];
    const codes = [...new Set(bad.map((op) => op.code))].join(", ");
    return [
      {
        rowId: row.id,
        severity: "error" as const,
        code: "INVALID_MODIFIER" as const,
        message: `Front/back post (FP/BP) only works on SC, HDC, DC, TR or DTR, one of them per stitch (found on ${codes}).`,
        actual: bad.length,
      },
    ];
  });
}

/**
 * Colour ids (row colour, stitch colour) that are not in `palette`. One error per row,
 * listing the unknown ids.
 */
export function checkColors(content: PartContent, palette: readonly { id: string }[]): Finding[] {
  const known = new Set(palette.map((c) => c.id));
  return content.rows.flatMap((row) => {
    const ids = [row.color, ...stitchOps(row.ops).map((op) => op.color)].filter(
      (id): id is string => id !== undefined && !known.has(id),
    );
    if (ids.length === 0) return [];
    const unique = [...new Set(ids)];
    return [
      {
        rowId: row.id,
        severity: "error" as const,
        code: "UNKNOWN_COLOR" as const,
        message: `Row uses colour${unique.length === 1 ? "" : "s"} not in the palette: ${unique.join(", ")}.`,
        actual: unique.length,
      },
    ];
  });
}

/**
 * Repeat groups without ops (`6× ()`) — legal in the schema, contribute nothing, and are
 * almost always an unfinished edit. One warning per affected row.
 */
export function checkEmptyRepeats(content: PartContent): Finding[] {
  return content.rows.flatMap((row) => {
    const empty = countEmptyRepeats(row.ops);
    if (empty === 0) return [];
    return [
      {
        rowId: row.id,
        severity: "warning" as const,
        code: "EMPTY_REPEAT" as const,
        message: `Row contains ${empty} repeat group${empty === 1 ? "" : "s"} without stitches.`,
        actual: empty,
      },
    ];
  });
}

/**
 * All findings for a part, in document order (stitch-count findings first within a row).
 * An empty list means the part can be turned into a stitch graph.
 */
export function validate(content: PartContent, opts: ValidateOptions = {}): Finding[] {
  const byRow = new Map<string, Finding[]>();
  const budget =
    opts.maxStitches !== undefined && Number.isFinite(opts.maxStitches)
      ? checkStitchBudget(content, opts.maxStitches)
      : [];
  const all = [
    ...checkStitchCounts(content),
    ...checkConsumes(content),
    ...checkModifiers(content),
    ...(opts.palette ? checkColors(content, opts.palette) : []),
    ...checkEmptyRepeats(content),
    ...checkEmptyGroups(content),
    ...budget,
  ];
  for (const f of all) {
    const list = byRow.get(f.rowId) ?? [];
    list.push(f);
    byRow.set(f.rowId, list);
  }
  return content.rows.flatMap((row) => byRow.get(row.id) ?? []);
}
