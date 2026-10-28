/**
 * Oval start (`Row.around`): a round worked around both sides of a foundation chain —
 * schema, validation, stitch graph, relaxation and meshes. Shapes are checked by measures and
 * topology only.
 */
import { describe, expect, it } from "vitest";
import { buildGraph, type StitchGraph } from "./graph.js";
import { measure } from "./measure.js";
import { toMesh, type MeshData } from "./mesh.js";
import { isClosedPiece, relax } from "./relax.js";
import { PartContentSchema, usesFormatV2, type Op, type PartContent, type Row, type StitchCode } from "./schema.js";
import { anchorsAvailable, aroundCapacity, checkConsumes, validate, worksAroundChain } from "./validate.js";

const st = (code: StitchCode, count = 1): Op => ({ kind: "stitch", code, count });
const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });
const grp = (ops: Op[]): Op => ({ kind: "group", ops }) as Op;
const row = (id: string, ops: Op[], t: number, extra: Partial<Row> = {}): Row => ({
  id,
  type: "round",
  ops,
  stitchCountTarget: t,
  ...extra,
});
const part = (rows: Row[]): PartContent => ({ schemaVersion: 2, rows });

/** "Ch 7. Rnd 1: sc in 2nd ch from hook, 4 sc, 3 sc in last ch, 4 sc on the other side, 2 sc in last ch (14)". */
const CHAIN = row("c", [st("CH", 7)], 0);
const R1 = row("r1", [st("SC"), st("SC", 4), grp([st("SC", 3)]), st("SC", 4), st("INC")], 14, { around: true });
/** Six increases per round, three at each end. */
const R2 = row("r2", [st("INC"), st("SC", 4), st("INC", 3), st("SC", 4), st("INC", 2)], 20);
const R3 = row("r3", [st("SC"), st("INC"), st("SC", 4), rep(3, [st("SC"), st("INC")]), st("SC", 4), rep(2, [st("SC"), st("INC")])], 26);
const OVAL = part([CHAIN, R1]);
const FLAT_OVAL = part([CHAIN, R1, R2, R3]);
const CUP = part([CHAIN, R1, R2, R3, row("r4", [st("SC", 26)], 26), row("r5", [st("SC", 26)], 26)]);
/** A foot: oval start, two even rounds, decreased shut. */
const FOOT = part([
  CHAIN,
  R1,
  R2,
  row("e1", [st("SC", 20)], 20),
  row("e2", [st("SC", 20)], 20),
  row("d1", [st("DEC"), st("SC", 4), st("DEC", 3), st("SC", 4), st("DEC", 2)], 14),
  row("d2", [st("DEC", 7)], 7),
]);

describe("schema: Row.around", () => {
  it("accepts `around: true` only, and only in format v2", () => {
    expect(PartContentSchema.safeParse(OVAL).success).toBe(true);
    expect(PartContentSchema.safeParse(part([CHAIN, { ...R1, around: false as unknown as true }])).success).toBe(false);
    expect(usesFormatV2(OVAL)).toBe(true);
    const plain = row("r1", [st("SC", 11)], 11);
    expect(usesFormatV2({ rows: [CHAIN, plain] })).toBe(false);
    expect(usesFormatV2({ rows: [CHAIN, { ...plain, around: true }] })).toBe(true);
    expect(PartContentSchema.safeParse({ ...OVAL, schemaVersion: 1 }).success).toBe(false);
  });
});

