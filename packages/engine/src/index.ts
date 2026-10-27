/**
 * @crochetbuilder/engine — public API.
 *
 * Schema → expansion → validation today; graph, relaxation and mesh follow (B2).
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

export {
  renderOp,
  renderOps,
  renderRow,
  rowLabel,
  parseRowText,
  resolveStitchTerm,
  resolveModTerm,
  NOTATION_LOCALES,
  STITCH_ABBREVIATIONS,
  STITCH_NAMES,
  MOD_ABBREVIATIONS,
  MOD_NAMES,
} from "./notation.js";
export type { NotationLocale, ParseRowResult, ParseRowErrorCode } from "./notation.js";

export {
  MaterialKindSchema,
  MaterialSchema,
  NotationLocaleSchema,
  BuilderPartSchema,
  BuilderOverviewSchema,
  RenderedRowsSchema,
  BuilderExportSchema,
  renderedRows,
} from "./export.js";
export type {
  MaterialKind,
  Material,
  BuilderPart,
  BuilderOverview,
  RenderedRows,
  BuilderExport,
} from "./export.js";
