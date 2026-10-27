import { describe, it, expect } from "vitest";
import { buildGraph } from "./graph.js";
import { relax } from "./relax.js";
import { toMesh, type MeshData } from "./mesh.js";
import type { Op, PartContent, Row, StitchCode } from "./schema.js";

const st = (code: StitchCode, count = 1): Op => ({ kind: "stitch", code, count });
const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });
const row = (id: string, ops: Op[], t: number, type: "row" | "round" = "round"): Row => ({
  id,
  type,
  ops,
  stitchCountTarget: t,
});
const SPHERE: PartContent = {
  schemaVersion: 1,
  rows: [
    row("r1", [st("MR"), st("SC", 6)], 6),
    row("r2", [st("INC", 6)], 12),
    row("r3", [rep(6, [st("SC"), st("INC")])], 18),
    row("r4", [rep(6, [st("SC", 2), st("INC")])], 24),
    row("r5", [st("SC", 24)], 24),
    row("r6", [rep(6, [st("SC", 2), st("DEC")])], 18),
    row("r7", [rep(6, [st("SC"), st("DEC")])], 12),
    row("r8", [st("DEC", 6)], 6),
  ],
};
const FLAT: PartContent = {
  schemaVersion: 1,
  rows: [row("f", [st("CH", 7)], 0, "row"), row("1", [st("SC", 6)], 6, "row"), row("2", [st("CH"), st("SC", 6)], 6, "row")],
};

const graph = relax(buildGraph(SPHERE));
const n = graph.nodes.length;

function expectWellFormed(m: MeshData) {
  const verts = m.positions.length / 3;
  expect(m.positions).toBeInstanceOf(Float32Array);
  expect(m.normals).toBeInstanceOf(Float32Array);
  expect(m.indices).toBeInstanceOf(Uint32Array);
  expect(m.nodeIndex).toBeInstanceOf(Uint32Array);
  expect(m.normals.length).toBe(m.positions.length);
  expect(m.nodeIndex.length).toBe(verts);
  for (const i of m.indices) expect(i).toBeLessThan(verts);
  for (const v of m.nodeIndex) expect(v).toBeLessThan(n);
  for (let v = 0; v < verts; v++) {
    expect(Math.hypot(m.normals[3 * v]!, m.normals[3 * v + 1]!, m.normals[3 * v + 2]!)).toBeCloseTo(1, 5);
  }
}

/** Share of triangles whose face normal agrees with the vertex normals. */
function windingAgreement(m: MeshData): number {
  const p = m.positions;
  let ok = 0;
  const tris = m.indices.length / 3;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = 3 * m.indices[t]!, b = 3 * m.indices[t + 1]!, c = 3 * m.indices[t + 2]!;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const dot = nx * m.normals[a]! + ny * m.normals[a + 1]! + nz * m.normals[a + 2]!;
    if (dot > 0) ok++;
  }
  return ok / tris;
}

describe("toMesh — points", () => {
  it("has one vertex per node, identity nodeIndex", () => {
    const m = toMesh(graph, "points");
    expectWellFormed(m);
    expect(m.primitive).toBe("points");
    expect(m.positions.length).toBe(3 * n);
    expect(Array.from(m.nodeIndex)).toEqual([...Array(n).keys()]);
    expect(Array.from(m.indices)).toEqual([...Array(n).keys()]);
    expect(m.positions[3 * 5]).toBeCloseTo(graph.positions[3 * 5]!, 4);
  });
});

describe("toMesh — surface", () => {
  it("triangulates the fabric with outward normals on a closed piece", () => {
    const m = toMesh(graph, "surface");
    expectWellFormed(m);
    expect(m.primitive).toBe("triangles");
    expect(m.indices.length).toBe(graph.triangles.length);
    // Outward: vertex normals point away from the piece's centroid.
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      cx += m.positions[3 * i]! / n;
      cy += m.positions[3 * i + 1]! / n;
      cz += m.positions[3 * i + 2]! / n;
    }
    let out = 0;
    for (let i = 0; i < n; i++) {
      const d =
        (m.positions[3 * i]! - cx) * m.normals[3 * i]! +
        (m.positions[3 * i + 1]! - cy) * m.normals[3 * i + 1]! +
        (m.positions[3 * i + 2]! - cz) * m.normals[3 * i + 2]!;
      if (d > 0) out++;
    }
    expect(out / n).toBeGreaterThan(0.95);
    expect(windingAgreement(m)).toBeGreaterThan(0.95);
  });

  it("gives a flat piece consistent normals across turned rows (facing +Z)", () => {
    const flat = relax(buildGraph(FLAT));
    const m = toMesh(flat, "surface");
    expectWellFormed(m);
    let facing = 0;
    const used = new Set(m.indices);
    for (const v of used) if (m.normals[3 * v + 2]! > 0.8) facing++;
    expect(facing / used.size).toBeGreaterThan(0.9);
  });
});

