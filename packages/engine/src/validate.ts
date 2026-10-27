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
 */

import { expandRow, isInstructionRow, type RowStitch } from "./expand.js";
import { STITCH_PROPERTIES, type PartContent, type Row } from "./schema.js";
import { checkPart } from "./stitch-count.js";

export type FindingCode =
  | "STITCH_COUNT_MISMATCH"
  | "CONSUMES_OVERFLOW"
  | "CONSUMES_UNDERFLOW"
  | "NO_ANCHOR_ROW";

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

/** Anchors a row offers to the next row. */
export function anchorsOffered(row: Row): number {
  const atoms = expandRow(row).filter((a) => a.code !== "NOTE");
  if (atoms.length > 0 && atoms.every((a) => a.code === "CH")) return atoms.length; // foundation chain
  return atoms.reduce(
    (sum, a) => sum + (a.code === "NOTE" ? 0 : STITCH_PROPERTIES[a.code].producesStitches),
    0,
  );
}

/** Anchors a row consumes from the previous row. */
export function anchorsConsumed(row: Row): number {
  return expandRow(row).reduce((sum, a) => sum + consumesOfAtom(a), 0);
}

/** A row that opens with a magic ring takes its anchors from the ring. */
export function isRingRow(row: Row): boolean {
  return expandRow(row).some((a) => a.code === "MR");
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

/**
 * All findings for a part, in document order (stitch-count findings first within a row).
 * An empty list means the part can be turned into a stitch graph.
 */
export function validate(content: PartContent): Finding[] {
  const byRow = new Map<string, Finding[]>();
  for (const f of [...checkStitchCounts(content), ...checkConsumes(content)]) {
    const list = byRow.get(f.rowId) ?? [];
    list.push(f);
    byRow.set(f.rowId, list);
  }
  return content.rows.flatMap((row) => byRow.get(row.id) ?? []);
}
