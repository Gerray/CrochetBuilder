import { describe, expect, it } from "vitest";
import { anchorOfNode, buildModel, placementAnchor } from "@crochetbuilder/engine";
import { demoDocument } from "../state/document.js";
import { combineScene, rowKey, scenePick, sceneSize } from "./combine.js";
import { AssemblyComputer, assemblyTransferables, meshesByPart, partMeshKey, totalStitches, type AssemblyResult, type PartMesh } from "./compute.js";
import { assemblyWatchdogMs, WATCHDOG_MS_PER_STITCH } from "./client.js";
import { WATCHDOG_MS } from "../preview/protocol.js";
import { documentFromExport } from "../export/import.js";

let n = 0;
const doc = demoDocument(() => `s${++n}`, "bunny");
const STYLE = "surface" as const;

function scene(result: AssemblyResult) {
  if (result.kind !== "scene") throw new Error(result.message);
  return result;
}

describe("AssemblyComputer", () => {
  const computer = new AssemblyComputer();
  const first = scene(computer.compute({ id: 1, doc, style: STYLE, have: [] }));

  it("meshes every part and places them all", () => {
    expect(first.parts.map((p) => p.status)).toEqual(["model", "model", "model", "model", "model"]);
    expect(first.parts.every((p) => p.mesh && p.mesh.nodeAngle.length === p.mesh.model.nodeRow.length)).toBe(true);
    expect(first.scene.findings).toEqual([]);
    // Kopf, Körper, Ohr ×2, Arm ×2, Bein ×2; eyes as a pair.
    expect(first.scene.instances.map((i) => [i.part, i.copy, i.placed])).toEqual([
      [0, 0, true],
      [1, 0, true],
      [2, 0, true],
      [2, 1, true],
      [3, 0, true],
      [3, 1, true],
      [4, 0, true],
      [4, 1, true],
    ]);
    expect(first.scene.eyes).toHaveLength(2);
    expect(first.scene.marks).toHaveLength(1);
  });

  it("does not send meshes the client already has, and keys follow the shape and style", () => {
    const have = first.parts.map((p) => p.key);
    const again = scene(computer.compute({ id: 2, doc, style: STYLE, have }));
    expect(again.parts.every((p) => p.mesh === undefined && p.status === "model")).toBe(true);
    expect(assemblyTransferables(again)).toEqual([]);
    expect(JSON.stringify(again.scene)).toBe(JSON.stringify(first.scene));
    expect(partMeshKey(doc, 0, "points", 20_000)).not.toBe(partMeshKey(doc, 0, STYLE, 20_000));
    // One part changed: only its mesh comes again.
    const edited = structuredClone(doc);
    edited.parts[2]!.content.rows.pop();
    const third = scene(computer.compute({ id: 3, doc: edited, style: STYLE, have }));
    expect(third.parts.map((p) => p.mesh !== undefined)).toEqual([false, false, true, false, false]);
  });

  it("transfers the mesh buffers", () => {
    const fresh = scene(new AssemblyComputer().compute({ id: 1, doc, style: STYLE, have: [] }));
    expect(assemblyTransferables(fresh).length).toBe(5 * 6);
  });
});

