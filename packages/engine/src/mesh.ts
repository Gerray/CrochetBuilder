/**
 * Mesh export — turns a (relaxed) stitch graph into plain vertex/index arrays that any
 * renderer can upload (Three.js `BufferGeometry`, WebGL, a native view). No Three.js here.
 *
 * Styles:
 *   - `tube`: the yarn as a tube along the working path (the `prev` chain), radius = half the
 *     yarn diameter, smoothed with a Catmull–Rom spline. Ends are left open. A path of a
 *     single stitch (a lone MR or SC) becomes a small yarn-thick sphere so it stays visible.
 *     On a closed piece the yarn runs on from the last stitch to the closing pole (the tail
 *     pulled through to shut the last round), mirroring the magic ring at the start.
 *   - `points`: one vertex per stitch (for `gl.POINTS` / sprites; cheap on mobile).
 *   - `surface`: the fabric as a triangle mesh — one vertex per stitch, triangles between
 *     each row and the stitches it is worked into. Closed pieces (see `isClosedPiece`) are
 *     wound outwards and capped: the last round is fanned to a closing pole (one extra
 *     vertex), as the first round is fanned to the magic ring, so the surface is watertight.
 *     Open pieces keep their open rim. `smooth` adds a smoothing subdivision for display.
 *   - `stitches`: every stitch as the yarn it is made of — post loop, back loop, wraps for tall
 *     stitches, chain links, the magic ring — so the piece reads as a crocheted lattice.
 *     See stitch-mesh.ts.
 *
 * Normals are smooth per-vertex normals (angle-weighted face normals of the capped surface).
 *
 * Every vertex carries the node it belongs to (`nodeIndex`), so the app can highlight a row
 * or the stitch under the guided cursor (`graph.nodes[nodeIndex[v]].rowId`). The closing pole
 * belongs to the last stitch of the last round, a vertex added by subdivision to the nearer
 * end of the edge it splits.
 */

import type { StitchGraph } from "./graph.js";
import { isClosedPiece, newellNormal, signedVolume } from "./relax.js";
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
  /**
   * `surface` only: smoothing subdivision steps, 0–2. Each step splits every triangle into
   * four; the new point of each edge lies on the curved patch the vertex normals describe
   * (PN triangles), so the stitch vertices stay put and the fabric looks round instead of
   * faceted. `"auto"`: one step below `SMOOTH_MAX_NODES` nodes, none above. Default 0 (one
   * vertex per stitch, plus the closing pole).
   */
  smooth?: number | "auto";
  /**
   * Whether the piece is closed (its last round pulled shut: the surface is capped, the tube
   * runs on to the pole). Default: `isClosedPiece`. Pass the same value as to `relax`.
   */
  closed?: boolean;
}

/** `smooth: "auto"` subdivides pieces below this many nodes (a step quadruples the triangles). */
export const SMOOTH_MAX_NODES = 5_000;

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
  const closed = typeof opts.closed === "boolean" ? opts.closed : isClosedPiece(graph);
  const n = graph.nodes.length;
  const surface = fabricSurface(graph, closed);
  if (style === "tube") return tubeMesh(graph, opts, surface);
  // Per-node normals (the pole, if any, comes after the nodes).
  const nodeNormals = surface.normals.slice(0, 3 * n);
  if (style === "stitches") {
    const arrays = stitchMesh(graph, nodeNormals, opts);
    return { style, primitive: "triangles", ...arrays };
  }
  if (style === "points") {
    const nodeIndex = surface.nodeIndex.slice(0, n);
    return {
      style,
      primitive: "points",
      positions: Float32Array.from(graph.positions),
      normals: nodeNormals,
      indices: nodeIndex.slice(),
      nodeIndex,
    };
  }
  const steps = smoothSteps(opts.smooth, n);
  const s = steps > 0 ? subdivide(surface, steps, n) : surface;
  return {
    style,
    primitive: "triangles",
    positions: Float32Array.from(s.pos),
    normals: s.normals,
    indices: s.tris,
    nodeIndex: s.nodeIndex,
  };
}

