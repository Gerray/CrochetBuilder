import { describe, it, expect } from "vitest";
import { buildModel } from "./model.js";
import { buildGraph } from "./graph.js";
import { relax } from "./relax.js";
import { measure, maxRoundDiameter } from "./measure.js";
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

  it("passes relax options through", () => {
    const a = buildModel(CUP, undefined, { seed: 3 });
    const b = buildModel(CUP, undefined, { seed: 3 });
    expect(Array.from(a.graph.positions)).toEqual(Array.from(b.graph.positions));
    expect(buildModel(CUP, { stitchesPer10cm: 10 }).estimated).toBe(false);
  });
});
