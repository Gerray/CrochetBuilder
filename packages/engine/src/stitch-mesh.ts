/**
 * Stitch mesh — the `"stitches"` style of `toMesh`: every stitch drawn as the yarn it is
 * made of, so the piece reads as crocheted fabric (a lattice with holes) rather than a
 * surface or one long tube.
 *
 * Every node is placed in a local frame taken from the relaxed positions:
 *   - `d` (row direction): towards the next stitch of the same row;
 *   - `u` (up): from the stitch's parent(s) to its top (or from a chain to the stitches
 *     worked into it);
 *   - `n` (normal): the fabric normal of the surface style (outwards on closed pieces).
 *
 * In that frame a stitch is a few tubes of yarn radius (see `stitchYarn`):
 *   - the post: one closed, smooth loop — over the stitch top as the front loop, down the
 *     legs into the parent's top and back up. For a single parent it is a "V" (SC, HDC, …;
 *     an INC is two of them side by side on one parent); for a decrease it reaches into
 *     each parent (a Λ). The height is whatever the relaxed geometry gives (rest lengths
 *     come from STITCH_HEIGHT_FACTOR), so a SL_ST stays very short and a DTR very tall;
 *   - the back loop: an arc behind the front loop, so the top edge of a row is the familiar
 *     braid of V's when seen from above;
 *   - wraps: one (HDC, DC), two (TR) or three (DTR) slanted bars across a tall post;
 *   - a chain (foundation, turning or mid-row) is an elongated link lying in the fabric;
 *   - the magic ring is a small ring around its anchor.
 * Each post loop encloses a hole, as real crochet has.
 *
 * Deterministic, no randomness. Degenerate frames (coincident nodes, a lone chain) fall back
 * to arbitrary but finite axes. Every vertex keeps its node (`nodeIndex`), so highlighting a
 * row and picking a stitch work as in the other styles. Only the topology (code, prev,
 * parents, span) is read, so an INC drawn as one node with two anchors or as two nodes on
 * the same parent gives the same picture.
 *
 * Detail adapts to the size of the piece (see `stitchDetail`) to keep the vertex count
 * bounded: about 100 vertices per SC at full detail.
 */

import type { StitchGraph } from "./graph.js";

export interface StitchMeshOptions {
  /** Yarn (tube) radius in mm. Default: `stitchYarnRadius(gauge)`. */
  radius?: number;
  /** Vertices around each tube. Default by piece size (6 / 5 / 4), minimum 3. */
  radialSegments?: number;
  /** Samples along each yarn arc. Default by piece size (5 / 4 / 3), minimum 2. */
  arcSamples?: number;
}

export interface StitchMeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  nodeIndex: Uint32Array;
}

/**
 * Tube radius relative to half the yarn diameter. Slightly thinner than the nominal yarn:
 * real yarn squeezes where loops cross, and the holes of the fabric stay readable.
 */
export const STITCH_YARN_SCALE = 0.85;
/**
 * Upper bound of the tube radius relative to the stitch width. Tight amigurumi gauges put
 * a 2.5 mm yarn into 3.7 mm stitches; drawn at full thickness the loops would merge into a
 * lumpy surface, so the yarn is drawn thinner there and the structure stays readable.
 */
export const STITCH_YARN_MAX_WIDTH = 0.19;

/** Default tube radius of the stitch mesh for a gauge (mm). */
export function stitchYarnRadius(gauge: { yarnDiameterMm: number; stitchWidthMm: number }): number {
  return Math.min(STITCH_YARN_SCALE * (gauge.yarnDiameterMm / 2), STITCH_YARN_MAX_WIDTH * gauge.stitchWidthMm);
}

/** Wraps across the post per stitch code (yarn-overs that stay visible on the post). */
const WRAPS: Partial<Record<string, number>> = { HDC: 1, DC: 1, TR: 2, DTR: 3 };

