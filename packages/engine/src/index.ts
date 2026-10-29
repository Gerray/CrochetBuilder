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
  JoinRefSchema,
  RepeatGroupSchema,
  GroupRepeatSchema,
  GroupOpSchema,
  StitchGroupSchema,
  OpSchema,
  RowSchema,
  PartContentSchema,
  SchemaVersionSchema,
  CURRENT_SCHEMA_VERSION,
  ColorIdSchema,
  FinishSchema,
  StuffingSchema,
  STITCH_PROPERTIES,
  POST_STITCH_CODES,
  consumesOf,
  isPostStitch,
  consumesOfGroup,
  usesFormatV2,
  GROUP_FORBIDDEN_CODES,
} from "./schema.js";
export type {
  StitchCode,
  Mod,
  StitchOp,
  JoinRef,
  RepeatGroup,
  GroupRepeat,
  GroupOp,
  StitchGroup,
  Op,
  Row,
  PartContent,
  StitchProperties,
  SchemaVersion,
  ColorId,
  Finish,
  Stuffing,
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
  STITCH_BULGE,
  MAX_YARN_DIAMETER_MM,
  YARN_DIAMETER_EXTRAPOLATION,
  resolveGauge,
  yarnDefaultsForDiameter,
  flatIncreasesPerRound,
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
  anchorsAvailable,
  aroundCapacity,
  hookSkipOf,
  worksAroundChain,
  isChainRow,
  consumesOfAtom,
  isRingRow,
  checkEmptyRepeats,
  checkEmptyGroups,
  checkModifiers,
  checkColors,
  checkGroups,
  checkJoins,
  rowWorksFromOtherPart,
} from "./validate.js";
export type { Finding, FindingCode, ValidateOptions } from "./validate.js";

export { colorsOfStitches, nodeColorIndices } from "./color.js";
export type { PaletteEntry } from "./color.js";

export { PlacementSchema, PlacementKindSchema, placementAnchor } from "./assembly.js";
export type { Placement, PlacementKind, Anchor, Vec3 } from "./assembly.js";

export {
  composeAssembly,
  anchorOfNode,
  nodeAnchorAngles,
  applyTransform,
  composeTransforms,
  transformMatrix4,
  rotate,
  IDENTITY_TRANSFORM,
  DEFAULT_EYE_MM,
  DEFAULT_MARK_MM,
} from "./assembly-scene.js";
export {
  placementText,
  assemblyLines,
  rowPositionText,
  rowWord,
  angleText,
  degreesText,
  isMirroredPair,
  isUsableAttach,
  partIndexById,
  partNameById,
  placementPartName,
} from "./assembly-text.js";
export type { PlacementTextDoc } from "./assembly-text.js";
export type {
  AssemblyScene,
  AssemblyDocument,
  AssemblyPartModel,
  AssemblyFinding,
  AssemblyFindingCode,
  ComposeOptions,
  EyeInstance,
  MarkInstance,
  Mat3,
  NodeAnchor,
  PartInstance,
  RigidTransform,
} from "./assembly-scene.js";

export { buildGraph, nodesOfRow, isFabricNode, LEG_LEAN } from "./graph.js";
export type {
  StitchGraph,
  StitchNode,
  StitchEdge,
  EdgeKind,
  GraphRow,
  GraphRowKind,
  NodeId,
  BuildGraphOptions,
  AnchorSlot,
} from "./graph.js";

export {
  relax,
  relaxBodies,
  stitchParticles,
  stuffingOf,
  isClosedPiece,
  canonicalPose,
  resolveFinish,
  relaxOptionsForPart,
  seamStrip,
  STUFFING_LEVELS,
} from "./relax.js";
export type { RelaxOptions, RelaxBody, RelaxBodiesOptions, RelaxBodiesResult, BodySpring, ParticleRef } from "./relax.js";

export { measure, measureRounds, maxRoundDiameter } from "./measure.js";
export type { Size, RoundMeasure } from "./measure.js";

export { nodeForCursor } from "./cursor.js";
export type { StitchCursor } from "./cursor.js";

