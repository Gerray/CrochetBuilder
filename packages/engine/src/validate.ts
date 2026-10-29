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
 * A round worked around a foundation chain (`Row.around`, oval start) works along both sides
 * of the chain: up to twice as many anchors as the chain has (`aroundCapacity`). Patterns
 * skip the chains next to the hook on both sides — as many as the first stitch is tall
 * (`hookSkipOf`: 1 for sc, 2 for hdc/dc, 3 for tr) — and turn around the far end in one
 * stitch group, so such a round usually leaves 2 × skip + 1 anchors unworked; only fewer than
 * that is reported as `CONSUMES_UNDERFLOW`. A round marked `around` whose previous stitch row
 * is not a chain is `AROUND_WITHOUT_CHAIN`, a row (`type: "row"`, it turns) marked `around` is
 * `AROUND_ON_ROW`; both are checked (and built) like a plain row.
 *
 * Consuming more anchors than exist is an error (the pattern cannot be worked). Consuming
 * fewer is a warning (stitches left unworked — legitimate for shaping, often a mistake).
 * A stitch group (format v2) consumes one anchor, whatever its stitches. Stitches worked into
 * another part (`StitchOp.from`) consume nothing of the own previous row; what they take from
 * the other part is checked across parts by `validateExport` (see join.ts). Stitches worked
 * `through` another part consume their own previous row as usual.
 *
 * Further checks: joins that cannot be worked (`INVALID_JOIN`), relief modifiers on stitches
 * without a post (`INVALID_MODIFIER`), colours
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
  consumesOfGroup,
  GROUP_FORBIDDEN_CODES,
  isPostStitch,
  type Op,
  type PartContent,
  type Row,
  type StitchCode,
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
  | "INVALID_GROUP"
  | "INVALID_MODIFIER"
  | "UNKNOWN_COLOR"
  | "AROUND_WITHOUT_CHAIN"
  | "AROUND_ON_ROW"
  | "INVALID_JOIN";

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
 * are — a group with no stitch that is worked into anything (empty, or only chains and
 * picots) into none (`consumesOfGroup`; the graph agrees).
 */
function consumedByOp(op: Op): number {
  // Worked into another part (`from`): nothing of the own previous row.
  if (op.kind === "stitch") return op.from ? 0 : op.count * consumesOf(op);
  if (op.kind === "group") return consumesOfGroup(op);
  return op.times * op.ops.reduce((sum, inner) => sum + consumedByOp(inner), 0);
}

function containsRing(op: Op): boolean {
  if (op.kind === "stitch") return op.code === "MR";
  return (op.kind === "group" || op.times > 0) && op.ops.some(containsRing);
}

/** Whether a row is a foundation chain: it has stitches, and all of them are chains. */
export function isChainRow(row: Row): boolean {
  return !isInstructionRow(row) && countRowAtoms(row) > 0 && row.ops.every(onlyChains);
}

/** Anchors a row offers to the next row. */
export function anchorsOffered(row: Row): number {
  if (isInstructionRow(row)) return 0;
  if (isChainRow(row)) return countRowAtoms(row); // foundation chain
  return computeRowStitches(row);
}

/**
 * What a round worked around a chain of `chainLength` chains can work into (`Row.around`):
 * at most both sides of every chain (`max`, 2 × length), and in the usual oval start the
 * `skip` chains next to the hook skipped on both sides and the far end turned in one stitch
 * group (`usual`, 2 × length − 2 × skip − 1, at least 1: 2n − 3 for sc, 2n − 5 for hdc and
 * dc, 2n − 7 for tr). Fewer than `usual` leaves stitches unworked.
 */
export function aroundCapacity(chainLength: number, skip = 1): { max: number; usual: number } {
  const n = Math.max(0, Math.floor(chainLength));
  const k = Math.max(1, Math.floor(skip));
  return { max: 2 * n, usual: Math.max(Math.min(1, n), 2 * n - 2 * k - 1) };
}

/** Chains a stitch skips at the hook when it is the first one worked into a chain. */
const HOOK_SKIP: Partial<Record<StitchCode, number>> = { HDC: 2, DC: 2, BOBBLE: 2, PUFF: 2, POPCORN: 2, TR: 3, DTR: 4 };

/**
 * Chains skipped at the hook before the first stitch of `row` that is worked into something
 * ("sc in 2nd ch from hook": 1, "hdc / dc in 3rd ch": 2, "tr in 4th ch": 3, "dtr": 4); 1 when
 * the row has no such stitch.
 */
export function hookSkipOf(row: Row): number {
  const first = (ops: readonly Op[]): StitchOp | undefined => {
    for (const op of ops) {
      if (op.kind === "stitch") {
        if (consumesOf(op) > 0 && !op.from) return op;
      } else {
        const inner = first(op.ops);
        if (inner) return inner;
      }
    }
    return undefined;
  };
  const op = first(row.ops);
  return (op && HOOK_SKIP[op.code]) ?? 1;
}

/**
 * Whether `row` is worked around the foundation chain `previous` (its previous stitch row):
 * it is a round that says `around`, is not opened by a magic ring, and `previous` is a chain.
 */
export function worksAroundChain(row: Row, previous: Row | undefined): boolean {
  return row.around === true && row.type === "round" && previous !== undefined && isChainRow(previous) && !isRingRow(row);
}