describe("combineScene", () => {
  const result = scene(new AssemblyComputer().compute({ id: 1, doc, style: STYLE, have: [] }));
  const meshes = result.parts.map((p) => p.mesh);
  const combined = combineScene(result.scene, meshes)!;

  it("appends every instance, moved by its transform", () => {
    const sum = (f: (m: PartMesh) => number) => result.scene.instances.reduce((s, i) => s + f(meshes[i.part]!), 0);
    expect(combined.mesh.positions.length).toBe(sum((m) => m.model.positions.length));
    expect(combined.mesh.nodeRow.length).toBe(sum((m) => m.model.nodeRow.length));
    expect(combined.mesh.rowIds.length).toBe(sum((m) => m.model.rowIds.length));
    expect(combined.ranges).toHaveLength(8);
    // The second ear: its first vertex is the part's first vertex, transformed.
    const range = combined.ranges.find((r) => r.part === 2 && r.copy === 1)!;
    const t = result.scene.instances[range.instance]!.transform;
    const m = meshes[2]!.model.positions;
    const want = [0, 1, 2].map((k) => t.rotation[3 * k]! * m[0]! + t.rotation[3 * k + 1]! * m[1]! + t.rotation[3 * k + 2]! * m[2]! + t.translation[k]!);
    for (let k = 0; k < 3; k++) expect(combined.mesh.positions[3 * range.vertexStart + k]).toBeCloseTo(want[k]!, 4);
    // Indices and nodes point into the instance's own block.
    const idx = combined.mesh.indices;
    for (let j = 0; j < idx.length; j++) expect(idx[j]).toBeLessThan(combined.mesh.positions.length / 3);
    const node = combined.mesh.nodeIndex[range.vertexStart]!;
    expect(node).toBeGreaterThanOrEqual(range.nodeStart);
    expect(node).toBeLessThan(range.nodeStart + range.nodeCount);
    expect(combined.mesh.rowIds[combined.mesh.nodeRow[node]!]!.startsWith(`${range.instance}|`)).toBe(true);
  });

  it("carries further per-vertex arrays of the meshes along (e.g. yarn colours)", () => {
    const colored = meshes.map((m) =>
      m ? { ...m, model: { ...m.model, colorIndex: new Uint8Array(m.model.positions.length / 3).fill(m.model.positions.length % 7) } } : m,
    );
    const out = combineScene(result.scene, colored)!.mesh as unknown as { colorIndex: Uint8Array; positions: Float32Array };
    expect(out.colorIndex).toBeInstanceOf(Uint8Array);
    expect(out.colorIndex.length).toBe(out.positions.length / 3);
  });

  it("measures the assembled toy", () => {
    const size = sceneSize(combined)!;
    // The bunny is taller than any of its parts.
    expect(size.height).toBeGreaterThan(result.parts.length > 0 ? 80 : 0);
    expect(size.height).toBeGreaterThan(size.width * 0.9);
  });
});

describe("scenePick", () => {
  const result = scene(new AssemblyComputer().compute({ id: 1, doc, style: STYLE, have: [] }));
  const meshes = result.parts.map((p) => p.mesh);
  const combined = combineScene(result.scene, meshes)!;
  const head = combined.ranges.find((r) => r.part === 0)!;
  const graph = buildModel(doc.parts[0]!.content, doc.overview.gauge).graph;

  it("turns a stitch of the head into its row and angle, snapped to 5°", () => {
    const row = doc.parts[0]!.content.rows[7]!.id;
    const local = graph.nodes.find((x) => x.rowId === row && x.offset === 10)!.id;
    const pick = scenePick(combined, { node: head.nodeStart + local })!;
    const exact = anchorOfNode(graph, local)!;
    expect(pick).toMatchObject({ instance: head.instance, part: 0, copy: 0, rowId: row });
    expect(Math.abs(pick.angleDeg % 5)).toBe(0);
    expect(Math.abs(pick.angleDeg - exact.angleDeg)).toBeLessThanOrEqual(2.5 + 1e-6);
    expect(placementAnchor(graph, pick.rowId, pick.angleDeg)).not.toBeNull();
    expect(rowKey(pick.instance, pick.rowId)).toBe(`${head.instance}|${row}`);
  });

  it("negates the angle on a mirrored copy, and finds nothing outside the mesh", () => {
    const ear0 = combined.ranges.find((r) => r.part === 2 && r.copy === 0)!;
    const ear1 = combined.ranges.find((r) => r.part === 2 && r.copy === 1)!;
    const a = scenePick(combined, { node: ear0.nodeStart + 20 })!;
    const b = scenePick(combined, { node: ear1.nodeStart + 20 })!;
    expect(b.angleDeg === -a.angleDeg || Math.abs(a.angleDeg) === 180).toBe(true);
    expect(scenePick(combined, { node: 1e9 })).toBeNull();
  });
});

