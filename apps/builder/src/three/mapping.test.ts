import { describe, expect, it } from "vitest";
import { buildModel, toMesh, type PartContent } from "@crochetbuilder/engine";
import { nodeRows } from "../preview/protocol.js";
import {
  flatAxis,
  frameCamera,
  gridPlacement,
  meshBounds,
  pickFromHit,
  rowIndexOf,
  vertexColors,
  vertexForHit,
  type Bounds,
  type ViewMesh,
} from "./mapping.js";

/** Two triangles, four vertices; nodes 0,1 in row "a", node 2 in row "b"; vertex 3 → node 2. */
const MESH: ViewMesh = {
  primitive: "triangles",
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
  nodeIndex: new Uint32Array([0, 1, 2, 2]),
  nodeRow: new Uint32Array([0, 0, 1]),
  rowIds: ["a", "b"],
};

const BASE: [number, number, number] = [1, 1, 1];
const HI: [number, number, number] = [0, 0.5, 0];

describe("row highlight colours", () => {
  it("colours the vertices of the selected row, all others in the base colour", () => {
    const c = vertexColors(MESH, rowIndexOf(MESH, "b"), BASE, HI);
    expect(Array.from(c)).toEqual([1, 1, 1, 1, 1, 1, 0, 0.5, 0, 0, 0.5, 0]);
  });

  it("no or an unknown row highlights nothing", () => {
    expect(rowIndexOf(MESH, null)).toBe(-1);
    expect(rowIndexOf(MESH, "instruction-row")).toBe(-1);
    expect(Array.from(vertexColors(MESH, -1, BASE, HI)).every((v) => v === 1)).toBe(true);
  });

  it("reuses the output buffer when it fits", () => {
    const out = new Float32Array(12);
    expect(vertexColors(MESH, 0, BASE, HI, out)).toBe(out);
    expect(vertexColors(MESH, 0, BASE, HI, new Float32Array(3))).toHaveLength(12);
  });

  it("highlights exactly the stitches of a round in a real tube mesh", () => {
    const content: PartContent = {
      schemaVersion: 1,
      rows: [
        { id: "r1", type: "round", ops: [{ kind: "stitch", code: "MR", count: 1 }, { kind: "stitch", code: "SC", count: 6 }], stitchCountTarget: 6 },
        { id: "r2", type: "round", ops: [{ kind: "stitch", code: "INC", count: 6 }], stitchCountTarget: 12 },
      ],
    };
    const model = buildModel(content);
    const mesh: ViewMesh = { ...toMesh(model.graph, "tube"), ...nodeRows(model) };
    const colors = vertexColors(mesh, rowIndexOf(mesh, "r2"), BASE, HI);
    for (let v = 0; v < mesh.nodeIndex.length; v++) {
      const inR2 = model.graph.nodes[mesh.nodeIndex[v]!]!.rowId === "r2";
      expect(colors[3 * v + 1], `vertex ${v}`).toBe(inR2 ? 0.5 : 1);
    }
  });
});

describe("picking", () => {
  it("maps a triangle hit to its nearest corner, then node and row", () => {
    const hit = { point: { x: 9, y: 9, z: 0 }, face: { a: 1, b: 3, c: 2 } };
    expect(vertexForHit(MESH, hit)).toBe(3);
    expect(pickFromHit(MESH, hit)).toEqual({ rowId: "b", node: 2 });
    expect(pickFromHit(MESH, { point: { x: 1, y: 0, z: 0 }, face: { a: 0, b: 1, c: 2 } })).toEqual({ rowId: "a", node: 0 });
  });

  it("maps a points hit by its vertex index", () => {
    const points: ViewMesh = { ...MESH, primitive: "points" };
    expect(pickFromHit(points, { point: { x: 0, y: 0, z: 0 }, index: 1 })).toEqual({ rowId: "a", node: 1 });
  });

  it("returns null for hits it cannot map", () => {
    expect(pickFromHit(MESH, { point: { x: 0, y: 0, z: 0 } })).toBeNull();
    expect(pickFromHit(MESH, { point: { x: 0, y: 0, z: 0 }, index: 99 })).toBeNull();
    expect(pickFromHit({ ...MESH, rowIds: [] }, { point: { x: 0, y: 0, z: 0 }, index: 0 })).toBeNull();
  });
});

const box = (min: [number, number, number], max: [number, number, number]): Bounds => ({ min, max });

describe("framing and grid", () => {
  it("bounds of the vertices", () => {
    expect(meshBounds(MESH.positions)).toEqual({ min: [0, 0, 0], max: [10, 10, 0] });
    expect(meshBounds(new Float32Array())).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });

  it("detects flat pieces and their normal axis", () => {
    expect(flatAxis(box([-30, -30, -30], [30, 30, 30]))).toBe(-1); // ball
    expect(flatAxis(box([-40, -2, -40], [40, 2, 40]))).toBe(1); // disc of rounds
    expect(flatAxis(box([0, 0, -1], [120, 120, 1]))).toBe(2); // potholder in rows
  });

  it("frames the bounding sphere into the narrower field of view", () => {
    const b = box([-30, -30, -30], [30, 30, 30]);
    const wide = frameCamera(b, 35, 2);
    const tall = frameCamera(b, 35, 0.5);
    expect(wide.target).toEqual([0, 0, 0]);
    const dist = (f: typeof wide) => Math.hypot(...f.position.map((p, k) => p - f.target[k]!));
    expect(wide.radius).toBeCloseTo(Math.sqrt(3) * 30, 6);
    expect(dist(wide)).toBeCloseTo(wide.radius / Math.sin((35 * Math.PI) / 360), 6);
    expect(dist(tall)).toBeGreaterThan(dist(wide)); // portrait: the horizontal fov limits
    expect(wide.near).toBeGreaterThan(0);
    expect(wide.far).toBeGreaterThan(dist(wide) + wide.radius);
  });

  it("never frames tighter than the minimum radius (a magic ring alone)", () => {
    const f = frameCamera(box([-1, 0, -1], [1, 0.5, 1]), 35, 1);
    expect(f.radius).toBe(15);
  });

  it("looks at a flat rectangle from the front", () => {
    const f = frameCamera(box([0, 0, -1], [120, 120, 1]), 35, 1);
    const dir = f.position.map((p, k) => p - f.target[k]!);
    expect(dir[2]).toBeGreaterThan(Math.abs(dir[0]!));
    expect(dir[2]).toBeGreaterThan(Math.abs(dir[1]!));
  });

  it("puts a 1-cm grid under a 3D piece, behind a flat one", () => {
    const ball = gridPlacement(box([-30, -28, -30], [30, 28, 30]));
    expect(ball.normalAxis).toBe(1);
    expect(ball.center[1]).toBeLessThan(-28);
    expect(ball.size).toBe(ball.divisions * 10);
    expect(ball.size).toBeGreaterThanOrEqual(60 + 20);

    const rect = gridPlacement(box([0, 0, -1], [121, 118, 1]));
    expect(rect.normalAxis).toBe(2);
    expect(rect.center[2]).toBeLessThan(-1);
    expect(rect.center[0]).toBeCloseTo(60.5);
    expect(rect.divisions).toBe(15); // 12.1 cm → 13 cells + one on each side
  });

  it("caps the number of grid cells", () => {
    expect(gridPlacement(box([0, 0, 0], [50000, 50000, 1])).divisions).toBe(200);
  });
});
