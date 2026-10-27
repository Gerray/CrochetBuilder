import { describe, expect, it } from "vitest";
import { createGrid, linearRgb, toBufferGeometry } from "./geometry.js";
import type { ViewMesh } from "./mapping.js";

const MESH: ViewMesh = {
  primitive: "triangles",
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  nodeIndex: new Uint32Array([0, 1, 2]),
  nodeRow: new Uint32Array([0, 0, 0]),
  rowIds: ["a"],
};

describe("mesh → BufferGeometry", () => {
  it("shares the typed arrays and adds a colour attribute and the index", () => {
    const g = toBufferGeometry(MESH);
    expect(g.getAttribute("position").array).toBe(MESH.positions);
    expect(g.getAttribute("normal").array).toBe(MESH.normals);
    expect(g.getAttribute("position").itemSize).toBe(3);
    expect(g.getAttribute("color").array).toHaveLength(9);
    expect(g.getIndex()?.array).toBe(MESH.indices);
    expect(g.boundingBox?.max.toArray()).toEqual([10, 10, 0]);
    expect(g.boundingSphere?.radius).toBeGreaterThan(0);
  });

  it("points have no index", () => {
    const g = toBufferGeometry({ ...MESH, primitive: "points" });
    expect(g.getIndex()).toBeNull();
    expect(g.getAttribute("position").count).toBe(3);
  });
});

describe("colours and grid", () => {
  it("converts CSS colours to linear RGB", () => {
    expect(linearRgb("#ffffff")).toEqual([1, 1, 1]);
    const [r, g, b] = linearRgb("#808080");
    expect(r).toBeCloseTo(0.2159, 3); // sRGB 0.5 → linear
    expect(g).toBe(r);
    expect(b).toBe(r);
    expect(linearRgb(" #000000 ")).toEqual([0, 0, 0]);
  });

  it("orients the grid as placed", () => {
    const floor = createGrid({ normalAxis: 1, center: [1, -5, 2], size: 60, divisions: 6 }, "#cccccc");
    expect(floor.position.toArray()).toEqual([1, -5, 2]);
    expect(floor.rotation.x).toBe(0);
    const back = createGrid({ normalAxis: 2, center: [0, 0, -2], size: 60, divisions: 6 }, "#cccccc");
    expect(back.rotation.x).toBeCloseTo(Math.PI / 2);
  });
});
