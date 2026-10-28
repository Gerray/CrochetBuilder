/**
 * Assembled scene (format v2 `assembly`): where every part instance, safety eye and
 * embroidered detail sits when the parts of a pattern are put together.
 *
 * Input: the document's parts and placements, plus the relaxed model of every part (each in
 * its canonical pose, see `relax`). Output: a rigid transform per drawn part instance, eye
 * and embroidery positions, and findings for placements that cannot be resolved. Plain
 * numbers only — the app turns the transforms into Three.js matrices.
 *
 * Rules (see docs/FORMAT.md, "Assembly"):
 *   - Root: a part that is not attached anywhere stays in its own pose (identity). Among
 *     several such parts the main one is the one something is attached to, then the largest
 *     (most stitches), then the first. Other unattached parts (with whatever is attached to
 *     them), parts in a cycle and parts without a usable placement are set beside the main
 *     group, left to right, so nothing disappears.
 *   - Attaching: an attached part is sewn on with its LAST row (the open end, flat seam or
 *     gathered end). The centre of that row goes to the placement's anchor on the target,
 *     sunk in by the sagitta of the target's curvature over the end's radius so the rim
 *     closes up with the surface; the part's growth axis (+Y in its pose, first row → last
 *     row) points into the target, so the part sticks out along the outward normal.
 *   - Roll around that axis: a part with an open or gathered end turns its own front
 *     (angle 0 of its last round) towards the target's front (as far as it can: projected
 *     onto the plane across the axis; when the part sits right at the target's front, its
 *     front turns up along the target's axis instead). A flat-finished part (or a piece
 *     worked in rows) lays its seam along the target's round (tangent, "horizontal"), with
 *     its face towards the target's front.
 *   - A placement on the target's LAST row (an open or gathered end: the head on top of the
 *     body) is centred on that end, along the target's axis; its angle only sets the roll.
 *   - Copies: the attach placements of a part apply to its copies in document order (the
 *     first placement to copy 1, the second to copy 2 …). A part with quantity ≥ 2 and only
 *     ONE placement gets its second copy mirrored automatically: same row, angle → −angle
 *     (ears, arms, legs). Further copies without a placement are not drawn. Copy k of an
 *     attached part goes onto copy k of its target when the target has that copy (hands on
 *     both arms), else onto copy 1.
 *   - Eyes: two eyes `spacing` stitches apart along the row, i.e. at angle ± (spacing / 2)
 *     stitches (one eye when the spacing is 0 or missing), on copy 1 of the target. The eye's
 *     centre lies on the surface — half its diameter is sunk in. Embroidery: one mark.
 *
 * Pure functions, no UI or framework imports; deterministic.
 */

import { placementAnchor, type Placement, type Vec3 } from "./assembly.js";
import { isFabricNode, type GraphRow, type StitchGraph } from "./graph.js";
import type { Finish } from "./schema.js";

/** Row-major 3×3 rotation matrix: `m[3 * row + col]`. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** A rotation followed by a translation (mm): world = rotation · local + translation. */
export interface RigidTransform {
  rotation: Mat3;
  translation: Vec3;
}

export const IDENTITY_TRANSFORM: RigidTransform = Object.freeze({
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation: [0, 0, 0],
}) as RigidTransform;

/** What `composeAssembly` needs of a part's model (an engine `Model` satisfies it). */
export interface AssemblyPartModel {
  /** Relaxed graph in canonical pose. */
  graph: StitchGraph;
  /** How the last round was finished (`Model.finish`). */
  finish?: Finish;
}

/** The parts of the document as the assembly sees them (a `BuilderExport` satisfies it). */
export interface AssemblyDocument {
  parts: ReadonlyArray<{ id?: string | undefined; quantity: number }>;
  assembly?: readonly Placement[] | undefined;
}

