/**
 * Convenience pipeline: content (+ gauge) → validated, relaxed stitch graph with its size.
 */

import type { Gauge } from "./gauge.js";
import { buildGraph, type StitchGraph } from "./graph.js";
import { measure, maxRoundDiameter, type Size } from "./measure.js";
import { relax, relaxOptionsForPart, resolveFinish, type RelaxOptions } from "./relax.js";
import type { Finish, PartContent } from "./schema.js";
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
  /**
   * How the last round was finished in the relaxation (the part's `finish`, else the
   * heuristic). Pass it on to `toMesh` so the mesh closes the piece the same way.
   */
  finish: Finish;
}

/**
 * The relaxation options for a part: the part's own `finish` and `stuffing` (format v2,
 * `relaxOptionsForPart`) unless the caller sets them — an explicit `finish`, `closed` or
 * numeric `stuffing` wins; `stuffing: "auto"` defers to the part.
 */
export function partRelaxOptions(content: PartContent, opts: RelaxOptions = {}): RelaxOptions {
  const own = relaxOptionsForPart(content);
  const out: RelaxOptions = { ...opts };
  if (opts.finish === undefined && opts.closed === undefined && own.finish) out.finish = own.finish;
  if ((opts.stuffing === undefined || opts.stuffing === "auto") && own.stuffing !== undefined) out.stuffing = own.stuffing;
  return out;
}

/** Validate, build the graph, relax it (with the part's finish and stuffing) and measure it. */
export function buildModel(content: PartContent, gauge?: Gauge, opts: ModelOptions = {}): Model {
  const maxStitches = Number.isFinite(opts.maxStitches) ? opts.maxStitches! : DEFAULT_MAX_STITCHES;
  const built = buildGraph(content, gauge, { maxStitches });
  const relaxOpts = partRelaxOptions(content, opts);
  const graph = built.overBudget ? built : relax(built, relaxOpts);
  return {
    graph,
    finish: resolveFinish(graph, relaxOpts),
    size: measure(graph),
    maxDiameter: maxRoundDiameter(graph),
    findings: validate(content, { maxStitches }),
    estimated: graph.estimated,
  };
}
