/**
 * Relaxation — settles the procedural layout of a stitch graph into a plausible shape.
 *
 * The solver works on a particle model of the fabric, finer than the graph:
 *
 *   - one particle per fabric stitch: an `INC` node (two stitches on one parent) becomes two
 *     particles a stitch width apart, each worked into the same parent; the node's output
 *     position is their midpoint. Every other node is one particle. So every round is a ring
 *     of evenly sized stitches instead of a ring with six double-wide lumps;
 *   - a pole particle that closes the last round of a closed piece (the hole pulled shut when
 *     finishing), mirroring the magic ring at the other end. It is not part of the output.
 *
 * Position-based Verlet integration: each step carries the particles' momentum forward
 * (damped), then projects constraints in a fixed order:
 *
 *   1. springs — Gauss–Seidel sweeps, alternating forward and backward so neither end of the
 *      work is favoured:
 *        - the yarn path (`prev`), the vertical links to the parent stitches (to the very
 *          slot of `parentSlots`, slanted legs leaning by `LEG_LEAN`), and the seam of every
 *          closed round (its last stitch sits next to its first — the spiral's yarn path
 *          alone leaves that seam open);
 *        - bending: springs between second neighbours along each row whose rest length is
 *          the chord of the row's own circle (2·w·cos(π/S) for a round of S stitches, 2·w for
 *          a flat row). Real fabric resists sharp kinks; without this a stuffed piece pillows
 *          between its stitches and its flat increase discs stay flat;
 *   2. radial start-up stabiliser — the particles of every closed round are nudged towards
 *      the radius their circumference implies (C / 2π), around the round's own centroid. It
 *      fades out linearly over the first half of the iterations, so the final shape is
 *      decided by the springs, the stuffing and the repulsion alone;
 *   3. stuffing — closed pieces (opened with a magic ring, ending in a small round) are
 *      inflated like a stuffed amigurumi: a uniform pressure moves every particle along the
 *      volume gradient (the area-weighted surface normal). The pressure is integral-
 *      controlled on the fabric's mean stretch — it rises until the stitches are stretched
 *      by `STUFFED_STRAIN` on average — so a ball and a long sausage end up equally firm
 *      instead of the sausage being blown up. Unilateral: it only ever pushes outwards;
 *   4. repulsion — particles closer than ~¾ stitch that are not directly linked push apart
 *      (spatial hash, O(n)), which keeps folded fabric from passing through itself.
 *
 * Deterministic: the only randomness is a small seeded jitter on the start positions (it
 * breaks the perfect symmetry of the layout so flat fabric can buckle if it must).
 *
 * Output pose: rounds grow along +Y (the axis through the rounds' centres), flat pieces lie
 * in the XY plane with the working direction of the rows along X and rows growing along +Y.
 * The piece is centred on the Y axis and rests on y = 0. Units are millimetres.
 *
 * What the shape depends on: the gauge's stitch height relative to its width. The classic
 * flat-circle rule (6 increases per round lie flat) holds for 2π·h ≈ 6·w; the engine's
 * default yarn table has square stitches (2π·h/w ≈ 6.3), so six increases lie flat or cup
 * very slightly, never ruffle. The 8-round sphere of
 * docs/FORMAT.md (one even round) still comes out as a flattened ball — its pole-to-pole path
 * is barely longer than its equator radius. That is the fabric's geometry, not a solver
 * artefact; the classic ball with four even rounds is round.
 */

import { LEG_LEAN, type StitchGraph } from "./graph.js";
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
  /**
   * Start-up strength of the radial stabiliser for closed rounds, 0–1. Default 0.3. Fades
   * linearly to zero over the first half of the iterations.
   */
  radial?: number;
  /** Strength of node–node repulsion, 0–1. Default 0.3. */
  repulsion?: number;
  /**
   * Bending stiffness of the fabric along its rows, 0–1 (relative to the stretch springs).
   * Default 1. 0 gives a limp net that pillows between stitches when stuffed.
   */
  bending?: number;
  /**
   * Stuffing, 0–1: how firmly the piece is stuffed (0 = none, 1 = firm: the stitches end up
   * stretched by about 8 % on average). `"auto"` (default) uses 1 for closed pieces (see
   * `isClosedPiece`) and 0 otherwise — open pieces would only balloon.
   */
  stuffing?: number | "auto";
  /** Start jitter as a fraction of the stitch width. Default 0.02. */
  jitter?: number;
  /** Rotate/translate the result into the canonical pose (see module doc). Default true. */
  pose?: boolean;
  /**
   * Override whether the piece is closed (last round pulled shut, stuffed). Default:
   * `isClosedPiece`.
   * Use it for a piece the heuristic gets wrong, e.g. an open tube that narrows at the end.
   */
  closed?: boolean;
}

