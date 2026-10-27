import { describe, it, expect } from "vitest";
import { buildGraph, type StitchGraph } from "./graph.js";
import { relax } from "./relax.js";
import { toMesh, type MeshData } from "./mesh.js";
import {
  stitchDetail,
  stitchYarn,
  stitchYarnRadius,
  STITCH_YARN_MAX_WIDTH,
  STITCH_YARN_SCALE,
  type V3,
  type YarnArc,
  type YarnPiece,
  type YarnPost,
} from "./stitch-mesh.js";
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
/** Flat piece with every code: foundation chain, turning chains, SC, HDC, DC, TR, DTR, SL_ST, INC, DEC, INVDEC. */
const SAMPLER: PartContent = {
  schemaVersion: 1,
  rows: [
    row("f", [st("CH", 9)], 0, "row"),
    row("1", [st("SC", 8)], 8, "row"),
    row("2", [st("CH", 2), st("HDC", 2), st("DC", 2), st("TR", 2), st("DTR", 2)], 8, "row"),
    row("3", [st("CH"), st("SL_ST", 2), st("INC"), st("SC"), st("DEC"), st("INVDEC")], 7, "row"),
  ],
};

const sphere = relax(buildGraph(SPHERE));
const sampler = relax(buildGraph(SAMPLER));

function expectWellFormed(m: MeshData, g: StitchGraph) {
  const verts = m.positions.length / 3;
  expect(m.style).toBe("stitches");
  expect(m.primitive).toBe("triangles");
  expect(m.normals.length).toBe(m.positions.length);
  expect(m.nodeIndex.length).toBe(verts);
  expect(m.indices.length % 3).toBe(0);
  expect(verts).toBeGreaterThan(0);
  for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
  let maxIndex = 0;
  for (const i of m.indices) maxIndex = Math.max(maxIndex, i);
  expect(maxIndex).toBeLessThan(verts);
  for (const v of m.nodeIndex) expect(v).toBeLessThan(g.nodes.length);
  for (let v = 0; v < verts; v++) {
    expect(Math.hypot(m.normals[3 * v]!, m.normals[3 * v + 1]!, m.normals[3 * v + 2]!)).toBeCloseTo(1, 5);
  }
  // Every stitch is drawn.
  expect(new Set(m.nodeIndex).size).toBe(g.nodes.length);
}

/** Share of triangles whose face normal agrees with the vertex normals (tubes face outwards). */
function windingAgreement(m: MeshData): number {
  const p = m.positions;
  let ok = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = 3 * m.indices[t]!, b = 3 * m.indices[t + 1]!, c = 3 * m.indices[t + 2]!;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * m.normals[a]! + ny * m.normals[a + 1]! + nz * m.normals[a + 2]! > 0) ok++;
  }
  return ok / (m.indices.length / 3);
}

/** The yarn pieces of a graph, with the surface normals toMesh uses. */
function yarnOf(g: StitchGraph): YarnPiece[] {
  const normals = toMesh(g, "points").normals;
  const out: YarnPiece[] = [];
  stitchYarn(g, normals, g.gauge.yarnDiameterMm, (p) => out.push(p));
  return out;
}
const arcs = (pieces: YarnPiece[], node: number, kind: YarnArc["kind"]) =>
  pieces.filter((p): p is YarnArc => p.node === node && "a" in p && p.kind === kind);
const P = (g: StitchGraph, i: number): V3 => [g.positions[3 * i]!, g.positions[3 * i + 1]!, g.positions[3 * i + 2]!];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const node = (g: StitchGraph, rowId: string, code: StitchCode) => g.nodes.find((n) => n.rowId === rowId && n.code === code)!;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const posts = (pieces: YarnPiece[], node: number) => pieces.filter((p): p is YarnPost => p.node === node && p.kind === "post");
/** Height of a stitch's post: from the crest of its front loop down to its feet (mean). */
const postHeight = (pieces: YarnPiece[], node: number) => {
  const p = posts(pieces, node)[0]!;
  return p.feet.reduce((s, k) => s + dist(p.points[p.crest]!, p.points[k]!), 0) / p.feet.length;
};

