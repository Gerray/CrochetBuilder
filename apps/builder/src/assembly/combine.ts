/**
 * The assembled scene as ONE mesh for the model view: every placed part instance's mesh,
 * moved by its transform, appended to the others. The model view then draws, colours,
 * highlights and picks the whole toy exactly as it does a single part — including whatever it
 * learns later (yarn colours): per-vertex and per-node arrays the meshes carry beyond the
 * known ones are appended part by part, which keeps them aligned with vertices and nodes.
 *
 * Rows get instance-qualified ids (`rowKey`), so a round of one ear can be highlighted
 * without the same round of the other. Pure (no Three.js), so it is unit-tested.
 */

import type { AssemblyScene, EyeInstance, MarkInstance, PartInstance, RigidTransform } from "@crochetbuilder/engine";
import type { PickResult, ViewMesh } from "../three/mapping.js";
import type { PartMesh } from "./compute.js";

/** Row id of a row of instance `instance` in the combined mesh. */
export const rowKey = (instance: number, rowId: string) => `${instance}|${rowId}`;

/** Where one instance's nodes and vertices sit in the combined mesh. */
export interface InstanceRange {
  /** Index into `scene.instances`. */
  instance: number;
  part: number;
  copy: number;
  mirrored: boolean;
  placed: boolean;
  nodeStart: number;
  nodeCount: number;
  vertexStart: number;
  vertexCount: number;
  /** The part's own mesh (local pose): rows, node angles. */
  mesh: PartMesh;
}

export interface CombinedScene {
  mesh: ViewMesh;
  ranges: InstanceRange[];
  eyes: EyeInstance[];
  marks: MarkInstance[];
}

const KNOWN = new Set([
  "style",
  "primitive",
  "positions",
  "normals",
  "indices",
  "nodeIndex",
  "nodeRow",
  "rowIds",
  "size",
  "maxDiameter",
  "estimated",
  "stitchCount",
  "stitchWidthMm",
  "yarnDiameterMm",
  "backing",
  "paletteIds",
]);

type Typed = Float32Array | Float64Array | Uint32Array | Int32Array | Uint16Array | Int16Array | Uint8Array | Int8Array;

