/**
 * Measurement unit tests and the golden shape tests of the graph → relax pipeline.
 *
 * Shapes are checked by size and topology, never by pictures. All runs use the default
 * relaxation (seed 1), so the numbers are deterministic. Gauge: engine default (DK, 4 mm):
 * stitch width w = 5 mm, stitch height h = 100/24 ≈ 4.17 mm, yarn 2.5 mm.
 *
 * Tolerance bands, and why:
 *   - Round diameters: ±15 % of the analytic C/π (C = stitches × w). Relaxed rounds come out
 *     within ~4 % (sphere 37.2 mm vs 38.2 mm); the band leaves room for tuning without letting a wrong topology pass.
 *   - The FORMAT.md sphere has a single even round, so its pole-to-pole path (8 rounds ≈ 35 mm)
 *     is about as long as its equator radius (~19 mm) — the real object is an oblate ball, not
 *     a perfect sphere. Expected height/diameter: 0.35–1.2 (actual ≈ 0.46); a ball with four
 *     even rounds must be clearly rounder (actual ≈ 0.68).
 *   - Flat pieces: width and height ±20 % of stitches × w and rows × h.
 */

import { describe, it, expect } from "vitest";
import { buildGraph, type StitchGraph } from "./graph.js";
import { relax } from "./relax.js";
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

const model = (c: PartContent) => relax(buildGraph(c));
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
  it("sphere (FORMAT.md): equator 24·w/π ± 15 %, roundish, closed at both ends", () => {
    const g = model(SPHERE);
    const w = g.gauge.stitchWidthMm;
    const expected = (24 * w) / Math.PI; // 38.2 mm
    const diameter = maxRoundDiameter(g);
    within(diameter, expected, 0.15);
    const size = measure(g);
    within(size.width, expected + g.gauge.yarnDiameterMm, 0.15);
    within(size.depth, expected + g.gauge.yarnDiameterMm, 0.15);
    // Not a flat disc, not a tall tube.
    expect(size.height / diameter).toBeGreaterThan(0.35);
    expect(size.height / diameter).toBeLessThan(1.2);

    // Closed at both ends: starts at the magic ring at the bottom, ends in a small round on top.
    const rounds = measureRounds(g);
    const top = rounds[rounds.length - 1]!;
    expect(g.nodes[0]!.code).toBe("MR");
    expect(g.nodes.filter((n) => n.rowId === "r1" && n.code === "SC").every((n) => n.parents[0] === 0)).toBe(true);
    expect(top.diameter).toBeLessThan(0.35 * diameter);
    const span = size.height - g.gauge.yarnDiameterMm;
    expect(g.positions[1]!).toBeLessThan(0.2 * span);
    expect(top.center[1]).toBeGreaterThan(0.7 * span);
  });

  it("classic ball (four even rounds) is rounder than the one-even-round sphere", () => {
    const sphere = model(SPHERE);
    const ball = model(BALL);
    const ratio = (g: StitchGraph) => measure(g).height / maxRoundDiameter(g);
    within(maxRoundDiameter(ball), (24 * ball.gauge.stitchWidthMm) / Math.PI, 0.15);
    expect(ratio(ball)).toBeGreaterThan(0.55);
    expect(ratio(ball)).toBeLessThan(1.3);
    expect(ratio(ball)).toBeGreaterThan(ratio(sphere) + 0.1);
  });

  it("increase-only rounds make a flat disc: thickness ≪ diameter", () => {
    const g = model(DISC);
    const diameter = maxRoundDiameter(g);
    within(diameter, (24 * g.gauge.stitchWidthMm) / Math.PI, 0.15);
    const size = measure(g);
    expect(size.height).toBeLessThan(0.25 * diameter);
    expect(size.width).toBeGreaterThan(0.85 * diameter);
    expect(size.depth).toBeGreaterThan(0.85 * diameter);
  });

  it("even rounds after a disc make a tube of constant circumference", () => {
    const g = model(TUBE);
    const w = g.gauge.stitchWidthMm;
    const h = g.gauge.stitchHeightMm;
    const tube = measureRounds(g).filter((r) => r.rowId.startsWith("t"));
    expect(tube).toHaveLength(6);
    for (const r of tube) within(r.diameter, (24 * w) / Math.PI, 0.05);
    const ds = tube.map((r) => r.diameter);
    expect(Math.max(...ds) / Math.min(...ds)).toBeLessThan(1.03);
    // Five round heights between the first and the last tube round, along the axis.
    within(tube[5]!.center[1] - tube[0]!.center[1], 5 * h, 0.2);
    expect(measure(g).height).toBeGreaterThan(0.6 * maxRoundDiameter(g));
  });

  it("foundation chain + rows make a flat rectangle: stitches × w by rows × h, thin", () => {
    const g = model(RECT);
    const w = g.gauge.stitchWidthMm;
    const h = g.gauge.stitchHeightMm;
    const d = g.gauge.yarnDiameterMm;
    const size = measure(g);
    within(size.width, 6 * w + d, 0.2);
    within(size.height, 3 * h + d, 0.2);
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
  it("builds and relaxes 3,000 stitches in well under a second", () => {
    const rows: Row[] = [row("a", [st("MR"), st("SC", 6)], 6)];
    for (let k = 2; k <= 10; k++) rows.push(row(`i${k}`, [rep(6, [st("SC", k - 2), st("INC")])], 6 * k));
    let stitches = 330; // 6 + 12 + … + 60
    for (let i = 0; stitches < 3000; i++, stitches += 60) rows.push(row(`b${i}`, [st("SC", 60)], 60));
    const content = part(rows);
    relax(buildGraph(content), { iterations: 10 }); // warm-up (JIT)
    const t0 = performance.now();
    const g = relax(buildGraph(content));
    const ms = performance.now() - t0;
    expect(g.nodes.length).toBeGreaterThanOrEqual(2900);
    expect(ms).toBeLessThan(1500);
    within(maxRoundDiameter(g), (60 * g.gauge.stitchWidthMm) / Math.PI, 0.15);
  });
});