describe("toMesh — stitches", () => {
  it("is well-formed on a closed piece and on a flat sampler of every stitch", () => {
    for (const g of [sphere, sampler]) {
      const m = toMesh(g, "stitches");
      expectWellFormed(m, g);
      expect(windingAgreement(m)).toBeGreaterThan(0.95);
    }
  });

  it("is deterministic", () => {
    const a = toMesh(sphere, "stitches");
    const b = toMesh(relax(buildGraph(SPHERE)), "stitches");
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
    expect(Array.from(b.indices)).toEqual(Array.from(a.indices));
    expect(Array.from(b.nodeIndex)).toEqual(Array.from(a.nodeIndex));
  });

  it("keeps the vertices of a stitch near that stitch (nodeIndex is meaningful for picking)", () => {
    const m = toMesh(sphere, "stitches");
    const reach = 2.5 * sphere.gauge.stitchHeightMm;
    for (let v = 0; v < m.nodeIndex.length; v += 17) {
      const p: V3 = [m.positions[3 * v]!, m.positions[3 * v + 1]!, m.positions[3 * v + 2]!];
      expect(dist(p, P(sphere, m.nodeIndex[v]!))).toBeLessThan(reach);
    }
  });

  it("sweeps tubes of the yarn radius with the requested resolution", () => {
    const m = toMesh(sampler, "stitches", { radialSegments: 5, arcSamples: 4, radius: 1 });
    expectWellFormed(m, sampler);
    // First ring: 5 vertices at distance 1 around their centre.
    let cx = 0, cy = 0, cz = 0;
    for (let s = 0; s < 5; s++) {
      cx += m.positions[3 * s]! / 5;
      cy += m.positions[3 * s + 1]! / 5;
      cz += m.positions[3 * s + 2]! / 5;
    }
    expect(Math.hypot(m.positions[0]! - cx, m.positions[1]! - cy, m.positions[2]! - cz)).toBeCloseTo(1, 4);
    const pieces: YarnPiece[] = [];
    stitchYarn(sampler, toMesh(sampler, "points").normals, 2, (p) => pieces.push(p));
    // Arcs: 4 rings + 2 cap centres; ellipses: max(6, 2 × 4) = 8 rings; posts: 2 rings per point.
    let rings = 0, caps = 0;
    for (const p of pieces) {
      if (p.kind === "post") rings += 2 * p.points.length;
      else if ("a" in p) {
        rings += 4;
        caps += 2;
      } else rings += 8;
    }
    expect(m.positions.length / 3).toBe(5 * rings + caps);
    const def = toMesh(sampler, "stitches");
    const r = stitchYarnRadius(sampler.gauge);
    expect(r).toBeLessThanOrEqual(STITCH_YARN_SCALE * (sampler.gauge.yarnDiameterMm / 2));
    expect(r).toBeLessThanOrEqual(STITCH_YARN_MAX_WIDTH * sampler.gauge.stitchWidthMm + 1e-12);
    let dx = 0, dy = 0, dz = 0;
    for (let s = 0; s < 6; s++) {
      dx += def.positions[3 * s]! / 6;
      dy += def.positions[3 * s + 1]! / 6;
      dz += def.positions[3 * s + 2]! / 6;
    }
    expect(Math.hypot(def.positions[0]! - dx, def.positions[1]! - dy, def.positions[2]! - dz)).toBeCloseTo(r, 4);
  });

  it("returns empty arrays for an empty graph", () => {
    const m = toMesh(buildGraph({ schemaVersion: 1, rows: [] }), "stitches");
    expect(m.positions).toHaveLength(0);
    expect(m.indices).toHaveLength(0);
    expect(m.nodeIndex).toHaveLength(0);
  });
});

