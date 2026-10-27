/**
 * Relaxation — settles the procedural layout of a stitch graph into a plausible shape.
 *
 * Position-based Verlet integration: each step carries the nodes' momentum forward
 * (damped), then projects constraints in a fixed order:
 *
 *   1. springs — every edge is pulled towards its rest length (Gauss–Seidel sweeps,
 *      alternating forward and backward so neither end of the work is favoured);
 *   2. radial stabiliser — the nodes of every closed round are nudged towards the radius
 *      their circumference implies (C / 2π), around the round's own centroid;
 *   3. stuffing — closed pieces (opened with a magic ring, ending in a small round) are
 *      inflated towards the volume of a sphere with the fabric's surface area, like a
 *      stuffed amigurumi. Unilateral: it only ever pushes outwards;
 *   4. repulsion — nodes closer than ~¾ stitch that are not directly linked push apart
 *      (spatial hash, O(n)), which keeps folded fabric from passing through itself.
 *
 * Deterministic: the only randomness is a small seeded jitter on the start positions (it
 * breaks the perfect symmetry of the layout so flat fabric can buckle if it must).
 *
 * Output pose: rounds grow along +Y (the axis through the rounds' centres), flat pieces lie
 * in the XY plane with rows growing along +Y. The piece is centred on the Y axis and rests on
 * y = 0. Units are millimetres.
 */

import type { StitchGraph } from "./graph.js";
import { createRandom } from "./random.js";

export interface RelaxOptions {
  /** Verlet steps. Default 300. Runtime is linear in iterations × nodes. */
  iterations?: number;
  /** Seed of the start-position jitter. Default 1. */
  seed?: number;
  /** Spring projection stiffness, 0–1. Default 1. */
  stiffness?: number;
  /** Fraction of velocity removed per step, 0–1. Default 0.2. */
  damping?: number;
  /** Strength of the radial stabiliser for closed rounds, 0–1. Default 0.3. */
  radial?: number;
  /** Strength of node–node repulsion, 0–1. Default 0.3. */
  repulsion?: number;
  /**
   * Stuffing, 0–1: how hard the piece is pushed towards the volume of a sphere with the
   * fabric's surface area (0 = none, 1 = firm). `"auto"` (default) uses 1 for closed pieces
   * (see `isClosedPiece`) and 0 otherwise — open pieces would only balloon.
   */
  stuffing?: number | "auto";
  /** Start jitter as a fraction of the stitch width. Default 0.02. */
  jitter?: number;
  /** Rotate/translate the result into the canonical pose (see module doc). Default true. */
  pose?: boolean;
}

/**
 * A piece is closed when it starts with a magic ring, consists only of rounds and ends in a
 * round much smaller than its widest one (the last hole is pulled shut when finishing).
 */
export function isClosedPiece(graph: StitchGraph): boolean {
  const rows = graph.rows;
  if (rows.length < 3) return false;
  if (rows[0]!.kind !== "ring") return false;
  if (!rows.every((r) => r.closed)) return false;
  const max = Math.max(...rows.map((r) => r.widthStitches));
  return rows[rows.length - 1]!.widthStitches <= Math.max(8, 0.35 * max);
}

/**
 * Relax a graph. Returns a new graph (same topology, `positions` replaced, `relaxed: true`);
 * the input is not modified.
 */
