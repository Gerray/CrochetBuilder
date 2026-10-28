/**
 * Measurements of a (relaxed) stitch graph, in millimetres.
 *
 * Orientation follows `relax`'s canonical pose: rounds grow along +Y; flat pieces lie in the
 * XY plane with rows growing along +Y. So for a round piece `height` is its length along the
 * axis and `width`/`depth` are its horizontal extent; for a flat piece `width` runs along the
 * rows, `height` across them and `depth` is the thickness.
 */

import { isFabricNode, type StitchGraph } from "./graph.js";

export interface Size {
  /** Extent along X (mm). */
  width: number;
  /** Extent along Y (mm). */
  height: number;
  /** Extent along Z (mm). */
  depth: number;
}

/**
 * Axis-aligned bounding box of the node centres, grown by one yarn diameter on every axis —
 * i.e. the outer envelope of the yarn that runs through the stitch centres.
 */
export function measure(graph: StitchGraph): Size {
  const pos = graph.positions;
  const n = graph.nodes.length;
  if (n === 0) return { width: 0, height: 0, depth: 0 };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = pos[3 * i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  const d = graph.gauge.yarnDiameterMm;
  return { width: max[0]! - min[0]! + d, height: max[1]! - min[1]! + d, depth: max[2]! - min[2]! + d };
}

export interface RoundMeasure {
  rowId: string;
  rowIndex: number;
  /** Centroid of the round's stitches (mm). */
  center: [number, number, number];
  /** Twice the mean distance of the round's stitches from its centroid (mm). */
  diameter: number;
  /** Length of the closed polygon through the round's stitches (mm). */
  circumference: number;
  /**
   * How far the round is from a circle: standard deviation of the stitches' distances from
   * the centroid over their mean (0 = perfect circle; a hexagon is ≈ 0.04).
   */
  circularity: number;
}

/**
 * Per-round measurements for every closed round (a round worked into a round or a magic
 * ring). Orientation-free: works on the round's own centroid, so it does not depend on pose.
 * MR anchors and turning/standing chains are left out.
 */
export function measureRounds(graph: StitchGraph): RoundMeasure[] {
  const pos = graph.positions;
  const out: RoundMeasure[] = [];
  for (const row of graph.rows) {
    if (!row.closed) continue;
    const ids: number[] = [];
    for (let id = row.firstNode; id < row.firstNode + row.nodeCount; id++) {
      if (isFabricNode(graph.nodes[id]!)) ids.push(id);
    }
    if (ids.length === 0) continue;
    let cx = 0, cy = 0, cz = 0;
    for (const id of ids) {
      cx += pos[3 * id]!;
      cy += pos[3 * id + 1]!;
      cz += pos[3 * id + 2]!;
    }
    cx /= ids.length;
    cy /= ids.length;
    cz /= ids.length;
    let r = 0;
    let r2 = 0;
    let circ = 0;
    ids.forEach((id, k) => {
      const d = Math.hypot(pos[3 * id]! - cx, pos[3 * id + 1]! - cy, pos[3 * id + 2]! - cz);
      r += d;
      r2 += d * d;
      const nx = ids[(k + 1) % ids.length]!;
      circ += Math.hypot(pos[3 * nx]! - pos[3 * id]!, pos[3 * nx + 1]! - pos[3 * id + 1]!, pos[3 * nx + 2]! - pos[3 * id + 2]!);
    });
    const mean = r / ids.length;
    const sd = Math.sqrt(Math.max(0, r2 / ids.length - mean * mean));
    out.push({
      rowId: row.rowId,
      rowIndex: row.rowIndex,
      center: [cx, cy, cz],
      diameter: 2 * mean,
      circumference: circ,
      circularity: mean > 1e-9 ? sd / mean : 0,
    });
  }
  return out;
}

/** Largest round diameter of the piece (mm), 0 when it has no closed rounds. */
export function maxRoundDiameter(graph: StitchGraph): number {
  return measureRounds(graph).reduce((m, r) => Math.max(m, r.diameter), 0);
}
