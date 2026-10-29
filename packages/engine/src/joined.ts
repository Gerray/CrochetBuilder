/**
 * Joined models — parts crocheted together (`StitchOp.from` / `.through`, see join.ts) relaxed
 * as one piece.
 *
 * Every part copy of a joined component (`JoinPlan.components`) keeps its own stitch graph
 * (`buildGraph`, the same as standalone) and its own finish and stuffing. The relaxation then
 * runs on all of them at once (`relaxBodies`), with the joins as extra links:
 *
 *   - `from`: the joined stitch is linked to the very stitches (slots) of the other part's row
 *     it is worked into, as to its own parents (rest length: its height, legs leaning like an
 *     increase's or decrease's). The fabric between such stitches and the other part counts to
 *     the joining part's surface for its stuffing, and is handed out as `JoinedComponent.bridge`
 *     so a view can draw it.
 *   - `through`: the stitch is linked to the place of the other part it goes through — for a
 *     round both stitches of the flattened pair, which are also pulled onto each other — half a
 *     stitch height below its top: the other part's edge is caught in the stitch's foot.
 *
 * Start pose: the component's root (`JoinPlan.roots`: most stitches, ties by part id) stays
 * where its layout puts it; the others are placed one after the other, each rigidly next to an
 * already placed
 * one it is joined to: a part worked `from` another continues that part's growth (its rounds
 * stacked on the source row; a join that takes only some of the row's stitches leans outwards
 * by how much it leaves free, so branches split and an ear picked up on the side points
 * sideways), a part worked `through` sticks out of the other part along its outward normal.
 * The rotation about that axis is the best fit (least squares) of the joined stitches onto
 * their places.
 *
 * A part whose last round is worked into by a `from` join is not gathered by default (the
 * join goes on from that round); its default stuffing stays that of a closed piece.
 *
 * The result is in one common frame: the canonical pose (see `relax`) of the component's
 * root, every other copy moved with it. Deterministic (seeded like `relax`) and independent of
 * the order of the parts in the document: the copies are relaxed in the order of their part
 * ids (the stitches a join takes without `start` still follow the document order, see join.ts).
 * Components whose parts are joined in a circle (`JOIN_CYCLE`) are not relaxed (`skipped`).
 *
 * Pure functions, no UI or framework imports.
 */

import type { Gauge } from "./gauge.js";
import { buildGraph, isFabricNode, LEG_LEAN, type GraphRow, type StitchGraph } from "./graph.js";
import { planJoins, type JoinDocument, type JoinInstance, type JoinLink, type JoinPlan } from "./join.js";
import { partRelaxOptions, type ModelOptions } from "./model.js";
import {
  relaxBodies,
  resolveFinish,
  stitchParticles,
  stuffingOf,
  type BodySpring,
  type ParticleRef,
  type RelaxBody,
} from "./relax.js";
import { STITCH_PROPERTIES, type Finish } from "./schema.js";
import { DEFAULT_MAX_STITCHES } from "./validate.js";

type V3 = [number, number, number];

/** One part copy of a joined component, relaxed together with the others. */
export interface JoinedPart {
  /** Index into `doc.parts`. */
  part: number;
  /** 0-based copy. */
  copy: number;
  /** Its stitch graph with the positions of the joint relaxation (common frame, mm). */
  graph: StitchGraph;
  /** How its last round was finished in the relaxation (pass on to `toMesh`). */
  finish: Finish;
}

/**
 * The fabric across `from` joins, between the joined stitches and the stitches they are worked
 * into, which neither part's own mesh has: triangles over `vertices`, each vertex a node of an
 * instance of the component (at its position in the common frame).
 */
export interface JoinBridge {
  /** Per vertex: index into `JoinedComponent.parts` and the node there. */
  vertices: Array<{ instance: number; node: number }>;
  /** xyz per vertex (mm, common frame). */
  positions: Float64Array;
  /** Vertex triples, wound like the joining part's surface. */
  triangles: Uint32Array;
}

export interface JoinedComponent {
  parts: JoinedPart[];
  /** Index into `parts` of the copy whose pose the component takes (`JoinPlan.roots`). */
  root: number;
  bridge: JoinBridge;
}