export interface PartInstance {
  /** Index into `doc.parts`. */
  part: number;
  /** 0-based copy of the part (quantity ×2 → copies 0 and 1). */
  copy: number;
  /** The placement that put it there (attached parts only). */
  placement?: string;
  /** This copy mirrors another one (angle → −angle). */
  mirrored: boolean;
  /**
   * `true` for the main part and everything attached to it (directly or through other
   * parts); `false` for parts set beside the scene (not attached, in a cycle, or attached
   * to a group that is not the main one — see `group`).
   */
  placed: boolean;
  /** Index of the group (main group 0): a root part and everything attached to it. */
  group: number;
  transform: RigidTransform;
}

export interface EyeInstance {
  /** Placement id. */
  placement: string;
  /** Centre of the eye, mm, world. It lies on the surface (half the eye is sunk). */
  position: Vec3;
  /** Outward unit normal of the surface there. */
  normal: Vec3;
  /** Diameter in mm. */
  diameter: number;
}

export interface MarkInstance {
  placement: string;
  position: Vec3;
  normal: Vec3;
  /** Size in mm. */
  size: number;
}

export type AssemblyFindingCode =
  | "UNKNOWN_TARGET"
  | "UNKNOWN_PART"
  | "MISSING_PART"
  | "UNKNOWN_ROW"
  | "SELF_ATTACH"
  | "CYCLE"
  | "NO_MODEL"
  | "EXTRA_PLACEMENT";

export interface AssemblyFinding {
  code: AssemblyFindingCode;
  placementId: string;
  /** The part concerned (index into `doc.parts`), where there is one. */
  part?: number;
  message: string;
}

export interface AssemblyScene {
  instances: PartInstance[];
  eyes: EyeInstance[];
  marks: MarkInstance[];
  findings: AssemblyFinding[];
}

export interface ComposeOptions {
  /** Eye diameter when a placement has no `size` (mm). Default 10. */
  defaultEyeMm?: number;
  /** Embroidery size when a placement has no `size` (mm). Default 5. */
  defaultMarkMm?: number;
  /** Gap between the main group and parts set beside it (mm). Default 15. */
  gapMm?: number;
}

export const DEFAULT_EYE_MM = 10;
export const DEFAULT_MARK_MM = 5;

// ---------------------------------------------------------------------------
// Small vector / matrix helpers
// ---------------------------------------------------------------------------

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0];
}
/** `a` without its component along unit `n`. */
const reject = (a: Vec3, n: Vec3): Vec3 => sub(a, scale(n, dot(a, n)));

/** `m · v`. */
export function rotate(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** A point from a part's pose into the world. */
export function applyTransform(t: RigidTransform, p: Vec3): Vec3 {
  return add(rotate(t.rotation, p), t.translation);
}

/** `a ∘ b`: first `b`, then `a`. */
export function composeTransforms(a: RigidTransform, b: RigidTransform): RigidTransform {
  const r = a.rotation;
  const s = b.rotation;
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      m[3 * i + j] = r[3 * i]! * s[j]! + r[3 * i + 1]! * s[3 + j]! + r[3 * i + 2]! * s[6 + j]!;
    }
  }
  return { rotation: m, translation: applyTransform(a, b.translation) };
}

/** The transform as a column-major 4×4 matrix (`THREE.Matrix4.fromArray`). */
export function transformMatrix4(t: RigidTransform): number[] {
  const r = t.rotation;
  const [x, y, z] = t.translation;
  return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, x, y, z, 1];
}

