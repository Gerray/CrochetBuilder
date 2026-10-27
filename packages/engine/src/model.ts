/**
 * Convenience pipeline: content (+ gauge) → validated, relaxed stitch graph with its size.
 */

import type { Gauge } from "./gauge.js";
import { buildGraph, type StitchGraph } from "./graph.js";
import { measure, maxRoundDiameter, type Size } from "./measure.js";
import { relax, type RelaxOptions } from "./relax.js";
import type { PartContent } from "./schema.js";
import { validate, type Finding } from "./validate.js";

export interface Model {
  /** Relaxed graph (positions in mm, canonical pose). */
  graph: StitchGraph;
  /** Bounding size of the relaxed piece (see `measure`). */
  size: Size;
  /** Largest round diameter in mm, 0 for pieces without closed rounds. */
  maxDiameter: number;
  /** `validate(content)` — the model is still built when there are findings. */
  findings: Finding[];
  /** `true` when the gauge came from defaults (sizes are estimates). */
  estimated: boolean;
}

/** Validate, build the graph, relax it and measure it. */
export function buildModel(content: PartContent, gauge?: Gauge, opts?: RelaxOptions): Model {
  const graph = relax(buildGraph(content, gauge), opts);
  return {
    graph,
    size: measure(graph),
    maxDiameter: maxRoundDiameter(graph),
    findings: validate(content),
    estimated: graph.estimated,
  };
}
