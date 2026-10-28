import { describe, it, expect } from "vitest";
import { placementAnchor, PlacementSchema } from "./assembly.js";
import { buildGraph, isFabricNode, type StitchGraph } from "./graph.js";
import { relax } from "./relax.js";
import type { Op, PartContent, Row, StitchCode } from "./schema.js";

const st = (code: StitchCode, count = 1): Op => ({ kind: "stitch", code, count });
const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });
const row = (id: string, ops: Op[], t: number, type: "row" | "round" = "round"): Row => ({ id, type, ops, stitchCountTarget: t });
const part = (rows: Row[]): PartContent => ({ schemaVersion: 2, rows });

/** A head: ball start, five even rounds of 24, decreased and gathered. */
const HEAD = relax(
  buildGraph(
    part([
      row("r1", [st("MR"), st("SC", 6)], 6),
      row("r2", [st("INC", 6)], 12),
      row("r3", [rep(6, [st("SC"), st("INC")])], 18),
      row("r4", [rep(6, [st("SC", 2), st("INC")])], 24),
      ...["e1", "e2", "e3", "e4", "e5"].map((id) => row(id, [st("SC", 24)], 24)),
      row("d1", [rep(6, [st("SC", 2), st("DEC")])], 18),
      row("d2", [rep(6, [st("SC"), st("DEC")])], 12),
      row("d3", [st("DEC", 6)], 6),
    ]),
  ),
);