/** Rotation whose columns are `c0, c1, c2`. */
function fromColumns(c0: Vec3, c1: Vec3, c2: Vec3): Mat3 {
  return [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
}

/** `a · bᵀ` for rotations given by their columns: maps frame `b` onto frame `a`. */
function frameToFrame(a: [Vec3, Vec3, Vec3], b: [Vec3, Vec3, Vec3]): Mat3 {
  const A = fromColumns(...a);
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      // (A · Bᵀ)[i][j] = Σ_k A[i][k] · B[j][k]; B's column k is b[k].
      m[3 * i + j] = A[3 * i]! * b[0][j]! + A[3 * i + 1]! * b[1][j]! + A[3 * i + 2]! * b[2][j]!;
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Part geometry
// ---------------------------------------------------------------------------

function fabricIds(graph: StitchGraph, row: GraphRow): number[] {
  const ids: number[] = [];
  for (let id = row.firstNode; id < row.firstNode + row.nodeCount; id++) {
    if (isFabricNode(graph.nodes[id]!)) ids.push(id);
  }
  return ids;
}

function P(graph: StitchGraph, id: number): Vec3 {
  const p = graph.positions;
  return [p[3 * id]!, p[3 * id + 1]!, p[3 * id + 2]!];
}

function centroid(graph: StitchGraph, ids: readonly number[]): Vec3 {
  let c: Vec3 = [0, 0, 0];
  for (const id of ids) c = add(c, P(graph, id));
  return ids.length > 0 ? scale(c, 1 / ids.length) : c;
}

/** Rows with fabric stitches, in working order. */
function fabricRows(graph: StitchGraph): Array<{ row: GraphRow; ids: number[] }> {
  return graph.rows.map((row) => ({ row, ids: fabricIds(graph, row) })).filter((r) => r.ids.length > 0);
}

/** Horizontal unit direction from a round's centre to its first stitch (the back). */
function startDirection(graph: StitchGraph, ids: readonly number[]): Vec3 {
  const c = centroid(graph, ids);
  const s = P(graph, ids[0]!);
  const d: Vec3 = [s[0] - c[0], 0, s[2] - c[2]];
  const l = length(d);
  return l > 1e-9 ? scale(d, 1 / l) : [0, 0, -1];
}

const isRound = (r: { row: GraphRow; ids: number[] }) => r.row.closed && r.ids.length >= 3;

/**
 * The front of a part in its pose at row `rowId` (angle 0: opposite the start of the round),
 * horizontal; for a part without rounds the fabric's front (+Z). A row that is not a round
 * borrows the front of the nearest round.
 */
function frontAt(graph: StitchGraph, rowId: string | undefined): Vec3 {
  const rows = fabricRows(graph);
  const rounds = rows.filter(isRound);
  if (rounds.length === 0) return [0, 0, 1];
  const at = rows.findIndex((r) => r.row.rowId === rowId);
  let best = rounds[0]!;
  if (at >= 0) {
    let bestD = Infinity;
    for (const r of rounds) {
      const d = Math.abs(rows.indexOf(r) - at);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
  }
  return scale(startDirection(graph, best.ids), -1);
}

interface AttachEnd {
  /** Centre of the last row. */
  center: Vec3;
  /** Mean distance of the last row's stitches from it. */
  radius: number;
  /**
   * `"round"`: open or gathered round, `front` is its angle-0 direction.
   * `"seam"`: flat seam (flat finish, or a piece in rows), `seam` along it and `face` across.
   */
  kind: "round" | "seam";
  front: Vec3;
  seam: Vec3;
  face: Vec3;
}

/** How a part is sewn on: its last row (see the module doc). `null` without stitches. */
function attachEnd(model: AssemblyPartModel): AttachEnd | null {
  const { graph } = model;
  const rows = fabricRows(graph);
  const last = rows[rows.length - 1];
  if (!last) return null;
  const center = centroid(graph, last.ids);
  const radius = last.ids.reduce((s, id) => s + length(sub(P(graph, id), center)), 0) / last.ids.length;
  const up: Vec3 = [0, 1, 0];
  if (!isRound(last)) {
    // A piece in rows: its last row runs along X, the fabric faces +Z.
    return { center, radius, kind: "seam", front: [0, 0, 1], seam: [1, 0, 0], face: [0, 0, 1] };
  }
  const start = startDirection(graph, last.ids);
  const front = scale(start, -1);
  if (model.finish === "flat") {
    // Folds at the round's start and opposite it: the seam runs through both.
    return { center, radius, kind: "seam", front, seam: start, face: normalize(cross(up, start)) };
  }
  return { center, radius, kind: "round", front, seam: normalize(cross(front, up)), face: front };
}

/** Where a placement sits on its target, in the target's pose. */
interface LocalAnchor {
  point: Vec3;
  normal: Vec3;
  /** Distance of the point from the target's axis (curvature for the sinking). */
  radius: number;
  /** Centred on the target's end (last row). */
  end: boolean;
}

function localAnchor(model: AssemblyPartModel, rowId: string, angleDeg: number, endMode: boolean): LocalAnchor | null {
  const { graph } = model;
  const rows = fabricRows(graph);
  const index = rows.findIndex((r) => r.row.rowId === rowId);
  if (index < 0) return null;
  const last = rows[rows.length - 1]!;
  if (endMode && index === rows.length - 1 && isRound(last) && rows.length > 1) {
    return { point: centroid(graph, last.ids), normal: [0, 1, 0], radius: 0, end: true };
  }
  const a = placementAnchor(graph, rowId, angleDeg);
  if (!a) return null;
  const axis = isRound(rows[index]!) ? centroid(graph, rows[index]!.ids) : null;
  const radius = axis ? Math.hypot(a.point[0] - axis[0], a.point[2] - axis[2]) : Infinity;
  return { point: a.point, normal: a.normal, radius, end: false };
}

/** Stitches around row `rowId` (its width; at least 1). */
function rowStitches(graph: StitchGraph, rowId: string): number {
  const row = graph.rows.find((r) => r.rowId === rowId);
  if (!row) return 1;
  return Math.max(1, fabricIds(graph, row).length);
}

/** Sagitta of a chord of half-width `r` on a circle of radius `R` (0 when flat). */
function sagitta(R: number, r: number): number {
  if (!Number.isFinite(R) || R <= 0) return 0;
  const h = Math.min(r, R);
  return R - Math.sqrt(Math.max(0, R * R - h * h));
}

/**
 * Rotation and translation that sew `end` onto the target at world point `p` with outward
 * normal `n`; `front` and `up` are the target's front and axis in the world.
 */
function attachTransform(end: AttachEnd, p: Vec3, n: Vec3, front: Vec3, up: Vec3, sink: number): RigidTransform {
  const yLocal: Vec3 = [0, 1, 0];
  const yWorld = scale(n, -1); // growth axis into the target
  let rotation: Mat3;
  if (end.kind === "round") {
    // The part's front towards the target's front, projected across the axis.
    let want = reject(front, n);
    if (length(want) < 0.3) want = reject(up, n);
    if (length(want) < 1e-6) want = reject([0, 0, 1], n);
    want = normalize(want);
    rotation = frameToFrame([want, yWorld, cross(want, yWorld)], [end.front, yLocal, cross(end.front, yLocal)]);
  } else {
    // The seam along the target's round (tangent), the face towards the target's front.
    let seam = cross(up, n);
    if (length(seam) < 0.3) seam = cross(n, front); // at a pole: seam across the front
    if (length(seam) < 1e-6) seam = cross(n, [0, 0, 1]);
    seam = normalize(seam);
    const r = frameToFrame([seam, yWorld, cross(seam, yWorld)], [end.seam, yLocal, cross(end.seam, yLocal)]);
    const face = rotate(r, end.face);
    if (dot(face, front) >= -1e-9) rotation = r;
    else {
      const flipped = scale(seam, -1);
      rotation = frameToFrame([flipped, yWorld, cross(flipped, yWorld)], [end.seam, yLocal, cross(end.seam, yLocal)]);
    }
  }
  const base = sub(p, scale(n, sink));
  return { rotation, translation: sub(base, rotate(rotation, end.center)) };
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

const instanceKey = (part: number, copy: number) => `${part}:${copy}`;

interface Assignment {
  placement: Placement;
  mirrored: boolean;
  target: number;
}

/**
 * The assembled scene of `doc`: `models[i]` is the relaxed model of `doc.parts[i]` (null or
 * missing when it could not be built). See the module doc for the rules.
 */
export function composeAssembly(
  doc: AssemblyDocument,
  models: ReadonlyArray<AssemblyPartModel | null | undefined>,
  opts: ComposeOptions = {},
): AssemblyScene {
  const defaultEye = opts.defaultEyeMm ?? DEFAULT_EYE_MM;
  const defaultMark = opts.defaultMarkMm ?? DEFAULT_MARK_MM;
  const gap = opts.gapMm ?? 15;
  const findings: AssemblyFinding[] = [];
  const placements = doc.assembly ?? [];

  const byId = new Map<string, number>();
  doc.parts.forEach((p, i) => {
    if (p.id !== undefined && !byId.has(p.id)) byId.set(p.id, i);
  });
  const usable = (i: number) => {
    const m = models[i];
    return !!m && m.graph.nodes.length > 0 && fabricRows(m.graph).length > 0;
  };
  const quantity = (i: number) => Math.max(1, Math.floor(doc.parts[i]?.quantity ?? 1));

  // 1. Resolve references; collect attach placements per attached part.
  const attaches = new Map<number, Placement[]>();
  const decorations: Array<{ placement: Placement; target: number }> = [];
  for (const pl of placements) {
    const target = byId.get(pl.target);
    if (target === undefined) {
      findings.push({ code: "UNKNOWN_TARGET", placementId: pl.id, message: `Placement "${pl.id}": target part "${pl.target}" does not exist.` });
      continue;
    }
    if (!usable(target)) {
      findings.push({ code: "NO_MODEL", placementId: pl.id, part: target, message: `Placement "${pl.id}": target part "${pl.target}" has no model.` });
      continue;
    }
    if (!models[target]!.graph.rows.some((r) => r.rowId === pl.row) || !placementAnchor(models[target]!.graph, pl.row, 0)) {
      findings.push({ code: "UNKNOWN_ROW", placementId: pl.id, part: target, message: `Placement "${pl.id}": part "${pl.target}" has no stitches in row "${pl.row}".` });
      continue;
    }
    if (pl.kind !== "attach") {
      decorations.push({ placement: pl, target });
      continue;
    }
    if (pl.part === undefined) {
      findings.push({ code: "MISSING_PART", placementId: pl.id, message: `Placement "${pl.id}" attaches something, but does not say which part.` });
      continue;
    }
    const part = byId.get(pl.part);
    if (part === undefined) {
      findings.push({ code: "UNKNOWN_PART", placementId: pl.id, message: `Placement "${pl.id}": part "${pl.part}" does not exist.` });
      continue;
    }
    if (part === target) {
      findings.push({ code: "SELF_ATTACH", placementId: pl.id, part, message: `Placement "${pl.id}" attaches part "${pl.part}" to itself.` });
      continue;
    }
    if (!usable(part)) {
      findings.push({ code: "NO_MODEL", placementId: pl.id, part, message: `Placement "${pl.id}": part "${pl.part}" has no model.` });
      continue;
    }
    const list = attaches.get(part) ?? [];
    list.push(pl);
    attaches.set(part, list);
  }

  // 2. Instances: copy k of a part takes its k-th placement; one placement and quantity ≥ 2
  // mirrors the second copy. Copy 0 is always drawn (placed or beside).
  const drawn: Array<{ part: number; copy: number; assignment?: Assignment }> = [];
  doc.parts.forEach((_, part) => {
    if (!usable(part)) return;
    const list = attaches.get(part) ?? [];
    const q = quantity(part);
    for (const extra of list.slice(q)) {
      findings.push({ code: "EXTRA_PLACEMENT", placementId: extra.id, part, message: `Placement "${extra.id}": part has only ${q} ${q === 1 ? "copy" : "copies"}.` });
    }
    const count = list.length === 0 ? 1 : list.length === 1 ? Math.min(q, 2) : Math.min(q, list.length);
    for (let copy = 0; copy < count; copy++) {
      const placement = list.length === 1 ? list[0] : list[copy];
      const target = placement ? byId.get(placement.target)! : -1;
      drawn.push(
        placement
          ? { part, copy, assignment: { placement, mirrored: list.length === 1 && copy === 1, target } }
          : { part, copy },
      );
    }
  });
  const drawnKeys = new Set(drawn.map((d) => instanceKey(d.part, d.copy)));
  const targetCopy = (target: number, copy: number) => (drawnKeys.has(instanceKey(target, copy)) ? copy : 0);

  // 3. Transforms relative to each group's root, resolved recursively (cycles detected).
  const local = new Map<string, { transform: RigidTransform; root: string } | null>();
  const visiting: string[] = [];
  const cyclic = new Set<string>();
  const byKey = new Map(drawn.map((d) => [instanceKey(d.part, d.copy), d]));

  const resolve = (key: string): { transform: RigidTransform; root: string } | null => {
    if (local.has(key)) return local.get(key)!;
    const inst = byKey.get(key)!;
    if (!inst.assignment) {
      const out = { transform: IDENTITY_TRANSFORM, root: key };
      local.set(key, out);
      return out;
    }
    const onStack = visiting.indexOf(key);
    if (onStack >= 0) {
      for (const k of visiting.slice(onStack)) cyclic.add(k);
      return null;
    }
    visiting.push(key);
    const { placement, mirrored, target } = inst.assignment;
    const tKey = instanceKey(target, targetCopy(target, inst.copy));
    const parent = resolve(tKey);
    visiting.pop();
    if (!parent || cyclic.has(key)) {
      local.set(key, null);
      return null;
    }
    const targetModel = models[target]!;
    const angle = mirrored ? -placement.angle : placement.angle;
    const anchor = localAnchor(targetModel, placement.row, angle, true)!;
    const end = attachEnd(models[inst.part]!)!;
    const T = parent.transform;
    const p = applyTransform(T, anchor.point);
    const n = normalize(rotate(T.rotation, anchor.normal));
    const front = normalize(rotate(T.rotation, frontAt(targetModel.graph, placement.row)));
    const up = rotate(T.rotation, [0, 1, 0]);
    const sink = anchor.end ? 0 : sagitta(anchor.radius, end.radius);
    const out = { transform: attachTransform(end, p, n, front, up, sink), root: parent.root };
    local.set(key, out);
    return out;
  };

  for (const d of drawn) resolve(instanceKey(d.part, d.copy));
  const reported = new Set<string>();
  for (const key of cyclic) {
    const inst = byKey.get(key)!;
    const id = inst.assignment!.placement.id;
    if (reported.has(id)) continue;
    reported.add(id);
    findings.push({ code: "CYCLE", placementId: id, part: inst.part, message: `Placement "${id}" is part of a cycle: the parts are attached to each other.` });
  }

  // 4. Groups: a root with everything attached to it; unresolved instances stand alone.
  const groupOf = new Map<string, string>();
  for (const d of drawn) {
    const key = instanceKey(d.part, d.copy);
    groupOf.set(key, local.get(key)?.root ?? key);
  }
  const groups = [...new Set(drawn.map((d) => groupOf.get(instanceKey(d.part, d.copy))!))];
  const members = (g: string) => drawn.filter((d) => groupOf.get(instanceKey(d.part, d.copy)) === g);
  const targeted = new Set<number>([...decorations.map((d) => d.target)]);
  for (const d of drawn) if (d.assignment && local.get(instanceKey(d.part, d.copy))) targeted.add(d.assignment.target);
  const stitches = (part: number) => models[part]!.graph.nodes.length;
  const rootPart = (g: string) => byKey.get(g)!.part;
  const isRealRoot = (g: string) => local.get(g) !== null && !byKey.get(g)!.assignment;
  const ranked = [...groups].sort((a, b) => {
    const real = Number(isRealRoot(b)) - Number(isRealRoot(a));
    if (real !== 0) return real;
    const hasChildren = Number(targeted.has(rootPart(b)) || members(b).length > 1) - Number(targeted.has(rootPart(a)) || members(a).length > 1);
    if (hasChildren !== 0) return hasChildren;
    const size = stitches(rootPart(b)) - stitches(rootPart(a));
    if (size !== 0) return size;
    return rootPart(a) - rootPart(b);
  });
  const main = ranked[0] !== undefined && isRealRoot(ranked[0]) ? ranked[0] : undefined;

  // 5. World transforms: the main group in place, the others beside it, left to right.
  const world = new Map<string, RigidTransform>();
  const boundsOf = (keys: string[], shift: RigidTransform) => {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const key of keys) {
      const inst = byKey.get(key)!;
      const t = composeTransforms(shift, local.get(key)?.transform ?? IDENTITY_TRANSFORM);
      const g = models[inst.part]!.graph;
      for (let i = 0; i < g.nodes.length; i++) {
        const p = applyTransform(t, P(g, i));
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k]!, p[k]!);
          max[k] = Math.max(max[k]!, p[k]!);
        }
      }
    }
    return { min, max };
  };
  const keysOf = (g: string) => members(g).map((d) => instanceKey(d.part, d.copy));
  let cursor = 0;
  let floor = 0;
  if (main !== undefined) {
    const b = boundsOf(keysOf(main), IDENTITY_TRANSFORM);
    cursor = b.max[0] + gap;
    floor = b.min[1];
    for (const key of keysOf(main)) world.set(key, local.get(key)!.transform);
  }
  for (const g of ranked.slice(main === undefined ? 0 : 1)) {
    const keys = keysOf(g);
    const b = boundsOf(keys, IDENTITY_TRANSFORM);
    const shift: RigidTransform = {
      rotation: IDENTITY_TRANSFORM.rotation,
      translation: [cursor - b.min[0], floor - b.min[1], -(b.min[2] + b.max[2]) / 2],
    };
    for (const key of keys) world.set(key, composeTransforms(shift, local.get(key)?.transform ?? IDENTITY_TRANSFORM));
    cursor += b.max[0] - b.min[0] + gap;
  }

  const instances: PartInstance[] = ranked.flatMap((g, group) =>
    members(g).map((d): PartInstance => {
      const key = instanceKey(d.part, d.copy);
      const inst: PartInstance = {
        part: d.part,
        copy: d.copy,
        mirrored: d.assignment?.mirrored ?? false,
        placed: main !== undefined && group === 0 && local.get(key) !== null,
        group,
        transform: world.get(key)!,
      };
      if (d.assignment && local.get(key)) inst.placement = d.assignment.placement.id;
      return inst;
    }),
  );
  instances.sort((a, b) => a.part - b.part || a.copy - b.copy);

  // 6. Eyes and embroidery, on copy 1 of their target.
  const eyes: EyeInstance[] = [];
  const marks: MarkInstance[] = [];
  for (const { placement, target } of decorations) {
    const T = world.get(instanceKey(target, 0));
    if (!T) continue;
    const model = models[target]!;
    const at = (angle: number) => {
      const a = localAnchor(model, placement.row, angle, false);
      if (!a) return null;
      return { position: applyTransform(T, a.point), normal: normalize(rotate(T.rotation, a.normal)) };
    };
    if (placement.kind === "eyes") {
      const spacing = placement.spacing ?? 0;
      const half = spacing > 0 ? ((spacing / 2) / rowStitches(model.graph, placement.row)) * 360 : 0;
      const angles = half > 0 ? [placement.angle - half, placement.angle + half] : [placement.angle];
      for (const angle of angles) {
        const a = at(angle);
        if (a) eyes.push({ placement: placement.id, ...a, diameter: placement.size ?? defaultEye });
      }
    } else {
      const a = at(placement.angle);
      if (a) marks.push({ placement: placement.id, ...a, size: placement.size ?? defaultMark });
    }
  }

  return { instances, eyes, marks, findings };
}

