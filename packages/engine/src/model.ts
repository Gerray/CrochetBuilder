/**
 * Convenience pipeline: content (+ gauge) → validated, relaxed stitch graph with its size.
 */

import type { Gauge } from "./gauge.js";
import { buildGraph, type StitchGraph } from "./graph.js";
import { measure, maxRoundDiameter, type Size } from "./measure.js";
import { relax, type RelaxOptions } from "./relax.js";
import type { PartContent } from "./schema.js";
import { DEFAULT_MAX_STITCHES, validate, type Finding } from "./validate.js";

export interface ModelOptions extends RelaxOptions {
  /**
   * Stitch budget (default 20,000). Above it no model is built: the graph is empty
   * (`graph.overBudget`) and `findings` contains `TOO_MANY_STITCHES`.
   */
  maxStitches?: number;
}

export interface Model {
  /** Relaxed graph (positions in mm, canonical pose); empty when over the stitch budget. */
  graph: StitchGraph;
  /** Bounding size of the relaxed piece (see `measure`). */
  size: Size;
  /** Largest round diameter in mm, 0 for pieces without closed rounds. */
  maxDiameter: number;
  /**
   * `validate(content)` plus `TOO_MANY_STITCHES` when over the budget — the model is still
   * built when the pattern has other findings.
   */
  findings: Finding[];
  /** `true` when the gauge came from defaults (sizes are estimates). */
  estimated: boolean;
}

/** Validate, build the graph, relax it and measure it. */
export function buildModel(content: PartContent, gauge?: Gauge, opts: ModelOptions = {}): Model {
  const maxStitches = Number.isFinite(opts.maxStitches) ? opts.maxStitches! : DEFAULT_MAX_STITCHES;
  const built = buildGraph(content, gauge, { maxStitches });
  const graph = built.overBudget ? built : relax(built, opts);
  return {
    graph,
    size: measure(graph),
    maxDiameter: maxRoundDiameter(graph),
    findings: validate(content, { maxStitches }),
    estimated: graph.estimated,
  };
}