export function relax(graph: StitchGraph, opts: RelaxOptions = {}): StitchGraph {
  const n = graph.nodes.length;
  if (n === 0) return { ...graph, positions: new Float64Array(0), relaxed: true };

  const iterations = Math.max(0, Math.floor(opts.iterations ?? 300));
  const stiffness = clamp01(opts.stiffness ?? 1);
  const keep = 1 - clamp01(opts.damping ?? 0.2);
  const radialK = clamp01(opts.radial ?? 0.3);
  const repulsionK = clamp01(opts.repulsion ?? 0.3);
  const closed = isClosedPiece(graph);
  const stuffing = opts.stuffing === undefined || opts.stuffing === "auto" ? (closed ? 1 : 0) : clamp01(opts.stuffing);
  const w = graph.gauge.stitchWidthMm;
  const h = graph.gauge.stitchHeightMm;

  // Start positions with seeded jitter.
  const rand = createRandom(opts.seed ?? 1);
  const amp = (opts.jitter ?? 0.02) * w;
  const pos = Float64Array.from(graph.positions);
  for (let i = 0; i < pos.length; i++) pos[i] = pos[i]! + (rand() * 2 - 1) * amp;
  const old = Float64Array.from(pos);

  // Springs as typed arrays.
  const m = graph.edges.length;
  const ea = new Uint32Array(m);
  const eb = new Uint32Array(m);
  const er = new Float64Array(m);
  graph.edges.forEach((e, i) => {
    ea[i] = e.a;
    eb[i] = e.b;
    er[i] = e.restLength;
  });

  // Adjacency (CSR) so repulsion skips directly linked nodes.
  const deg = new Uint32Array(n + 1);
  for (let i = 0; i < m; i++) {
    deg[ea[i]! + 1]!++;
    deg[eb[i]! + 1]!++;
  }
  for (let i = 0; i < n; i++) deg[i + 1] = deg[i + 1]! + deg[i]!;
  const adj = new Uint32Array(deg[n]!);
  const fill = deg.slice(0, n);
  for (let i = 0; i < m; i++) {
    adj[fill[ea[i]!]!++] = eb[i]!;
    adj[fill[eb[i]!]!++] = ea[i]!;
  }

  // Rounds for the radial stabiliser: ring nodes (no MR, no lift chains) and target radius.
  const rings = graph.rows
    .filter((r) => r.closed)
    .map((r) => {
      const ids: number[] = [];
      for (let id = r.firstNode; id < r.firstNode + r.nodeCount; id++) {
        const node = graph.nodes[id]!;
        if (!node.lift && node.code !== "MR") ids.push(id);
      }
      return { ids: Uint32Array.from(ids), radius: (r.widthStitches * w) / (2 * Math.PI) };
    })
    .filter((r) => r.ids.length >= 3);

  // Surface for stuffing: fabric triangles plus a fan over the last round's hole.
  let tris = graph.triangles;
  let targetVolume = 0;
  let volumeSign = 1;
  if (stuffing > 0) {
    const last = rings[rings.length - 1];
    if (last && last.ids.length >= 3) {
      const cap: number[] = [];
      const flip = graph.rows[graph.rows.length - 1]!.direction === -1;
      for (let i = 1; i + 1 < last.ids.length; i++) {
        const a = last.ids[0]!;
        const b = last.ids[i]!;
        const c = last.ids[i + 1]!;
        if (flip) cap.push(a, c, b);
        else cap.push(a, b, c);
      }
      const merged = new Uint32Array(tris.length + cap.length);
      merged.set(tris);
      merged.set(cap, tris.length);
      tris = merged;
    }
    let area = 0;
    for (const node of graph.nodes) if (node.parents.length > 0) area += node.span * w * (node.height || h);
    targetVolume = stuffing * (area ** 1.5 / (6 * Math.sqrt(Math.PI)));
    volumeSign = signedVolume(pos, tris) < 0 ? -1 : 1;
  }
  const grad = stuffing > 0 ? new Float64Array(3 * n) : null;

  // Repulsion grid.
  const r0 = 0.75 * Math.min(w, h);
  const hash = new SpatialHash(n, r0);

  for (let it = 0; it < iterations; it++) {
    // 1. Verlet step (no external forces: motion comes from constraint corrections).
    for (let i = 0; i < pos.length; i++) {
      const p = pos[i]!;
      const v = (p - old[i]!) * keep;
      old[i] = p;
      pos[i] = p + v;
    }

    // 2. Springs.
    for (let pass = 0; pass < 2; pass++) {
      const forward = pass === 0;
      for (let k = 0; k < m; k++) {
        const e = forward ? k : m - 1 - k;
        const a = 3 * ea[e]!;
        const b = 3 * eb[e]!;
        const dx = pos[b]! - pos[a]!;
        const dy = pos[b + 1]! - pos[a + 1]!;
        const dz = pos[b + 2]! - pos[a + 2]!;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-9) continue;
        const s = (0.5 * stiffness * (len - er[e]!)) / len;
        pos[a] = pos[a]! + dx * s;
        pos[a + 1] = pos[a + 1]! + dy * s;
        pos[a + 2] = pos[a + 2]! + dz * s;
        pos[b] = pos[b]! - dx * s;
        pos[b + 1] = pos[b + 1]! - dy * s;
        pos[b + 2] = pos[b + 2]! - dz * s;
      }
    }

    // 3. Radial stabiliser.
    if (radialK > 0) {
      for (const ring of rings) {
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (const id of ring.ids) {
          cx += pos[3 * id]!;
          cy += pos[3 * id + 1]!;
          cz += pos[3 * id + 2]!;
        }
        const k = ring.ids.length;
        cx /= k;
        cy /= k;
        cz /= k;
        for (const id of ring.ids) {
          const dx = pos[3 * id]! - cx;
          const dy = pos[3 * id + 1]! - cy;
          const dz = pos[3 * id + 2]! - cz;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < 1e-9) continue;
          const s = (radialK * (ring.radius - d)) / d;
          pos[3 * id] = pos[3 * id]! + dx * s;
          pos[3 * id + 1] = pos[3 * id + 1]! + dy * s;
          pos[3 * id + 2] = pos[3 * id + 2]! + dz * s;
        }
      }
    }

    // 4. Stuffing (unilateral volume constraint).
    if (grad && tris.length > 0) {
      const volume = volumeSign * volumeGradient(pos, tris, grad);
      const deficit = targetVolume - volume;
      if (deficit > 0) {
        let denom = 0;
        for (let i = 0; i < grad.length; i++) denom += grad[i]! * grad[i]!;
        if (denom > 1e-12) {
          const lambda = (STUFFING_STEP * stuffing * deficit * volumeSign) / denom;
          for (let i = 0; i < grad.length; i++) pos[i] = pos[i]! + lambda * grad[i]!;
        }
      }
    }

    // 5. Repulsion (every other step is enough and halves its cost).
    if (repulsionK > 0 && (it & 1) === 0) {
      hash.build(pos);
      hash.forPairs(pos, r0, (i, j, dx, dy, dz, d) => {
        for (let k = deg[i]!; k < deg[i + 1]!; k++) if (adj[k] === j) return;
        const s = (0.5 * repulsionK * (r0 - d)) / Math.max(d, 1e-6);
        pos[3 * i] = pos[3 * i]! - dx * s;
        pos[3 * i + 1] = pos[3 * i + 1]! - dy * s;
        pos[3 * i + 2] = pos[3 * i + 2]! - dz * s;
        pos[3 * j] = pos[3 * j]! + dx * s;
        pos[3 * j + 1] = pos[3 * j + 1]! + dy * s;
        pos[3 * j + 2] = pos[3 * j + 2]! + dz * s;
      });
    }
  }

  const relaxed = { ...graph, positions: pos, relaxed: true };
  if (opts.pose ?? true) canonicalPose(relaxed);
  return relaxed;
}