function isTyped(v: unknown): v is Typed {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

function concatTyped(list: Typed[]): Typed {
  const total = list.reduce((s, a) => s + a.length, 0);
  const Ctor = list[0]!.constructor as new (n: number) => Typed;
  const out = new Ctor(total);
  let at = 0;
  for (const a of list) {
    out.set(a as never, at);
    at += a.length;
  }
  return out;
}

/** Positions (and with `normals`, directions) of `src` moved by `t`, written to `out` at `at`. */
function transformInto(src: Float32Array, t: RigidTransform, out: Float32Array, at: number, direction: boolean): void {
  const r = t.rotation;
  const [tx, ty, tz] = direction ? [0, 0, 0] : t.translation;
  for (let i = 0; i + 2 < src.length; i += 3) {
    const x = src[i]!;
    const y = src[i + 1]!;
    const z = src[i + 2]!;
    out[at + i] = r[0] * x + r[1] * y + r[2] * z + tx;
    out[at + i + 1] = r[3] * x + r[4] * y + r[5] * z + ty;
    out[at + i + 2] = r[6] * x + r[7] * y + r[8] * z + tz;
  }
}

/**
 * One mesh of all drawn instances of `scene`; `meshes[part]` is the part's mesh (instances
 * of parts without one are left out). Null when nothing can be drawn.
 */
export function combineScene(scene: AssemblyScene, meshes: ReadonlyArray<PartMesh | undefined>): CombinedScene | null {
  const items = scene.instances
    .map((inst, i) => ({ inst, i, mesh: meshes[inst.part] }))
    .filter((x): x is { inst: PartInstance; i: number; mesh: PartMesh } => !!x.mesh && x.mesh.model.positions.length > 0);
  if (items.length === 0) return null;
  const first = items[0]!.mesh.model;
  const primitive = first.primitive;
  const usable = items.filter((x) => x.mesh.model.primitive === primitive);

  let vertices = 0;
  let nodes = 0;
  let indices = 0;
  let rows = 0;
  let backingVertices = 0;
  let backingIndices = 0;
  const withBacking = usable.every((x) => x.mesh.model.backing);
  for (const { mesh } of usable) {
    const m = mesh.model;
    vertices += m.positions.length / 3;
    nodes += m.nodeRow.length;
    indices += m.indices.length;
    rows += m.rowIds.length;
    if (withBacking) {
      backingVertices += m.backing!.positions.length / 3;
      backingIndices += m.backing!.indices.length;
    }
  }

  const positions = new Float32Array(3 * vertices);
  const normals = new Float32Array(3 * vertices);
  const index = new Uint32Array(indices);
  const nodeIndex = new Uint32Array(vertices);
  const nodeRow = new Uint32Array(nodes);
  const rowIds: string[] = new Array<string>(rows);
  const backing = withBacking
    ? { positions: new Float32Array(3 * backingVertices), normals: new Float32Array(3 * backingVertices), indices: new Uint32Array(backingIndices) }
    : undefined;
  const extras = new Map<string, Typed[]>();
  for (const key of Object.keys(first)) {
    if (KNOWN.has(key)) continue;
    const value = (first as unknown as Record<string, unknown>)[key];
    if (isTyped(value)) extras.set(key, []);
  }

  const ranges: InstanceRange[] = [];
  let v = 0;
  let n = 0;
  let k = 0;
  let r = 0;
  let bv = 0;
  let bk = 0;
  for (const { inst, i, mesh } of usable) {
    const m = mesh.model;
    const count = m.positions.length / 3;
    transformInto(m.positions, inst.transform, positions, 3 * v, false);
    transformInto(m.normals, inst.transform, normals, 3 * v, true);
    for (let j = 0; j < m.indices.length; j++) index[k + j] = m.indices[j]! + v;
    for (let j = 0; j < count; j++) nodeIndex[v + j] = m.nodeIndex[j]! + n;
    for (let j = 0; j < m.nodeRow.length; j++) nodeRow[n + j] = m.nodeRow[j]! + r;
    for (let j = 0; j < m.rowIds.length; j++) rowIds[r + j] = rowKey(i, m.rowIds[j]!);
    if (backing) {
      const b = m.backing!;
      transformInto(b.positions, inst.transform, backing.positions, 3 * bv, false);
      transformInto(b.normals, inst.transform, backing.normals, 3 * bv, true);
      // A backing has one vertex per node: its indices shift with the nodes.
      for (let j = 0; j < b.indices.length; j++) backing.indices[bk + j] = b.indices[j]! + bv;
      bv += b.positions.length / 3;
      bk += b.indices.length;
    }
    for (const [key, list] of extras) {
      const value = (m as unknown as Record<string, unknown>)[key];
      if (isTyped(value)) list.push(value);
      else extras.delete(key);
    }
    ranges.push({
      instance: i,
      part: inst.part,
      copy: inst.copy,
      mirrored: inst.mirrored,
      placed: inst.placed,
      nodeStart: n,
      nodeCount: m.nodeRow.length,
      vertexStart: v,
      vertexCount: count,
      mesh,
    });
    v += count;
    n += m.nodeRow.length;
    k += m.indices.length;
    r += m.rowIds.length;
  }

  const mesh: ViewMesh & Record<string, unknown> = {
    primitive,
    positions,
    normals,
    indices: index,
    nodeIndex,
    nodeRow,
    rowIds,
    stitchWidthMm: first.stitchWidthMm,
    yarnDiameterMm: first.yarnDiameterMm,
  };
  if (backing) mesh.backing = backing;
  for (const [key, list] of extras) if (list.length === usable.length) mesh[key] = concatTyped(list);
  // Yarn colours: every part's `nodeColor` indexes the document's palette ids (the same list
  // for all parts), so the appended indices keep pointing at the right colour.
  const palette = usable.find((x) => x.mesh.model.paletteIds)?.mesh.model.paletteIds;
  if (palette && mesh.nodeColor) mesh.paletteIds = palette;
  return { mesh, ranges, eyes: scene.eyes, marks: scene.marks };
}

/** What a click on the combined mesh points at, in placement terms. */
export interface ScenePick {
  /** Index into `scene.instances`. */
  instance: number;
  part: number;
  copy: number;
  /** Row id of the part (not qualified). */
  rowId: string;
  /** Placement angle on the part, degrees, for its copy 1 (a mirrored copy's angle is negated). */
  angleDeg: number;
}

/** Angles snap to this many degrees when picked. */
export const PICK_SNAP_DEG = 5;

/** A combined-mesh pick (node of the combined mesh) → part, row and angle. */
export function scenePick(combined: CombinedScene, hit: Pick<PickResult, "node">, snap = PICK_SNAP_DEG): ScenePick | null {
  const range = combined.ranges.find((x) => hit.node >= x.nodeStart && hit.node < x.nodeStart + x.nodeCount);
  if (!range) return null;
  const local = hit.node - range.nodeStart;
  const m = range.mesh.model;
  const rowId = m.rowIds[m.nodeRow[local] ?? -1];
  const raw = range.mesh.nodeAngle[local];
  if (rowId === undefined || raw === undefined || Number.isNaN(raw)) return null;
  let angle = Math.round(raw / snap) * snap;
  if (range.mirrored) angle = -angle;
  if (angle <= -180) angle += 360;
  if (angle > 180) angle -= 360;
  return { instance: range.instance, part: range.part, copy: range.copy, rowId, angleDeg: Object.is(angle, -0) ? 0 : angle };
}

/** Axis-aligned size of the placed instances (mm): width, height, depth. */
export function sceneSize(combined: CombinedScene): { width: number; height: number; depth: number } | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const p = combined.mesh.positions;
  for (const range of combined.ranges) {
    if (!range.placed) continue;
    for (let i = range.vertexStart; i < range.vertexStart + range.vertexCount; i++) {
      for (let c = 0; c < 3; c++) {
        const x = p[3 * i + c]!;
        if (x < min[c]!) min[c] = x;
        if (x > max[c]!) max[c] = x;
      }
    }
  }
  if (min[0] === Infinity) return null;
  return { width: max[0]! - min[0]!, height: max[1]! - min[1]!, depth: max[2]! - min[2]! };
}