describe("review fixes: budget, shared meshes, watchdog, imported ids", () => {
  it("leaves parts beyond the total stitch budget out, in document order", () => {
    // Kopf 277, Körper 247, Ohr 133, Arm 67, Bein 76 stitches (atoms, as the graph has nodes).
    const r = scene(new AssemblyComputer(buildModel, 600).compute({ id: 1, doc, style: STYLE, have: [] }));
    expect(r.parts.map((p) => p.status)).toEqual(["model", "model", "skipped", "model", "skipped"]);
    expect(r.maxTotal).toBe(600);
    expect(r.scene.instances.map((i) => i.part)).not.toContain(2);
    expect(r.scene.findings.map((f) => f.code)).toContain("NO_MODEL");
  });

  it("relaxes a part once for every style (the PDF after the view)", () => {
    let builds = 0;
    const counting = ((...args: Parameters<typeof buildModel>) => {
      builds++;
      return buildModel(...args);
    }) as typeof buildModel;
    const computer = new AssemblyComputer(counting);
    computer.compute({ id: 1, doc, style: "surface", have: [] });
    computer.compute({ id: 2, doc, style: "stitches", have: [] });
    expect(builds).toBe(5);
  });

  it("draws every part that shares a mesh with an earlier one", async () => {
    const twin = { ...doc, parts: [doc.parts[0]!, { ...doc.parts[0]!, id: "kopf-2", name: "Kopf 2" }], assembly: [] };
    const r = scene(new AssemblyComputer().compute({ id: 1, doc: twin, style: STYLE, have: [] }));
    expect(r.parts.map((p) => p.mesh !== undefined)).toEqual([true, false]);
    const meshes = meshesByPart(r);
    expect(meshes.every((m) => m !== undefined)).toBe(true);
    expect(combineScene(r.scene, meshes)!.ranges).toHaveLength(2);
  });

  it("gives big documents more time before the worker counts as dead", () => {
    expect(assemblyWatchdogMs({ doc })).toBe(WATCHDOG_MS + WATCHDOG_MS_PER_STITCH * totalStitches(doc));
    expect(totalStitches(doc)).toBe(277 + 247 + 133 + 67 + 76);
  });

  it("renames a later duplicate part id on import and keeps the placements on the first", () => {
    const exp = structuredClone(doc);
    exp.parts[1]!.id = "kopf";
    const result = documentFromExport(exp);
    if (!result.ok) throw new Error(result.message);
    expect(result.doc.parts.map((p) => p.id)).toEqual(["kopf", "koerper", "ohr", "arm", "bein"]);
    expect(result.doc.assembly).toEqual(exp.assembly);
  });
});
describe("colours in the Montage", () => {
  it("carries every part's yarn colours through to the assembled mesh", () => {
    const coloured = structuredClone(doc);
    coloured.overview.colors = [
      { id: "grau", name: "Grau", hex: "#999999" },
      { id: "rosa", name: "Rosa", hex: "#e8a0b4" },
    ];
    coloured.parts[2]!.content.rows[0]!.color = "rosa"; // the ears are pink
    const r = scene(new AssemblyComputer().compute({ id: 1, doc: coloured, style: STYLE, have: [] }));
    const combined = combineScene(r.scene, meshesByPart(r))!;
    const mesh = combined.mesh as typeof combined.mesh & { nodeColor?: Uint16Array; paletteIds?: string[] };
    expect(mesh.paletteIds).toEqual(["grau", "rosa"]);
    expect(mesh.nodeColor!.length).toBe(mesh.nodeRow.length);
    for (const range of combined.ranges) {
      const colours = new Set(mesh.nodeColor!.slice(range.nodeStart, range.nodeStart + range.nodeCount));
      expect([...colours]).toEqual([range.part === 2 ? 1 : 0]);
    }
    // Recolouring (hex) needs no new mesh; another colour id in a row does.
    const recoloured = { ...coloured, overview: { ...coloured.overview, colors: [{ id: "grau", name: "Grau", hex: "#000000" }, coloured.overview.colors[1]!] } };
    expect(partMeshKey(recoloured, 2, STYLE, 20_000)).toBe(partMeshKey(coloured, 2, STYLE, 20_000));
    expect(partMeshKey(coloured, 2, STYLE, 20_000)).not.toBe(partMeshKey(doc, 2, STYLE, 20_000));
  });
});