import { describe, it, expect } from "vitest";
import { buildGraph } from "./graph.js";
import { relax, isClosedPiece, signedVolume, newellNormal } from "./relax.js";
import { createRandom } from "./random.js";
import type { Op, PartContent, Row, StitchCode } from "./schema.js";

const st = (code: StitchCode, count = 1): Op => ({ kind: "stitch", code, count });
const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });
const row = (id: string, ops: Op[], t: number, type: "row" | "round" = "round"): Row => ({
  id,
  type,
  ops,
  stitchCountTarget: t,
});
const part = (rows: Row[]): PartContent => ({ schemaVersion: 1, rows });

const INCREASES = [
  row("r1", [st("MR"), st("SC", 6)], 6),
  row("r2", [st("INC", 6)], 12),
  row("r3", [rep(6, [st("SC"), st("INC")])], 18),
  row("r4", [rep(6, [st("SC", 2), st("INC")])], 24),
];
const SPHERE = part([
  ...INCREASES,
  row("r5", [st("SC", 24)], 24),
  row("r6", [rep(6, [st("SC", 2), st("DEC")])], 18),
  row("r7", [rep(6, [st("SC"), st("DEC")])], 12),
  row("r8", [st("DEC", 6)], 6),
]);
const DISC = part(INCREASES);
const FLAT = part([
  row("f", [st("CH", 7)], 0, "row"),
  row("1", [st("SC", 6)], 6, "row"),
  row("2", [st("CH"), st("SC", 6)], 6, "row"),
]);

describe("createRandom", () => {
  it("is deterministic per seed and stays in [0, 1)", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const c = createRandom(43);
    const xs = Array.from({ length: 100 }, () => a());
    expect(Array.from({ length: 100 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 100 }, () => c())).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe("relax", () => {
  it("is deterministic: same seed, identical positions", () => {
    const g = buildGraph(SPHERE);
    const a = relax(g, { seed: 7 });
    const b = relax(g, { seed: 7 });
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    const c = relax(g, { seed: 8 });
    expect(Array.from(c.positions)).not.toEqual(Array.from(a.positions));
  });

  it("returns a new graph and leaves the input untouched", () => {
    const g = buildGraph(SPHERE);
    const before = Float64Array.from(g.positions);
    const r = relax(g);
    expect(r).not.toBe(g);
    expect(r.relaxed).toBe(true);
    expect(g.relaxed).toBe(false);
    expect(Array.from(g.positions)).toEqual(Array.from(before));
    expect(r.nodes).toBe(g.nodes);
    expect(r.positions).toHaveLength(g.positions.length);
    expect(Array.from(r.positions).every(Number.isFinite)).toBe(true);
  });

  it("brings springs close to their rest lengths", () => {
    for (const content of [SPHERE, DISC, FLAT]) {
      const g = relax(buildGraph(content));
      const p = g.positions;
      let strain = 0;
      for (const e of g.edges) {
        const d = Math.hypot(
          p[3 * e.b]! - p[3 * e.a]!,
          p[3 * e.b + 1]! - p[3 * e.a + 1]!,
          p[3 * e.b + 2]! - p[3 * e.a + 2]!,
        );
        strain += Math.abs(d - e.restLength) / e.restLength;
      }
      expect(strain / g.edges.length).toBeLessThan(0.12);
    }
  });

  it("handles an empty graph and zero iterations", () => {
    expect(relax(buildGraph(part([]))).positions).toHaveLength(0);
    const g = relax(buildGraph(SPHERE), { iterations: 0, jitter: 0 });
    expect(Array.from(g.positions).every(Number.isFinite)).toBe(true);
  });

  it("puts the piece in canonical pose: resting on y = 0, centred on the Y axis", () => {
    const g = relax(buildGraph(SPHERE));
    const p = g.positions;
    let minY = Infinity;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < g.nodes.length; i++) {
      minY = Math.min(minY, p[3 * i + 1]!);
      minX = Math.min(minX, p[3 * i]!);
      maxX = Math.max(maxX, p[3 * i]!);
      minZ = Math.min(minZ, p[3 * i + 2]!);
      maxZ = Math.max(maxZ, p[3 * i + 2]!);
    }
    expect(minY).toBeCloseTo(0, 9);
    expect(minX + maxX).toBeCloseTo(0, 9);
    expect(minZ + maxZ).toBeCloseTo(0, 9);
    // Rounds grow along +Y: the magic ring is at the bottom.
    expect(p[1]!).toBeLessThan(2);
  });

  it("recognises closed pieces (ring start, small last round, rounds only)", () => {
    expect(isClosedPiece(buildGraph(SPHERE))).toBe(true);
    expect(isClosedPiece(buildGraph(DISC))).toBe(false);
    expect(isClosedPiece(buildGraph(FLAT))).toBe(false);
  });

  it("stuffing only inflates closed pieces and makes them taller", () => {
    const g = buildGraph(SPHERE);
    const height = (x: ReturnType<typeof relax>) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < x.nodes.length; i++) {
        lo = Math.min(lo, x.positions[3 * i + 1]!);
        hi = Math.max(hi, x.positions[3 * i + 1]!);
      }
      return hi - lo;
    };
    expect(height(relax(g))).toBeGreaterThan(height(relax(g, { stuffing: 0 })) + 2);
  });
});

describe("geometry helpers", () => {
  it("signedVolume of a unit tetrahedron is 1/6 and flips with winding", () => {
    const pos = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const out = Uint32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
    expect(signedVolume(pos, out)).toBeCloseTo(1 / 6);
    const inv = Uint32Array.from([0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2]);
    expect(signedVolume(pos, inv)).toBeCloseTo(-1 / 6);
  });

  it("newellNormal of a square in the XZ plane points along ±Y with its area", () => {
    const pos = Float64Array.from([1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0, 1]);
    const [x, y, z] = newellNormal(pos, [0, 1, 2, 3]);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
    expect(y).toBeCloseTo(4); // twice the area (2) — Newell's sum
  });
});
