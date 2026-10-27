/**
 * Mesh export — turns a (relaxed) stitch graph into plain vertex/index arrays that any
 * renderer can upload (Three.js `BufferGeometry`, WebGL, a native view). No Three.js here.
 *
 * Styles:
 *   - `tube`: the yarn as a tube along the working path (the `prev` chain), radius = half the
 *     yarn diameter, smoothed with a Catmull–Rom spline. Ends are left open. A path of a
 *     single stitch (a lone MR or SC) becomes a small yarn-thick sphere so it stays visible.
 *   - `points`: one vertex per stitch (for `gl.POINTS` / sprites; cheap on mobile).
 *   - `surface`: the fabric as a triangle mesh — one vertex per stitch, triangles between
 *     each row and the stitches it is worked into. Closed pieces are wound outwards.
 *   - `stitches`: every stitch as the yarn it is made of — post loop, back loop, wraps for tall
 *     stitches, chain links, the magic ring — so the piece reads as a crocheted lattice.
 *     See stitch-mesh.ts.
 *
 * Every vertex carries the node it belongs to (`nodeIndex`), so the app can highlight a row
 * or the stitch under the guided cursor (`graph.nodes[nodeIndex[v]].rowId`).
 */

import type { StitchGraph } from "./graph.js";
import { signedVolume } from "./relax.js";
import { stitchMesh } from "./stitch-mesh.js";

export type MeshStyle = "stitches" | "tube" | "points" | "surface";

export interface MeshOptions {
  /**
   * Tube radius in mm. Default: half the yarn diameter of the resolved gauge (`stitches`:
   * see `stitchYarnRadius`).
   */
  radius?: number;
  /** Vertices around the tube. Default 6, minimum 3 (`stitches`: by piece size, 6/5/4). */
  radialSegments?: number;
  /** Spline points per stitch-to-stitch segment of the tube. Default 2, minimum 1. */
  subdivisions?: number;
  /** `stitches` only: samples along each yarn arc. Default by piece size (5/4/3), minimum 2. */
  arcSamples?: number;
}

export interface MeshData {
  style: MeshStyle;
  /** `"triangles"` for stitches, tube and surface, `"points"` for points. */
  primitive: "triangles" | "points";
  /** xyz per vertex, mm. */
  positions: Float32Array;
  /** Unit normal per vertex. */
  normals: Float32Array;
  /** Triangle indices (3 per triangle) or, for points, one index per vertex. */
  indices: Uint32Array;
  /** Graph node of every vertex. */
  nodeIndex: Uint32Array;
}

/** Build mesh data for a graph in the given style. */
export function toMesh(graph: StitchGraph, style: MeshStyle, opts: MeshOptions = {}): MeshData {
  if (style === "tube") return tubeMesh(graph, opts);
  const n = graph.nodes.length;
  const positions = Float32Array.from(graph.positions);
  const nodeIndex = new Uint32Array(n);
  for (let i = 0; i < n; i++) nodeIndex[i] = i;
  const tris = outwardTriangles(graph);
  const normals = vertexNormals(graph, tris);
  if (style === "stitches") {
    const arrays = stitchMesh(graph, normals, opts);
    return { style, primitive: "triangles", ...arrays };
  }
  if (style === "points") {
    return { style, primitive: "points", positions, normals, indices: nodeIndex.slice(), nodeIndex };
  }
  return { style, primitive: "triangles", positions, normals, indices: tris, nodeIndex };
}

/** Graph triangles, flipped if needed so that a closed piece's normals point outwards. */
function outwardTriangles(graph: StitchGraph): Uint32Array {
  const tris = graph.triangles.slice();
  if (!graph.rows.some((r) => r.closed) || tris.length === 0) return tris;
  // Volume relative to the centroid, so an open rim does not bias the sign.
  const n = graph.nodes.length;
  const c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k]! += graph.positions[3 * i + k]! / n;
  const centred = new Float64Array(graph.positions.length);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) centred[3 * i + k] = graph.positions[3 * i + k]! - c[k]!;
  if (signedVolume(centred, tris) < 0) {
    for (let t = 0; t < tris.length; t += 3) {
      const b = tris[t + 1]!;
      tris[t + 1] = tris[t + 2]!;
      tris[t + 2] = b;
    }
  }
  return tris;
}