function smoothSteps(smooth: MeshOptions["smooth"], nodes: number): number {
  if (smooth === "auto") return nodes < SMOOTH_MAX_NODES ? 1 : 0;
  if (typeof smooth !== "number" || !Number.isFinite(smooth)) return 0;
  return Math.min(2, Math.max(0, Math.floor(smooth)));
}

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

interface Surface {
  /** Vertex positions: the graph's nodes first (vertex i = node i), then any extra vertices. */
  pos: Float64Array;
  tris: Uint32Array;
  /** Unit normal per vertex. */
  normals: Float32Array;
  /** Graph node of every vertex. */
  nodeIndex: Uint32Array;
  /** Vertex of the closing pole (= number of nodes), or -1 for an open piece. */
  pole: number;
  /** The last round's stitches around the pole, in working order (empty without a pole). */
  ring: number[];
}

/**
 * The fabric surface: the graph's triangles wound outwards and, for a closed piece, the
 * last round fanned to its closing pole.
 */
function fabricSurface(graph: StitchGraph, closed: boolean): Surface {
  const n = graph.nodes.length;
  const tris = outwardTriangles(graph);
  const identity = new Uint32Array(n);
  for (let i = 0; i < n; i++) identity[i] = i;
  const open = vertexNormals(graph.positions, n, tris, n);
  const ring = closed ? closingRing(graph) : null;
  if (!ring) return { pos: graph.positions, tris, normals: open, nodeIndex: identity, pole: -1, ring: [] };

  const pole = n;
  const pos = new Float64Array(3 * (n + 1));
  pos.set(graph.positions);
  pos.set(polePosition(graph.positions, n, ring, open), 3 * pole);
  const capped = new Uint32Array(tris.length + 3 * ring.length);
  capped.set(tris);
  capped.set(capTriangles(tris, ring, pole), tris.length);
  const nodeIndex = new Uint32Array(n + 1);
  nodeIndex.set(identity);
  nodeIndex[pole] = ring[ring.length - 1]!;
  return { pos, tris: capped, normals: vertexNormals(pos, n + 1, capped, n), nodeIndex, pole, ring };
}

/**
 * The stitches of the last round of a piece, in working order, when that round can be
 * pulled shut (a closed round of at least three stitches); else null.
 */
function closingRing(graph: StitchGraph): number[] | null {
  const last = graph.rows[graph.rows.length - 1];
  if (!last || !last.closed) return null;
  const ids: number[] = [];
  for (let id = last.firstNode; id < last.firstNode + last.nodeCount; id++) {
    const node = graph.nodes[id]!;
    if (!node.lift && node.code !== "MR") ids.push(id);
  }
  return ids.length >= 3 ? ids : null;
}

/**
 * Where the last round is pulled shut: on the round's axis, outwards, as far above its
 * centre as the surface around it would continue — a sphere through the round, tangent to
 * the fabric there: r · tan(θ / 2) for a round of radius r whose normals lean θ off the axis
 * (flat for a flat round, at most r).
 */
function polePosition(pos: Float64Array, n: number, ring: number[], normals: Float32Array): [number, number, number] {
  const k = ring.length;
  let cx = 0, cy = 0, cz = 0;
  let mx = 0, my = 0, mz = 0;
  for (const id of ring) {
    cx += pos[3 * id]! / k;
    cy += pos[3 * id + 1]! / k;
    cz += pos[3 * id + 2]! / k;
    mx += normals[3 * id]!;
    my += normals[3 * id + 1]!;
    mz += normals[3 * id + 2]!;
  }
  let r = 0;
  for (const id of ring) r += Math.hypot(pos[3 * id]! - cx, pos[3 * id + 1]! - cy, pos[3 * id + 2]! - cz) / k;

  let [ax, ay, az] = newellNormal(pos, ring);
  let al = Math.hypot(ax, ay, az);
  if (!(al > 1e-9)) {
    // Degenerate round (all stitches on a point or a line): the fabric's own normals.
    [ax, ay, az] = [mx, my, mz];
    al = Math.hypot(ax, ay, az);
  }
  if (!(al > 1e-9)) return [cx, cy, cz];
  ax /= al;
  ay /= al;
  az /= al;
  // Outwards: along the fabric normals there, else away from the piece's centroid.
  let side = ax * mx + ay * my + az * mz;
  if (Math.abs(side) < 1e-9) {
    let px = 0, py = 0, pz = 0;
    for (let i = 0; i < n; i++) {
      px += pos[3 * i]! / n;
      py += pos[3 * i + 1]! / n;
      pz += pos[3 * i + 2]! / n;
    }
    side = ax * (cx - px) + ay * (cy - py) + az * (cz - pz);
  }
  if (side < 0) {
    ax = -ax;
    ay = -ay;
    az = -az;
  }
  let theta = 0;
  for (const id of ring) {
    const d = ax * normals[3 * id]! + ay * normals[3 * id + 1]! + az * normals[3 * id + 2]!;
    theta += Math.acos(Math.min(1, Math.max(-1, d))) / k;
  }
  const h = Math.min(r, r * Math.tan(Math.min(theta, Math.PI / 2) / 2));
  return [cx + h * ax, cy + h * ay, cz + h * az];
}

