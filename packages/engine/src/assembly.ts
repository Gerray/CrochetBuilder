/**
 * Assembly (format v2) — where parts are sewn on, eyes set and details embroidered.
 *
 * A placement names a target part, a row of it and an angle around it:
 *   - `row` is the target row; the placement sits between it and the next stitch row;
 *   - `angle` is in degrees around the round's axis: 0 is the front, i.e. opposite the start
 *     of that round (where the rounds' jogs line up at the back), positive turns to the right
 *     as seen from the front, so 90 is the right-hand side of the picture and −90 the left.
 *
 * `placementAnchor` turns this into a point and an outward normal on a relaxed part, in the
 * part's canonical pose (see `relax`). Composing several parts into one scene builds on it
 * later.
 *
 * Pure functions, no UI or framework imports.
 */

import { z } from "zod";
import { isFabricNode, type GraphRow, type StitchGraph } from "./graph.js";

export const PlacementKindSchema = z.enum(["attach", "eyes", "embroidery"]);

/**
 * One placement of the assembly.
 *   - `attach`: sew part `part` onto `target`;
 *   - `eyes`: a pair of safety eyes on `target`, `spacing` stitches apart, `size` mm across;
 *   - `embroidery`: an embroidered detail (nose, mouth, cheeks) on `target`, `size` mm.
 * `part` and `target` are `BuilderPart.id`s, `row` a row id of the target part.
 */
export const PlacementSchema = z
  .object({
    id: z.string().min(1),
    kind: PlacementKindSchema,
    part: z.string().min(1).optional(),
    target: z.string().min(1),
    row: z.string().min(1),
    angle: z.number().finite(),
    spacing: z.number().finite().nonnegative().optional(),
    size: z.number().finite().positive().optional(),
    note: z.string().optional(),
  })
  .strict();

export type PlacementKind = z.infer<typeof PlacementKindSchema>;
export type Placement = z.infer<typeof PlacementSchema>;

export type Vec3 = [number, number, number];

export interface Anchor {
  /** Point on the fabric, mm, in the part's canonical pose. */
  point: Vec3;
  /** Unit outward surface normal there. */
  normal: Vec3;
}

/**
 * Where a placement sits on a relaxed part: the point between row `rowId` and the next stitch
 * row (the row itself when it is the last) at `angleDeg` (see the module doc), with the
 * outward normal of the fabric there.
 *
 * Rounds (closed rows): the angle is measured around the round's own centre from the
 * direction opposite its first stitch; the point is where that direction crosses the round
 * (and the next round). Flat rows: the angle runs along the row instead, −180 … 180 from its
 * left end to its right end in the pose (0 is the middle), and the normal is the fabric's.
 *
 * `null` when the row has no stitches in the graph (unknown id, free instruction).
 */
export function placementAnchor(graph: StitchGraph, rowId: string, angleDeg: number): Anchor | null {
  const index = graph.rows.findIndex((r) => r.rowId === rowId);
  if (index < 0 || !Number.isFinite(angleDeg)) return null;
  const row = graph.rows[index]!;
  const ids = fabricIds(graph, row);
  if (ids.length === 0) return null;
  const next = graph.rows.slice(index + 1).find((r) => fabricIds(graph, r).length > 0);
  const prev = graph.rows
    .slice(0, index)
    .reverse()
    .find((r) => fabricIds(graph, r).length > 0);
  if (row.closed && ids.length >= 3) return roundAnchor(graph, row, next, prev, angleDeg);
  return rowAnchor(graph, row, next, angleDeg);
}

/** The fabric nodes of a row in working order (no lifts, MR or picots). */
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
  const c: Vec3 = [0, 0, 0];
  for (const id of ids) {
    const p = P(graph, id);
    for (let k = 0; k < 3; k++) c[k] = c[k]! + p[k]! / ids.length;
  }
  return c;
}

/**
 * Where the horizontal ray from the round's centroid in direction `phi` (azimuth in the XZ
 * plane, x = cos, z = sin) leaves the closed polygon through `ids`. Falls back to the stitch
 * whose azimuth is nearest when no edge is crossed (a degenerate round).
 */