type V3 = [number, number, number];
const P = (g: StitchGraph, i: number): V3 => [g.positions[3 * i]!, g.positions[3 * i + 1]!, g.positions[3 * i + 2]!];
const fabric = (g: StitchGraph, rowId: string) => g.nodes.filter((n) => n.rowId === rowId && isFabricNode(n)).map((n) => n.id);
const centroid = (g: StitchGraph, ids: number[]): V3 => {
  const c: V3 = [0, 0, 0];
  for (const id of ids) for (let k = 0; k < 3; k++) c[k] = c[k]! + P(g, id)[k]! / ids.length;
  return c;
};
/** Unit horizontal direction from a round's centre to `p`. */
const azimuth = (c: V3, p: V3): V3 => {
  const l = Math.hypot(p[0] - c[0], p[2] - c[2]);
  return [(p[0] - c[0]) / l, 0, (p[2] - c[2]) / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("placementAnchor", () => {
  const c = centroid(HEAD, fabric(HEAD, "e3"));
  const start = azimuth(c, P(HEAD, fabric(HEAD, "e3")[0]!));
  const front: V3 = [-start[0], 0, -start[2]];
  // A viewer in front looks along −front with +Y up; their right is (−front) × Y = (front_z, 0, −front_x).
  const right: V3 = [front[2], 0, -front[0]];

  it("puts angle 0 at the front, opposite the round's start", () => {
    const a = placementAnchor(HEAD, "e3", 0)!;
    expect(dot(azimuth(c, a.point), front)).toBeGreaterThan(0.98);
    expect(dot(azimuth(c, a.point), start)).toBeLessThan(-0.98);
  });

  it("turns positive angles to the right as seen from the front", () => {
    expect(dot(azimuth(c, placementAnchor(HEAD, "e3", 90)!.point), right)).toBeGreaterThan(0.95);
    expect(dot(azimuth(c, placementAnchor(HEAD, "e3", -90)!.point), right)).toBeLessThan(-0.95);
    expect(dot(azimuth(c, placementAnchor(HEAD, "e3", 180)!.point), start)).toBeGreaterThan(0.95);
    const a = placementAnchor(HEAD, "e3", 45)!.point;
    expect(dot(azimuth(c, a), front)).toBeCloseTo(Math.SQRT1_2, 1);
    expect(dot(azimuth(c, a), right)).toBeCloseTo(Math.SQRT1_2, 1);
  });

  it("sits on the fabric between the row and the next one", () => {
    const a = placementAnchor(HEAD, "e3", 0)!;
    const y3 = centroid(HEAD, fabric(HEAD, "e3"))[1];
    const y4 = centroid(HEAD, fabric(HEAD, "e4"))[1];
    expect(a.point[1]).toBeGreaterThan(Math.min(y3, y4));
    expect(a.point[1]).toBeLessThan(Math.max(y3, y4));
    const radius = Math.hypot(a.point[0] - c[0], a.point[2] - c[2]);
    const rounds = fabric(HEAD, "e3").map((id) => Math.hypot(P(HEAD, id)[0] - c[0], P(HEAD, id)[2] - c[2]));
    const mean = rounds.reduce((s, r) => s + r, 0) / rounds.length;
    expect(radius).toBeGreaterThan(0.85 * mean);
    expect(radius).toBeLessThan(1.15 * mean);
  });

  it("returns an outward unit normal that follows the curve of the piece", () => {
    const side = placementAnchor(HEAD, "e3", 0)!;
    expect(Math.hypot(...side.normal)).toBeCloseTo(1, 9);
    expect(dot(side.normal, azimuth(c, side.point))).toBeGreaterThan(0.9); // the equator faces out
    const top = placementAnchor(HEAD, "d1", 0)!;
    expect(top.normal[1]).toBeGreaterThan(0.3); // the decrease rounds face upwards
    const bottom = placementAnchor(HEAD, "r3", 0)!;
    expect(bottom.normal[1]).toBeLessThan(-0.3); // the increase rounds face downwards
    expect(placementAnchor(HEAD, "d3", 0)).not.toBeNull(); // the last round has no next round
  });

  it("is null for unknown rows and non-finite angles", () => {
    expect(placementAnchor(HEAD, "nope", 0)).toBeNull();
    expect(placementAnchor(HEAD, "e3", Number.NaN)).toBeNull();
  });

  it("runs along a flat row from its left end (−180) to its right end (180)", () => {
    const g = relax(
      buildGraph(
        part([
          row("f", [st("CH", 9)], 0, "row"),
          row("1", [st("SC", 8)], 8, "row"),
          row("2", [st("CH"), st("SC", 8)], 8, "row"),
          row("3", [st("CH"), st("SC", 8)], 8, "row"),
        ]),
      ),
    );
    const xs = fabric(g, "2").map((id) => P(g, id)[0]);
    const left = placementAnchor(g, "2", -180)!;
    const mid = placementAnchor(g, "2", 0)!;
    const rightEnd = placementAnchor(g, "2", 180)!;
    expect(left.point[0]).toBeCloseTo(Math.min(...xs), 0);
    expect(rightEnd.point[0]).toBeCloseTo(Math.max(...xs), 0);
    expect(mid.point[0]).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 0);
    expect(mid.normal).toEqual([0, 0, 1]);
  });
});

describe("PlacementSchema", () => {
  it("accepts the three kinds with their optional fields", () => {
    expect(PlacementSchema.safeParse({ id: "a", kind: "attach", part: "arm", target: "body", row: "r5", angle: -60 }).success).toBe(true);
    expect(PlacementSchema.safeParse({ id: "b", kind: "eyes", target: "head", row: "r9", angle: 0, spacing: 6, size: 9 }).success).toBe(true);
    expect(PlacementSchema.safeParse({ id: "c", kind: "embroidery", target: "head", row: "r10", angle: 0, note: "Mund" }).success).toBe(true);
  });

  it("rejects missing targets, empty ids and non-numeric angles", () => {
    expect(PlacementSchema.safeParse({ id: "a", kind: "attach", row: "r5", angle: 0 }).success).toBe(false);
    expect(PlacementSchema.safeParse({ id: "", kind: "eyes", target: "h", row: "r5", angle: 0 }).success).toBe(false);
    expect(PlacementSchema.safeParse({ id: "a", kind: "eyes", target: "h", row: "r5", angle: "front" }).success).toBe(false);
    expect(PlacementSchema.safeParse({ id: "a", kind: "eyes", target: "h", row: "", angle: 0 }).success).toBe(false);
  });
});