/** The cap: a fan from the pole over every edge of the ring, wound like the fabric next to it. */
function capTriangles(tris: Uint32Array, ring: number[], pole: number): Uint32Array {
  const N = pole + 1;
  const directed = new Set<number>();
  for (let t = 0; t < tris.length; t += 3) {
    for (let j = 0; j < 3; j++) directed.add(tris[t + j]! * N + tris[t + ((j + 1) % 3)]!);
  }
  // A consistently wound surface runs each rim edge one way; the cap must run it the other.
  let along = 0, against = 0;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k]!, b = ring[(k + 1) % ring.length]!;
    if (directed.has(a * N + b)) along++;
    if (directed.has(b * N + a)) against++;
  }
  const flip = along > against;
  const out = new Uint32Array(3 * ring.length);
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k]!, b = ring[(k + 1) % ring.length]!;
    out[3 * k] = pole;
    out[3 * k + 1] = flip ? b : a;
    out[3 * k + 2] = flip ? a : b;
  }
  return out;
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
 * Smooth vertex normals: the unit normals of the triangles around a vertex, weighted by the
 * triangle's angle at that vertex (so the result does not depend on how the fabric happens to
 * be split into triangles). A vertex outside every triangle takes `prior`'s normal when one is
 * given (a vertex kept from a coarser mesh); else, among the first `path` vertices (graph
 * nodes in working order: a turning chain, a lone chain), the normal of its nearest
 * neighbour along the working path that has one; else it points away from the centroid.
 */
