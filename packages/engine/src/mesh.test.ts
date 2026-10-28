import { describe, it, expect } from "vitest";
import { buildGraph } from "./graph.js";
import { relax } from "./relax.js";
import { SMOOTH_MAX_NODES, toMesh, type MeshData } from "./mesh.js";
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
    // The fabric plus the cap over the last round (6 stitches).
    expect(m.indices.length).toBe(graph.triangles.length + 3 * 6);
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
    // n stitches and, on this closed piece, the closing pole the tail runs to.
    const points = n * 3 + 1;
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

// ---------------------------------------------------------------------------
// Closing pole, smoothing
// ---------------------------------------------------------------------------

/** An open tube (an arm): grows to 12 stitches, then four even rounds — the rim stays open. */
const ARM: PartContent = {
  schemaVersion: 1,
  rows: [
    row("a1", [st("MR"), st("SC", 6)], 6),
    row("a2", [st("INC", 6)], 12),
    ...[3, 4, 5, 6].map((k) => row(`a${k}`, [st("SC", 12)], 12)),
  ],
};
const arm = relax(buildGraph(ARM));

/** Undirected edge → number of triangles using it, and how often a directed edge repeats. */
function edges(m: MeshData): { count: Map<number, number>; repeatedDirected: number } {
  const V = m.positions.length / 3;
  const count = new Map<number, number>();
  const directed = new Set<number>();
  let repeatedDirected = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let j = 0; j < 3; j++) {
      const a = m.indices[t + j]!, b = m.indices[t + ((j + 1) % 3)]!;
      const key = Math.min(a, b) * V + Math.max(a, b);
      count.set(key, (count.get(key) ?? 0) + 1);
      if (directed.has(a * V + b)) repeatedDirected++;
      directed.add(a * V + b);
    }
  }
  return { count, repeatedDirected };
}

/** Boundary edges (in one triangle only) as [a, b] vertex pairs. */
function boundary(m: MeshData): Array<[number, number]> {
  const V = m.positions.length / 3;
  const out: Array<[number, number]> = [];
  for (const [key, c] of edges(m).count) if (c === 1) out.push([Math.floor(key / V), key % V]);
  return out;
}

type V3 = [number, number, number];
const lastRound = (g: typeof graph) => {
  const r = g.rows[g.rows.length - 1]!;
  return Array.from({ length: r.nodeCount }, (_, k) => r.firstNode + k);
};
const at = (p: ArrayLike<number>, i: number): V3 => [p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!];
const centroid = (p: ArrayLike<number>, ids: number[]): V3 => {
  const c: V3 = [0, 0, 0];
  for (const i of ids) for (let k = 0; k < 3; k++) c[k] = c[k]! + p[3 * i + k]! / ids.length;
  return c;
};
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** Share of vertices whose normal points away from the centroid of all vertices. */
function outward(m: MeshData): number {
  const V = m.positions.length / 3;
  const c = centroid(m.positions, [...Array(V).keys()]);
  let out = 0;
  for (let v = 0; v < V; v++) {
    let d = 0;
    for (let k = 0; k < 3; k++) d += (m.positions[3 * v + k]! - c[k]!) * m.normals[3 * v + k]!;
    if (d > 0) out++;
  }
  return out / V;
}

