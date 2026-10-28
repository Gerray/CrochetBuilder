/**
 * Pure helpers of the model view — no Three.js, no DOM — so they are unit-testable:
 * row highlight colours, stitch picking (hit → node → row), framing and grid placement.
 */

/**
 * Mesh as the view consumes it: the engine's `toMesh` arrays plus the row of every graph
 * node. `PreviewModel` (src/preview/protocol.ts) satisfies it; a standalone viewer can build
 * one from `toMesh` + `nodeRows`.
 */
export interface ViewMesh {
  /** `"triangles"` (surface, tube) or `"points"`. */
  primitive: "triangles" | "points";
  /** xyz per vertex, mm. */
  positions: Float32Array;
  /** Unit normal per vertex. */
  normals: Float32Array;
  /** Triangle indices (3 per triangle); ignored for points. */
  indices: Uint32Array;
  /** Graph node of every vertex. */
  nodeIndex: Uint32Array;
  /** Per graph node: index into `rowIds`. */
  nodeRow: Uint32Array;
  /** Row ids, indexed by `nodeRow`. */
  rowIds: readonly string[];
  /**
   * Per graph node: index into the palette (format v2 colours, engine `nodeColorIndices`).
   * Without it, or without a palette in the view's style, the piece has one yarn colour.
   */
  nodeColor?: ArrayLike<number>;
  /** Stitch width in mm — the size of a point in `"points"` style. Default 5. */
  stitchWidthMm?: number;
  /** Yarn diameter in mm (picking tolerance against the backing). Default 2.5. */
  yarnDiameterMm?: number;
  /**
   * The fabric as a closed surface behind an open style (the `"stitches"` lattice): one
   * vertex per graph node (vertex index = node). Drawn faintly behind the yarn when the view
   * asks for it, and always used for picking so a click into a hole selects the stitch
   * around it rather than one on the far side of the piece.
   */
  backing?: MeshBacking;
}