/**
 * Anchors `row` can work into after its previous stitch row `previous`: twice the chain for
 * a round worked around it (`aroundCapacity(…).max`), else `anchorsOffered(previous)`.
 */
export function anchorsAvailable(row: Row, previous: Row): number {
  return worksAroundChain(row, previous) ? aroundCapacity(anchorsOffered(previous)).max : anchorsOffered(previous);
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

    if (row.around && row.type === "row") {
      findings.push({
        rowId: row.id,
        severity: "error",
        code: "AROUND_ON_ROW",
        message: "A row turns at its end and cannot be worked around a foundation chain; make it a round.",
      });
    } else if (row.around && !worksAroundChain(row, previous)) {
      findings.push({
        rowId: row.id,
        severity: "error",
        code: "AROUND_WITHOUT_CHAIN",
        message: "Round is marked as worked around a foundation chain, but the stitch row before it is not a chain (or it opens with a magic ring).",
      });
    }

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
          const around = worksAroundChain(row, previous);
          const capacity = aroundCapacity(anchorsOffered(previous), hookSkipOf(row));
          const offered = around ? capacity.max : anchorsOffered(previous);
          // Around a chain, the usual skips at both ends are not "left unworked".
          const enough = around ? capacity.usual : offered;
          if (consumed > offered) {
            findings.push({
              rowId: row.id,
              severity: "error",
              code: "CONSUMES_OVERFLOW",
              message: `Row works into ${consumed} stitches, but the previous row only has ${offered}.`,
              expected: offered,
              actual: consumed,
            });
          } else if (consumed < enough) {
            findings.push({
              rowId: row.id,
              severity: "warning",
              code: "CONSUMES_UNDERFLOW",
              message: `Row works into ${consumed} of ${enough} stitches; ${enough - consumed} left unworked.`,
              expected: enough,
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
    if (op.kind === "group") return n + (consumesOfGroup(op) === 0 ? 1 : 0);
    return n + countEmptyGroups(op.ops);
  }, 0);
}

/**
 * Stitch groups with no stitch worked into the group's stitch — empty (`()` in one stitch) or
 * only chains and picots. Legal in the schema; such a group is worked into no stitch, so it
 * is almost always an unfinished edit. One warning per affected row.
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
 * Stitch groups with stitches that cannot be worked into one stitch: the magic ring, a
 * decrease (`DEC`, `INVDEC`) or a stitch worked together (`TOG`). An `INC` is allowed (two
 * stitches into the group's stitch). One error per affected row; `actual` counts the ops.
 */
export function checkGroups(content: PartContent): Finding[] {
  const inGroups = (ops: readonly Op[], inside: boolean, out: StitchOp[]): StitchOp[] => {
    for (const op of ops) {
      if (op.kind === "stitch") {
        if (inside) out.push(op);
      } else inGroups(op.ops, inside || op.kind === "group", out);
    }
    return out;
  };
  return content.rows.flatMap((row) => {
    const bad = inGroups(row.ops, false, []).filter(
      (op) => GROUP_FORBIDDEN_CODES.includes(op.code) || consumesOf(op) > 1,
    );
    if (bad.length === 0) return [];
    const codes = [...new Set(bad.map((op) => (op.modifiers?.includes("TOG") ? `${op.code} TOG` : op.code)))].join(", ");
    return [
      {
        rowId: row.id,
        severity: "error" as const,
        code: "INVALID_GROUP" as const,
        message: `A group "in one stitch" cannot contain a magic ring, a decrease or stitches worked together (found ${codes}).`,
        actual: bad.length,
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
 * Joins (`StitchOp.from` / `.through`) that cannot be worked: both on one op, inside a stitch
 * group (all its stitches go into one stitch of the own row), or on a stitch that is worked
 * into nothing (chain, magic ring, picot). One error per affected row; `actual` counts the ops.
 * Whether the referenced part and row exist is checked by `validateExport`.
 */
export function checkJoins(content: PartContent): Finding[] {
  const bad = (ops: readonly Op[], inGroup: boolean, out: StitchOp[]): StitchOp[] => {
    for (const op of ops) {
      if (op.kind === "stitch") {
        if (!op.from && !op.through) continue;
        if (inGroup || (op.from && op.through) || consumesOf(op) === 0) out.push(op);
      } else bad(op.ops, inGroup || op.kind === "group", out);
    }
    return out;
  };
  return content.rows.flatMap((row) => {
    const ops = bad(row.ops, false, []);
    if (ops.length === 0) return [];
    return [
      {
        rowId: row.id,
        severity: "error" as const,
        code: "INVALID_JOIN" as const,
        message:
          "A join to another part needs a stitch that is worked into something, outside a stitch group, and either “from” or “through”, not both.",
        actual: ops.length,
      },
    ];
  });
}

/** Whether a row has a stitch worked into another part (`StitchOp.from`). */
export function rowWorksFromOtherPart(row: Row): boolean {
  const any = (ops: readonly Op[]): boolean => ops.some((op) => (op.kind === "stitch" ? op.from !== undefined : any(op.ops)));
  return any(row.ops);
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
    ...checkGroups(content),
    ...checkJoins(content),
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