/**
 * Area-weighted vertex normals. A vertex outside every triangle (a turning chain, a lone
 * chain) takes the normal of its nearest neighbour along the working path that has one, else
 * it points away from the centroid.
 */
function vertexNormals(graph: StitchGraph, tris: Uint32Array): Float32Array {
  const pos = graph.positions;
  const n = graph.nodes.length;
  const acc = new Float64Array(3 * n);
  for (let t = 0; t < tris.length; t += 3) {
    const a = 3 * tris[t]!, b = 3 * tris[t + 1]!, c = 3 * tris[t + 2]!;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      acc[v] = acc[v]! + nx;
      acc[v + 1] = acc[v + 1]! + ny;
      acc[v + 2] = acc[v + 2]! + nz;
    }
  }
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    cx += pos[3 * i]! / n;
    cy += pos[3 * i + 1]! / n;
    cz += pos[3 * i + 2]! / n;
  }
  // Nearest node with a normal on either side along the working path (two linear passes).
  const has = (i: number) => Math.hypot(acc[3 * i]!, acc[3 * i + 1]!, acc[3 * i + 2]!) >= 1e-12;
  const left = new Int32Array(n);
  const right = new Int32Array(n);
  for (let i = 0, last = -1; i < n; i++) left[i] = last = has(i) ? i : last;
  for (let i = n - 1, last = -1; i >= 0; i--) right[i] = last = has(i) ? i : last;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const l = left[i]!, r = right[i]!;
    const src = l < 0 ? (r < 0 ? i : r) : r < 0 || i - l <= r - i ? l : r;
    let x = acc[3 * src]!, y = acc[3 * src + 1]!, z = acc[3 * src + 2]!;
    let len = Math.hypot(x, y, z);
    if (len < 1e-12) {
      x = pos[3 * i]! - cx;
      y = pos[3 * i + 1]! - cy;
      z = pos[3 * i + 2]! - cz;
      len = Math.hypot(x, y, z);
      if (len < 1e-12) {
        x = 0;
        y = 1;
        z = 0;
        len = 1;
      }
    }
    out[3 * i] = x / len;
    out[3 * i + 1] = y / len;
    out[3 * i + 2] = z / len;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tube
// ---------------------------------------------------------------------------

