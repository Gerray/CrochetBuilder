/**
 * Building blocks for typical amigurumi rounds, shared by the next-round suggestion
 * (`suggest.ts`) and the snippets (`snippets.ts`): magic-ring start, evenly spread increase
 * and decrease rounds, plain rounds — plus the "previous stitch row" context a row's text is
 * parsed in.
 */

import {
  anchorsOffered,
  computeRowStitches,
  isInstructionRow,
  type Op,
  type Row,
  type StitchCode,
} from "@crochetbuilder/engine";

/** A row as a snippet or suggestion produces it: its ops and the stitches it makes. */
export interface RoundSpec {
  ops: Op[];
  count: number;
  /** Worked around the foundation chain before it (`Row.around`, oval start). */
  around?: true;
}

const stitch = (code: StitchCode, count: number): Op => ({ kind: "stitch", code, count });

/** Shortest foundation chain an oval start works around (one chain on each side, one at the end). */
export const MIN_OVAL_CHAIN = 3;

/** "7 Lm": a foundation chain of `length` chains. */
export function chainRow(length: number): RoundSpec {
  return { ops: [stitch("CH", length)], count: 0 };
}

/**
 * The first round of an oval start around a chain of `chain` chains, starting in the 2nd
 * chain from the hook: along one side, 3 fM in the last chain, back along the other side and
 * 2 fM into the first chain worked — "5 fM, (3 fM) in dieselbe M, 4 fM, 1 Zun" (14) on 7 Lm.
 * Null for a chain shorter than `MIN_OVAL_CHAIN`.
 */
export function ovalRound(chain: number): RoundSpec | null {
  if (!Number.isInteger(chain) || chain < MIN_OVAL_CHAIN) return null;
  const side = chain - 3;
  const ops: Op[] = [stitch("SC", chain - 2), { kind: "group", ops: [{ kind: "stitch", code: "SC", count: 3 }] }];
  if (side > 0) ops.push(stitch("SC", side));
  ops.push(stitch("INC", 1));
  return { ops, count: 2 * chain, around: true };
}

/**
 * Increase round `k` (2, 3, …) of an oval start around `chain` chains: six increases, three
 * at each end, the sides plain — "1 Zun, 4 fM, 3 Zun, 4 fM, 2 Zun" (20) after `ovalRound(7)`,
 * then "1 fM, 1 Zun, 4 fM, 3× (1 fM, 1 Zun), 4 fM, 2× (1 fM, 1 Zun)" (26). The round starts
 * at the hook end, so that end's increases are split: one at the start, two at the end.
 */
export function ovalIncreaseRound(chain: number, k: number): RoundSpec | null {
  if (ovalRound(chain) === null || !Number.isInteger(k) || k < 2) return null;
  const between = k - 2;
  const section = (): Op[] => (between > 0 ? [stitch("SC", between), stitch("INC", 1)] : [stitch("INC", 1)]);
  const fan = (times: number): Op[] => {
    if (between === 0) return [stitch("INC", times)];
    if (times === 1) return section();
    return [{ kind: "repeat", times, ops: section() }];
  };
  const side = chain - 3;
  const sides: Op[] = side > 0 ? [stitch("SC", side)] : [];
  const ops: Op[] = [...fan(1), ...sides, ...fan(3), ...sides, ...fan(2)];
  return { ops, count: 2 * chain + 6 * (k - 1) };
}

/** "1 MR, 6 fM": a magic ring with `count` single crochets. */
export function ringStart(count = 6): RoundSpec {
  return { ops: [stitch("MR", 1), stitch("SC", count)], count };
}

/** `count` single crochets in a round ("24 fM"). */
export function plainRound(count: number): RoundSpec {
  return { ops: [stitch("SC", count)], count };
}

/**
 * One round from `count` to `count + sections`, the increases spread evenly:
 * 6 → "6 Zun", 12 → "6× (1 fM, 1 Zun)", 18 → "6× (2 fM, 1 Zun)". Null when `count` is not a
 * multiple of `sections`.
 */
export function increaseRound(count: number, sections = 6): RoundSpec | null {
  if (!Number.isInteger(count) || sections < 1 || count < sections || count % sections !== 0) return null;
  const between = count / sections - 1;
  const ops: Op[] =
    between === 0
      ? [stitch("INC", sections)]
      : [{ kind: "repeat", times: sections, ops: [stitch("SC", between), stitch("INC", 1)] }];
  return { ops, count: count + sections };
}

/**
 * One round from `count` to `count - sections`, the mirror of `increaseRound`:
 * 24 → "6× (2 fM, 1 Abn)", 12 → "6 Abn". Null when `count` is not a multiple of `sections`
 * or too small to decrease (fewer than two stitches per section).
 */
export function decreaseRound(count: number, sections = 6): RoundSpec | null {
  if (!Number.isInteger(count) || sections < 1 || count % sections !== 0 || count / sections < 2) return null;
  const between = count / sections - 2;
  const ops: Op[] =
    between === 0
      ? [stitch("DEC", sections)]
      : [{ kind: "repeat", times: sections, ops: [stitch("SC", between), stitch("DEC", 1)] }];
  return { ops, count: count - sections };
}

/**
 * The ops of a row worked flat: "1 Lm" (turning chain, makes and uses no stitch) in front,
 * unless the row already starts with a chain — the potholder demo's convention.
 */
export function withTurningChain(ops: readonly Op[]): Op[] {
  const first = ops[0];
  if (first?.kind === "stitch" && first.code === "CH") return structuredClone([...ops]);
  return [stitch("CH", 1), ...structuredClone([...ops])];
}

/** A line that takes part in the stitch chain: it has stitches and is no free instruction. */
export function isStitchRow(row: Row): boolean {
  return row.ops.length > 0 && !isInstructionRow(row);
}

/** The last stitch row before `index` (instruction and empty rows are skipped). */
export function previousStitchRow(rows: readonly Row[], index: number): Row | undefined {
  for (let i = Math.min(index, rows.length) - 1; i >= 0; i--) {
    if (isStitchRow(rows[i]!)) return rows[i];
  }
  return undefined;
}

/**
 * Stitches the row at `index` can be worked into: what the previous stitch row offers (its
 * stitch count; a foundation chain offers one per chain). Undefined without such a row.
 */
export function previousCountAt(rows: readonly Row[], index: number): number | undefined {
  const previous = previousStitchRow(rows, index);
  return previous ? anchorsOffered(previous) : undefined;
}

/** `previousCountAt` for every row, in one pass. */
export function previousCounts(rows: readonly Row[]): Array<number | undefined> {
  const out: Array<number | undefined> = [];
  let offered: number | undefined;
  for (const row of rows) {
    out.push(offered);
    if (isStitchRow(row)) offered = anchorsOffered(row);
  }
  return out;
}

/** Stitch count of a row (shorthand used by the assistants). */
export const rowCount = (row: Row): number => computeRowStitches(row);