export interface JoinedModels {
  plan: JoinPlan;
  /** Components that could be built (all their parts have stitches and are within the budget). */
  components: JoinedComponent[];
  /** Components of `plan.components` left out, with the reason (`cycle`: `JOIN_CYCLE`). */
  skipped: Array<{ instances: JoinInstance[]; reason: "empty" | "overBudget" | "cycle" }>;
}

/** Key of a part copy (`part:copy`, 0-based copy). */
export const joinedKey = (part: number, copy: number) => `${part}:${copy}`;

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3, fallback: V3 = [0, 1, 0]): V3 => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : fallback;
};
type M3 = number[]; // row-major 3×3
const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const apply = (m: M3, v: V3): V3 => [
  m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
  m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
  m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
];
const matmul = (a: M3, b: M3): M3 => {
  const out = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[3 * i + j]! += a[3 * i + k]! * b[3 * k + j]!;
  return out;
};
/** Rotation by `angle` about unit axis `k` (Rodrigues). */
function axisAngle(k: V3, angle: number): M3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const [x, y, z] = k;
  return [c + x * x * t, x * y * t - z * s, x * z * t + y * s, y * x * t + z * s, c + y * y * t, y * z * t - x * s, z * x * t - y * s, z * y * t + x * s, c + z * z * t];
}
/** The minimal rotation taking unit `a` onto unit `b`. */
function alignRotation(a: V3, b: V3): M3 {
  const c = dot(a, b);
  const axis = cross(a, b);
  const s = len(axis);
  if (s < 1e-9) {
    if (c > 0) return [...IDENTITY];
    const alt: V3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    return axisAngle(unit(cross(a, alt)), Math.PI);
  }
  return axisAngle(mul(axis, 1 / s), Math.atan2(s, c));
}

function pointOf(graph: StitchGraph, id: number): V3 {
  const p = graph.positions;
  return [p[3 * id]!, p[3 * id + 1]!, p[3 * id + 2]!];
}

function centroidOf(points: readonly V3[]): V3 {
  let c: V3 = [0, 0, 0];
  for (const p of points) c = add(c, p);
  return points.length > 0 ? mul(c, 1 / points.length) : c;
}

// ---------------------------------------------------------------------------
// Rows of a graph as joins see them
// ---------------------------------------------------------------------------

export interface RowInfo {
  row: GraphRow;
  /** Slots offered to a `from` join (as to the part's next row): node and its k-th stitch. */
  slots: Array<{ node: number; k: number }>;
  /** Fabric stitches in working order (a `through` join's places). */
  fabric: Array<{ node: number; k: number }>;
}