/** Default detail for a piece of `nodes` stitches. */
export function stitchDetail(nodes: number): { radialSegments: number; arcSamples: number } {
  if (nodes <= 4_000) return { radialSegments: 6, arcSamples: 5 };
  if (nodes <= 10_000) return { radialSegments: 5, arcSamples: 4 };
  return { radialSegments: 4, arcSamples: 3 };
}

export type V3 = [number, number, number];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
/** a + b·s + c·t + e·q (a point plus frame offsets). */
const at = (a: V3, b: V3, s: number, c: V3, t: number, e: V3, q: number): V3 => [
  a[0] + b[0] * s + c[0] * t + e[0] * q,
  a[1] + b[1] * s + c[1] * t + e[1] * q,
  a[2] + b[2] * s + c[2] * t + e[2] * q,
];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Any unit vector perpendicular to `a` (a must be a unit vector). */
function perpendicular(a: V3): V3 {
  const axis: V3 = Math.abs(a[0]) < 0.6 ? [1, 0, 0] : Math.abs(a[1]) < 0.6 ? [0, 1, 0] : [0, 0, 1];
  const p = sub(axis, mul(a, dot(axis, a)));
  return mul(p, 1 / len(p));
}

/** Unit vector, or `fallback` when `a` is (nearly) zero or not finite. */
function unit(a: V3, fallback: V3): V3 {
  const l = len(a);
  return l > 1e-9 && Number.isFinite(l) ? mul(a, 1 / l) : fallback;
}

/** Growable typed buffers for the swept tubes. */
class TubeBuffer {
  positions: Float32Array;
  normals: Float32Array;
  nodeIndex: Uint32Array;
  indices: Uint32Array;
  vertexCount = 0;
  indexCount = 0;

  constructor(vertices: number, indices: number) {
    this.positions = new Float32Array(3 * vertices);
    this.normals = new Float32Array(3 * vertices);
    this.nodeIndex = new Uint32Array(vertices);
    this.indices = new Uint32Array(indices);
  }

  reserve(vertices: number, indices: number): void {
    const v = this.vertexCount + vertices;
    if (v > this.nodeIndex.length) {
      const cap = Math.max(v, 2 * this.nodeIndex.length);
      const grow = <T extends Float32Array | Uint32Array>(a: T, size: number): T => {
        const b = new (a.constructor as new (n: number) => T)(size);
        b.set(a);
        return b;
      };
      this.positions = grow(this.positions, 3 * cap);
      this.normals = grow(this.normals, 3 * cap);
      this.nodeIndex = grow(this.nodeIndex, cap);
    }
    const i = this.indexCount + indices;
    if (i > this.indices.length) {
      const b = new Uint32Array(Math.max(i, 2 * this.indices.length));
      b.set(this.indices);
      this.indices = b;
    }
  }

  result(): StitchMeshArrays {
    return {
      positions: this.positions.slice(0, 3 * this.vertexCount),
      normals: this.normals.slice(0, 3 * this.vertexCount),
      indices: this.indices.slice(0, this.indexCount),
      nodeIndex: this.nodeIndex.slice(0, this.vertexCount),
    };
  }
}

/** Sweeps tubes of one radius / resolution into a buffer. */
class Sweeper {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(
    readonly buf: TubeBuffer,
    readonly radius: number,
    readonly seg: number,
    readonly samples: number,
  ) {
    this.cos = new Float64Array(seg);
    this.sin = new Float64Array(seg);
    for (let s = 0; s < seg; s++) {
      this.cos[s] = Math.cos((2 * Math.PI * s) / seg);
      this.sin[s] = Math.sin((2 * Math.PI * s) / seg);
    }
  }