function vertexNormals(pos: Float64Array, count: number, tris: Uint32Array, path: number, prior?: Float32Array): Float32Array {
  const acc = new Float64Array(3 * count);
  for (let t = 0; t < tris.length; t += 3) {
    const a = 3 * tris[t]!, b = 3 * tris[t + 1]!, c = 3 * tris[t + 2]!;
    const abx = pos[b]! - pos[a]!, aby = pos[b + 1]! - pos[a + 1]!, abz = pos[b + 2]! - pos[a + 2]!;
    const acx = pos[c]! - pos[a]!, acy = pos[c + 1]! - pos[a + 1]!, acz = pos[c + 2]! - pos[a + 2]!;
    const bcx = pos[c]! - pos[b]!, bcy = pos[c + 1]! - pos[b + 1]!, bcz = pos[c + 2]! - pos[b + 2]!;
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const lab = Math.sqrt(abx * abx + aby * aby + abz * abz);
    const lac = Math.sqrt(acx * acx + acy * acy + acz * acz);
    const lbc = Math.sqrt(bcx * bcx + bcy * bcy + bcz * bcz);
    // A degenerate (collinear) triangle has no direction of its own.
    if (!(nl > 1e-9 * Math.max(lab * lac, lab * lbc, lac * lbc))) continue;
    const wa = Math.acos(Math.min(1, Math.max(-1, (abx * acx + aby * acy + abz * acz) / (lab * lac))));
    const wb = Math.acos(Math.min(1, Math.max(-1, -(abx * bcx + aby * bcy + abz * bcz) / (lab * lbc))));
    const wc = Math.max(0, Math.PI - wa - wb);
    const ux = nx / nl, uy = ny / nl, uz = nz / nl;
    acc[a] = acc[a]! + wa * ux;
    acc[a + 1] = acc[a + 1]! + wa * uy;
    acc[a + 2] = acc[a + 2]! + wa * uz;
    acc[b] = acc[b]! + wb * ux;
    acc[b + 1] = acc[b + 1]! + wb * uy;
    acc[b + 2] = acc[b + 2]! + wb * uz;
    acc[c] = acc[c]! + wc * ux;
    acc[c + 1] = acc[c + 1]! + wc * uy;
    acc[c + 2] = acc[c + 2]! + wc * uz;
  }
  const has = (i: number) => Math.hypot(acc[3 * i]!, acc[3 * i + 1]!, acc[3 * i + 2]!) >= 1e-12;
  if (prior) {
    for (let i = 0; i < count && 3 * i < prior.length; i++) {
      if (has(i)) continue;
      acc[3 * i] = prior[3 * i]!;
      acc[3 * i + 1] = prior[3 * i + 1]!;
      acc[3 * i + 2] = prior[3 * i + 2]!;
    }
  }
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) {
    cx += pos[3 * i]! / count;
    cy += pos[3 * i + 1]! / count;
    cz += pos[3 * i + 2]! / count;
  }
  // Nearest node with a normal on either side along the working path (two linear passes).
  const m = Math.min(path, count);
  const left = new Int32Array(m);
  const right = new Int32Array(m);
  for (let i = 0, last = -1; i < m; i++) left[i] = last = has(i) ? i : last;
  for (let i = m - 1, last = -1; i >= 0; i--) right[i] = last = has(i) ? i : last;
  const out = new Float32Array(3 * count);
  for (let i = 0; i < count; i++) {
    let src = i;
    if (i < m) {
      const l = left[i]!, r = right[i]!;
      src = l < 0 ? (r < 0 ? i : r) : r < 0 || i - l <= r - i ? l : r;
    }
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

/** Largest offset of a new edge point from the straight edge, relative to the edge length. */
const MAX_BULGE = 0.25;

/**
 * Smoothing subdivision, `steps` times: every triangle into four. The new point of an edge
 * lies on the cubic curve between its ends that is tangent to the surface at both (the edge
 * curve of a PN triangle): (p0 + p1) / 2 − ((p1 − p0)·n0 n0 + (p0 − p1)·n1 n1) / 8. The
 * existing vertices stay; normals are recomputed on the finer mesh. `path`: number of
 * leading vertices that are graph nodes in working order (see `vertexNormals`).
 */
function subdivide(s: Surface, steps: number, path: number): Surface {
  let { pos, tris, normals, nodeIndex } = s;
  for (let step = 0; step < steps; step++) {
    const V = pos.length / 3;
    // One new vertex per undirected edge, numbered in order of first appearance.
    const edge = new Map<number, number>();
    const ends: number[] = [];
    const mids = new Uint32Array(tris.length);
    for (let t = 0; t < tris.length; t += 3) {
      for (let j = 0; j < 3; j++) {
        const a = tris[t + j]!, b = tris[t + ((j + 1) % 3)]!;
        const key = a < b ? a * V + b : b * V + a;
        let v = edge.get(key);
        if (v === undefined) {
          v = V + ends.length / 2;
          edge.set(key, v);
          ends.push(Math.min(a, b), Math.max(a, b));
        }
        mids[t + j] = v;
      }
    }
    const E = ends.length / 2;
    const np = new Float64Array(3 * (V + E));
    np.set(pos);
    const ni = new Uint32Array(V + E);
    ni.set(nodeIndex);
    for (let e = 0; e < E; e++) {
      const a = ends[2 * e]!, b = ends[2 * e + 1]!;
      const pa = 3 * a, pb = 3 * b;
      const dx = pos[pb]! - pos[pa]!, dy = pos[pb + 1]! - pos[pa + 1]!, dz = pos[pb + 2]! - pos[pa + 2]!;
      const wa = dx * normals[pa]! + dy * normals[pa + 1]! + dz * normals[pa + 2]!;
      const wb = -(dx * normals[pb]! + dy * normals[pb + 1]! + dz * normals[pb + 2]!);
      let ox = -(wa * normals[pa]! + wb * normals[pb]!) / 8;
      let oy = -(wa * normals[pa + 1]! + wb * normals[pb + 1]!) / 8;
      let oz = -(wa * normals[pa + 2]! + wb * normals[pb + 2]!) / 8;
      const ol = Math.hypot(ox, oy, oz);
      const limit = MAX_BULGE * Math.hypot(dx, dy, dz);
      if (ol > limit) {
        const f = limit / ol;
        ox *= f;
        oy *= f;
        oz *= f;
      }
      const x = pos[pa]! + dx / 2 + ox, y = pos[pa + 1]! + dy / 2 + oy, z = pos[pa + 2]! + dz / 2 + oz;
      const v = V + e;
      np[3 * v] = x;
      np[3 * v + 1] = y;
      np[3 * v + 2] = z;
      // The node of the nearer end (a tie goes to the lower vertex).
      const da = (x - pos[pa]!) ** 2 + (y - pos[pa + 1]!) ** 2 + (z - pos[pa + 2]!) ** 2;
      const db = (x - pos[pb]!) ** 2 + (y - pos[pb + 1]!) ** 2 + (z - pos[pb + 2]!) ** 2;
      ni[v] = db < da ? nodeIndex[b]! : nodeIndex[a]!;
    }
    // Same winding: three corner triangles and the middle one.
    const nt = new Uint32Array(4 * tris.length);
    let o = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t]!, b = tris[t + 1]!, c = tris[t + 2]!;
      const ab = mids[t]!, bc = mids[t + 1]!, ca = mids[t + 2]!;
      nt[o++] = a;
      nt[o++] = ab;
      nt[o++] = ca;
      nt[o++] = ab;
      nt[o++] = b;
      nt[o++] = bc;
      nt[o++] = ca;
      nt[o++] = bc;
      nt[o++] = c;
      nt[o++] = ab;
      nt[o++] = bc;
      nt[o++] = ca;
    }
    normals = vertexNormals(np, V + E, nt, path, normals);
    pos = np;
    tris = nt;
    nodeIndex = ni;
  }
  return { ...s, pos, tris, normals, nodeIndex };
}