/** Fraction of the volume deficit the stuffing step corrects per iteration at stuffing 1. */
const STUFFING_STEP = 0.3;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Signed volume enclosed by the triangles (divergence theorem). */
export function signedVolume(pos: Float64Array, tris: Uint32Array): number {
  let v = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = 3 * tris[t]!;
    const b = 3 * tris[t + 1]!;
    const c = 3 * tris[t + 2]!;
    v +=
      pos[a]! * (pos[b + 1]! * pos[c + 2]! - pos[b + 2]! * pos[c + 1]!) +
      pos[a + 1]! * (pos[b + 2]! * pos[c]! - pos[b]! * pos[c + 2]!) +
      pos[a + 2]! * (pos[b]! * pos[c + 1]! - pos[b + 1]! * pos[c]!);
  }
  return v / 6;
}

/** Volume and its gradient with respect to every node position (written into `grad`). */
function volumeGradient(pos: Float64Array, tris: Uint32Array, grad: Float64Array): number {
  grad.fill(0);
  let v = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = 3 * tris[t]!;
    const b = 3 * tris[t + 1]!;
    const c = 3 * tris[t + 2]!;
    const ax = pos[a]!, ay = pos[a + 1]!, az = pos[a + 2]!;
    const bx = pos[b]!, by = pos[b + 1]!, bz = pos[b + 2]!;
    const cx = pos[c]!, cy = pos[c + 1]!, cz = pos[c + 2]!;
    // ∂V/∂a = (b × c)/6, ∂V/∂b = (c × a)/6, ∂V/∂c = (a × b)/6
    const bcx = by * cz - bz * cy, bcy = bz * cx - bx * cz, bcz = bx * cy - by * cx;
    const cax = cy * az - cz * ay, cay = cz * ax - cx * az, caz = cx * ay - cy * ax;
    const abx = ay * bz - az * by, aby = az * bx - ax * bz, abz = ax * by - ay * bx;
    v += ax * bcx + ay * bcy + az * bcz;
    grad[a] = grad[a]! + bcx / 6;
    grad[a + 1] = grad[a + 1]! + bcy / 6;
    grad[a + 2] = grad[a + 2]! + bcz / 6;
    grad[b] = grad[b]! + cax / 6;
    grad[b + 1] = grad[b + 1]! + cay / 6;
    grad[b + 2] = grad[b + 2]! + caz / 6;
    grad[c] = grad[c]! + abx / 6;
    grad[c + 1] = grad[c + 1]! + aby / 6;
    grad[c + 2] = grad[c + 2]! + abz / 6;
  }
  return v / 6;
}