  /** One ring of vertices around point `p` with unit tangent `t`; `hint` orients the ring. */
  private ring(p: V3, t: V3, hint: V3, owner: number): void {
    const { buf, seg, radius } = this;
    let nx = hint[0] - t[0] * dot(hint, t), ny = hint[1] - t[1] * dot(hint, t), nz = hint[2] - t[2] * dot(hint, t);
    let nl = Math.hypot(nx, ny, nz);
    if (!(nl > 1e-6)) {
      const q = perpendicular(t);
      nx = q[0];
      ny = q[1];
      nz = q[2];
      nl = 1;
    }
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const bx = t[1] * nz - t[2] * ny, by = t[2] * nx - t[0] * nz, bz = t[0] * ny - t[1] * nx;
    let v = buf.vertexCount;
    for (let s = 0; s < seg; s++) {
      const c = this.cos[s]!, sn = this.sin[s]!;
      const rx = c * nx + sn * bx, ry = c * ny + sn * by, rz = c * nz + sn * bz;
      buf.positions[3 * v] = p[0] + radius * rx;
      buf.positions[3 * v + 1] = p[1] + radius * ry;
      buf.positions[3 * v + 2] = p[2] + radius * rz;
      buf.normals[3 * v] = rx;
      buf.normals[3 * v + 1] = ry;
      buf.normals[3 * v + 2] = rz;
      buf.nodeIndex[v] = owner;
      v++;
    }
    buf.vertexCount = v;
  }

  /** Quads between consecutive rings `first … first + rings − 1` (and back to the first when closed). */
  private stitchRings(first: number, rings: number, closed: boolean): void {
    const { buf, seg } = this;
    let k = buf.indexCount;
    const spans = closed ? rings : rings - 1;
    for (let i = 0; i < spans; i++) {
      const r0 = first + i * seg;
      const r1 = first + ((i + 1) % rings) * seg;
      for (let s = 0; s < seg; s++) {
        const s1 = (s + 1) % seg;
        const a = r0 + s, b = r0 + s1, c = r1 + s, d = r1 + s1;
        buf.indices[k++] = a;
        buf.indices[k++] = b;
        buf.indices[k++] = c;
        buf.indices[k++] = b;
        buf.indices[k++] = d;
        buf.indices[k++] = c;
      }
    }
    buf.indexCount = k;
  }

  /**
   * A tube along the quadratic Bézier a → b with control point c. `hint` is a direction
   * roughly perpendicular to the curve (the normal of the plane it bends in).
   */
  arc(a: V3, c: V3, b: V3, hint: V3, owner: number): void {
    const m = this.samples;
    const seg = this.seg;
    const buf = this.buf;
    buf.reserve(m * seg + 2, 6 * (m - 1) * seg + 6 * seg);
    const first = buf.vertexCount;
    const chord = unit(sub(b, a), perpendicular(unit(hint, [0, 1, 0])));
    let t0: V3 = chord, t1: V3 = chord;
    for (let i = 0; i < m; i++) {
      const t = i / (m - 1), s = 1 - t;
      const p: V3 = [
        s * s * a[0] + 2 * s * t * c[0] + t * t * b[0],
        s * s * a[1] + 2 * s * t * c[1] + t * t * b[1],
        s * s * a[2] + 2 * s * t * c[2] + t * t * b[2],
      ];
      const tan = unit(add(mul(sub(c, a), s), mul(sub(b, c), t)), chord);
      if (i === 0) t0 = tan;
      t1 = tan;
      this.ring(p, tan, hint, owner);
    }
    this.stitchRings(first, m, false);
    // Flat caps, so the cut ends of the yarn do not show the tube's inside.
    const cap = (centre: V3, normal: V3, ring: number, end: boolean) => {
      const v = buf.vertexCount++;
      buf.positions.set(centre, 3 * v);
      buf.normals.set(normal, 3 * v);
      buf.nodeIndex[v] = owner;
      let k = buf.indexCount;
      for (let s = 0; s < seg; s++) {
        const p = ring + s, q = ring + ((s + 1) % seg);
        buf.indices[k++] = v;
        buf.indices[k++] = end ? p : q;
        buf.indices[k++] = end ? q : p;
      }
      buf.indexCount = k;
    };
    cap(a, mul(t0, -1), first, false);
    cap(b, t1, first + (m - 1) * seg, true);
  }

