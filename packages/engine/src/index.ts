/**
 * @crochetbuilder/engine — public API.
 *
 * Schema → expansion → validation → stitch graph → relaxation → measurements / mesh.
 * Everything here is pure TypeScript with no UI or framework imports.
 */

export const PACKAGE_NAME = "@crochetbuilder/engine" as const;

export {
  StitchCodeSchema,
  ModSchema,
  StitchOpSchema,
  RepeatGroupSchema,
  OpSchema,
  RowSchema,
  PartContentSchema,
  STITCH_PROPERTIES,
  consumesOf,
} from "./schema.js";
export type {
  StitchCode,
  Mod,
  StitchOp,
  RepeatGroup,
  Op,
  Row,
  PartContent,
  StitchProperties,
} from "./schema.js";

export {
  expandRow,
  expandPart,
  isInstructionRow,
  instructionText,
  rowOrdinals,
  INSTRUCTION_CODE,
} from "./expand.js";
export type { AtomicStitch, RowStitch, AtomCode } from "./expand.js";

export { computeRowStitches, checkPart } from "./stitch-count.js";
export type { RowStitchCheck } from "./stitch-count.js";

export {
  GaugeSchema,
  YarnWeightSchema,
  YARN_WEIGHT_DEFAULTS,
  DEFAULT_YARN_WEIGHT,
  STITCH_HEIGHT_FACTOR,
  resolveGauge,
} from "./gauge.js";
export type { Gauge, YarnWeight, ResolvedGauge } from "./gauge.js";

export {
  validate,
  checkConsumes,
  checkStitchCounts,
  anchorsOffered,
  anchorsConsumed,
  consumesOfAtom,
  isRingRow,
} from "./validate.js";
export type { Finding, FindingCode } from "./validate.js";

export { buildGraph, nodesOfRow } from "./graph.js";
export type {
  StitchGraph,
  StitchNode,
  StitchEdge,
  EdgeKind,
  GraphRow,
  GraphRowKind,
  NodeId,
} from "./graph.js";
