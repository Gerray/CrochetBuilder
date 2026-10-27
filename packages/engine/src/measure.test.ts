/**
 * Measurement unit tests and the golden shape tests of the graph → relax pipeline.
 *
 * Shapes are checked by size and topology, never by pictures. All runs use the default
 * relaxation (seed 1), so the numbers are deterministic. The radial stabiliser only helps the
 * start and has faded out long before the end — the final shape comes from the springs, the
 * stuffing and the repulsion (radial: 0 gives the same sizes, see relax.test.ts).
 *
 * Two gauges:
 *   - DEFAULT: engine default (DK, 4 mm) — w = 5 mm, h = 100/24 ≈ 4.17 mm (h ≈ 0.83·w), yarn
 *     2.5 mm.
 *   - SQUARE: w = h = 5 mm. The flat-circle rule "6 increases per round lie flat" holds for
 *     2π·h/w ≈ 6, i.e. square stitches; that is where the ideal shapes are checked tightly.
 *
 * Tolerance bands, and why:
 *   - Per round, the diameter (2 × mean distance from the round's centroid) over the analytic
 *     C/π (C = stitches × w) must stay within 0.75–1.35 (DEFAULT) / 0.85–1.30 (SQUARE). This is
 *     the topology-sensitive check: a round worked into the wrong anchors cannot open up to its
 *     circumference (the negative test drops to ≈ 0.3).
 *   - DEFAULT increase rounds are slightly too dense for h < w (2π·h/w ≈ 5.2 < 6), so they
 *     ruffle a little: the disc is wavy (thickness ≈ 0.35 × width) and the FORMAT.md sphere —
 *     one even round, pole-to-pole path barely longer than its equator radius — is a flattened
 *     ball (≈ 36 × 23 mm, height/width ≈ 0.64). With SQUARE stitches the disc is flat
 *     (≈ 0.17) and the classic four-even-rounds ball is round (height/width ≈ 0.94).
 *   - Outer width (yarn envelope) ±15 % of C/π + yarn; circumference ±10 % of C.
 *   - Flat pieces: width ±15 % of stitches × w + yarn, height ±20 % of rows × h + yarn.
 */

import { describe, it, expect } from "vitest";
import { buildGraph, type StitchGraph } from "./graph.js";
import { relax, isClosedPiece } from "./relax.js";
import { buildModel } from "./model.js";
import type { Gauge } from "./gauge.js";
import { measure, measureRounds, maxRoundDiameter } from "./measure.js";
import { expandPart } from "./expand.js";
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
const sc24 = (id: string) => row(id, [st("SC", 24)], 24);

const INCREASES = [
  row("r1", [st("MR"), st("SC", 6)], 6),
  row("r2", [st("INC", 6)], 12),
  row("r3", [rep(6, [st("SC"), st("INC")])], 18),
  row("r4", [rep(6, [st("SC", 2), st("INC")])], 24),
];
const DECREASES = [
  row("r6", [rep(6, [st("SC", 2), st("DEC")])], 18),
  row("r7", [rep(6, [st("SC"), st("DEC")])], 12),
  row("r8", [st("DEC", 6)], 6),
];
/** docs/FORMAT.md: 8 rounds, 24 stitches at the equator. */
const SPHERE = part([...INCREASES, sc24("r5"), ...DECREASES]);
/** The classic amigurumi ball: four even rounds. */
const BALL = part([...INCREASES, sc24("r5"), sc24("e2"), sc24("e3"), sc24("e4"), ...DECREASES]);
const DISC = part(INCREASES);
const TUBE = part([...INCREASES, ...["t1", "t2", "t3", "t4", "t5", "t6"].map(sc24)]);
/** CH 7 foundation (as in validate.test.ts) + three rows of 6 SC with turning chains. */
const RECT = part([
  row("f", [st("CH", 7)], 0, "row"),
  row("1", [st("SC", 6)], 6, "row"),
  row("2", [st("CH"), st("SC", 6)], 6, "row"),
  row("3", [st("CH"), st("SC", 6)], 6, "row"),
]);

/** The FORMAT.md sphere with round 2 wrong: 24 stitches worked into the 6 of round 1. */
const WRONG = part([
  row("r1", [st("MR"), st("SC", 6)], 6),
  sc24("r2"),
  sc24("r3"),
  sc24("r4"),
  sc24("r5"),
  row("r6", [st("SC", 6)], 6),
]);
const SQUARE = { stitchesPer10cm: 20, rowsPer10cm: 20 };

const model = (c: PartContent, gauge?: Gauge) => relax(buildGraph(c, gauge));
/** Per closed round: diameter / (C/π). */
const roundRatios = (g: StitchGraph) =>
  measureRounds(g).map((r) => {
    const row = g.rows.find((x) => x.rowId === r.rowId)!;
    return r.diameter / ((row.widthStitches * g.gauge.stitchWidthMm) / Math.PI);
  });