  /** A closed, smooth tube through `points` (uniform Catmull–Rom, `samples − 2` per span, ≥ 2). */
  closedSpline(points: V3[], hint: V3, owner: number): void {
    const k = points.length;
    const per = Math.max(2, this.samples - 2);
    const m = k * per;
    this.buf.reserve(m * this.seg, 6 * m * this.seg);
    const first = this.buf.vertexCount;
    const fallback = perpendicular(unit(hint, [0, 0, 1]));
    for (let i = 0; i < k; i++) {
      const p0 = points[(i + k - 1) % k]!, p1 = points[i]!, p2 = points[(i + 1) % k]!, p3 = points[(i + 2) % k]!;
      for (let j = 0; j < per; j++) {
        const t = j / per, t2 = t * t, t3 = t2 * t;
        const p: V3 = [0, 0, 0];
        const tan: V3 = [0, 0, 0];
        for (let x = 0; x < 3; x++) {
          const a0 = p0[x]!, a1 = p1[x]!, a2 = p2[x]!, a3 = p3[x]!;
          const c1 = -a0 + a2, c2 = 2 * a0 - 5 * a1 + 4 * a2 - a3, c3 = -a0 + 3 * a1 - 3 * a2 + a3;
          p[x] = 0.5 * (2 * a1 + c1 * t + c2 * t2 + c3 * t3);
          tan[x] = c1 + 2 * c2 * t + 3 * c3 * t2;
        }
        this.ring(p, unit(tan, fallback), hint, owner);
      }
    }
    this.stitchRings(first, m, true);
  }

  /** A closed ellipse around `centre` with semi-axes `e1`, `e2` (vectors). */
  loop(centre: V3, e1: V3, e2: V3, owner: number): void {
    const m = Math.max(6, 2 * this.samples);
    this.buf.reserve(m * this.seg, 6 * m * this.seg);
    const first = this.buf.vertexCount;
    const hint = unit(cross(e1, e2), perpendicular(unit(e1, [1, 0, 0])));
    for (let i = 0; i < m; i++) {
      const ang = (2 * Math.PI * i) / m;
      const c = Math.cos(ang), s = Math.sin(ang);
      const p = add(centre, add(mul(e1, c), mul(e2, s)));
      const tan = unit(add(mul(e1, -s), mul(e2, c)), perpendicular(hint));
      this.ring(p, tan, hint, owner);
    }
    this.stitchRings(first, m, true);
  }
}

interface Frame {
  d: V3;
  u: V3;
  n: V3;
  /** Local stitch width (mm): the gauge width scaled by how far the neighbours really are. */
  w: number;
}

/**
 * Local frames of all nodes. `normals` are the fabric normals of the surface style (unit,
 * 3 per node).
 */