describe("validation of a round around a chain", () => {
  it("offers both sides of the chain and accepts the usual skips at the ends", () => {
    expect(aroundCapacity(7)).toEqual({ max: 14, usual: 11 });
    expect(aroundCapacity(1)).toEqual({ max: 2, usual: 1 });
    expect(aroundCapacity(0)).toEqual({ max: 0, usual: 0 });
    expect(anchorsAvailable(R1, CHAIN)).toBe(14);
    expect(anchorsAvailable({ ...R1, around: undefined }, CHAIN)).toBe(7);
    expect(worksAroundChain(R1, CHAIN)).toBe(true);
    expect(validate(FLAT_OVAL)).toEqual([]);
    // 3 sc at both ends ("Ch 9: 7 sc, 3 sc in one, 7 sc, 3 sc in one"): 16 of 18, no finding.
    const both = part([row("c", [st("CH", 9)], 0), row("r1", [st("SC", 7), grp([st("SC", 3)]), st("SC", 7), grp([st("SC", 3)])], 20, { around: true })]);
    expect(validate(both)).toEqual([]);
  });

  it("reports working into more than both sides, and fewer than the usual skips leave", () => {
    const over = part([CHAIN, row("r1", [st("SC", 15)], 15, { around: true })]);
    expect(checkConsumes(over)).toMatchObject([{ rowId: "r1", code: "CONSUMES_OVERFLOW", severity: "error", expected: 14, actual: 15 }]);
    const under = part([CHAIN, row("r1", [st("SC", 9)], 9, { around: true })]);
    expect(checkConsumes(under)).toMatchObject([{ rowId: "r1", code: "CONSUMES_UNDERFLOW", severity: "warning", expected: 11, actual: 9 }]);
    // All 14: allowed (up to twice the chain).
    expect(checkConsumes(part([CHAIN, row("r1", [st("SC", 14)], 14, { around: true })]))).toEqual([]);
  });

  it("reports `around` without a chain before it, and checks the round as a plain one", () => {
    const ring = row("m", [st("MR"), st("SC", 6)], 6);
    const notChain = part([ring, row("r2", [st("INC", 6)], 12, { around: true })]);
    expect(validate(notChain).map((f) => [f.rowId, f.code, f.severity])).toEqual([["r2", "AROUND_WITHOUT_CHAIN", "error"]]);
    const first = part([row("r1", [st("SC", 6)], 6, { around: true })]);
    expect(validate(first).map((f) => f.code)).toEqual(["AROUND_WITHOUT_CHAIN", "NO_ANCHOR_ROW"]);
    const ringAround = part([CHAIN, row("r1", [st("MR"), st("SC", 6)], 6, { around: true })]);
    expect(validate(ringAround).map((f) => f.code)).toEqual(["AROUND_WITHOUT_CHAIN"]);
    // The graph ignores `around` there: a plain round worked into the ring.
    expect(buildGraph(notChain).rows[1]!.around).toBeUndefined();
  });
});

/** Children of every chain node: [side-1 children, side-2 children] by node ids. */
function chainChildren(g: StitchGraph): number[][] {
  const chain = g.rows[0]!;
  const out: number[][] = Array.from({ length: chain.nodeCount }, () => []);
  for (const node of g.nodes) for (const p of node.parents) if (p < chain.nodeCount) out[p]!.push(node.id);
  return out;
}