/** Mean relative deviation of parent (vertical) edges from their rest length. */
const parentStrain = (g: StitchGraph) => {
  const p = g.positions;
  let sum = 0;
  let n = 0;
  for (const e of g.edges) {
    if (e.kind !== "parent") continue;
    const d = Math.hypot(p[3 * e.b]! - p[3 * e.a]!, p[3 * e.b + 1]! - p[3 * e.a + 1]!, p[3 * e.b + 2]! - p[3 * e.a + 2]!);
    sum += Math.abs(d - e.restLength) / e.restLength;
    n++;
  }
  return sum / n;
};
const within = (actual: number, expected: number, tol: number) => {
  expect(actual).toBeGreaterThanOrEqual(expected * (1 - tol));
  expect(actual).toBeLessThanOrEqual(expected * (1 + tol));
};

describe("measure", () => {
  it("is the bounding box of the node centres grown by one yarn diameter", () => {
    const g = buildGraph(part([row("f", [st("CH", 3)], 0, "row")]));
    const fake: StitchGraph = { ...g, positions: Float64Array.from([0, 0, 0, 10, 2, 0, 4, -1, 3]) };
    const d = g.gauge.yarnDiameterMm;
    expect(measure(fake)).toEqual({ width: 10 + d, height: 3 + d, depth: 3 + d });
  });

  it("is zero for an empty graph", () => {
    expect(measure(buildGraph(part([])))).toEqual({ width: 0, height: 0, depth: 0 });
    expect(maxRoundDiameter(buildGraph(part([])))).toBe(0);
  });

  it("measures every closed round, leaving out the MR anchor", () => {
    const g = buildGraph(SPHERE);
    const rounds = measureRounds(g);
    expect(rounds.map((r) => r.rowId)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]);
    // The procedural layout puts round 5 exactly on a circle of 24 w.
    const w = g.gauge.stitchWidthMm;
    expect(rounds[4]!.diameter).toBeCloseTo((24 * w) / Math.PI, 6);
    expect(rounds[4]!.circumference).toBeCloseTo(24 * 2 * ((24 * w) / (2 * Math.PI)) * Math.sin(Math.PI / 24), 6);
    expect(measureRounds(buildGraph(RECT))).toEqual([]);
  });
});