function frames(graph: StitchGraph, normals: Float32Array): Frame[] {
  const { nodes, rows } = graph;
  const pos = graph.positions;
  const n = nodes.length;
  const w = graph.gauge.stitchWidthMm;
  const P = (i: number): V3 => [pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!];
  const rowOf = new Int32Array(n);
  rows.forEach((r, k) => rowOf.fill(k, r.firstNode, r.firstNode + r.nodeCount));
  const inRow = (i: number) => !nodes[i]!.lift && nodes[i]!.code !== "MR";

  const children: number[][] = Array.from({ length: n }, () => []);
  for (const node of nodes) for (const p of node.parents) children[p]!.push(node.id);

  // Raw up direction where the topology gives one.
  const upRaw: Array<V3 | null> = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const node = nodes[i]!;
    const t = P(i);
    if (node.parents.length > 0) {
      let m: V3 = [0, 0, 0];
      for (const p of node.parents) m = add(m, P(p));
      upRaw[i] = sub(t, mul(m, 1 / node.parents.length));
    } else if (children[i]!.length > 0) {
      let m: V3 = [0, 0, 0];
      for (const c of children[i]!) m = add(m, P(c));
      upRaw[i] = sub(mul(m, 1 / children[i]!.length), t);
    }
    if (upRaw[i] && !(len(upRaw[i]!) > 1e-9)) upRaw[i] = null;
  }
  // Nodes without one take the nearest along the working path.
  const left = new Int32Array(n);
  const right = new Int32Array(n);
  for (let i = 0, last = -1; i < n; i++) left[i] = last = upRaw[i] ? i : last;
  for (let i = n - 1, last = -1; i >= 0; i--) right[i] = last = upRaw[i] ? i : last;

  const out: Frame[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const node = nodes[i]!;
    const t = P(i);
    const n0 = unit([normals[3 * i]!, normals[3 * i + 1]!, normals[3 * i + 2]!], [0, 0, 1]);

    // Row direction from the neighbours in the same row.
    const l = i > 0 && rowOf[i - 1] === rowOf[i] && inRow(i - 1) && inRow(i) ? i - 1 : -1;
    const r = i + 1 < n && rowOf[i + 1] === rowOf[i] && inRow(i + 1) && inRow(i) ? i + 1 : -1;
    let dRaw: V3 = [0, 0, 0];
    let dist = 0, expected = 0;
    if (l >= 0) {
      const v = sub(t, P(l));
      dRaw = add(dRaw, v);
      dist += len(v);
      expected += ((node.span + nodes[l]!.span) / 2) * w;
    }
    if (r >= 0) {
      const v = sub(P(r), t);
      dRaw = add(dRaw, v);
      dist += len(v);
      expected += ((node.span + nodes[r]!.span) / 2) * w;
    }
    if (l < 0 && r < 0 && node.prev !== null) dRaw = sub(t, P(node.prev));
    const scale = expected > 0 && dist > 0 ? Math.min(1.6, Math.max(0.6, dist / expected)) : 1;

    const li = left[i]!, ri = right[i]!;
    const src = li < 0 ? ri : ri < 0 || i - li <= ri - i ? li : ri;
    const up0: V3 = src >= 0 ? upRaw[src]! : cross(n0, unit(dRaw, perpendicular(n0)));

    let u = sub(up0, mul(n0, dot(up0, n0)));
    u = unit(u, unit(cross(n0, unit(dRaw, perpendicular(n0))), perpendicular(n0)));
    let d = cross(u, n0);
    d = unit(d, perpendicular(u));
    if (dot(d, dRaw) < 0) d = mul(d, -1);
    out[i] = { d, u, n: n0, w: w * scale };
  }
  return out;
}

/** What a piece of yarn in the stitch mesh is (for tests and other renderers). */
export type YarnArcKind = "top" | "wrap";
export type YarnLoopKind = "link" | "ring";

/** A yarn arc: quadratic Bézier `a → b` with control `c`, bending in the plane normal to `hint`. */
export interface YarnArc {
  kind: YarnArcKind;
  node: number;
  a: V3;
  c: V3;
  b: V3;
  hint: V3;
}

/** A closed yarn loop: ellipse around `centre` with semi-axis vectors `e1`, `e2`. */
export interface YarnLoop {
  kind: YarnLoopKind;
  node: number;
  centre: V3;
  e1: V3;
  e2: V3;
}

/**
 * The post of a stitch with its front loop: a closed, smooth yarn loop (Catmull–Rom through
 * `points`) running over the stitch top, down the legs into the parent(s) and back up.
 * `feet` are the indices of the points that sit in a parent's top; `crest` the index of the
 * top of the front loop.
 */
export interface YarnPost {
  kind: "post";
  node: number;
  points: V3[];
  feet: number[];
  crest: number;
  hint: V3;
}