/**
 * Dense spatial hash (counting sort into a fixed table): build O(n), neighbour query over the
 * 27 surrounding cells. Hash collisions only cost time, never correctness.
 */
class SpatialHash {
  private readonly size: number;
  private readonly mask: number;
  private readonly inv: number;
  private readonly start: Int32Array;
  private readonly entries: Int32Array;
  private readonly cellOf: Int32Array;

  constructor(
    private readonly n: number,
    cell: number,
  ) {
    let size = 16;
    while (size < 2 * n) size *= 2;
    this.size = size;
    this.mask = size - 1;
    this.inv = 1 / cell;
    this.start = new Int32Array(this.size + 1);
    this.entries = new Int32Array(n);
    this.cellOf = new Int32Array(n);
  }

  private key(xi: number, yi: number, zi: number): number {
    const hsh = Math.imul(xi, 92837111) ^ Math.imul(yi, 689287499) ^ Math.imul(zi, 283923481);
    return hsh & this.mask;
  }

  build(pos: Float64Array): void {
    this.start.fill(0);
    for (let i = 0; i < this.n; i++) {
      const k = this.key(
        Math.floor(pos[3 * i]! * this.inv),
        Math.floor(pos[3 * i + 1]! * this.inv),
        Math.floor(pos[3 * i + 2]! * this.inv),
      );
      this.cellOf[i] = k;
      this.start[k]!++;
    }
    let sum = 0;
    for (let k = 0; k < this.size; k++) {
      sum += this.start[k]!;
      this.start[k] = sum;
    }
    this.start[this.size] = sum;
    for (let i = 0; i < this.n; i++) this.entries[--this.start[this.cellOf[i]!]!] = i;
  }

  /** Calls `fn(i, j, dx, dy, dz, d)` for each pair i < j closer than `radius` (d = |pj − pi|). */
  forPairs(
    pos: Float64Array,
    radius: number,
    fn: (i: number, j: number, dx: number, dy: number, dz: number, d: number) => void,
  ): void {
    const r2 = radius * radius;
    for (let i = 0; i < this.n; i++) {
      const px = pos[3 * i]!;
      const py = pos[3 * i + 1]!;
      const pz = pos[3 * i + 2]!;
      const xi = Math.floor(px * this.inv);
      const yi = Math.floor(py * this.inv);
      const zi = Math.floor(pz * this.inv);
      // Two of the 27 cells may share a bucket; the pair is then visited twice, which only
      // doubles a tiny push and stays deterministic — cheaper than de-duplicating buckets.
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++)
          for (let oz = -1; oz <= 1; oz++) {
            const k = this.key(xi + ox, yi + oy, zi + oz);
            for (let e = this.start[k]!; e < this.start[k + 1]!; e++) {
              const j = this.entries[e]!;
              if (j <= i) continue;
              const dx = pos[3 * j]! - px;
              const dy = pos[3 * j + 1]! - py;
              const dz = pos[3 * j + 2]! - pz;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < r2) fn(i, j, dx, dy, dz, Math.sqrt(d2));
            }
          }
    }
  }
}

// ---------------------------------------------------------------------------
// Canonical pose
// ---------------------------------------------------------------------------

/**
 * Rotate and translate positions in place: round axis (sum of the closed rounds' oriented
 * normals) → +Y; for flat pieces the fabric normal → +Z and row growth → +Y. Then centre on
 * the Y axis and put the lowest point on y = 0.
 */