describe("graph of an oval start", () => {
  const g = buildGraph(OVAL);
  const r1 = g.rows[1]!;

  it("walks side 1 from the hook end, turns at the far end and comes back along side 2", () => {
    // 13 nodes (the INC is one node of two stitches), 14 stitches.
    expect(r1).toMatchObject({ kind: "stitch", around: true, closed: true, nodeCount: 13, widthStitches: 14 });
    const parents = Array.from({ length: 13 }, (_, k) => g.nodes[r1.firstNode + k]!.parents);
    // Chain nodes 0 … 6, node 6 next to the hook (skipped on both sides).
    expect(parents).toEqual([[5], [4], [3], [2], [1], [0], [0], [0], [1], [2], [3], [4], [5]]);
  });

  it("attaches every worked chain on both sides, so the chain lies inside the oval", () => {
    const kids = chainChildren(g);
    const first = r1.firstNode;
    const side1 = (id: number) => id < first + 8; // sc, 4 sc, 3 sc in the last chain
    for (let k = 1; k <= 5; k++) {
      expect(kids[k]!.some(side1), `chain ${k} side 1`).toBe(true);
      expect(kids[k]!.some((id) => !side1(id)), `chain ${k} side 2`).toBe(true);
    }
    // The far chain carries the three stitches that turn around the end.
    expect(kids[0]).toEqual([first + 5, first + 6, first + 7]);
    expect(kids[6]).toEqual([]); // the chain next to the hook is not worked into
  });

  it("closes the round, and the next round works into it like into any round", () => {
    const g3 = buildGraph(FLAT_OVAL);
    expect(g3.rows.map((r) => r.closed)).toEqual([false, true, true, true]);
    expect(g3.rows[2]!.reversed).toBe(false);
    expect(g3.rows[2]!.around).toBeUndefined();
    const r2 = g3.rows[2]!;
    expect(g3.nodes[r2.firstNode]!.parents).toEqual([g3.rows[1]!.firstNode]);
    // The seam: the round's last triangle zips its last stitch to its first.
    const tri = Array.from(g.triangles);
    const last = r1.firstNode + 12;
    let seam = false;
    for (let t = 0; t < tri.length; t += 3) {
      const abc = tri.slice(t, t + 3);
      if (abc.includes(last) && abc.includes(r1.firstNode)) seam = true;
    }
    expect(seam).toBe(true);
  });

  it("is a surface without a hole along the chain: each chain edge between two triangles, one per side", () => {
    const { count, repeatedDirected } = edgeUse(g.triangles, g.nodes.length);
    for (let k = 0; k < 5; k++) expect(count.get(key(k, k + 1, g.nodes.length)), `chain edge ${k}`).toBe(2);
    expect(repeatedDirected).toBe(0);
  });

  it("skips slots as patterns count when the round works into fewer", () => {
    // 3 sc at both ends of a chain of 9: 16 of 18 slots; side 2 ends in the chain next to the hook.
    const both = buildGraph(part([row("c", [st("CH", 9)], 0), row("r1", [st("SC", 7), grp([st("SC", 3)]), st("SC", 7), grp([st("SC", 3)])], 20, { around: true })]));
    const first = both.rows[1]!.firstNode;
    const parentOf = (k: number) => both.nodes[first + k]!.parents[0];
    expect([0, 6, 7, 8, 9, 10, 16, 17, 19].map(parentOf)).toEqual([7, 1, 0, 0, 0, 1, 7, 8, 8]);
  });

  it("is deterministic", () => {
    const a = buildGraph(CUP);
    const b = buildGraph(CUP);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.triangles)).toEqual(Array.from(b.triangles));
  });
});

function key(a: number, b: number, n: number): number {
  return Math.min(a, b) * n + Math.max(a, b);
}

function edgeUse(idx: ArrayLike<number>, n: number): { count: Map<number, number>; repeatedDirected: number } {
  const count = new Map<number, number>();
  const directed = new Set<number>();
  let repeatedDirected = 0;
  for (let t = 0; t < idx.length; t += 3) {
    for (let j = 0; j < 3; j++) {
      const a = idx[t + j]!, b = idx[t + ((j + 1) % 3)]!;
      count.set(key(a, b, n), (count.get(key(a, b, n)) ?? 0) + 1);
      if (directed.has(a * n + b)) repeatedDirected++;
      directed.add(a * n + b);
    }
  }
  return { count, repeatedDirected };
}

/** Extents of some nodes (default: all) along the X axis and the Z axis, and along Y. */
function extents(g: StitchGraph, rowId?: string): { along: number; across: number; height: number } {
  const p = g.positions;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  g.nodes.forEach((node, i) => {
    if (rowId && node.rowId !== rowId) return;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[3 * i + k]!);
      hi[k] = Math.max(hi[k]!, p[3 * i + k]!);
    }
  });
  return { along: hi[0]! - lo[0]!, across: hi[2]! - lo[2]!, height: hi[1]! - lo[1]! };
}

/** Distance between the centres of chain nodes `a` and `b`. */
function chainSpan(g: StitchGraph, a: number, b: number): number {
  const p = g.positions;
  return Math.hypot(p[3 * b]! - p[3 * a]!, p[3 * b + 1]! - p[3 * a + 1]!, p[3 * b + 2]! - p[3 * a + 2]!);
}

