/**
 * Stitch expansion — flatten the recursive op-tree of a part into atomic stitches.
 *
 * Carried over from TellmeCrochet's guided-mode engine (the UI-free part of it). The
 * load-bearing idea: `expandPart` yields one entry per worked stitch instance. That list
 * is the basis of the stitch graph (one node per atom) and, in TellmeCrochet, of the
 * progress percentage (`stitch_count_total = expandPart().length`) — deliberately NOT the
 * fabric stitch count: "INC ×6" is 6 atoms but 12 fabric stitches.
 *
 * Pure functions, no I/O, no framework imports.
 */

import type { Mod, Op, PartContent, Row, StitchCode } from "./schema.js";

/**
 * Pseudo-code of a free instruction row ("insert safety eyes between rounds 8 and 9").
 * Not a stitch code of the schema — a step for the person crocheting, never a graph node.
 */
export const INSTRUCTION_CODE = "NOTE" as const;

/** Code of an atomic step: a stitch OR a free instruction. */
export type AtomCode = StitchCode | typeof INSTRUCTION_CODE;

/**
 * One atomic stitch = one worked stitch instance.
 *
 * `globalIndex` is the 0-based position across the whole part (derived, never stored).
 * `rowId` is the stable row id; `rowIndex` the row's 0-based position in document order.
 */
export interface AtomicStitch {
  globalIndex: number;
  rowId: string;
  rowIndex: number;
  code: AtomCode;
}

/**
 * One worked stitch of a row: its code plus the op's modifiers (BLO/FLO/TOG). `modifiers`
 * is only present when the op carries at least one. A free instruction row yields exactly
 * one atom with `code: INSTRUCTION_CODE`.
 */
export interface RowStitch {
  code: AtomCode;
  modifiers?: Mod[];
}

/** A row with no ops but with text (note, else label) is a free instruction. */
export function isInstructionRow(row: Row): boolean {
  return row.ops.length === 0 && instructionText(row) !== "";
}

/** Text of a free instruction (note, else label) — empty when there is none. */
export function instructionText(row: Row): string {
  return row.note?.trim() || row.label?.trim() || "";
}

/**
 * Running 1-based row number per line. Only lines with stitches are counted — an
 * instruction between round 4 and 5 does not turn round 5 into round 6. Lines without
 * stitches carry the number of the previous stitch line.
 */
export function rowOrdinals(rows: readonly Row[]): number[] {
  let n = 0;
  return rows.map((row) => (row.ops.length > 0 ? ++n : n));
}

/**
 * Flatten one op into its atomic stitches, recursing through repeat groups and
 * multiplying out `count` / `times`. The display-only `into` note never spawns extra
 * atoms, and `modifiers` only ride along on each atom.
 */
function expandOp(op: Op): RowStitch[] {
  if (op.kind === "stitch") {
    const mods = op.modifiers && op.modifiers.length > 0 ? op.modifiers : undefined;
    return Array.from({ length: op.count }, () =>
      mods ? { code: op.code, modifiers: [...mods] } : { code: op.code },
    );
  }
  const body = op.ops.flatMap(expandOp);
  const out: RowStitch[] = [];
  // Element-wise: `out.push(...body)` overflows the call stack for very large bodies.
  for (let i = 0; i < op.times; i++) for (let k = 0; k < body.length; k++) out.push(body[k]!);
  return out;
}

/** Atomic steps of a single row (its expanded op-tree; one step for a free instruction). */
export function expandRow(row: Row): RowStitch[] {
  if (isInstructionRow(row)) return [{ code: INSTRUCTION_CODE }];
  return row.ops.flatMap(expandOp);
}

/** Atoms one op expands to, computed arithmetically (no expansion). */
function countOpAtoms(op: Op): number {
  if (op.kind === "stitch") return op.count;
  return op.times * op.ops.reduce((sum, inner) => sum + countOpAtoms(inner), 0);
}

/**
 * Number of atomic steps of a row — always equal to `expandRow(row).length`, but computed
 * without expanding, so it is cheap even for absurdly large repeat counts.
 */
export function countRowAtoms(row: Row): number {
  if (isInstructionRow(row)) return 1;
  return row.ops.reduce((sum, op) => sum + countOpAtoms(op), 0);
}

/**
 * Expand a whole part into a flat, ordered list of atomic stitches.
 *
 * Null-op rows without text (turning, "fasten off" without a note) contribute nothing.
 *
 * @example
 *   expandPart({ schemaVersion: 1, rows: [{ ..., ops: [{ kind:"stitch", code:"INC", count:6 }] }] })
 *   // → 6 atomic stitches (globalIndex 0..5), even though the fabric count is 12.
 */
export function expandPart(content: PartContent): AtomicStitch[] {
  const stitches: AtomicStitch[] = [];
  content.rows.forEach((row, rowIndex) => {
    for (const { code } of expandRow(row)) {
      stitches.push({ globalIndex: stitches.length, rowId: row.id, rowIndex, code });
    }
  });
  return stitches;
}