export function canonicalPose(graph: StitchGraph): void {
  const pos = graph.positions;
  const n = graph.nodes.length;
  if (n === 0) return;

  const closedRows = graph.rows.filter((r) => r.closed);
  if (closedRows.length > 0) {
    let ax = 0, ay = 0, az = 0;
    for (const r of closedRows) {
      const ids: number[] = [];
      for (let id = r.firstNode; id < r.firstNode + r.nodeCount; id++) {
        const node = graph.nodes[id]!;
        if (!node.lift && node.code !== "MR") ids.push(id);
      }
      const nrm = newellNormal(pos, ids);
      // The layout winds rounds so that their Newell normal points along the growth axis.
      ax += nrm[0];
      ay += nrm[1];
      az += nrm[2];
    }
    rotateInto(pos, [ax, ay, az], [0, 1, 0]);
  } else if (graph.triangles.length > 0) {
    const t = graph.triangles;
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < t.length; k += 3) {
      const c = triNormal(pos, t[k]!, t[k + 1]!, t[k + 2]!);
      nx += c[0];
      ny += c[1];
      nz += c[2];
    }
    rotateInto(pos, [nx, ny, nz], [0, 0, 1]);
    const first = graph.rows[0]!;
    const last = graph.rows[graph.rows.length - 1]!;
    const c0 = centroid(pos, first.firstNode, first.nodeCount);
    const c1 = centroid(pos, last.firstNode, last.nodeCount);
    const gx = c1[0] - c0[0];
    const gy = c1[1] - c0[1];
    if (gx * gx + gy * gy > 1e-12) {
      // Rotate about Z so that growth points along +Y.
      const ang = Math.atan2(gx, gy);
      const cs = Math.cos(ang), sn = Math.sin(ang);
      for (let i = 0; i < n; i++) {
        const x = pos[3 * i]!, y = pos[3 * i + 1]!;
        pos[3 * i] = cs * x - sn * y;
        pos[3 * i + 1] = sn * x + cs * y;
      }
    }
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, pos[3 * i]!);
    maxX = Math.max(maxX, pos[3 * i]!);
    minY = Math.min(minY, pos[3 * i + 1]!);
    minZ = Math.min(minZ, pos[3 * i + 2]!);
    maxZ = Math.max(maxZ, pos[3 * i + 2]!);
  }
  const ox = (minX + maxX) / 2, oz = (minZ + maxZ) / 2;
  for (let i = 0; i < n; i++) {
    pos[3 * i] = pos[3 * i]! - ox;
    pos[3 * i + 1] = pos[3 * i + 1]! - minY;
    pos[3 * i + 2] = pos[3 * i + 2]! - oz;
  }
}

/** Newell's method: area-weighted normal of a (non-planar) closed polygon. */
export function newellNormal(pos: Float64Array, ids: readonly number[]): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < ids.length; k++) {
    const a = 3 * ids[k]!;
    const b = 3 * ids[(k + 1) % ids.length]!;
    x += (pos[a + 1]! - pos[b + 1]!) * (pos[a + 2]! + pos[b + 2]!);
    y += (pos[a + 2]! - pos[b + 2]!) * (pos[a]! + pos[b]!);
    z += (pos[a]! - pos[b]!) * (pos[a + 1]! + pos[b + 1]!);
  }
  return [x, y, z];
}

function triNormal(pos: Float64Array, i: number, j: number, k: number): [number, number, number] {
  const a = 3 * i, b = 3 * j, c = 3 * k;
  const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
  const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function centroid(pos: Float64Array, first: number, count: number): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (let i = first; i < first + count; i++) {
    x += pos[3 * i]!;
    y += pos[3 * i + 1]!;
    z += pos[3 * i + 2]!;
  }
  return count > 0 ? [x / count, y / count, z / count] : [0, 0, 0];
}

/** Rotate all positions by the minimal rotation taking direction `from` onto `to` (unit). */
function rotateInto(pos: Float64Array, from: [number, number, number], to: [number, number, number]): void {
  const len = Math.hypot(from[0], from[1], from[2]);
  if (len < 1e-12) return;
  const f = [from[0] / len, from[1] / len, from[2] / len] as const;
  const c = f[0] * to[0] + f[1] * to[1] + f[2] * to[2];
  let kx = f[1] * to[2] - f[2] * to[1];
  let ky = f[2] * to[0] - f[0] * to[2];
  let kz = f[0] * to[1] - f[1] * to[0];
  let s = Math.hypot(kx, ky, kz);
  const ang = Math.atan2(s, c);
  if (s < 1e-9) {
    if (c > 0) return; // already aligned
    // Opposite: rotate 180° about any axis perpendicular to `to`.
    const alt = Math.abs(to[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    kx = alt[1]! * to[2] - alt[2]! * to[1];
    ky = alt[2]! * to[0] - alt[0]! * to[2];
    kz = alt[0]! * to[1] - alt[1]! * to[0];
    s = Math.hypot(kx, ky, kz);
  }
  kx /= s;
  ky /= s;
  kz /= s;
  const cs = Math.cos(ang), sn = Math.sin(ang), t = 1 - cs;
  // Rodrigues rotation matrix.
  const m00 = cs + kx * kx * t, m01 = kx * ky * t - kz * sn, m02 = kx * kz * t + ky * sn;
  const m10 = ky * kx * t + kz * sn, m11 = cs + ky * ky * t, m12 = ky * kz * t - kx * sn;
  const m20 = kz * kx * t - ky * sn, m21 = kz * ky * t + kx * sn, m22 = cs + kz * kz * t;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
    pos[i] = m00 * x + m01 * y + m02 * z;
    pos[i + 1] = m10 * x + m11 * y + m12 * z;
    pos[i + 2] = m20 * x + m21 * y + m22 * z;
  }
}