// ---------------------------------------------------------------------------
// Tube
// ---------------------------------------------------------------------------

function tubeMesh(graph: StitchGraph, opts: MeshOptions, surface: Surface): MeshData {
  const radius = opts.radius ?? graph.gauge.yarnDiameterMm / 2;
  const seg = Math.max(3, Math.floor(opts.radialSegments ?? 6));
  const sub = Math.max(1, Math.floor(opts.subdivisions ?? 2));
  const n = graph.nodes.length;
  // Node positions, then the closing pole (if any) as one more point the yarn can run to.
  const pos = surface.pos;
  const tail = surface.pole >= 0 ? surface.ring[surface.ring.length - 1]! : -1;

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
    // The yarn that ends on the last stitch of the closing round is pulled through to the pole.
    const pole = path[path.length - 1] === tail;
    if (pole) path.push(surface.pole);
    const owner = (v: number) => (v === surface.pole ? tail : v);
    if (path.length < 2) {
      yarnBead(path[0]!, pos, radius, seg, positions, normals, indices, nodeIndex);
      continue;
    }
    // Spline samples along the path.
    const pts: number[] = [];
    const owners: number[] = [];
    const P = (k: number, axis: number) => pos[3 * path[Math.min(path.length - 1, Math.max(0, k))]! + axis]!;
    for (let k = 0; k < path.length - 1; k++) {
      for (let s = 0; s < sub; s++) {
        const t = s / sub;
        for (let axis = 0; axis < 3; axis++) {
          pts.push(catmullRom(P(k - 1, axis), P(k, axis), P(k + 1, axis), P(k + 2, axis), t));
        }
        owners.push(owner(t < 0.5 ? path[k]! : path[k + 1]!));
      }
    }
    for (let axis = 0; axis < 3; axis++) pts.push(P(path.length - 1, axis));
    owners.push(owner(path[path.length - 1]!));
    const m = owners.length;

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
        nodeIndex.push(owners[i]!);
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