// ---------------------------------------------------------------------------
// Picking: a stitch → the placement that sits there
// ---------------------------------------------------------------------------

/** Placement coordinates of a point: its row and its angle (see `placementAnchor`). */
export interface NodeAnchor {
  rowId: string;
  angleDeg: number;
}

/** Angle in (−180, 180]. */
function wrapDegrees(a: number): number {
  let x = a % 360;
  if (x <= -180) x += 360;
  if (x > 180) x -= 360;
  return x;
}

/** Per row: what turns a stitch position into an angle. */
function rowAngleOf(graph: StitchGraph, row: GraphRow): ((p: Vec3) => number) | null {
  const ids = fabricIds(graph, row);
  if (ids.length === 0) return null;
  if (row.closed && ids.length >= 3) {
    const c = centroid(graph, ids);
    const s = P(graph, ids[0]!);
    const phiStart = Math.atan2(s[2] - c[2], s[0] - c[0]);
    // Inverse of `placementAnchor`: phi = phiStart + π − angle.
    return (p) => wrapDegrees(((phiStart + Math.PI - Math.atan2(p[2] - c[2], p[0] - c[0])) * 180) / Math.PI);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  for (const id of ids) {
    minX = Math.min(minX, P(graph, id)[0]);
    maxX = Math.max(maxX, P(graph, id)[0]);
  }
  const w = maxX - minX;
  return (p) => (w > 1e-9 ? Math.min(180, Math.max(-180, ((p[0] - minX) / w - 0.5) * 360)) : 0);
}

/**
 * The placement coordinates of stitch `nodeId` of a relaxed part (canonical pose): its row
 * and the angle at which `placementAnchor(graph, rowId, angle)` finds it — the inverse used
 * to create a placement by clicking a stitch. Lifts and the magic ring take the position of
 * their row's nearest fabric stitch. `null` for unknown nodes and rows without stitches.
 */
export function anchorOfNode(graph: StitchGraph, nodeId: number): NodeAnchor | null {
  const node = graph.nodes[nodeId];
  if (!node) return null;
  const row = graph.rows.find((r) => r.rowId === node.rowId);
  if (!row) return null;
  const angleOf = rowAngleOf(graph, row);
  if (!angleOf) return null;
  let p = P(graph, nodeId);
  if (!isFabricNode(node)) {
    let best = Infinity;
    let nearest = p;
    for (const id of fabricIds(graph, row)) {
      const d = length(sub(P(graph, id), p));
      if (d < best) {
        best = d;
        nearest = P(graph, id);
      }
    }
    p = nearest;
  }
  return { rowId: row.rowId, angleDeg: angleOf(p) };
}

/**
 * `anchorOfNode` for every node at once (angles in degrees, `NaN` where there is none), for
 * picking without the graph: the row of a node is `node.rowId`.
 */
export function nodeAnchorAngles(graph: StitchGraph): Float32Array {
  const out = new Float32Array(graph.nodes.length).fill(Number.NaN);
  for (const row of graph.rows) {
    const angleOf = rowAngleOf(graph, row);
    if (!angleOf) continue;
    const fabric = fabricIds(graph, row);
    for (let id = row.firstNode; id < row.firstNode + row.nodeCount; id++) {
      if (isFabricNode(graph.nodes[id]!)) out[id] = angleOf(P(graph, id));
      else {
        let best = Infinity;
        let angle = Number.NaN;
        for (const f of fabric) {
          const d = length(sub(P(graph, f), P(graph, id)));
          if (d < best) {
            best = d;
            angle = angleOf(P(graph, f));
          }
        }
        out[id] = angle;
      }
    }
  }
  return out;
}