/** The places a row of `graph` offers to joins: slots for `from`, fabric stitches for `through`. */
export function rowInfo(graph: StitchGraph, rowId: string): RowInfo | null {
  const row = graph.rows.find((r) => r.rowId === rowId);
  if (!row) return null;
  const slots: RowInfo["slots"] = [];
  const fabric: RowInfo["fabric"] = [];
  for (let id = row.firstNode; id < row.firstNode + row.nodeCount; id++) {
    const node = graph.nodes[id]!;
    const p = row.kind === "chain" ? 1 : STITCH_PROPERTIES[node.code].producesStitches;
    for (let k = 0; k < p; k++) slots.push({ node: id, k });
    // Chains inside a row of stitches are no place to work through (`joinCapacity`).
    if (isFabricNode(node) && (row.kind === "chain" || node.code !== "CH")) for (let k = 0; k < stitchParticles(node); k++) fabric.push({ node: id, k });
  }
  return { row, slots, fabric };
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

interface Body {
  key: string;
  part: number;
  copy: number;
  graph: StitchGraph;
  finish: Finish;
  stuffing: number;
}

/** A join resolved to graph nodes and particles. */
interface Wire {
  link: JoinLink;
  consumer: number; // body index
  source: number; // body index
  node: number; // consumer node
  places: Array<{ node: number; k: number }>; // source particles, per place (pairs flattened)
}

/**
 * Relax every joined component of `doc` (see the module doc). Parts that are not joined are
 * not touched — build them with `buildModel`. `opts` as for `buildModel` (gauge, budget per
 * part, relaxation settings); a part's own finish and stuffing apply.
 */
export function buildJoinedModels(doc: JoinDocument, gauge?: Gauge, opts: ModelOptions = {}): JoinedModels {
  const plan = planJoins(doc);
  const maxStitches = Number.isFinite(opts.maxStitches) ? opts.maxStitches! : DEFAULT_MAX_STITCHES;
  const graphs = new Map<number, StitchGraph>();
  const graphOf = (part: number) => {
    let g = graphs.get(part);
    if (!g) {
      g = buildGraph(doc.parts[part]!.content, gauge, { maxStitches });
      graphs.set(part, g);
    }
    return g;
  };
  const components: JoinedComponent[] = [];
  const skipped: JoinedModels["skipped"] = [];
  const cyclic = new Set(plan.findings.filter((f) => f.code === "JOIN_CYCLE").map((f) => f.partIndex));
  const idOf = (part: number) => doc.parts[part]!.id ?? "";
  plan.components.forEach((instances, c) => {
    if (instances.some((x) => cyclic.has(x.part))) {
      skipped.push({ instances, reason: "cycle" });
      return;
    }
    const built = instances.map((x) => graphOf(x.part));
    if (built.some((g) => g.overBudget)) {
      skipped.push({ instances, reason: "overBudget" });
      return;
    }
    if (built.some((g) => g.nodes.length === 0)) {
      skipped.push({ instances, reason: "empty" });
      return;
    }
    // Relax in the order of the part ids (not of the parts in the document), report in the
    // component's order.
    const order = instances.map((_, i) => i).sort((a, b) => {
      const x = instances[a]!;
      const y = instances[b]!;
      return idOf(x.part) < idOf(y.part) ? -1 : idOf(x.part) > idOf(y.part) ? 1 : x.copy - y.copy || x.part - y.part;
    });
    const rootAt = order.indexOf(plan.roots[c] ?? 0);
    const relaxed = relaxComponent(
      doc,
      plan,
      order.map((i) => instances[i]!),
      order.map((i) => built[i]!),
      rootAt,
      opts,
    );
    const back = new Array<number>(order.length);
    order.forEach((i, k) => (back[k] = i));
    const parts = new Array<JoinedPart>(order.length);
    relaxed.parts.forEach((p, k) => (parts[back[k]!] = p));
    components.push({
      parts,
      root: back[relaxed.root]!,
      bridge: { ...relaxed.bridge, vertices: relaxed.bridge.vertices.map((v) => ({ instance: back[v.instance]!, node: v.node })) },
    });
  });
  return { plan, components, skipped };
}

function relaxComponent(
  doc: JoinDocument,
  plan: JoinPlan,
  instances: JoinInstance[],
  graphs: StitchGraph[],
  root: number,
  opts: ModelOptions,
): JoinedComponent {
  const index = new Map(instances.map((x, i) => [joinedKey(x.part, x.copy), i]));
  const links = plan.links.filter((l) => index.has(joinedKey(l.part, l.copy)));

  // Rows of the source parts that are worked into by `from`: such a last round stays open.
  const fromSourceRows = new Set<string>();
  for (const l of links) {
    const s = plan.sources[l.source]!;
    if (l.kind === "from") fromSourceRows.add(`${joinedKey(s.part, s.copy)}|${s.rowId}`);
  }

  const bodies: Body[] = instances.map((x, i) => {
    const content = doc.parts[x.part]!.content;
    const graph = graphs[i]!;
    const relaxOpts = partRelaxOptions(content, opts);
    let finish = resolveFinish(graph, relaxOpts);
    let stuffing = stuffingOf(relaxOpts, finish);
    const lastRow = graph.rows[graph.rows.length - 1];
    const explicit = relaxOpts.finish !== undefined || relaxOpts.closed !== undefined;
    if (!explicit && finish === "gather" && lastRow && fromSourceRows.has(`${joinedKey(x.part, x.copy)}|${lastRow.rowId}`)) {
      finish = "open";
      stuffing = stuffingOf(relaxOpts, "gather");
    }
    return { key: joinedKey(x.part, x.copy), part: x.part, copy: x.copy, graph, finish, stuffing };
  });

  // Resolve the links to nodes and particles.
  const rowCache = new Map<string, RowInfo | null>();
  const info = (body: number, rowId: string) => {
    const key = `${body}|${rowId}`;
    if (!rowCache.has(key)) rowCache.set(key, rowInfo(bodies[body]!.graph, rowId));
    return rowCache.get(key)!;
  };
  const wires: Wire[] = [];
  for (const link of links) {
    const consumer = index.get(joinedKey(link.part, link.copy))!;
    const src = plan.sources[link.source]!;
    const source = index.get(joinedKey(src.part, src.copy));
    if (source === undefined) continue;
    const own = info(consumer, link.rowId);
    const from = info(source, src.rowId);
    if (!own || !from) continue;
    const node = own.row.firstNode + link.offset;
    if (node >= own.row.firstNode + own.row.nodeCount) continue;
    const places: Wire["places"] = [];
    for (let j = 0; j < link.count; j++) {
      const at = link.slot + j;
      if (link.kind === "from") {
        const slot = from.slots[at];
        if (slot) places.push(slot);
      } else if (src.layered) {
        const S = from.fabric.length;
        const a = from.fabric[at];
        const b = from.fabric[S - 1 - at];
        if (a && b && at < S - 1 - at) places.push(a, b);
        else if (a) places.push(a);
      } else {
        const a = from.fabric[at];
        if (a) places.push(a);
      }
    }
    if (places.length > 0) wires.push({ link, consumer, source, node, places });
  }
  // In body order, not document order: the relaxation does not depend on the parts' order.
  wires.sort((a, b) => a.consumer - b.consumer || a.node - b.node || a.source - b.source || a.places[0]!.node - b.places[0]!.node);

  // The root stays; the others are placed next to placed ones.
  const placement = placeBodies(bodies, wires, root);

  // Springs and the fabric across `from` joins.
  const springs: BodySpring[] = [];
  const tris: Array<Array<[ParticleRef, ParticleRef, ParticleRef]>> = bodies.map(() => []);
  for (const wire of wires) {
    const b = bodies[wire.consumer]!;
    const g = b.graph;
    const w = g.gauge.stitchWidthMm;
    const node = g.nodes[wire.node]!;
    const hc = node.height > 0 ? node.height : g.gauge.stitchHeightMm;
    if (wire.link.kind === "from") {
      const mine = stitchParticles(node);
      const m = wire.places.length;
      for (let i = 0; i < mine; i++) {
        wire.places.forEach((p, j) => {
          const dx = LEG_LEAN * (i - (mine - 1) / 2 - (j - (m - 1) / 2)) * w;
          springs.push({ a: { body: wire.source, node: p.node, k: p.k }, b: { body: wire.consumer, node: wire.node, k: i }, rest: Math.sqrt(hc * hc + dx * dx) });
        });
      }
    } else {
      for (const p of wire.places) {
        springs.push({ a: { body: wire.source, node: p.node, k: p.k }, b: { body: wire.consumer, node: wire.node }, rest: 0.5 * hc });
      }
      if (wire.places.length === 2) {
        const [a, c] = wire.places as [Wire["places"][0], Wire["places"][0]];
        const gap = 0.5 * Math.min(w, g.gauge.stitchHeightMm);
        springs.push({ a: { body: wire.source, ...a }, b: { body: wire.source, ...c }, rest: gap });
      }
    }
  }
  const bridgeTris = fromBridges(bodies, wires);
  for (const t of bridgeTris) tris[t[0].body]!.push(t);

  const relaxBodiesInput: RelaxBody[] = bodies.map((b, i) => {
    const body: RelaxBody = { graph: b.graph, finish: b.finish, stuffing: b.stuffing, place: placement[i]! };
    if (tris[i]!.length > 0) body.tris = tris[i]!;
    return body;
  });
  const relaxOpts: Parameters<typeof relaxBodies>[2] = { root };
  for (const k of ["iterations", "seed", "stiffness", "damping", "radial", "repulsion", "bending", "jitter", "pose"] as const) {
    if (opts[k] !== undefined) (relaxOpts as Record<string, unknown>)[k] = opts[k];
  }
  const result = relaxBodies(relaxBodiesInput, springs, relaxOpts);

  const parts: JoinedPart[] = bodies.map((b, i) => ({
    part: b.part,
    copy: b.copy,
    graph: { ...b.graph, positions: result.positions[i]!, relaxed: true },
    finish: b.finish,
  }));

  // The bridge as node triangles (degenerate ones dropped).
  const vertexIndex = new Map<string, number>();
  const vertices: JoinBridge["vertices"] = [];
  const triangles: number[] = [];
  const vertexOf = (r: ParticleRef) => {
    const key = `${r.body}:${r.node}`;
    let v = vertexIndex.get(key);
    if (v === undefined) {
      v = vertices.length;
      vertexIndex.set(key, v);
      vertices.push({ instance: r.body, node: r.node });
    }
    return v;
  };
  for (const [a, b, c] of bridgeTris) {
    const va = vertexOf(a);
    const vb = vertexOf(b);
    const vc = vertexOf(c);
    if (va !== vb && vb !== vc && va !== vc) triangles.push(va, vb, vc);
  }
  const positions = new Float64Array(3 * vertices.length);
  vertices.forEach((v, i) => {
    const p = parts[v.instance]!.graph.positions;
    positions[3 * i] = p[3 * v.node]!;
    positions[3 * i + 1] = p[3 * v.node + 1]!;
    positions[3 * i + 2] = p[3 * v.node + 2]!;
  });

  return { parts, root, bridge: { vertices, positions, triangles: Uint32Array.from(triangles) } };
}

/**
 * Triangles between runs of `from`-joined stitches and the stitches they are worked into, wound
 * like the joining part's own rows (as the graph zips a row to its parents).
 */
function fromBridges(bodies: Body[], wires: Wire[]): Array<[ParticleRef, ParticleRef, ParticleRef]> {
  const out: Array<[ParticleRef, ParticleRef, ParticleRef]> = [];
  // Group the wires per consumer row, in node order.
  const byRow = new Map<string, Wire[]>();
  for (const w of wires) {
    if (w.link.kind !== "from") continue;
    const key = `${w.consumer}|${w.link.rowId}`;
    const list = byRow.get(key) ?? [];
    list.push(w);
    byRow.set(key, list);
  }
  for (const list of byRow.values()) {
    list.sort((a, b) => a.node - b.node);
    const body = bodies[list[0]!.consumer]!;
    const row = body.graph.rows.find((r) => r.rowId === list[0]!.link.rowId)!;
    const flip = row.direction === -1;
    const tri = (a: ParticleRef, b: ParticleRef, c: ParticleRef) => {
      out.push(flip ? [a, c, b] : [a, b, c]);
    };
    const child = (w: Wire): ParticleRef => ({ body: w.consumer, node: w.node });
    const parents = (w: Wire): ParticleRef[] => w.places.map((p) => ({ body: w.source, node: p.node, k: p.k }));
    const same = (a: ParticleRef, b: ParticleRef) => a.body === b.body && a.node === b.node && (a.k ?? 0) === (b.k ?? 0);
    const zip = (w1: Wire, w2: Wire) => {
      const p1 = parents(w1);
      const p2 = parents(w2);
      const last = p1[p1.length - 1]!;
      const first = p2[0]!;
      tri(child(w1), last, child(w2));
      if (!same(first, last)) tri(child(w2), last, first);
    };
    // Runs: neighbouring stitches of the row, joined to the same part copy.
    const adjacent = (a: Wire, b: Wire) => b.node === a.node + 1 && a.source === b.source && a.link.source === b.link.source;
    for (let i = 0; i < list.length; i++) {
      const w = list[i]!;
      const ps = parents(w);
      for (let k = 0; k + 1 < ps.length; k++) tri(child(w), ps[k]!, ps[k + 1]!);
      if (i + 1 < list.length && adjacent(w, list[i + 1]!)) zip(w, list[i + 1]!);
    }
    // A closed round worked entirely into one row (a stem): close the ring.
    const fabric: number[] = [];
    for (let id = row.firstNode; id < row.firstNode + row.nodeCount; id++) if (isFabricNode(body.graph.nodes[id]!)) fabric.push(id);
    const whole =
      row.closed &&
      list.length >= 3 &&
      list.length === fabric.length &&
      list.every((w) => w.link.source === list[0]!.link.source);
    if (whole) {
      zip(list[list.length - 1]!, list[0]!);
      continue;
    }

    // Where a run of joined stitches meets the row's own stitches (worked into its own
    // previous row, e.g. a chain bridge), zip the two as neighbours: the own stitch's parent
    // stands in for the joined stitch's places. A run that goes all the way round its source
    // row (a leg) is closed between its last and first place and that parent.
    const byNode = new Map(list.map((w) => [w.node, w]));
    const ownParent = (id: number): ParticleRef | null => {
      const parent = body.graph.nodes[id]!.parents[0];
      return parent === undefined ? null : { body: list[0]!.consumer, node: parent };
    };
    const n = fabric.length;
    const ends = row.closed ? n : n - 1;
    for (let i = 0; i < ends; i++) {
      const a = fabric[i]!;
      const b = fabric[(i + 1) % n]!;
      const wa = byNode.get(a);
      const wb = byNode.get(b);
      if ((wa === undefined) === (wb === undefined)) continue;
      const ca: ParticleRef = { body: list[0]!.consumer, node: a };
      const cb: ParticleRef = { body: list[0]!.consumer, node: b };
      if (wa) {
        // End of a run: …, joined a | own b.
        const last = parents(wa).at(-1)!;
        const pb = ownParent(b);
        if (!pb) continue;
        tri(ca, last, cb);
        tri(cb, last, pb);
        // The run's first place, when the run covers its whole source row.
        const first = runStart(wa);
        if (first && wholeSource(first, wa)) {
          const p0 = parents(first)[0]!;
          if (!same(p0, last)) tri(pb, last, p0);
        }
      } else if (wb) {
        // Start of a run: own a | joined b, ….
        const pa = ownParent(a);
        if (!pa) continue;
        const first = parents(wb)[0]!;
        tri(ca, pa, cb);
        tri(cb, pa, first);
      }
    }

    /** The first wire of the run that ends with `w` (neighbouring stitches, one source). */
    function runStart(w: Wire): Wire | null {
      let cur = w;
      for (let guard = 0; guard < n; guard++) {
        const at = fabric.indexOf(cur.node);
        if (at < 0) return null;
        const prev = byNode.get(fabric[(at - 1 + n) % n]!);
        if (!prev || prev === w || prev.link.source !== cur.link.source || prev.source !== cur.source) return cur;
        cur = prev;
      }
      return null;
    }
    /** Whether the run from `first` to `last` takes every place of its source row once. */
    function wholeSource(first: Wire, last: Wire): boolean {
      const src = bodies[first.source]!.graph;
      const info = rowInfo(src, src.nodes[first.places[0]!.node]!.rowId);
      if (!info) return false;
      let count = 0;
      let at = fabric.indexOf(first.node);
      for (let guard = 0; guard < n; guard++) {
        const w = byNode.get(fabric[at]!)!;
        count += w.places.length;
        if (w === last) break;
        at = (at + 1) % n;
      }
      return count === info.slots.length && first.link.slot === 0;
    }
  }
  return out;
}

/**
 * Rigid start placement of every body (see the module doc): the root stays, the others follow
 * in order of discovery, each fitted onto an already placed body it is joined to.
 */
function placeBodies(bodies: Body[], wires: Wire[], root: number): Array<{ rotation: number[]; translation: number[] }> {
  const placed: Array<{ rotation: M3; translation: V3 } | null> = bodies.map(() => null);
  placed[root] = { rotation: [...IDENTITY], translation: [0, 0, 0] };
  const queue = [root];
  while (queue.length > 0) {
    const x = queue.shift()!;
    for (let y = 0; y < bodies.length; y++) {
      if (placed[y]) continue;
      const between = wires.filter((w) => (w.consumer === x && w.source === y) || (w.consumer === y && w.source === x));
      if (between.length === 0) continue;
      placed[y] = fitBody(bodies, between, x, y, placed[x]!);
      queue.push(y);
    }
  }
  // Not reachable from the root (cannot happen for a component): beside it, as laid out.
  return placed.map((p) => (p ? { rotation: p.rotation, translation: p.translation } : { rotation: [...IDENTITY], translation: [0, 0, 0] }));
}

/** Horizontal unit direction from the centre of `ids`' row to the centre of `ids` (layout frame). */
function outwards(graph: StitchGraph, row: GraphRow, ids: readonly number[]): V3 {
  const all: V3[] = [];
  for (let id = row.firstNode; id < row.firstNode + row.nodeCount; id++) if (isFabricNode(graph.nodes[id]!)) all.push(pointOf(graph, id));
  const d = sub(centroidOf(ids.map((id) => pointOf(graph, id))), centroidOf(all));
  return [d[0], 0, d[2]];
}

function fitBody(
  bodies: Body[],
  wires: Wire[],
  x: number,
  y: number,
  tx: { rotation: M3; translation: V3 },
): { rotation: M3; translation: V3 } {
  const up: V3 = [0, 1, 0];
  // One direction of joins between the two (a cycle is never relaxed, see buildJoinedModels).
  wires = wires.filter((wire) => wire.consumer === wires[0]!.consumer && wire.link.kind === wires[0]!.link.kind);
  const kind = wires[0]!.link.kind;
  const toWorld = (p: V3): V3 => add(apply(tx.rotation, p), tx.translation);
  const consumerBody = wires[0]!.consumer;
  const sourceBody = wires[0]!.source;
  const cg = bodies[consumerBody]!.graph;
  const sg = bodies[sourceBody]!.graph;
  const w = sg.gauge.stitchWidthMm;
  const h = cg.gauge.stitchHeightMm;
  const cPoint = (wire: Wire) => pointOf(cg, wire.node);
  const sPoint = (wire: Wire) => centroidOf(wire.places.map((p) => pointOf(sg, p.node)));

  // Growth direction of the source at the joined places (local to the source): along its own
  // growth when the join takes the whole row, leaning outwards by what it leaves free.
  const sourceRowId = wires[0]!.places.length > 0 ? sg.nodes[wires[0]!.places[0]!.node]!.rowId : "";
  const sourceRow = sg.rows.find((r) => r.rowId === sourceRowId)!;
  let sourceFabric = 0;
  for (let id = sourceRow.firstNode; id < sourceRow.firstNode + sourceRow.nodeCount; id++) if (isFabricNode(sg.nodes[id]!)) sourceFabric++;
  const used = new Set(wires.flatMap((wire) => wire.places.map((p) => `${p.node}:${p.k}`)));
  const fraction = Math.min(1, used.size / Math.max(1, sourceFabric));
  const radialS = unit(outwards(sg, sourceRow, wires.flatMap((wire) => wire.places.map((p) => p.node))), [0, 0, 0]);
  const growS = unit(add(mul(up, fraction), mul(radialS, 1 - fraction)));
  // Outward normal of the consumer at the joined stitches (for `through`).
  const consumerRow = cg.rows.find((r) => r.rowId === wires[0]!.link.rowId)!;
  const outC = unit(outwards(cg, consumerRow, wires.map((wire) => wire.node)), [0, 0, 1]);

  let aY: V3;
  let aW: V3;
  let q: V3[];
  let t: V3[];
  if (kind === "from") {
    if (y === sourceBody) {
      aY = growS;
      aW = unit(apply(tx.rotation, up));
      q = wires.map(sPoint);
      t = wires.map((wire) => sub(toWorld(cPoint(wire)), mul(aW, h)));
    } else {
      aY = up;
      aW = unit(apply(tx.rotation, growS));
      q = wires.map(cPoint);
      t = wires.map((wire) => add(toWorld(sPoint(wire)), mul(aW, h)));
    }
  } else if (y === sourceBody) {
    aY = up;
    aW = mul(unit(apply(tx.rotation, outC)), -1);
    q = wires.map(sPoint);
    t = wires.map((wire) => toWorld(cPoint(wire)));
  } else {
    aY = mul(outC, -1);
    aW = unit(apply(tx.rotation, up));
    q = wires.map(cPoint);
    t = wires.map((wire) => toWorld(sPoint(wire)));
  }

  // Align the axes, then the best rotation about the axis (2D Procrustes), then the centres.
  const r0 = alignRotation(unit(aY), aW);
  const q0 = q.map((p) => apply(r0, p));
  const qc = centroidOf(q0);
  const tc = centroidOf(t);
  const u = unit(cross(aW, Math.abs(aW[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]));
  const v = cross(aW, u);
  let sxx = 0;
  let sxy = 0;
  q0.forEach((p, i) => {
    const a = sub(p, qc);
    const b = sub(t[i]!, tc);
    const au = dot(a, u), av = dot(a, v), bu = dot(b, u), bv = dot(b, v);
    sxx += au * bu + av * bv;
    sxy += au * bv - av * bu;
  });
  const theta = Math.abs(sxx) + Math.abs(sxy) > 1e-9 * w ? Math.atan2(sxy, sxx) : 0;
  const rotation = matmul(axisAngle(aW, theta), r0);
  const translation = sub(tc, apply(rotation, centroidOf(q)));
  return { rotation, translation };
}