describe("golden shapes", () => {
  it("sphere (FORMAT.md, default gauge): flattened ball of the right size, closed at both ends", () => {
    const g = model(SPHERE);
    const w = g.gauge.stitchWidthMm;
    const d = g.gauge.yarnDiameterMm;
    const expected = (24 * w) / Math.PI; // 38.2 mm
    const size = measure(g);
    within(size.width, expected + d, 0.15); // 36.2 mm
    within(size.depth, expected + d, 0.15);
    const rounds = measureRounds(g);
    within(rounds.find((r) => r.rowId === "r5")!.circumference, 24 * w, 0.1);
    for (const ratio of roundRatios(g)) {
      expect(ratio).toBeGreaterThan(0.75);
      expect(ratio).toBeLessThan(1.35);
    }
    expect(parentStrain(g)).toBeLessThan(0.1);
    // Not a flat disc, not a tall tube.
    expect(size.height / size.width).toBeGreaterThan(0.45); // 0.64
    expect(size.height / size.width).toBeLessThan(1.1);

    // Closed at both ends: starts at the magic ring at the bottom, ends in a small round on top.
    const top = rounds[rounds.length - 1]!;
    expect(isClosedPiece(g)).toBe(true);
    expect(g.nodes[0]!.code).toBe("MR");
    expect(g.nodes.filter((n) => n.rowId === "r1" && n.code === "SC").every((n) => n.parents[0] === 0)).toBe(true);
    expect(top.diameter).toBeLessThan(0.4 * size.width);
    const span = size.height - d;
    expect(g.positions[1]!).toBeLessThan(0.2 * span);
    expect(top.center[1]).toBeGreaterThan(0.7 * span);
  });

  it("sphere with square stitches: every round within 0.85–1.30 of C/π, equator ±10 %", () => {
    const g = model(SPHERE, SQUARE);
    within(maxRoundDiameter(g), (24 * g.gauge.stitchWidthMm) / Math.PI, 0.1); // 35.6 vs 38.2
    for (const ratio of roundRatios(g)) {
      expect(ratio).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThan(1.3);
    }
  });

  it("a wrong topology does not pass: 24 stitches on a round of 6 cannot open up", () => {
    for (const gauge of [undefined, SQUARE]) {
      const ratios = roundRatios(model(WRONG, gauge));
      expect(Math.min(...ratios)).toBeLessThan(0.5); // round 2: ≈ 0.3
    }
  });

  it("classic ball (four even rounds) is round with square stitches and rounder than the sphere", () => {
    const ratio = (g: StitchGraph) => measure(g).height / measure(g).width;
    const square = model(BALL, SQUARE);
    within(maxRoundDiameter(square), (24 * square.gauge.stitchWidthMm) / Math.PI, 0.1);
    expect(ratio(square)).toBeGreaterThan(0.85); // 0.94
    expect(ratio(square)).toBeLessThan(1.15);
    expect(ratio(model(BALL))).toBeGreaterThan(ratio(model(SPHERE)) + 0.05); // 0.74 vs 0.64
  });

  it("increase-only rounds make a flat disc with square stitches: thickness ≪ diameter", () => {
    const g = model(DISC, SQUARE);
    const diameter = maxRoundDiameter(g);
    within(diameter, (24 * g.gauge.stitchWidthMm) / Math.PI, 0.1);
    const size = measure(g);
    expect(size.height).toBeLessThan(0.25 * diameter); // 6.8 vs 37.9
    expect(size.width).toBeGreaterThan(0.95 * diameter);
    expect(size.depth).toBeGreaterThan(0.95 * diameter);
  });

  it("increase-only rounds with the default gauge: a slightly ruffled disc", () => {
    const g = model(DISC);
    const size = measure(g);
    for (const ratio of roundRatios(g)) expect(ratio).toBeGreaterThan(0.75);
    expect(size.height).toBeLessThan(0.45 * size.width); // 11.7 vs 33.9
    expect(size.height).toBeGreaterThan(0.15 * size.width); // it does ruffle: 6 > 2π·h/w
  });

  it("even rounds after a disc make a tube of constant circumference", () => {
    for (const gauge of [undefined, SQUARE]) {
      const g = model(TUBE, gauge);
      const w = g.gauge.stitchWidthMm;
      const h = g.gauge.stitchHeightMm;
      const tube = measureRounds(g).filter((r) => r.rowId.startsWith("t"));
      expect(tube).toHaveLength(6);
      within(tube[0]!.diameter, (24 * w) / Math.PI, 0.1);
      for (const r of tube.slice(1)) within(r.diameter, (24 * w) / Math.PI, 0.03);
      const ds = tube.slice(1).map((r) => r.diameter);
      expect(Math.max(...ds) / Math.min(...ds)).toBeLessThan(1.02);
      // Five round heights between the first and the last tube round, along the axis.
      within(tube[5]!.center[1] - tube[0]!.center[1], 5 * h, 0.2);
    }
  });

  it("foundation chain + rows make a flat rectangle: stitches × w by rows × h, thin", () => {
    const g = model(RECT);
    const w = g.gauge.stitchWidthMm;
    const h = g.gauge.stitchHeightMm;
    const d = g.gauge.yarnDiameterMm;
    const size = measure(g);
    within(size.width, 6 * w + d, 0.15); // 32.5
    within(size.height, 3 * h + d, 0.2); // 15.0
    expect(size.depth).toBeLessThan(2 * d);
  });

  it("has the topology of its pattern: node counts and parents per code", () => {
    for (const content of [SPHERE, BALL, DISC, TUBE, RECT]) {
      const g = model(content);
      expect(g.nodes).toHaveLength(expandPart(content).filter((a) => a.code !== "NOTE").length);
      for (const n of g.nodes) {
        const expected = n.code === "MR" || n.code === "CH" ? 0 : n.code === "DEC" ? 2 : 1;
        expect(n.parents).toHaveLength(expected);
      }
    }
  });
});

describe("performance", () => {
  it("builds a stuffed, closed 3,000-stitch piece with buildModel in under a second", () => {
    const rows: Row[] = [row("a", [st("MR"), st("SC", 6)], 6)];
    for (let k = 2; k <= 10; k++) rows.push(row("i" + k, [rep(6, [st("SC", k - 2), st("INC")])], 6 * k));
    for (let i = 0; i < 40; i++) rows.push(row("e" + i, [st("SC", 60)], 60));
    for (let k = 9; k >= 1; k--) rows.push(row("d" + k, [rep(6, [st("SC", k - 1), st("DEC")])], 6 * k));
    const content = part(rows);
    buildModel(content, undefined, { iterations: 10 }); // warm-up (JIT)
    const t0 = performance.now();
    const m = buildModel(content);
    const ms = performance.now() - t0; // ≈ 300 ms on the reference machine
    expect(m.graph.nodes.length).toBeGreaterThanOrEqual(2900);
    expect(isClosedPiece(m.graph)).toBe(true);
    expect(ms).toBeLessThan(1000);
    within(m.maxDiameter, (60 * m.graph.gauge.stitchWidthMm) / Math.PI, 0.15);
  });
});