describe("stitch yarn — per stitch code", () => {
  const pieces = yarnOf(sampler);
  const sPieces = yarnOf(sphere);
  const w = sampler.gauge.stitchWidthMm;

  it("draws an SC as a closed post loop (front loop + legs) into its parent plus a back loop", () => {
    const sc = node(sampler, "1", "SC");
    const ps = posts(pieces, sc.id);
    expect(ps).toHaveLength(1);
    expect(arcs(pieces, sc.id, "top")).toHaveLength(1);
    expect(arcs(pieces, sc.id, "wrap")).toHaveLength(0);
    const post = ps[0]!;
    expect(post.feet).toHaveLength(1);
    expect(dist(post.points[post.feet[0]!]!, P(sampler, sc.parents[0]!))).toBeLessThan(0.5 * w);
    // The front loop's crest lies in front of the back loop (along the fabric normal).
    const normal = toMesh(sampler, "points").normals;
    const nv: V3 = [normal[3 * sc.id]!, normal[3 * sc.id + 1]!, normal[3 * sc.id + 2]!];
    const back = arcs(pieces, sc.id, "top")[0]!;
    const crest = post.points[post.crest]!;
    expect(dot(crest, nv) - dot(back.c, nv)).toBeGreaterThan(0.5 * sampler.gauge.yarnDiameterMm);
  });

  it("makes taller stitches longer, with 1 (HDC, DC), 2 (TR) or 3 (DTR) wraps", () => {
    const sc = postHeight(pieces, node(sampler, "1", "SC").id);
    const hdc = postHeight(pieces, node(sampler, "2", "HDC").id);
    const dc = postHeight(pieces, node(sampler, "2", "DC").id);
    const tr = postHeight(pieces, node(sampler, "2", "TR").id);
    const dtr = postHeight(pieces, node(sampler, "2", "DTR").id);
    const slst = postHeight(pieces, node(sampler, "3", "SL_ST").id);
    expect(dc).toBeGreaterThan(1.3 * sc);
    expect(hdc).toBeGreaterThan(sc);
    expect(tr).toBeGreaterThan(dc);
    expect(dtr).toBeGreaterThan(tr);
    expect(slst).toBeLessThan(sc);
    const wraps = (code: StitchCode) => arcs(pieces, node(sampler, "2", code).id, "wrap").length;
    expect([wraps("HDC"), wraps("DC"), wraps("TR"), wraps("DTR")]).toEqual([1, 1, 2, 3]);
  });

  it("draws an INC as two posts side by side ending at the same parent", () => {
    for (const [g, ps, inc] of [
      [sampler, pieces, node(sampler, "3", "INC")],
      [sphere, sPieces, node(sphere, "r2", "INC")],
    ] as const) {
      expect(inc.parents).toHaveLength(1);
      const two = posts(ps, inc.id);
      expect(two).toHaveLength(2);
      expect(arcs(ps, inc.id, "top")).toHaveLength(2);
      const parent = P(g, inc.parents[0]!);
      const feet = two.map((p) => p.points[p.feet[0]!]!);
      for (const f of feet) expect(dist(f, parent)).toBeLessThan(0.5 * g.gauge.stitchWidthMm);
      expect(dist(feet[0]!, feet[1]!)).toBeLessThan(1e-9);
      // The tops stand about a stitch width apart.
      expect(dist(two[0]!.points[two[0]!.crest]!, two[1]!.points[two[1]!.crest]!)).toBeGreaterThan(0.6 * g.gauge.stitchWidthMm);
    }
  });

  it("draws a DEC / INVDEC as one top with a leg into each of its two parents (Λ)", () => {
    for (const [g, ps, rowId, code] of [
      [sampler, pieces, "3", "DEC"],
      [sampler, pieces, "3", "INVDEC"],
      [sphere, sPieces, "r8", "DEC"],
    ] as const) {
      const dec = node(g, rowId, code);
      expect(dec.parents).toHaveLength(2);
      expect(arcs(ps, dec.id, "top")).toHaveLength(1);
      const all = posts(ps, dec.id);
      expect(all).toHaveLength(1);
      const post = all[0]!;
      expect(post.feet).toHaveLength(2);
      const [p0, p1] = [P(g, dec.parents[0]!), P(g, dec.parents[1]!)];
      const feet = post.feet.map((k) => post.points[k]!);
      // One foot in each parent, the feet apart.
      expect(Math.min(dist(feet[0]!, p0), dist(feet[1]!, p0))).toBeLessThan(0.5 * g.gauge.stitchWidthMm);
      expect(Math.min(dist(feet[0]!, p1), dist(feet[1]!, p1))).toBeLessThan(0.5 * g.gauge.stitchWidthMm);
      expect(dist(feet[0]!, feet[1]!)).toBeGreaterThan(0.5 * g.gauge.stitchWidthMm);
    }
  });

  it("draws chains as links and the magic ring as a ring around its anchor", () => {
    for (const n of sampler.nodes.filter((n) => n.code === "CH")) {
      const own = pieces.filter((p) => p.node === n.id);
      expect(own).toHaveLength(1);
      expect(own[0]!.kind).toBe("link");
    }
    // A turning chain's link lies between the stitch before it and its own position.
    const turn = sampler.nodes.find((n) => n.lift)!;
    const link = pieces.find((p) => p.node === turn.id)!;
    if (!("centre" in link)) throw new Error("expected a loop");
    const prev = P(sampler, turn.prev!);
    const centre = P(sampler, turn.id).map((v, k) => (v + prev[k]!) / 2) as V3;
    expect(dist(link.centre, centre)).toBeLessThan(1e-6);
    const mr = sphere.nodes.find((n) => n.code === "MR")!;
    const ring = sPieces.filter((p) => p.node === mr.id);
    expect(ring).toHaveLength(1);
    expect(ring[0]!.kind).toBe("ring");
    if (!("centre" in ring[0]!)) throw new Error("expected a loop");
    expect(dist(ring[0]!.centre, P(sphere, mr.id))).toBeLessThan(1e-9);
  });

  it("leaves holes: every post loop is open inside, neighbouring tops stay apart", () => {
    const r = stitchYarnRadius(sampler.gauge);
    const yarnPieces: YarnPiece[] = [];
    stitchYarn(sampler, toMesh(sampler, "points").normals, 2 * r, (p) => yarnPieces.push(p));
    const row1 = sampler.nodes.filter((n) => n.rowId === "1");
    for (let k = 0; k < row1.length; k++) {
      const post = posts(yarnPieces, row1[k]!.id)[0]!;
      const c = post.points.reduce<V3>((s, p) => [s[0] + p[0] / post.points.length, s[1] + p[1] / post.points.length, s[2] + p[2] / post.points.length], [0, 0, 0]);
      const inner = Math.min(...post.points.map((p) => dist(p, c))) - r;
      expect(inner).toBeGreaterThan(0.1 * w); // a clear hole, not just a gap between tubes
      if (k + 1 < row1.length) {
        const next = posts(yarnPieces, row1[k + 1]!.id)[0]!;
        expect(dist(post.points[post.crest]!, next.points[next.crest]!)).toBeGreaterThan(0.8 * w);
      }
    }
  });

  it("never produces NaN for degenerate frames (coincident nodes, lone chain, lone stitch)", () => {
    const chain = relax(buildGraph({ schemaVersion: 1, rows: [row("a", [st("CH", 5)], 0, "row")] }));
    expectWellFormed(toMesh(chain, "stitches"), chain);
    const lone = relax(buildGraph({ schemaVersion: 1, rows: [row("a", [st("SC")], 0)] }));
    expectWellFormed(toMesh(lone, "stitches"), lone);
    const ring = relax(buildGraph({ schemaVersion: 1, rows: [row("a", [st("MR")], 0)] }));
    expectWellFormed(toMesh(ring, "stitches"), ring);
    const squashed = { ...sphere, positions: new Float64Array(sphere.positions.length) };
    const m = toMesh(squashed, "stitches");
    for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
    for (const v of m.normals) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("stitch mesh — budget", () => {
  const big = (rounds: number): PartContent => ({
    schemaVersion: 1,
    rows: [
      row("r1", [st("MR"), st("SC", 6)], 6),
      ...Array.from({ length: 9 }, (_, k) => row(`i${k}`, [rep(6, [st("SC", k), st("INC")])], 6 * (k + 2))),
      ...Array.from({ length: rounds }, (_, k) => row(`e${k}`, [st("SC", 60)], 60)),
    ],
  });

  it("adapts detail to the size of the piece", () => {
    expect(stitchDetail(3_000)).toEqual({ radialSegments: 6, arcSamples: 5 });
    expect(stitchDetail(8_000)).toEqual({ radialSegments: 5, arcSamples: 4 });
    expect(stitchDetail(20_000)).toEqual({ radialSegments: 4, arcSamples: 3 });
  });

  it("stays within ~130 vertices per stitch and builds 3,000 stitches quickly", () => {
    const g = relax(buildGraph(big(45)), { iterations: 5 });
    expect(g.nodes.length).toBeGreaterThan(2_900);
    toMesh(g, "stitches"); // warm-up (JIT)
    const t0 = performance.now();
    const m = toMesh(g, "stitches");
    const ms = performance.now() - t0;
    const verts = m.positions.length / 3;
    console.info(`stitches mesh: ${g.nodes.length} nodes → ${verts} vertices, ${m.indices.length / 3} triangles, ${ms.toFixed(1)} ms`);
    expect(verts / g.stitchCount).toBeLessThan(130);
    expect(m.indices.length / 3).toBeLessThan(250 * g.stitchCount);
    expect(ms).toBeLessThan(400); // generous for slow CI machines; typically far less
  });
});