export { SMOOTH_MAX_NODES, toMesh } from "./mesh.js";
export type { MeshData, MeshOptions, MeshStyle } from "./mesh.js";
export { STITCH_YARN_MAX_WIDTH, STITCH_YARN_SCALE, stitchDetail, stitchYarn, stitchYarnRadius } from "./stitch-mesh.js";
export type { StitchClosing, YarnArc, YarnLoop, YarnPiece, YarnPost } from "./stitch-mesh.js";

export { buildModel, partRelaxOptions } from "./model.js";
export type { Model, ModelOptions } from "./model.js";

export {
  planJoins,
  lastStitchRow,
  rowHasJoin,
  partHasJoin,
  joinCapacity,
  gathersByDefault,
} from "./join.js";
export type {
  JoinDocument,
  JoinFinding,
  JoinFindingCode,
  JoinInstance,
  JoinKind,
  JoinLink,
  JoinPlan,
  JoinSource,
} from "./join.js";
export { buildJoinedModels, joinedKey } from "./joined.js";
export type { JoinBridge, JoinedComponent, JoinedModels, JoinedPart } from "./joined.js";

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
  AROUND_MARKS,
} from "./notation.js";
export type { NotationLocale, ParseRowResult, ParseRowErrorCode, ParseRowContext } from "./notation.js";

export { detectNotationLocale } from "./detect-locale.js";
export type { LocaleDetection } from "./detect-locale.js";

export { parsePatternText } from "./pattern-import.js";
export { colorKey } from "./pattern-details.js";
export type {
  PatternImport,
  ImportedPart,
  ImportedColor,
  ImportIssue,
  ImportIssueCode,
  ImportIssueSeverity,
  ParsePatternOptions,
} from "./pattern-import.js";

export {
  MaterialKindSchema,
  MaterialSchema,
  NotationLocaleSchema,
  BuilderPartSchema,
  BuilderOverviewSchema,
  RenderedRowsSchema,
  BuilderExportSchema,
  PaletteColorSchema,
  renderedRows,
  renderedRowLine,
  validateExport,
  withCurrentVersion,
} from "./export.js";
export type {
  MaterialKind,
  Material,
  PaletteColor,
  ExportFinding,
  ExportFindingCode,
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
  buildViewerUrl,
  ShareDecodeError,
  SHARE_VERSION,
  MAX_SHARE_JSON_BYTES,
  MAX_SHARE_CHARS,
  MAX_JSON_DEPTH,
} from "./share.js";
export type { ShareDecodeErrorCode } from "./share.js";

export {
  TMC_STITCH_CODES,
  TmcStitchCodeSchema,
  TmcModSchema,
  TmcStitchOpSchema,
  TmcRepeatSchema,
  TmcOpSchema,
  TmcRowSchema,
  TmcPartContentSchema,
  TmcMaterialSchema,
  TmcRowStitchCheckSchema,
  TmcDraftPartSchema,
  TmcDraftSchema,
  TmcEnvelopeSchema,
  TmcOriginHintSchema,
  TMC_ASSEMBLY_PART_NAME,
  TMC_PAYLOAD_VERSION,
  TMC_IMPORT_URL,
  toTellmeCrochetDraft,
  toTmcEnvelope,
  summarizeTmcLosses,
  describePlacement,
  gaugeText,
  partDisplayName,
  encodeTmcPayload,
  decodeTmcPayload,
  buildTmcImportUrl,
} from "./tellmecrochet.js";
export type {
  TmcStitchCode,
  TmcMod,
  TmcStitchOp,
  TmcRepeat,
  TmcOp,
  TmcRow,
  TmcPartContent,
  TmcMaterial,
  TmcRowStitchCheck,
  TmcDraftPart,
  TmcDraft,
  TmcEnvelope,
  TmcOriginHint,
  TmcLoss,
  TmcLossCode,
  TmcTextFeature,
  TmcDraftResult,
  TmcDraftOptions,
} from "./tellmecrochet.js";