describe("toMesh — tube", () => {
  it("sweeps a ring of radialSegments vertices per spline point along the working path", () => {
    const m = toMesh(graph, "tube", { radialSegments: 5, subdivisions: 3 });
    expectWellFormed(m);
    const points = (n - 1) * 3 + 1;
    expect(m.positions.length / 3).toBe(points * 5);
    expect(m.indices.length).toBe((points - 1) * 5 * 6);
    // Owners run along the working path.
    for (let v = 1; v < m.nodeIndex.length; v++) expect(m.nodeIndex[v]!).toBeGreaterThanOrEqual(m.nodeIndex[v - 1]!);
    expect(m.nodeIndex[0]).toBe(0);
    expect(m.nodeIndex[m.nodeIndex.length - 1]).toBe(n - 1);
    expect(windingAgreement(m)).toBeGreaterThan(0.95);
  });

  it("has the yarn radius around each spline point (default: half the yarn diameter)", () => {
    const seg = 6;
    const m = toMesh(graph, "tube");
    const r = graph.gauge.yarnDiameterMm / 2;
    for (let ring = 0; ring < m.positions.length / 3 / seg; ring += 7) {
      let cx = 0, cy = 0, cz = 0;
      for (let s = 0; s < seg; s++) {
        const v = 3 * (ring * seg + s);
        cx += m.positions[v]! / seg;
        cy += m.positions[v + 1]! / seg;
        cz += m.positions[v + 2]! / seg;
      }
      const v = 3 * ring * seg;
      expect(Math.hypot(m.positions[v]! - cx, m.positions[v + 1]! - cy, m.positions[v + 2]! - cz)).toBeCloseTo(r, 3);
    }
    const thick = toMesh(graph, "tube", { radius: 2 });
    expect(Math.hypot(thick.positions[0]! - graph.positions[0]!, thick.positions[1]! - graph.positions[1]!, thick.positions[2]! - graph.positions[2]!)).toBeCloseTo(2, 4);
  });
});

describe("toMesh — degenerate pieces", () => {
  it("draws a lone stitch (MR only, one SC) as a yarn-thick bead", () => {
    for (const ops of [[st("MR")], [st("SC")]]) {
      const g = relax(buildGraph({ schemaVersion: 1, rows: [row("a", ops, 0)] }));
      const m = toMesh(g, "tube", { radialSegments: 6 });
      expectWellFormed(m);
      expect(m.indices.length).toBeGreaterThan(0);
      const r = g.gauge.yarnDiameterMm / 2;
      for (let v = 0; v < m.positions.length / 3; v++) {
        const d = Math.hypot(
          m.positions[3 * v]! - g.positions[0]!,
          m.positions[3 * v + 1]! - g.positions[1]!,
          m.positions[3 * v + 2]! - g.positions[2]!,
        );
        expect(d).toBeCloseTo(r, 4);
      }
      expect(windingAgreement(m)).toBeGreaterThan(0.6); // pole triangles are degenerate
    }
  });

  it("gives turning chains (in no triangle) the normal of their neighbour on the path", () => {
    const flat = relax(buildGraph(FLAT));
    const m = toMesh(flat, "surface");
    const turn = flat.nodes.find((n) => n.lift)!;
    const neighbour = turn.id - 1; // last stitch of the previous row
    for (let k = 0; k < 3; k++) expect(m.normals[3 * turn.id + k]).toBeCloseTo(m.normals[3 * neighbour + k]!, 6);
    // Facing +Z like the fabric, not "away from the centroid" sideways.
    expect(m.normals[3 * turn.id + 2]!).toBeGreaterThan(0.8);
  });
});

describe("toMesh — empty graph", () => {
  it("returns empty arrays for every style", () => {
    const empty = buildGraph({ schemaVersion: 1, rows: [] });
    for (const style of ["tube", "points", "surface"] as const) {
      const m = toMesh(empty, style);
      expect(m.positions).toHaveLength(0);
      expect(m.indices).toHaveLength(0);
      expect(m.nodeIndex).toHaveLength(0);
    }
  });
});