function rayHit(graph: StitchGraph, ids: readonly number[], phi: number): Vec3 {
  const c = centroid(graph, ids);
  const dx = Math.cos(phi);
  const dz = Math.sin(phi);
  let best: Vec3 | null = null;
  let bestT = -Infinity;
  for (let k = 0; k < ids.length; k++) {
    const a = P(graph, ids[k]!);
    const b = P(graph, ids[(k + 1) % ids.length]!);
    // c + t·d = a + s·(b − a) in the XZ plane.
    const ex = b[0] - a[0];
    const ez = b[2] - a[2];
    const den = dx * -ez - dz * -ex;
    if (Math.abs(den) < 1e-12) continue;
    const rx = a[0] - c[0];
    const rz = a[2] - c[2];
    const t = (rx * -ez - rz * -ex) / den;
    const s = (dx * rz - dz * rx) / den;
    if (s < -1e-9 || s > 1 + 1e-9 || t <= 0) continue;
    if (t > bestT) {
      bestT = t;
      best = [a[0] + s * ex, a[1] + s * (b[1] - a[1]), a[2] + s * ez];
    }
  }
  if (best) return best;
  let nearest = ids[0]!;
  let bestCos = -Infinity;
  for (const id of ids) {
    const p = P(graph, id);
    const l = Math.hypot(p[0] - c[0], p[2] - c[2]);
    const cos = l > 1e-12 ? ((p[0] - c[0]) * dx + (p[2] - c[2]) * dz) / l : -1;
    if (cos > bestCos) {
      bestCos = cos;
      nearest = id;
    }
  }
  return P(graph, nearest);
}

function roundAnchor(
  graph: StitchGraph,
  row: GraphRow,
  next: GraphRow | undefined,
  prev: GraphRow | undefined,
  angleDeg: number,
): Anchor {
  const ids = fabricIds(graph, row);
  const c = centroid(graph, ids);
  const s = P(graph, ids[0]!);
  // Front = opposite the round's first stitch; positive angles turn to the viewer's right,
  // which (looking at the front, +Y up) is a negative turn in the x = cos, z = sin azimuth.
  const phi = Math.atan2(s[2] - c[2], s[0] - c[0]) + Math.PI - (angleDeg * Math.PI) / 180;
  const here = rayHit(graph, ids, phi);
  const nextIds = next?.closed ? fabricIds(graph, next) : [];
  const prevIds = prev?.closed ? fabricIds(graph, prev) : [];
  const above = nextIds.length >= 3 ? rayHit(graph, nextIds, phi) : null;
  const below = prevIds.length >= 3 ? rayHit(graph, prevIds, phi) : null;
  const point: Vec3 = above ? mid(here, above) : here;

  // Normal: perpendicular to the profile (the fabric's run from round to round) in the plane
  // of the axis and the radial direction, pointing outwards.
  const r: Vec3 = [Math.cos(phi), 0, Math.sin(phi)];
  const [lo, hi] = above ? [here, above] : below ? [below, here] : [here, here];
  const dr = (hi[0] - lo[0]) * r[0] + (hi[2] - lo[2]) * r[2];
  const dy = hi[1] - lo[1];
  let nr = dy;
  let ny = -dr;
  const l = Math.hypot(nr, ny);
  if (l < 1e-9) {
    nr = 1;
    ny = 0;
  } else {
    nr /= l;
    ny /= l;
  }
  if (nr < 0) {
    // The profile runs downwards (a piece worked top-down at this point): flip outwards.
    nr = -nr;
    ny = -ny;
  }
  return { point, normal: [nr * r[0], ny, nr * r[2]] };
}

function rowAnchor(graph: StitchGraph, row: GraphRow, next: GraphRow | undefined, angleDeg: number): Anchor {
  const at = (r: GraphRow): Vec3 => {
    const ids = fabricIds(graph, r);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const id of ids) {
      const x = P(graph, id)[0];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    const t = Math.min(1, Math.max(0, 0.5 + angleDeg / 360));
    const x = minX + t * (maxX - minX);
    // The stitch nearest that x, interpolated with its neighbour along the row.
    const sorted = ids.map((id) => P(graph, id)).sort((a, b) => a[0] - b[0]);
    for (let k = 0; k + 1 < sorted.length; k++) {
      const a = sorted[k]!;
      const b = sorted[k + 1]!;
      if (x >= a[0] && x <= b[0]) {
        const s = b[0] - a[0] > 1e-12 ? (x - a[0]) / (b[0] - a[0]) : 0;
        return [x, a[1] + s * (b[1] - a[1]), a[2] + s * (b[2] - a[2])];
      }
    }
    // Rounding put x just outside the row: the nearer end.
    return x <= sorted[0]![0] ? sorted[0]! : sorted[sorted.length - 1]!;
  };
  const here = at(row);
  const point = next ? mid(here, at(next)) : here;
  return { point, normal: [0, 0, 1] };
}

function mid(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}