/** Surface arrays of a `ViewMesh.backing`. */
export interface MeshBacking {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export type Vec3 = [number, number, number];
export type Rgb = [number, number, number];

/** Axis-aligned bounds of the mesh vertices (mm). */
export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export function meshBounds(positions: Float32Array): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  if (min[0] === Infinity) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** Index of `rowId` in the mesh's row list, -1 when the row has no stitches in the model. */
export function rowIndexOf(mesh: Pick<ViewMesh, "rowIds">, rowId: string | null): number {
  return rowId === null ? -1 : mesh.rowIds.indexOf(rowId);
}

/** Indices of `rowIds` in the mesh's row list (rows without stitches in the model are left out). */
export function rowIndicesOf(mesh: Pick<ViewMesh, "rowIds">, rowIds: string | readonly string[] | null): number[] {
  if (rowIds === null) return [];
  const list = typeof rowIds === "string" ? [rowIds] : rowIds;
  return list.map((id) => mesh.rowIds.indexOf(id)).filter((i) => i >= 0);
}

/**
 * Vertex colours (linear RGB, 3 floats per vertex): `highlight` for the vertices of the row
 * with index `row` (or of all rows in a list — a group "Runde 7–12"), `base` for all others.
 * Writes into `out` when it has the right length.
 */
export function vertexColors(
  mesh: Pick<ViewMesh, "nodeIndex" | "nodeRow" | "nodeColor">,
  row: number | readonly number[],
  base: Rgb,
  highlight: Rgb,
  out?: Float32Array,
): Float32Array {
  return meshColors(mesh, { base, highlight, rows: typeof row === "number" ? [row] : row }, out);
}

/** Share of the highlight colour in a highlighted stitch of a coloured piece. */
export const HIGHLIGHT_MIX = 0.7;

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * The colour of a highlighted stitch in yarn colour `base`: mostly the highlight colour, with
 * a trace of the yarn, so the row stands out on any palette colour while its own colour stays
 * recognisable. A yarn colour close to the highlight itself is lightened (dark yarn) or
 * darkened (light yarn) instead, so the row never disappears in it.
 */
export function highlightOn(base: Rgb, highlight: Rgb): Rgb {
  const tinted = mix(base, highlight, HIGHLIGHT_MIX);
  if (distance(tinted, base) >= 0.18) return tinted;
  const luminance = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
  return luminance > 0.35 ? mix(base, [0, 0, 0], 0.6) : mix(base, [1, 1, 1], 0.65);
}

export interface ColorOptions {
  /** Yarn colour without a palette (and for palette indices outside it). */
  base: Rgb;
  /** Colours of the palette (linear RGB), indexed by `nodeColor`; empty: one yarn colour. */
  palette?: readonly Rgb[];
  /** Rows (indices into `rowIds`) to highlight; -1 entries are ignored. */
  rows?: readonly number[];
  highlight: Rgb;
}

/**
 * Vertex colours (linear RGB, 3 floats per vertex) of a mesh: each stitch in its palette
 * colour (`mesh.nodeColor` with `palette`), else in `base`; stitches of the highlighted rows
 * in `highlight` — on a coloured piece blended with their yarn colour (`highlightOn`).
 * Writes into `out` when it has the right length. Reusable for any view that shows a
 * `ViewMesh` (preview, viewer, PDF image, assembled parts).
 */
export function meshColors(
  mesh: Pick<ViewMesh, "nodeIndex" | "nodeRow" | "nodeColor">,
  opts: ColorOptions,
  out?: Float32Array,
): Float32Array {
  const n = mesh.nodeIndex.length;
  const colors = out && out.length === 3 * n ? out : new Float32Array(3 * n);
  const rows = new Set(opts.rows ?? []);
  rows.delete(-1);
  const palette = opts.palette ?? [];
  const coloured = palette.length > 0 && mesh.nodeColor !== undefined;
  // One highlight colour per palette entry (and the plain one), computed once.
  const lit = coloured ? palette.map((c) => highlightOn(c, opts.highlight)) : [];
  for (let v = 0; v < n; v++) {
    const node = mesh.nodeIndex[v]!;
    const index = coloured ? (mesh.nodeColor![node] ?? 0) : -1;
    const own = coloured ? palette[index] : undefined;
    const on = rows.size > 0 && rows.has(mesh.nodeRow[node]!);
    const c = on ? (own ? lit[index]! : opts.highlight) : (own ?? opts.base);
    colors[3 * v] = c[0];
    colors[3 * v + 1] = c[1];
    colors[3 * v + 2] = c[2];
  }
  return colors;
}

/** What a raycast reports (a subset of Three's `Intersection`). */
export interface HitLike {
  point: { x: number; y: number; z: number };
  /** Triangle hit: its three vertex indices. */
  face?: { a: number; b: number; c: number } | null;
  /** Points hit: the vertex index. */
  index?: number;
}

/** Vertex nearest to the hit: the triangle corner closest to the hit point, or the point. */
export function vertexForHit(mesh: Pick<ViewMesh, "positions" | "primitive">, hit: HitLike): number | null {
  if (mesh.primitive === "points" || !hit.face) {
    return hit.index !== undefined && 3 * hit.index < mesh.positions.length ? hit.index : null;
  }
  let best: number | null = null;
  let bestD = Infinity;
  for (const v of [hit.face.a, hit.face.b, hit.face.c]) {
    if (3 * v + 2 >= mesh.positions.length) continue;
    const dx = mesh.positions[3 * v]! - hit.point.x;
    const dy = mesh.positions[3 * v + 1]! - hit.point.y;
    const dz = mesh.positions[3 * v + 2]! - hit.point.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

export interface PickResult {
  rowId: string;
  /** Graph node (stitch) under the pointer. */
  node: number;
}

/** Hit → vertex → graph node → row. */
export function pickFromHit(mesh: ViewMesh, hit: HitLike): PickResult | null {
  const v = vertexForHit(mesh, hit);
  if (v === null) return null;
  const node = mesh.nodeIndex[v];
  if (node === undefined) return null;
  const rowId = mesh.rowIds[mesh.nodeRow[node] ?? -1];
  return rowId === undefined ? null : { rowId, node };
}

/** Hit on the backing surface → nearest node → row. */
export function pickFromBacking(mesh: Pick<ViewMesh, "backing" | "nodeRow" | "rowIds">, hit: HitLike): PickResult | null {
  if (!mesh.backing) return null;
  const node = vertexForHit({ positions: mesh.backing.positions, primitive: "triangles" }, hit);
  if (node === null) return null;
  const rowId = mesh.rowIds[mesh.nodeRow[node] ?? -1];
  return rowId === undefined ? null : { rowId, node };
}

/**
 * Which of two raycast results to trust: the yarn hit, unless the backing surface was hit
 * clearly nearer (by more than `slack` mm) — then the ray went through a hole in the
 * lattice, and the stitch around the hole is what the user pointed at.
 */
export function choosePick(
  yarn: { pick: PickResult; distance: number } | null,
  backing: { pick: PickResult; distance: number } | null,
  slack: number,
): PickResult | null {
  if (!backing) return yarn?.pick ?? null;
  if (!yarn) return backing.pick;
  return backing.distance + slack < yarn.distance ? backing.pick : yarn.pick;
}

/**
 * Axis (0 = X, 1 = Y, 2 = Z) along which the piece is flat, or -1 for a 3D piece. Flat means
 * the thinnest extent is under a quarter of the next thinnest: a disc (rounds, lying in XZ)
 * is flat along Y, a worked rectangle (rows, in XY) along Z.
 */
export function flatAxis(bounds: Bounds): number {
  const ext = [0, 1, 2].map((k) => bounds.max[k]! - bounds.min[k]!);
  const order = [0, 1, 2].sort((a, b) => ext[a]! - ext[b]!);
  const thin = order[0]!;
  return ext[thin]! < 0.25 * ext[order[1]!]! ? thin : -1;
}

export interface Framing {
  target: Vec3;
  position: Vec3;
  /** Radius of the bounding sphere used for framing (mm, at least `minRadius`). */
  radius: number;
  near: number;
  far: number;
}

const VIEW_DIRECTIONS: Record<number, Vec3> = {
  [-1]: [0.6, 0.45, 1], // 3D: from the front, a little from the right and above
  0: [1, 0.3, 0.25],
  1: [0.3, 1, 0.75], // disc: mostly from above
  2: [0.2, 0.25, 1], // flat rows: from the front
};

/**
 * Camera placement that shows the whole piece: the bounding sphere fits the narrower of the
 * two fields of view with a margin, looking along a direction that suits the piece's shape.
 */
export function frameCamera(bounds: Bounds, fovDeg: number, aspect: number, minRadius = 15, margin = 1.0): Framing {
  const target: Vec3 = [0, 1, 2].map((k) => (bounds.min[k]! + bounds.max[k]!) / 2) as Vec3;
  const half = [0, 1, 2].map((k) => (bounds.max[k]! - bounds.min[k]!) / 2);
  const radius = Math.max(minRadius, Math.hypot(half[0]!, half[1]!, half[2]!));
  const vfov = (fovDeg * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(aspect, 1e-3));
  const distance = (radius * margin) / Math.sin(Math.min(vfov, hfov) / 2);
  const dir = VIEW_DIRECTIONS[flatAxis(bounds)]!;
  const len = Math.hypot(...dir);
  const position: Vec3 = [0, 1, 2].map((k) => target[k]! + (dir[k]! / len) * distance) as Vec3;
  return { target, position, radius, near: Math.max(0.1, distance / 100), far: distance * 20 };
}

export interface GridPlacement {
  /** Axis the grid is perpendicular to (1 = ground plane XZ, 2 = backdrop XY, 0 = YZ). */
  normalAxis: number;
  /** Centre of the grid (mm). */
  center: Vec3;
  /** Edge length (mm), a whole number of cells. */
  size: number;
  /** Cells per edge. */
  divisions: number;
}

/**
 * A 1-cm grid behind or under the piece: perpendicular to its flat axis (a rectangle gets a
 * backdrop, a disc a floor), under a 3D piece. It covers the piece plus one cell on every
 * side and sits just outside the piece so it never cuts through it.
 */
export function gridPlacement(bounds: Bounds, cellMm = 10, maxDivisions = 200): GridPlacement {
  const flat = flatAxis(bounds);
  const normalAxis = flat === -1 ? 1 : flat;
  const inPlane = [0, 1, 2].filter((k) => k !== normalAxis);
  const extent = Math.max(...inPlane.map((k) => bounds.max[k]! - bounds.min[k]!));
  const divisions = Math.min(maxDivisions, Math.max(2, Math.ceil(extent / cellMm) + 2));
  const center: Vec3 = [0, 1, 2].map((k) => (bounds.min[k]! + bounds.max[k]!) / 2) as Vec3;
  center[normalAxis] = bounds.min[normalAxis]! - Math.max(0.5, 0.02 * extent);
  return { normalAxis, center, size: divisions * cellMm, divisions };
}
