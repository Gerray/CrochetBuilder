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
  countRowAtoms,
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
  MAX_YARN_DIAMETER_MM,
  YARN_DIAMETER_EXTRAPOLATION,
  resolveGauge,
  yarnDefaultsForDiameter,
} from "./gauge.js";
export type { Gauge, YarnWeight, ResolvedGauge, YarnSizeDefaults } from "./gauge.js";

export {
  validate,
  checkConsumes,
  checkStitchBudget,
  countPartAtoms,
  DEFAULT_MAX_STITCHES,
  checkStitchCounts,
  anchorsOffered,
  anchorsConsumed,
  consumesOfAtom,
  isRingRow,
  checkEmptyRepeats,
} from "./validate.js";
export type { Finding, FindingCode, ValidateOptions } from "./validate.js";

export { buildGraph, nodesOfRow } from "./graph.js";
export type {
  StitchGraph,
  StitchNode,
  StitchEdge,
  EdgeKind,
  GraphRow,
  GraphRowKind,
  NodeId,
  BuildGraphOptions,
} from "./graph.js";

export { relax, isClosedPiece, canonicalPose } from "./relax.js";
export type { RelaxOptions } from "./relax.js";

export { measure, measureRounds, maxRoundDiameter } from "./measure.js";
export type { Size, RoundMeasure } from "./measure.js";

export { nodeForCursor } from "./cursor.js";
export type { StitchCursor } from "./cursor.js";

export { toMesh } from "./mesh.js";
export type { MeshData, MeshOptions, MeshStyle } from "./mesh.js";
export { STITCH_YARN_MAX_WIDTH, STITCH_YARN_SCALE, stitchDetail, stitchYarn, stitchYarnRadius } from "./stitch-mesh.js";
export type { YarnArc, YarnLoop, YarnPiece, YarnPost } from "./stitch-mesh.js";

export { buildModel } from "./model.js";
export type { Model, ModelOptions } from "./model.js";

export {
  renderOp,
  renderOps,
  renderRow,
  rowLabel,
  parseRowText,
  resolveStitchTerm,
  resolveModTerm,
  stitchVocabulary,
  countWorkedStitches,
  opsWithinLimits,
  modifierAllowed,
  normalizeModifiers,
  MAX_COUNT,
  MAX_TIMES,
  MAX_ROW_STITCHES,
  MAX_STITCH_COUNT_TARGET,
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

export {
  encodeShare,
  decodeShare,
  readShareFragment,
  canonicalSharePayload,
  exceedsJsonDepth,
  buildTmcImportUrl,
  buildViewerUrl,
  ShareDecodeError,
  SHARE_VERSION,
  MAX_SHARE_JSON_BYTES,
  MAX_SHARE_CHARS,
  MAX_JSON_DEPTH,
  TMC_IMPORT_URL,
} from "./share.js";
export type { ShareDecodeErrorCode } from "./share.js";