describe("toMesh — surface of a closed piece (closing pole)", () => {
  it("caps the last round with a fan to the pole: watertight and consistently wound", () => {
    for (const smooth of [0, 1, 2]) {
      const m = toMesh(graph, "surface", { smooth });
      expectWellFormed(m);
      const { count, repeatedDirected } = edges(m);
      for (const c of count.values()) expect(c).toBe(2); // every edge between exactly two triangles
      expect(repeatedDirected).toBe(0); // which run it in opposite directions
      expect(boundary(m)).toHaveLength(0);
    }
  });

  it("puts the pole on the outside of the last round, owned by its last stitch", () => {
    const m = toMesh(graph, "surface");
    expect(m.positions.length).toBe(3 * (n + 1));
    const ring = lastRound(graph);
    expect(m.nodeIndex[n]).toBe(ring[ring.length - 1]);
    const c = centroid(graph.positions, ring);
    const r = ring.reduce((s, i) => s + dist(at(graph.positions, i), c), 0) / ring.length;
    const pole = at(m.positions, n);
    const piece = centroid(graph.positions, [...Array(n).keys()]);
    const out = [c[0] - piece[0], c[1] - piece[1], c[2] - piece[2]];
    const up = [pole[0] - c[0], pole[1] - c[1], pole[2] - c[2]];
    // Above the round's centre (the ball curves on), never further than the round's radius.
    expect(up[0]! * out[0]! + up[1]! * out[1]! + up[2]! * out[2]!).toBeGreaterThan(0);
    expect(dist(pole, c)).toBeGreaterThan(0.05 * r);
    expect(dist(pole, c)).toBeLessThanOrEqual(r + 1e-6);
    // Every stitch of the last round is fanned to the pole.
    const fan = new Set<number>();
    for (let t = 0; t < m.indices.length; t += 3) {
      const tri = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
      if (tri.includes(n)) for (const v of tri) if (v !== n) fan.add(v);
    }
    expect([...fan].sort((a, b) => a - b)).toEqual(ring);
  });

  it("points (almost) every normal outwards, also when smoothed", () => {
    for (const smooth of [0, 1]) {
      const m = toMesh(graph, "surface", { smooth });
      expectWellFormed(m);
      expect(m.normals.every(Number.isFinite)).toBe(true);
      expect(outward(m)).toBeGreaterThan(0.95);
      expect(windingAgreement(m)).toBeGreaterThan(0.95);
    }
  });

  it("keeps an open piece open: the rim of an open tube stays a boundary loop", () => {
    const an = arm.nodes.length;
    const rim = new Set(lastRound(arm));
    const coarse = toMesh(arm, "surface");
    expect(coarse.positions.length).toBe(3 * an); // no pole
    expect(boundary(coarse)).toHaveLength(rim.size);
    const m = toMesh(arm, "surface", { smooth: 1 });
    for (const v of m.nodeIndex) expect(v).toBeLessThan(an);
    // Two boundary edges per rim stitch after a subdivision step, all on the rim.
    const open = boundary(m);
    expect(open).toHaveLength(2 * rim.size);
    for (const [a, b] of open) expect(rim.has(m.nodeIndex[a]!) && rim.has(m.nodeIndex[b]!)).toBe(true);
  });

  it("follows the `closed` override (as `relax` does)", () => {
    expect(boundary(toMesh(graph, "surface", { closed: false }))).toHaveLength(6);
    expect(toMesh(graph, "surface", { closed: false }).positions.length).toBe(3 * n);
    expect(boundary(toMesh(arm, "surface", { closed: true }))).toHaveLength(0);
    // A flat piece has no closing round: nothing to cap.
    const flat = relax(buildGraph(FLAT));
    expect(toMesh(flat, "surface", { closed: true }).positions.length).toBe(3 * flat.nodes.length);
  });
});