function tubeMesh(graph: StitchGraph, opts: MeshOptions): MeshData {
  const radius = opts.radius ?? graph.gauge.yarnDiameterMm / 2;
  const seg = Math.max(3, Math.floor(opts.radialSegments ?? 6));
  const sub = Math.max(1, Math.floor(opts.subdivisions ?? 2));
  const pos = graph.positions;
  const n = graph.nodes.length;

  // Split the working path where it is interrupted (it normally is one chain).
  const paths: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < n; i++) {
    if (cur.length > 0 && graph.nodes[i]!.prev !== cur[cur.length - 1]) {
      paths.push(cur);
      cur = [];
    }
    cur.push(i);
  }
  if (cur.length > 0) paths.push(cur);

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const nodeIndex: number[] = [];

  for (const path of paths) {
    if (path.length < 2) {
      yarnBead(path[0]!, pos, radius, seg, positions, normals, indices, nodeIndex);
      continue;
    }
    // Spline samples along the path.
    const pts: number[] = [];
    const owner: number[] = [];
    const P = (k: number, axis: number) => pos[3 * path[Math.min(path.length - 1, Math.max(0, k))]! + axis]!;
    for (let k = 0; k < path.length - 1; k++) {
      for (let s = 0; s < sub; s++) {
        const t = s / sub;
        for (let axis = 0; axis < 3; axis++) {
          pts.push(catmullRom(P(k - 1, axis), P(k, axis), P(k + 1, axis), P(k + 2, axis), t));
        }
        owner.push(t < 0.5 ? path[k]! : path[k + 1]!);
      }
    }
    for (let axis = 0; axis < 3; axis++) pts.push(P(path.length - 1, axis));
    owner.push(path[path.length - 1]!);
    const m = owner.length;

    // Tangents and parallel-transported frames.
    let nx = 0, ny = 0, nz = 0;
    const base = positions.length / 3;
    for (let i = 0; i < m; i++) {
      const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
      let tx = pts[3 * b]! - pts[3 * a]!, ty = pts[3 * b + 1]! - pts[3 * a + 1]!, tz = pts[3 * b + 2]! - pts[3 * a + 2]!;
      const tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-12) {
        tx = 0;
        ty = 1;
        tz = 0;
      } else {
        tx /= tl;
        ty /= tl;
        tz /= tl;
      }
      if (i === 0) {
        // Any vector not parallel to the tangent.
        const ax = Math.abs(tx) < 0.9 ? 1 : 0, ay = ax === 1 ? 0 : 1;
        nx = ax;
        ny = ay;
        nz = 0;
      }
      // Remove the tangent component (parallel transport by projection).
      const d = nx * tx + ny * ty + nz * tz;
      nx -= d * tx;
      ny -= d * ty;
      nz -= d * tz;
      let nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-9) {
        const ax = Math.abs(tx) < 0.9 ? 1 : 0, ay = ax === 1 ? 0 : 1;
        const e = ax * tx + ay * ty;
        nx = ax - e * tx;
        ny = ay - e * ty;
        nz = -e * tz;
        nl = Math.hypot(nx, ny, nz);
      }
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      for (let s = 0; s < seg; s++) {
        const ang = (2 * Math.PI * s) / seg;
        const c = Math.cos(ang), sn = Math.sin(ang);
        const rx = c * nx + sn * bx, ry = c * ny + sn * by, rz = c * nz + sn * bz;
        positions.push(pts[3 * i]! + radius * rx, pts[3 * i + 1]! + radius * ry, pts[3 * i + 2]! + radius * rz);
        normals.push(rx, ry, rz);
        nodeIndex.push(owner[i]!);
      }
    }
    for (let i = 0; i + 1 < m; i++) {
      for (let s = 0; s < seg; s++) {
        const a = base + i * seg + s;
        const b = base + i * seg + ((s + 1) % seg);
        const c = a + seg;
        const d = b + seg;
        indices.push(a, b, c, b, d, c); // wound so that normals face away from the yarn axis
      }
    }
  }

  return {
    style: "tube",
    primitive: "triangles",
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    nodeIndex: Uint32Array.from(nodeIndex),
  };
}

/** A small UV sphere of yarn radius around one node (for single-stitch paths). */
function yarnBead(
  node: number,
  pos: Float64Array,
  radius: number,
  seg: number,
  positions: number[],
  normals: number[],
  indices: number[],
  nodeIndex: number[],
): void {
  const base = positions.length / 3;
  const lat = Math.max(2, Math.floor(seg / 2));
  for (let i = 0; i <= lat; i++) {
    const th = (Math.PI * i) / lat;
    for (let j = 0; j < seg; j++) {
      const ph = (2 * Math.PI * j) / seg;
      const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
      positions.push(pos[3 * node]! + radius * nx, pos[3 * node + 1]! + radius * ny, pos[3 * node + 2]! + radius * nz);
      normals.push(nx, ny, nz);
      nodeIndex.push(node);
    }
  }
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < seg; j++) {
      const a = base + i * seg + j;
      const b = base + i * seg + ((j + 1) % seg);
      indices.push(a, b, a + seg, b, b + seg, a + seg);
    }
  }
}

/** Uniform Catmull–Rom interpolation between p1 and p2 at t ∈ [0, 1]. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