export type YarnPiece = YarnArc | YarnLoop | YarnPost;

/**
 * The yarn pieces of every stitch, in node order. `normals`: fabric normal per node (unit,
 * 3 per node, as for the surface style); `yarn`: yarn diameter used for offsets (mm).
 *
 * Works on the topology alone (code, prev, parents, span), so a stitch reads the same
 * whether an increase is one node offering two anchors or two nodes on one parent.
 */
export function stitchYarn(graph: StitchGraph, normals: Float32Array, yarn: number, emit: (piece: YarnPiece) => void): void {
  const { nodes } = graph;
  const n = nodes.length;
  if (n === 0) return;
  const F = frames(graph, normals);
  const pos = graph.positions;
  const P = (i: number): V3 => [pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!];
  const Y = yarn;

  /**
   * One stitch standing on `bottoms` (parent tops) with its top centred at `top`: the front
   * loop and legs as one closed post loop, the back loop as an arc behind it, wraps across
   * a tall post.
   */
  const stitch = (top: V3, f: Frame, bottoms: V3[], wraps: number, owner: number) => {
    const many = bottoms.length > 1;
    const tall = wraps > 0;
    const hw = (many || tall ? 0.36 : 0.42) * f.w;
    const L = at(top, f.d, -hw, f.u, -0.15 * Y, f.n, 0.3 * Y);
    const M = at(top, f.d, 0, f.u, 0.2 * Y, f.n, 0.5 * Y);
    const R = at(top, f.d, hw, f.u, -0.15 * Y, f.n, 0.3 * Y);
    const foot = (b: V3) => at(b, f.d, 0, f.u, -0.15 * Y, f.n, 0.15 * Y);
    let points: V3[];
    let feet: number[];
    let left: [V3, V3]; // [foot, top corner] of the leftmost and rightmost leg
    let right: [V3, V3];
    if (!many) {
      const B = foot(bottoms[0]!);
      if (tall) {
        // Straighter legs: a point halfway down each side.
        const Rm = at(lerp(R, B, 0.5), f.d, 0.06 * f.w, f.u, 0, f.n, 0.2 * Y);
        const Lm = at(lerp(L, B, 0.5), f.d, -0.06 * f.w, f.u, 0, f.n, 0.2 * Y);
        points = [L, M, R, Rm, B, Lm];
        feet = [4];
      } else {
        points = [L, M, R, B];
        feet = [3];
      }
      left = [B, L];
      right = [B, R];
    } else {
      // A decrease: one top, a leg into every parent (Λ); the yarn between the outer legs
      // is drawn up into a notch.
      const fs = bottoms.map(foot);
      const first = fs[0]!, last = fs[fs.length - 1]!;
      const notch = lerp(lerp(first, last, 0.5), lerp(L, R, 0.5), 0.45);
      // Going round: L, crest, R, down to the last foot, … back to the first foot, notch.
      points = [L, M, R, ...fs.slice().reverse(), notch];
      feet = fs.map((_, k) => 3 + k);
      left = [first, L];
      right = [last, R];
    }
    emit({ kind: "post", node: owner, points, feet, crest: 1, hint: f.n });
    // Back loop: behind the front loop's crest, from corner to corner.
    const bl = at(top, f.d, -0.92 * hw, f.u, -0.05 * Y, f.n, -0.15 * Y);
    const br = at(top, f.d, 0.92 * hw, f.u, -0.05 * Y, f.n, -0.15 * Y);
    emit({ kind: "top", node: owner, a: bl, c: at(top, f.d, 0, f.u, 0.3 * Y, f.n, -0.6 * Y), b: br, hint: f.u });
    for (let j = 0; j < wraps; j++) {
      // HDC: its single yarn-over sits high on the post; otherwise evenly spaced.
      const fpos = wraps === 1 && nodes[owner]!.code === "HDC" ? 0.62 : (j + 1) / (wraps + 1);
      const tilt = 0.16 / wraps;
      const pl = lerp(left[0], left[1], Math.max(0.05, fpos - tilt));
      const pr = lerp(right[0], right[1], Math.min(0.95, fpos + tilt));
      const a = at(pl, f.d, -0.1 * f.w, f.u, 0, f.n, 0.35 * Y);
      const b = at(pr, f.d, 0.1 * f.w, f.u, 0, f.n, 0.35 * Y);
      const c = at(lerp(a, b, 0.5), f.d, 0, f.u, 0, f.n, 0.8 * Y);
      emit({ kind: "wrap", node: owner, a, c, b, hint: f.u });
    }
  };

  /** Chain link (an elongated loop in the fabric plane) from `a` to `b`. */
  const link = (a: V3, b: V3, f: Frame, owner: number) => {
    const along = sub(b, a);
    const l = len(along);
    const dir = unit(along, f.d);
    const side = unit(cross(f.n, dir), f.u);
    emit({ kind: "link", node: owner, centre: lerp(a, b, 0.5), e1: mul(dir, Math.max(0.5 * l, 0.6 * Y)), e2: mul(side, 0.6 * Y) });
  };

  for (let i = 0; i < n; i++) {
    const node = nodes[i]!;
    const f = F[i]!;
    const t = P(i);
    if (node.code === "MR") {
      const rr = 0.3 * f.w + 0.5 * Y;
      emit({ kind: "ring", node: i, centre: t, e1: mul(f.d, rr), e2: mul(cross(f.n, f.d), rr) });
      continue;
    }
    if (node.code === "CH") {
      if (node.lift && node.prev !== null) {
        const q = P(node.prev);
        link(lerp(q, t, 0.08), lerp(q, t, 0.92), f, i);
      } else {
        const half = 0.42 * f.w;
        link(at(t, f.d, -half, f.u, 0, f.n, 0), at(t, f.d, half, f.u, 0, f.n, 0), f, i);
      }
      continue;
    }

    const bottoms: V3[] = node.parents.map(P);
    if (bottoms.length === 0) {
      const h = node.height > 0 ? node.height : graph.gauge.stitchHeightMm;
      bottoms.push(at(t, f.u, -h, f.d, 0, f.n, 0));
    }
    const wraps = WRAPS[node.code] ?? 0;
    const parts = Math.max(1, node.span);
    // A node that stands for two stitches (an INC offering two anchors) is drawn as two
    // stitches side by side on the same parent(s).
    for (let k = 0; k < parts; k++) {
      const top = at(t, f.d, (k - (parts - 1) / 2) * f.w, f.u, 0, f.n, 0);
      stitch(top, f, bottoms, wraps, i);
    }
  }
}

/**
 * The stitch mesh of a graph. `normals`: fabric normal per node (unit, as for the surface
 * style).
 */
export function stitchMesh(graph: StitchGraph, normals: Float32Array, opts: StitchMeshOptions = {}): StitchMeshArrays {
  const n = graph.nodes.length;
  const detail = stitchDetail(n);
  const radius = opts.radius ?? stitchYarnRadius(graph.gauge);
  const seg = Math.max(3, Math.floor(opts.radialSegments ?? detail.radialSegments));
  const samples = Math.max(2, Math.floor(opts.arcSamples ?? detail.arcSamples));
  const buf = new TubeBuffer(n * 4 * samples * seg + 64, n * 4 * (samples - 1) * seg * 6 + 64);
  const sw = new Sweeper(buf, radius, seg, samples);
  stitchYarn(graph, normals, 2 * radius, (p) => {
    if (p.kind === "post") sw.closedSpline(p.points, p.hint, p.node);
    else if ("a" in p) sw.arc(p.a, p.c, p.b, p.hint, p.node);
    else sw.loop(p.centre, p.e1, p.e2, p.node);
  });
  return buf.result();
}