describe("toMesh — surface smoothing", () => {
  it("keeps the stitch vertices, adds one per edge and maps it to a nearby stitch", () => {
    const coarse = toMesh(graph, "surface");
    const fine = toMesh(graph, "surface", { smooth: 1 });
    expectWellFormed(fine);
    const V = coarse.positions.length / 3;
    const coarseEdges = [...edges(coarse).count.keys()];
    expect(fine.positions.length / 3).toBe(V + coarseEdges.length);
    expect(fine.indices.length).toBe(4 * coarse.indices.length);
    expect(Array.from(fine.positions.subarray(0, 3 * V))).toEqual(Array.from(coarse.positions));
    expect(Array.from(fine.nodeIndex.subarray(0, V))).toEqual(Array.from(coarse.nodeIndex));
    // A new vertex sits about mid-edge and belongs to the nearer end of its edge.
    let longest = 0;
    for (const key of coarseEdges) {
      longest = Math.max(longest, dist(at(coarse.positions, Math.floor(key / V)), at(coarse.positions, key % V)));
    }
    // Measured to the stitch's own vertices: the closing pole is a vertex of the last stitch
    // too, so a point next to the pole belongs to that stitch without being near its vertex.
    for (let v = V; v < fine.positions.length / 3; v++) {
      let nearest = Infinity;
      for (let u = 0; u < V; u++) {
        if (coarse.nodeIndex[u] === fine.nodeIndex[v]) nearest = Math.min(nearest, dist(at(fine.positions, v), at(coarse.positions, u)));
      }
      expect(nearest).toBeLessThan(0.75 * longest);
    }
  });

  it("rounds a ball off: the new edge points lie further out than straight midpoints", () => {
    const coarse = toMesh(graph, "surface");
    const fine = toMesh(graph, "surface", { smooth: 1 });
    const V = coarse.positions.length / 3;
    const c = centroid(graph.positions, [...Array(n).keys()]);
    let straight = 0;
    const keys = [...edges(coarse).count.keys()];
    for (const key of keys) {
      const a = at(coarse.positions, Math.floor(key / V)), b = at(coarse.positions, key % V);
      straight += dist([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], c) / keys.length;
    }
    let curved = 0;
    for (let v = V; v < fine.positions.length / 3; v++) curved += dist(at(fine.positions, v), c) / keys.length;
    expect(curved).toBeGreaterThan(straight);
  });

  it("is deterministic", () => {
    const a = toMesh(graph, "surface", { smooth: 2 });
    const b = toMesh(relax(buildGraph(SPHERE)), "surface", { smooth: 2 });
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
    expect(Array.from(b.normals)).toEqual(Array.from(a.normals));
    expect(Array.from(b.indices)).toEqual(Array.from(a.indices));
    expect(Array.from(b.nodeIndex)).toEqual(Array.from(a.nodeIndex));
  });

  it("subdivides once with 'auto' below SMOOTH_MAX_NODES, not above; clamps to 0–2 steps", () => {
    const coarse = toMesh(graph, "surface").indices.length;
    expect(toMesh(graph, "surface", { smooth: "auto" }).indices.length).toBe(4 * coarse);
    expect(toMesh(graph, "surface", { smooth: 7 }).indices.length).toBe(16 * coarse);
    expect(toMesh(graph, "surface", { smooth: -1 }).indices.length).toBe(coarse);
    expect(toMesh(graph, "surface", { smooth: Number.NaN }).indices.length).toBe(coarse);
    const huge = buildGraph({
      schemaVersion: 1,
      rows: [row("c", [st("CH", 101)], 0, "row"), ...Array.from({ length: 50 }, (_, k) => row(`${k}`, [st("CH"), st("SC", 100)], 100, "row"))],
    });
    expect(huge.nodes.length).toBeGreaterThan(SMOOTH_MAX_NODES);
    expect(toMesh(huge, "surface", { smooth: "auto" }).indices.length).toBe(toMesh(huge, "surface").indices.length);
  });

  it("smooths a closed piece of ~3,000 stitches quickly", () => {
    const big: PartContent = {
      schemaVersion: 1,
      rows: [
        row("r1", [st("MR"), st("SC", 6)], 6),
        ...Array.from({ length: 9 }, (_, k) => row(`i${k}`, [rep(6, [st("SC", k), st("INC")])], 6 * (k + 2))),
        ...Array.from({ length: 40 }, (_, k) => row(`e${k}`, [st("SC", 60)], 60)),
        ...Array.from({ length: 9 }, (_, k) => row(`d${k}`, [rep(6, [st("SC", 8 - k), st("DEC")])], 6 * (9 - k))),
      ],
    };
    const g = relax(buildGraph(big), { iterations: 5 });
    expect(g.nodes.length).toBeGreaterThan(2_900);
    toMesh(g, "surface", { smooth: "auto" }); // warm-up (JIT)
    const t0 = performance.now();
    const m = toMesh(g, "surface", { smooth: "auto" });
    const ms = performance.now() - t0;
    console.info(`smoothed surface: ${g.nodes.length} nodes → ${m.positions.length / 3} vertices, ${m.indices.length / 3} triangles, ${ms.toFixed(1)} ms`);
    expect(boundary(m)).toHaveLength(0); // closed: capped
    expect(ms).toBeLessThan(300); // generous for slow CI machines; typically far less
  });
});

describe("toMesh — tube of a closed piece", () => {
  it("runs the tail on from the last stitch to the closing pole", () => {
    const seg = 6;
    const m = toMesh(graph, "tube", { radialSegments: seg, subdivisions: 2 });
    const pole = at(toMesh(graph, "surface").positions, n);
    const V = m.positions.length / 3;
    const end = centroid(m.positions, Array.from({ length: seg }, (_, s) => V - seg + s));
    expect(dist(end, pole)).toBeLessThan(1e-4);
    expect(m.nodeIndex[V - 1]).toBe(n - 1);
    // An open piece ends on its last stitch.
    const a = toMesh(arm, "tube", { radialSegments: seg });
    const AV = a.positions.length / 3;
    const armEnd = centroid(a.positions, Array.from({ length: seg }, (_, s) => AV - seg + s));
    expect(dist(armEnd, at(arm.positions, arm.nodes.length - 1))).toBeLessThan(1e-4);
  });
});
