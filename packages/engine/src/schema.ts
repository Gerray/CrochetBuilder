/**
 * Canonical crochet-pattern schema — the single source of truth for the engine, the
 * builder app and TellmeCrochet (which re-exports it via @tellmecrochet/shared).
 *
 * See docs/FORMAT.md. Stitches are stored language-neutral as codes; rendering a code to
 * DE/US/UK display strings is a separate, display-side concern that does not live here.
 * The numeric, language-neutral stitch properties (produces / consumes) live in
 * STITCH_PROPERTIES so the stitch-count check and the stitch graph build on them
 * independently of any glossary.
 *
 * Note: this Zod schema validates *shape*, not crochet correctness — a recursive
 * RepeatGroup tree cannot enforce row stitch counts. The real guarantee is
 * server-side Zod parsing PLUS the deterministic stitch-count check.
 */

import { z } from "zod";

/**
 * Stitch codes (extensible). Language-neutral identities — never store display text.
 *   CH = chain · SL_ST = slip stitch · SC = single crochet · HDC = half double ·
 *   DC = double · TR = treble · DTR = double treble · MR = magic ring ·
 *   INC = increase · DEC = decrease · INVDEC = invisible decrease · ST = generic stitch
 */
export const StitchCodeSchema = z.enum([
  "CH",
  "SL_ST",
  "SC",
  "HDC",
  "DC",
  "TR",
  "DTR",
  "MR",
  "INC",
  "DEC",
  "INVDEC",
  "ST",
]);

/**
 * Modifiers instead of a code explosion.
 *   BLO = back loop only · FLO = front loop only · TOG = worked together
 */
export const ModSchema = z.enum(["BLO", "FLO", "TOG"]);

/**
 * A single stitch operation: a code worked `count` times, with optional modifiers.
 * `into` is a display-only note ("into next chain space") and does NOT affect the
 * stitch-count check.
 */
export const StitchOpSchema = z
  .object({
    kind: z.literal("stitch"),
    code: StitchCodeSchema,
    count: z.number().int().positive(),
    modifiers: z.array(ModSchema).optional(),
    into: z.string().optional(),
  })
  .strict();

/**
 * A repeat group, e.g. "6× (1 SC, INC)". Recursive: a group may nest further groups,
 * wired via z.lazy so the type can reference itself.
 */
export const RepeatGroupSchema: z.ZodType<RepeatGroup> = z.lazy(() =>
  z
    .object({
      kind: z.literal("repeat"),
      times: z.number().int().positive(),
      ops: z.array(OpSchema),
    })
    .strict(),
);

/** An operation is either a single stitch op or a (recursive) repeat group. */
export const OpSchema: z.ZodType<Op> = z.lazy(() =>
  z.union([StitchOpSchema, RepeatGroupSchema]),
);

/**
 * A row or round. `id` is a stable UUID so editor reordering does not invalidate
 * progress/checkpoints. `stitchCountTarget` is the author-declared stitch count the
 * stitch-count check validates against.
 */
export const RowSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().optional(),
    type: z.enum(["row", "round"]),
    ops: z.array(OpSchema),
    stitchCountTarget: z.number().int().nonnegative(),
    note: z.string().optional(),
  })
  .strict();

/**
 * The content of one project part (head/body/arm/…). Stored as a single JSONB
 * document; carries `schemaVersion` for forward migrations.
 */
export const PartContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    rows: z.array(RowSchema),
  })
  .strict();

// ---------------------------------------------------------------------------
// Inferred TypeScript types — keep app/edge code in lock-step with the schema.
// ---------------------------------------------------------------------------

export type StitchCode = z.infer<typeof StitchCodeSchema>;
export type Mod = z.infer<typeof ModSchema>;
export type StitchOp = z.infer<typeof StitchOpSchema>;
export type RepeatGroup = {
  kind: "repeat";
  times: number;
  ops: Op[];
};
export type Op = StitchOp | RepeatGroup;
export type Row = z.infer<typeof RowSchema>;
export type PartContent = z.infer<typeof PartContentSchema>;

// ---------------------------------------------------------------------------
// Structural, language-neutral stitch properties — basis of the stitch-count check
// and of the stitch graph.
// ---------------------------------------------------------------------------

export interface StitchProperties {
  /**
   * How many stitches one worked instance adds to the fabric stitch count.
   *   - Standard stitches (SC/HDC/DC/TR/DTR/SL_ST/ST) each produce 1.
   *   - INC produces 2 (two stitches into one).
   *   - DEC / INVDEC each produce 1 (two stitches worked together into one).
   *   - MR (magic ring) produces 0 — it only opens the round.
   *   - CH (turning/standing chain at a row start) produces 0.
   */
  producesStitches: number;
  /**
   * How many stitches of the previous row one worked instance is worked into — the
   * vertical link in the stitch graph.
   *   - Standard stitches consume 1.
   *   - INC consumes 1 (both new stitches share one parent).
   *   - DEC / INVDEC consume 2 (one new stitch has two parents).
   *   - MR and CH consume 0 (anchors, see docs/FORMAT.md).
   * The `TOG` modifier raises a 1-consuming code to 2 (e.g. "SC TOG" = sc2tog).
   */
  consumesStitches: number;
}

export const STITCH_PROPERTIES: Record<StitchCode, StitchProperties> = {
  CH: { producesStitches: 0, consumesStitches: 0 },
  SL_ST: { producesStitches: 1, consumesStitches: 1 },
  SC: { producesStitches: 1, consumesStitches: 1 },
  HDC: { producesStitches: 1, consumesStitches: 1 },
  DC: { producesStitches: 1, consumesStitches: 1 },
  TR: { producesStitches: 1, consumesStitches: 1 },
  DTR: { producesStitches: 1, consumesStitches: 1 },
  MR: { producesStitches: 0, consumesStitches: 0 },
  INC: { producesStitches: 2, consumesStitches: 1 },
  DEC: { producesStitches: 1, consumesStitches: 2 },
  INVDEC: { producesStitches: 1, consumesStitches: 2 },
  ST: { producesStitches: 1, consumesStitches: 1 },
};

/** Stitches of the previous row that one worked instance of `op` consumes (TOG-aware). */
export function consumesOf(op: StitchOp): number {
  const base = STITCH_PROPERTIES[op.code].consumesStitches;
  if (base === 1 && op.modifiers?.includes("TOG")) return 2;
  return base;
}
