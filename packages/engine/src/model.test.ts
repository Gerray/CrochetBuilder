import { describe, it, expect } from "vitest";
import { buildModel } from "./model.js";
import { buildGraph } from "./graph.js";
import { relax } from "./relax.js";
import { measure, maxRoundDiameter, measureRounds } from "./measure.js";
import type { Gauge } from "./gauge.js";
import type { Op, PartContent, StitchCode } from "./schema.js";

const st = (code: StitchCode, count = 1): Op => ({ kind: "stitch", code, count });

const CUP: PartContent = {
  schemaVersion: 1,
  rows: [
    { id: "r1", type: "round", ops: [st("MR"), st("SC", 6)], stitchCountTarget: 6 },
    { id: "r2", type: "round", ops: [st("INC", 6)], stitchCountTarget: 12 },
    { id: "r3", type: "round", ops: [st("SC", 12)], stitchCountTarget: 12 },
  ],
};

describe("buildModel", () => {
  it("is buildGraph + relax + measure + validate", () => {
    const m = buildModel(CUP, { yarnWeight: "worsted" });
    const g = relax(buildGraph(CUP, { yarnWeight: "worsted" }));
    expect(Array.from(m.graph.positions)).toEqual(Array.from(g.positions));
    expect(m.size).toEqual(measure(g));
    expect(m.maxDiameter).toBe(maxRoundDiameter(g));
    expect(m.findings).toEqual([]);
    expect(m.estimated).toBe(true);
  });

  it("still builds a model for an invalid pattern and reports the findings", () => {
    const broken: PartContent = {
      schemaVersion: 1,
      rows: [CUP.rows[0]!, { id: "r2", type: "round", ops: [st("SC", 9)], stitchCountTarget: 8 }],
    };
    const m = buildModel(broken);
    expect(m.graph.nodes).toHaveLength(16);
    expect(m.findings.map((f) => f.code)).toEqual(["STITCH_COUNT_MISMATCH", "CONSUMES_OVERFLOW"]);
    expect(m.size.width).toBeGreaterThan(0);
  });

  it("refuses to build above the stitch budget and says so, instead of hanging", () => {
    const huge: PartContent = {
      schemaVersion: 1,
      rows: [
        CUP.rows[0]!,
        { id: "r2", type: "round", ops: [{ kind: "repeat", times: 100_000, ops: [st("SC", 1000)] }], stitchCountTarget: 1e8 },
      ],
    };
    const t0 = performance.now();
    const m = buildModel(huge);
    // Guards against building 100 million stitches, not a benchmark: generous so a loaded
    // machine running tests in parallel cannot make it flaky.
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(m.graph.overBudget).toBe(true);
    expect(m.graph.nodes).toHaveLength(0);
    expect(m.size).toEqual({ width: 0, height: 0, depth: 0 });
    const budget = m.findings.find((f) => f.code === "TOO_MANY_STITCHES")!;
    expect(budget).toMatchObject({ rowId: "r2", severity: "error", expected: 20_000, actual: 100_000_007 });
    // A custom budget moves the limit; under it no budget finding appears.
    expect(buildModel(CUP, undefined, { maxStitches: 10 }).graph.overBudget).toBe(true);
    expect(buildModel(CUP).findings.map((f) => f.code)).not.toContain("TOO_MANY_STITCHES");
  });

  it("passes relax options through", () => {
    const a = buildModel(CUP, undefined, { seed: 3 });
    const b = buildModel(CUP, undefined, { seed: 3 });
    expect(Array.from(a.graph.positions)).toEqual(Array.from(b.graph.positions));
    expect(buildModel(CUP, { stitchesPer10cm: 10 }).estimated).toBe(false);
  });
});

/** Magic ring with `n` sc, then `n` evenly spaced increases in every round. */
function disc(n: number, rounds: number): PartContent {
  const rows: PartContent["rows"] = [{ id: "r1", type: "round", ops: [st("MR"), st("SC", n)], stitchCountTarget: n }];
  for (let k = 2; k <= rounds; k++) {
    const ops: Op[] = k === 2 ? [st("INC", n)] : [{ kind: "repeat", times: n, ops: [st("SC", k - 2), st("INC")] }];
    rows.push({ id: `r${k}`, type: "round", ops, stitchCountTarget: n * k });
  }
  return { schemaVersion: 1, rows };
}

/** Angle (degrees) by which the outer rounds rise out of the plane of round 1. */
function edgeRise(content: PartContent, gauge: Gauge): number {
  const rounds = measureRounds(buildModel(content, gauge).graph);
  const c0 = rounds[0]!.center;
  const a = rounds[rounds.length - 4]!;
  const b = rounds[rounds.length - 1]!;
  const axis = b.center.map((v, i) => v - c0[i]!);
  const len = Math.hypot(...axis);
  const along = (c: number[]) => (len === 0 ? 0 : c.reduce((s, v, i) => s + (v - c0[i]!) * axis[i]!, 0) / len);
  return (Math.atan2(along(b.center) - along(a.center), (b.diameter - a.diameter) / 2) * 180) / Math.PI;
}

describe("increases per round and cone angle", () => {
  // A disc with n increases per round is a cone whose rounds grow by n·w/(2π) in radius
  // per row of height h, so it rises out of the plane by arccos(n / n₀) with
  // n₀ = 2π·h/w, the increase count that lies flat.
  const cases: [string, Gauge, number[]][] = [
    ["default gauge (square stitches, flat at 2π ≈ 6.3)", {}, [4, 5, 6]],
    ["tall stitches (h = 1.25 w, flat at 8)", { stitchesPer10cm: 20, rowsPer10cm: 16 }, [5, 6, 8]],
  ];
  for (const [label, gauge, counts] of cases) {
    it(`follows arccos(n / n₀) for ${label}`, () => {
      const stitches = gauge.stitchesPer10cm ?? 20;
      const rows = gauge.rowsPer10cm ?? 20;
      const flat = (2 * Math.PI * stitches) / rows;
      for (const n of counts) {
        // Compared as cos(rise) = n / n₀: near flat the angle itself is very sensitive
        // (arccos is steep at 1), the ratio of circumference to slant growth is not.
        const rise = (edgeRise(disc(n, 10), gauge) * Math.PI) / 180;
        expect(Math.abs(Math.cos(rise) - Math.min(1, n / flat))).toBeLessThan(0.035);
      }
    });
  }
});