describe("relaxed oval start", () => {
  const h = buildGraph(OVAL).gauge.stitchHeightMm;

  it("lays the chain along X; the first round is about the chain plus a stitch at each end long and two stitches wide", () => {
    // Measured with the second round worked: a first round alone is too short for a flat
    // stadium around its chain (its ends cannot fan wider than the stitches are) and cups.
    const g = relax(buildGraph(part([CHAIN, R1, R2])));
    const span = chainSpan(g, 0, 5); // the chains worked into
    const r1 = extents(g, "r1");
    expect(r1.along - span).toBeGreaterThan(1 * h);
    expect(r1.along - span).toBeLessThan(2.2 * h);
    expect(r1.across).toBeGreaterThan(1.8 * h);
    expect(r1.across).toBeLessThan(2.6 * h);
    // The chain runs along X after posing.
    const p = g.positions;
    expect(Math.abs(p[3 * 5]! - p[0]!)).toBeCloseTo(span, 0);
  });

  it("a lone first round cups around its chain but keeps both sides on it", () => {
    const g = relax(buildGraph(OVAL));
    const r1 = extents(g, "r1");
    expect(r1.along).toBeGreaterThan(chainSpan(g, 0, 5));
    expect(r1.across).toBeGreaterThan(1.2 * h);
    expect(r1.across).toBeLessThan(2.4 * h);
  });

  it("grows into a flat oval with six increases per round (long, low)", () => {
    const g = relax(buildGraph(FLAT_OVAL));
    const size = measure(g);
    expect(size.width / size.depth).toBeGreaterThan(1.3);
    expect(size.height).toBeLessThan(0.5 * size.depth);
  });

  it("grows into an elongated cup with even rounds, the chain at the bottom", () => {
    const g = relax(buildGraph(CUP));
    const size = measure(g);
    expect(size.width / size.depth).toBeGreaterThan(1.3);
    const rim = extents(g, "r5");
    expect(rim.along / rim.across).toBeGreaterThan(1.3);
    const chainY = Math.max(...[0, 1, 2, 3, 4, 5].map((k) => g.positions[3 * k + 1]!));
    const rimNodes = g.nodes.filter((n) => n.rowId === "r5").map((n) => g.positions[3 * n.id + 1]!);
    expect(Math.min(...rimNodes)).toBeGreaterThan(chainY + h);
  });

  it("closes and stuffs a foot that starts oval, and keeps it long", () => {
    const graph = buildGraph(FOOT);
    expect(isClosedPiece(graph)).toBe(true);
    const g = relax(graph);
    const size = measure(g);
    expect(size.width / size.depth).toBeGreaterThan(1.3);
    for (const v of g.positions) expect(Number.isFinite(v)).toBe(true);
  });

  it("is deterministic for a fixed seed", () => {
    const a = relax(buildGraph(FOOT), { seed: 3 });
    const b = relax(buildGraph(FOOT), { seed: 3 });
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });
});

describe("meshes of an oval start", () => {
  const foot = relax(buildGraph(FOOT));
  const finite = (m: MeshData) => m.positions.every(Number.isFinite) && m.normals.every(Number.isFinite);

  it("renders every style with finite vertices", () => {
    for (const style of ["surface", "stitches", "tube", "points"] as const) {
      const m = toMesh(foot, style);
      expect(m.positions.length, style).toBeGreaterThan(0);
      expect(finite(m), style).toBe(true);
    }
  });

  it("closes the surface of a foot: every edge between two triangles, consistently wound", () => {
    for (const smooth of [0, 1]) {
      const m = toMesh(foot, "surface", { smooth });
      const { count, repeatedDirected } = edgeUse(m.indices, m.positions.length / 3);
      for (const c of count.values()) expect(c).toBe(2);
      expect(repeatedDirected).toBe(0);
    }
  });

  it("leaves an open oval cup open only at its rim", () => {
    const cup = relax(buildGraph(CUP));
    const m = toMesh(cup, "surface", { smooth: 0 });
    const { count } = edgeUse(m.indices, m.positions.length / 3);
    const open = [...count.values()].filter((c) => c === 1).length;
    expect(open).toBe(26); // the rim of the last round
  });
});