/**
 * A piece is closed when it starts with a magic ring, consists only of rounds and is
 * decreased at the end: its last round has less than half the stitches of its widest one
 * (the last hole is pulled shut when finishing). A straight tube — an arm, say — is open.
 */
export function isClosedPiece(graph: StitchGraph): boolean {
  const rows = graph.rows;
  if (rows.length < 3) return false;
  if (rows[0]!.kind !== "ring") return false;
  if (!rows.every((r) => r.closed)) return false;
  const max = Math.max(...rows.map((r) => r.widthStitches));
  return rows[rows.length - 1]!.widthStitches < 0.5 * max;
}

/**
 * Relax a graph. Returns a new graph (same topology, `positions` replaced, `relaxed: true`);
 * the input is not modified.
 */
export function relax(graph: StitchGraph, opts: RelaxOptions = {}): StitchGraph {
  const n = graph.nodes.length;
  if (n === 0) return { ...graph, positions: new Float64Array(0), relaxed: true };

  const iterations = Math.max(0, Math.floor(num(opts.iterations, 300)));
  const stiffness = clamp01(num(opts.stiffness, 1));
  const keep = 1 - clamp01(num(opts.damping, 0.2));
  const radialK = clamp01(num(opts.radial, 0.3));
  const repulsionK = clamp01(num(opts.repulsion, 0.3));
  const bendingK = clamp01(num(opts.bending, 1));
  const closed = typeof opts.closed === "boolean" ? opts.closed : isClosedPiece(graph);
  const stuffing =
    opts.stuffing === undefined || opts.stuffing === "auto" ? (closed ? 1 : 0) : clamp01(num(opts.stuffing, 0));
  const w = graph.gauge.stitchWidthMm;
  const h = graph.gauge.stitchHeightMm;

  const model = buildParticles(graph, closed, bendingK);
  const P = model.count;

  // Start positions with seeded jitter (graph nodes first, so a seed jitters them as before).
  const rand = createRandom(num(opts.seed, 1));
  const amp = Math.max(0, num(opts.jitter, 0.02)) * w;
  const pos = model.pos;
  for (let i = 0; i < pos.length; i++) pos[i] = pos[i]! + (rand() * 2 - 1) * amp;
  const old = Float64Array.from(pos);

  const { ea, eb, er, ek, es } = model;
  const m = er.length;
  const half = 0.5 * stiffness;

  // Adjacency (CSR) so repulsion skips directly linked particles.
  const deg = new Uint32Array(P + 1);
  for (let i = 0; i < m; i++) {
    deg[ea[i]! + 1]!++;
    deg[eb[i]! + 1]!++;
  }
  for (let i = 0; i < P; i++) deg[i + 1] = deg[i + 1]! + deg[i]!;
  const adj = new Uint32Array(deg[P]!);
  const fill = deg.slice(0, P);
  for (let i = 0; i < m; i++) {
    adj[fill[ea[i]!]!++] = eb[i]!;
    adj[fill[eb[i]!]!++] = ea[i]!;
  }

  const rings = model.rings;

  // Stuffing: a pressure on the surface (fabric triangles plus the pole's cap) that rises
  // until the fabric is stretched by the target strain on average.
  const tris = model.tris;
  const grad = stuffing > 0 && tris.length > 0 ? new Float64Array(3 * P) : null;
  const volumeSign = grad && signedVolume(pos, tris) < 0 ? -1 : 1;
  const targetStrain = stuffing * STUFFED_STRAIN;
  let pressure = 0; // outward step per iteration, in stitch widths
  let strainSum = 0;
  let strainCount = 0;

  // Repulsion grid.
  const r0 = 0.75 * Math.min(w, h);
  const hash = new SpatialHash(P, r0);

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
        if (!forward && es[e] === 1) {
          strainSum += (len - er[e]!) / er[e]!;
          strainCount++;
        }
        const s = (half * ek[e]! * (len - er[e]!)) / len;
        pos[a] = pos[a]! + dx * s;
        pos[a + 1] = pos[a + 1]! + dy * s;
        pos[a + 2] = pos[a + 2]! + dz * s;
        pos[b] = pos[b]! - dx * s;
        pos[b + 1] = pos[b + 1]! - dy * s;
        pos[b + 2] = pos[b + 2]! - dz * s;
      }
    }

    // 3. Radial start-up stabiliser, fading out over the first half.
    const rk = radialK * Math.max(0, 1 - (2 * it) / Math.max(1, iterations));
    if (rk > 0) {
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
          const s = (rk * (ring.radius - d)) / d;
          pos[3 * id] = pos[3 * id]! + dx * s;
          pos[3 * id + 1] = pos[3 * id + 1]! + dy * s;
          pos[3 * id + 2] = pos[3 * id + 2]! + dz * s;
        }
      }
    }

    // 4. Stuffing: integral control of the pressure on the mean stretch of the fabric, so a
    //    ball and a long sausage end up equally firm. Unilateral: it only ever pushes out.
    const meanStrain = strainCount > 0 ? strainSum / strainCount : 0;
    strainSum = 0;
    strainCount = 0;
    if (grad) {
      pressure = Math.min(MAX_PRESSURE, Math.max(0, pressure + PRESSURE_GAIN * (targetStrain - meanStrain)));
      if (pressure > 0) {
        // The volume gradient is the area-weighted outward normal: a uniform pressure.
        volumeGradient(pos, tris, grad);
        let sum = 0;
        let count = 0;
        for (let i = 0; i < P; i++) {
          const g = Math.hypot(grad[3 * i]!, grad[3 * i + 1]!, grad[3 * i + 2]!);
          if (g > 0) {
            sum += g;
            count++;
          }
        }
        if (sum > 1e-12) {
          const scale = (pressure * w * volumeSign * count) / sum;
          for (let i = 0; i < grad.length; i++) pos[i] = pos[i]! + scale * grad[i]!;
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

  // Back to one position per node: the mean of its particles.
  const out = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    const first = model.extraStart[i]!;
    const extra = model.extraCount[i]!;
    for (let k = 0; k < 3; k++) {
      let s = pos[3 * i + k]!;
      for (let e = 0; e < extra; e++) s += pos[3 * (first + e) + k]!;
      out[3 * i + k] = s / (extra + 1);
    }
  }

  const relaxed = { ...graph, positions: out, relaxed: true };
  if (opts.pose ?? true) canonicalPose(relaxed);
  return relaxed;
}

/**
 * Mean stretch of the fabric's stitches in a piece stuffed firmly (stuffing 1). Firm
 * amigurumi stuffing visibly stretches the fabric; 8 % rounds the flat increase and decrease
 * discs of a ball into a sphere without blowing a long piece up.
 */
const STUFFED_STRAIN = 0.08;
/** How fast the stuffing pressure follows the stretch error (stitch widths per step per 100 %). */
const PRESSURE_GAIN = 0.05;
/** Upper bound of the stuffing pressure (stitch widths per step), against runaway inflation. */
const MAX_PRESSURE = 0.5;

// ---------------------------------------------------------------------------
// Particle model
// ---------------------------------------------------------------------------

interface Particles {
  /** Number of particles: graph nodes first (particle i = node i), then extras, then the pole. */
  count: number;
  /** Start positions (procedural layout), 3 per particle. */
  pos: Float64Array;
  /** Per node: index of its first extra particle (an INC's second stitch). */
  extraStart: Int32Array;
  /** Per node: number of extra particles (0 for all but multi-stitch nodes). */
  extraCount: Int32Array;
  /** Springs: endpoints, rest length (mm), relative stiffness (0–1), fabric flag. */
  ea: Uint32Array;
  eb: Uint32Array;
  er: Float64Array;
  ek: Float64Array;
  /** 1 for the fabric's own links (yarn path, vertical links, seams), 0 for bending and pole. */
  es: Uint8Array;
  /** Closed rounds: their fabric particles in working order and the radius C / 2π. */
  rings: Array<{ ids: Uint32Array; radius: number }>;
  /** Surface triangles over particles (closed pieces include the pole's cap). */
  tris: Uint32Array;
}

/** Relative stiffness of the pole springs that pull the last round shut. */
const POLE_STIFFNESS = 0.5;

/**
 * Build the particle model of a graph: particles, springs, closed rings and the surface.
 * See the module doc for what it models and why.
 */
function buildParticles(graph: StitchGraph, closed: boolean, bendingK: number): Particles {
  const nodes = graph.nodes;
  const n = nodes.length;
  const w = graph.gauge.stitchWidthMm;
  const h = graph.gauge.stitchHeightMm;
  const src = graph.positions;

  // Particles per node: a multi-stitch node (INC) gets one particle per fabric stitch.
  const extraStart = new Int32Array(n);
  const extraCount = new Int32Array(n);
  let count = n;
  for (let i = 0; i < n; i++) {
    const node = nodes[i]!;
    const parts = !node.lift && node.code !== "MR" && node.span > 1 ? Math.round(node.span) : 1;
    extraStart[i] = count;
    extraCount[i] = parts - 1;
    count += parts - 1;
  }
  /** Particle `k` (0-based, clamped) of node `i`. */
  const part = (i: number, k: number): number => {
    const e = extraCount[i]!;
    const kk = Math.min(e, Math.max(0, Math.floor(k)));
    return kk === 0 ? i : extraStart[i]! + kk - 1;
  };
  const partsOf = (i: number): number[] => {
    const out = [i];
    for (let k = 0; k < extraCount[i]!; k++) out.push(extraStart[i]! + k);
    return out;
  };

  // Graph rows by the document row index their nodes carry (instruction rows have no graph row).
  const graphRowOf = new Map(graph.rows.map((r, i) => [r.rowIndex, i]));

  // Fabric particles of every row (no lifts, no MR), in working order.
  const fabric = graph.rows.map((r) => {
    const ids: number[] = [];
    for (let id = r.firstNode; id < r.firstNode + r.nodeCount; id++) {
      const node = nodes[id]!;
      if (!node.lift && node.code !== "MR") ids.push(...partsOf(id));
    }
    return ids;
  });
  const lastRing = closed ? fabric[fabric.length - 1] : undefined;
  const pole = lastRing && lastRing.length >= 3 && graph.rows[graph.rows.length - 1]!.closed ? count++ : -1;

  // Start positions: nodes as laid out; the stitches of a multi-stitch node spread along the
  // row around the node's position; the pole just beyond the last round's centre.
  const pos = new Float64Array(3 * count);
  pos.set(src.subarray(0, 3 * n));
  for (let i = 0; i < n; i++) {
    const e = extraCount[i]!;
    if (e === 0) continue;
    const a = i > 0 && nodes[i - 1]!.rowIndex === nodes[i]!.rowIndex ? i - 1 : i;
    const b = i + 1 < n && nodes[i + 1]!.rowIndex === nodes[i]!.rowIndex ? i + 1 : i;
    let tx = src[3 * b]! - src[3 * a]!;
    let ty = src[3 * b + 1]! - src[3 * a + 1]!;
    let tz = src[3 * b + 2]! - src[3 * a + 2]!;
    const tl = Math.hypot(tx, ty, tz);
    if (tl < 1e-9) {
      tx = 1;
      ty = 0;
      tz = 0;
    } else {
      tx /= tl;
      ty /= tl;
      tz /= tl;
    }
    for (let k = 0; k <= e; k++) {
      const p = part(i, k);
      const o = (k - e / 2) * w;
      pos[3 * p] = src[3 * i]! + o * tx;
      pos[3 * p + 1] = src[3 * i + 1]! + o * ty;
      pos[3 * p + 2] = src[3 * i + 2]! + o * tz;
    }
  }

  // Springs.
  const ea: number[] = [];
  const eb: number[] = [];
  const er: number[] = [];
  const ek: number[] = [];
  const es: number[] = [];
  const seen = new Set<number>();
  /** `fabric`: a stitch-to-stitch link of the fabric itself (its stretch is the stuffing's gauge). */
  const spring = (a: number, b: number, rest: number, k: number, fabric = true) => {
    if (a === b) return;
    const key = a < b ? a * count + b : b * count + a;
    if (seen.has(key)) return;
    seen.add(key);
    ea.push(a);
    eb.push(b);
    er.push(rest);
    ek.push(k);
    es.push(fabric ? 1 : 0);
  };

  // The stitches of a multi-stitch node sit side by side.
  for (let i = 0; i < n; i++) for (let k = 0; k < extraCount[i]!; k++) spring(part(i, k), part(i, k + 1), w, 1);

  // Vertical links (dominate the shape, so they come first). With `parentSlots` each fabric
  // stitch is linked to the very slot particle(s) it was worked into.
  const parentsOfPart = new Map<number, number[]>();
  for (const node of nodes) {
    const slots = node.parentSlots;
    const hc = node.height > 0 ? node.height : h;
    if (slots && slots.length > 0) {
      const mine = partsOf(node.id);
      const m = slots.length;
      mine.forEach((c, i) => {
        const list: number[] = [];
        slots.forEach((s, j) => {
          const q = part(s.node, s.slot);
          const dx = LEG_LEAN * (i - (mine.length - 1) / 2 - (j - (m - 1) / 2)) * w;
          // Into the magic ring: the first round needs at least its own polygon's radius,
          // else the ring pulls it in and its stitches buckle out of the plane.
          const ringRadius =
            nodes[s.node]!.code === "MR" ? w / (2 * Math.sin(Math.PI / Math.max(3, fabric[graphRowOf.get(node.rowIndex)!]!.length))) : 0;
          spring(q, c, Math.max(ringRadius, Math.sqrt(hc * hc + dx * dx)), 1);
          if (!list.includes(q)) list.push(q);
        });
        parentsOfPart.set(c, list);
      });
    }
  }
  for (const e of graph.edges) {
    if (e.kind !== "parent" || nodes[e.b]!.parentSlots) continue;
    // A graph without slot information: link the first particles, as the graph does.
    spring(e.a, e.b, e.restLength, 1);
    const list = parentsOfPart.get(e.b) ?? [];
    list.push(e.a);
    parentsOfPart.set(e.b, list);
  }

  // Yarn path: from the last stitch of a node to the first stitch of the next.
  for (const e of graph.edges) {
    if (e.kind !== "prev") continue;
    const A = nodes[e.a]!;
    const B = nodes[e.b]!;
    // The step from one round into the next: in the piece the yarn there only carries
    // tension, and the stitch is held by its parent and the round's seam. As a spring at the
    // procedural layout's distance it shears the seam and warps flat discs into a saddle.
    if (A.rowIndex !== B.rowIndex && !A.lift && !B.lift && graph.rows[graphRowOf.get(A.rowIndex)!]!.closed && graph.rows[graphRowOf.get(B.rowIndex)!]!.closed) {
      continue;
    }
    let rest = e.restLength;
    if (!A.lift && !B.lift && A.rowIndex === B.rowIndex) {
      // Span-based rest length: each of A's and B's particles is one stitch wide.
      rest -= ((extraCount[e.a]! > 0 ? A.span - 1 : 0) + (extraCount[e.b]! > 0 ? B.span - 1 : 0)) * (w / 2);
    }
    spring(part(e.a, Infinity), e.b, rest, 1);
  }

  // Seam of every closed round: its last stitch sits next to its first.
  graph.rows.forEach((r, ri) => {
    const f = fabric[ri]!;
    if (r.closed && f.length >= 3) spring(f[f.length - 1]!, f[0]!, w, 1);
  });

  // Bending along the rows: second neighbours at the chord of the row's own circle.
  if (bendingK > 0) {
    graph.rows.forEach((r, ri) => {
      const f = fabric[ri]!;
      const S = f.length;
      const ring = r.closed && S >= 4;
      // Closed rounds bend to their own circle, flat rows stay straight; a round that is
      // not closed (worked around a foundation chain) turns where it must, so it is left out.
      if (!ring && (r.type !== "row" || r.kind === "ring")) return;
      const rest = ring ? 2 * w * Math.cos(Math.PI / S) : 2 * w;
      const last = ring ? S : S - 2;
      for (let k = 0; k < last; k++) spring(f[k]!, f[(k + 2) % S]!, rest, bendingK, false);
    });
  }

  // The pole pulls the last round shut, like the magic ring at the start.
  if (pole >= 0) {
    const f = lastRing!;
    let cx = 0, cy = 0, cz = 0;
    for (const id of f) {
      cx += pos[3 * id]! / f.length;
      cy += pos[3 * id + 1]! / f.length;
      cz += pos[3 * id + 2]! / f.length;
    }
    pos[3 * pole] = cx;
    pos[3 * pole + 1] = cy + 0.5 * h;
    pos[3 * pole + 2] = cz;
    const rest = Math.min(h, w / (2 * Math.sin(Math.PI / f.length)));
    for (const id of f) spring(pole, id, rest, POLE_STIFFNESS, false);
  }

  // Closed rounds for the radial stabiliser.
  const rings = graph.rows
    .map((r, ri) => ({ r, ids: fabric[ri]! }))
    .filter(({ r, ids }) => r.closed && ids.length >= 3)
    .map(({ r, ids }) => ({ ids: Uint32Array.from(ids), radius: (r.widthStitches * w) / (2 * Math.PI) }));

  // Surface: zip every row's stitches to the stitches they are worked into (as the graph's
  // triangulation, per particle), plus the pole's cap.
  const tris: number[] = [];
  graph.rows.forEach((r, ri) => {
    const children = fabric[ri]!.filter((c) => (parentsOfPart.get(c)?.length ?? 0) > 0);
    if (children.length === 0) return;
    const flip = r.direction === -1;
    const tri = (a: number, b: number, c: number) => {
      if (a === b || b === c || a === c) return;
      if (flip) tris.push(a, c, b);
      else tris.push(a, b, c);
    };
    const zip = (c1: number, c2: number) => {
      const p1 = parentsOfPart.get(c1)!;
      const p2 = parentsOfPart.get(c2)!;
      const lastP = p1[p1.length - 1]!;
      const firstP = p2[0]!;
      tri(c1, lastP, c2);
      if (firstP !== lastP) tri(c2, lastP, firstP);
    };
    for (let i = 0; i < children.length; i++) {
      const c = children[i]!;
      const ps = parentsOfPart.get(c)!;
      for (let k = 0; k + 1 < ps.length; k++) tri(c, ps[k]!, ps[k + 1]!);
      if (i + 1 < children.length) zip(c, children[i + 1]!);
    }
    const ringOk = r.kind === "ring" || new Set(children.flatMap((c) => parentsOfPart.get(c)!)).size > 2;
    if (r.closed && children.length > 2 && ringOk) zip(children[children.length - 1]!, children[0]!);
  });
  if (pole >= 0) {
    const f = lastRing!;
    const flip = graph.rows[graph.rows.length - 1]!.direction === -1;
    for (let k = 0; k < f.length; k++) {
      const a = f[k]!;
      const b = f[(k + 1) % f.length]!;
      if (flip) tris.push(pole, b, a);
      else tris.push(pole, a, b);
    }
  }

  return {
    count,
    pos,
    extraStart,
    extraCount,
    ea: Uint32Array.from(ea),
    eb: Uint32Array.from(eb),
    er: Float64Array.from(er),
    ek: Float64Array.from(ek),
    es: Uint8Array.from(es),
    rings,
    tris: Uint32Array.from(tris),
  };
}

/** A finite number, else the default (NaN / ±Infinity / undefined options fall back). */
function num(x: number | undefined, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

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
  } else {
    // Flat piece: fabric normal → +Z, then the rows' working direction → +X. Rows then grow
    // along ±Y (+Y for consistently wound fabric), whatever the outline of the piece.
    const t = graph.triangles;
    if (t.length > 0) {
      let nx = 0, ny = 0, nz = 0;
      for (let k = 0; k < t.length; k += 3) {
        const c = triNormal(pos, t[k]!, t[k + 1]!, t[k + 2]!);
        nx += c[0];
        ny += c[1];
        nz += c[2];
      }
      rotateInto(pos, [nx, ny, nz], [0, 0, 1]);
    }
    const u = workingDirection(graph);
    if (t.length > 0) {
      if (u[0] * u[0] + u[1] * u[1] > 1e-12) {
        // Rotate about Z so that the working direction points along +X.
        const ang = -Math.atan2(u[1], u[0]);
        const cs = Math.cos(ang), sn = Math.sin(ang);
        for (let i = 0; i < n; i++) {
          const x = pos[3 * i]!, y = pos[3 * i + 1]!;
          pos[3 * i] = cs * x - sn * y;
          pos[3 * i + 1] = sn * x + cs * y;
        }
      }
    } else {
      rotateInto(pos, u, [1, 0, 0]);
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

/**
 * Mean working direction of the rows: the sum of in-row steps between neighbouring stitches
 * (turning chains and MR left out), each row counted in its own direction so that turned rows
 * add up instead of cancelling.
 */
function workingDirection(graph: StitchGraph): [number, number, number] {
  const pos = graph.positions;
  let x = 0, y = 0, z = 0;
  for (const row of graph.rows) {
    let prev = -1;
    for (let id = row.firstNode; id < row.firstNode + row.nodeCount; id++) {
      const node = graph.nodes[id]!;
      if (node.lift || node.code === "MR") continue;
      if (prev >= 0) {
        x += row.direction * (pos[3 * id]! - pos[3 * prev]!);
        y += row.direction * (pos[3 * id + 1]! - pos[3 * prev + 1]!);
        z += row.direction * (pos[3 * id + 2]! - pos[3 * prev + 2]!);
      }
      prev = id;
    }
  }
  return [x, y, z];
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
