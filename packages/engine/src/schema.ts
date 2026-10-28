/**
 * Canonical crochet-pattern schema — the single source of truth for the engine and the
 * builder app. TellmeCrochet keeps its own copy of format version 1 and receives patterns as
 * drafts in its own structure (see `tellmecrochet.ts`, docs/FORMAT.md "Hand-off to
 * TellmeCrochet").
 *
 * See docs/FORMAT.md. Stitches are stored language-neutral as codes; rendering a code to
 * DE/US/UK display strings is a separate, display-side concern that does not live here.
 * The numeric, language-neutral stitch properties (produces / consumes) live in
 * STITCH_PROPERTIES so the stitch-count check and the stitch graph build on them
 * independently of any glossary.
 *
 * Format versions: parsers read `schemaVersion` 1 and 2, writers write 2
 * (`CURRENT_SCHEMA_VERSION`). Version 2 is purely additive — colours, stitch groups, the
 * codes BOBBLE/PUFF/POPCORN/PICOT, the modifiers FP/BP, rounds around a foundation chain
 * (`Row.around`), a part's finish and stuffing — so every v1 document is a valid v2 document.
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
 *   INC = increase · DEC = decrease · INVDEC = invisible decrease · ST = generic stitch ·
 *   BOBBLE = bobble · PUFF = puff stitch · POPCORN = popcorn · PICOT = picot (format v2)
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
  "BOBBLE",
  "PUFF",
  "POPCORN",
  "PICOT",
]);

/**
 * Modifiers instead of a code explosion.
 *   BLO = back loop only · FLO = front loop only · TOG = worked together ·
 *   FP = front post · BP = back post (format v2; only on post stitches, see `isPostStitch`)
 */
export const ModSchema = z.enum(["BLO", "FLO", "TOG", "FP", "BP"]);

/**
 * Id of a colour in the export's palette (`BuilderOverview.colors`). Format v2. Whether the
 * id exists is checked by `validate` / `validateExport`, not by the schema.
 */
export const ColorIdSchema = z.string().min(1);

/** Finish of a part (format v2): left open, gathered shut, or crocheted flat shut. */
export const FinishSchema = z.enum(["open", "gather", "flat"]);

/** How firmly a part is stuffed (format v2). */
export const StuffingSchema = z.enum(["none", "light", "firm"]);

/**
 * A single stitch operation: a code worked `count` times, with optional modifiers.
 * `into` is a display-only note ("into next chain space") and does NOT affect the
 * stitch-count check. `color` (format v2) switches the working colour from this op on; it
 * stays until the next switch.
 */
export const StitchOpSchema = z
  .object({
    kind: z.literal("stitch"),
    code: StitchCodeSchema,
    count: z.number().int().positive(),
    modifiers: z.array(ModSchema).optional(),
    into: z.string().optional(),
    color: ColorIdSchema.optional(),
  })
  .strict();

/**
 * A repeat group, e.g. "6× (1 SC, INC)". Recursive: it may nest further repeats and stitch
 * groups, wired via z.lazy so the type can reference itself.
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

/**
 * A repeat inside a stitch group, e.g. the "2×" of "(2× (1 DC), 1 CH, 2× (1 DC)) in one
 * stitch". Like `RepeatGroupSchema`, but it may not contain stitch groups.
 */
export const GroupRepeatSchema: z.ZodType<GroupRepeat> = z.lazy(() =>
  z
    .object({
      kind: z.literal("repeat"),
      times: z.number().int().positive(),
      ops: z.array(GroupOpSchema),
    })
    .strict(),
);

/** What a stitch group may contain: stitches and repeats, never another group. */
export const GroupOpSchema: z.ZodType<GroupOp> = z.lazy(() => z.union([StitchOpSchema, GroupRepeatSchema]));

/**
 * A stitch group (format v2): all its stitches are worked into the same stitch — "3 SC in
 * one stitch", an HDC increase, a shell, a V-stitch. It consumes one stitch of the previous
 * row (none when it is empty) and produces the sum of its stitches. Groups do not nest.
 */
export const StitchGroupSchema: z.ZodType<StitchGroup> = z.lazy(() =>
  z
    .object({
      kind: z.literal("group"),
      ops: z.array(GroupOpSchema),
    })
    .strict(),
);

/** An operation is a single stitch op, a (recursive) repeat group or a stitch group. */
export const OpSchema: z.ZodType<Op> = z.lazy(() =>
  z.union([StitchOpSchema, RepeatGroupSchema, StitchGroupSchema]),
);

/**
 * A row or round. `id` is a stable UUID so editor reordering does not invalidate
 * progress/checkpoints. `stitchCountTarget` is the author-declared stitch count the
 * stitch-count check validates against. `color` (format v2) switches the working colour at
 * the start of the row; it stays until the next switch.
 *
 * `around` (format v2, oval start): the round is worked around both sides of the foundation
 * chain right before it — first along one side from the hook end (as a row into the chain),
 * around the far end, then back along the other side ("ch 7; sc in 2nd ch from hook, 4 sc,
 * 3 sc in last ch, working on the other side: 4 sc, 2 sc in last ch"). It may work into up to
 * twice as many stitches as the chain has. The previous stitch row must be a chain (else a
 * validation finding, `AROUND_WITHOUT_CHAIN`); only `true` is stored, never `false`.
 */
export const RowSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().optional(),
    type: z.enum(["row", "round"]),
    ops: z.array(OpSchema),
    stitchCountTarget: z.number().int().nonnegative(),
    note: z.string().optional(),
    color: ColorIdSchema.optional(),
    around: z.literal(true).optional(),
  })
  .strict();

/** Format versions a parser accepts. Every v1 document is a valid v2 document. */
export const SchemaVersionSchema = z.union([z.literal(1), z.literal(2)]);

/** The format version writers write. */
export const CURRENT_SCHEMA_VERSION = 2 as const;

/** Codes that only exist since format version 2. */
const V2_CODES: ReadonlySet<string> = new Set(["BOBBLE", "PUFF", "POPCORN", "PICOT"]);
/** Modifiers that only exist since format version 2. */
const V2_MODS: ReadonlySet<string> = new Set(["FP", "BP"]);

function opsUseV2(ops: readonly Op[]): boolean {
  return ops.some((op) => {
    if (op.kind === "group") return true;
    if (op.kind === "repeat") return opsUseV2(op.ops);
    return op.color !== undefined || V2_CODES.has(op.code) || (op.modifiers ?? []).some((m) => V2_MODS.has(m));
  });
}

/**
 * Whether a part uses anything of format version 2: `finish`, `stuffing`, a row or stitch
 * colour, a round worked around a chain (`around`), a stitch group, the codes
 * BOBBLE/PUFF/POPCORN/PICOT or the modifiers FP/BP. Such a part must say `schemaVersion: 2`
 * (a version-1 reader would reject it).
 */
export function usesFormatV2(content: {
  finish?: unknown;
  stuffing?: unknown;
  rows: readonly { color?: string; around?: true; ops: readonly Op[] }[];
}): boolean {
  if (content.finish !== undefined || content.stuffing !== undefined) return true;
  return content.rows.some((row) => row.color !== undefined || row.around !== undefined || opsUseV2(row.ops));
}

/**
 * The content of one project part (head/body/arm/…). Stored as a single JSONB
 * document; carries `schemaVersion` for forward migrations. `finish` and `stuffing` are
 * format v2; without them the engine guesses from the shape (see `relax`). A document that
 * says `schemaVersion: 1` but uses a version-2 feature is rejected (`usesFormatV2`).
 */
export const PartContentSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    rows: z.array(RowSchema),
    finish: FinishSchema.optional(),
    stuffing: StuffingSchema.optional(),
  })
  .strict()
  .superRefine((content, ctx) => {
    if (content.schemaVersion === 1 && usesFormatV2(content)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schemaVersion"],
        message:
          "Uses format version 2 features (colours, groups, new stitches, rounds around a chain, finish or stuffing) but says schemaVersion 1",
      });
    }
  });

// ---------------------------------------------------------------------------
// Inferred TypeScript types — keep app/edge code in lock-step with the schema.
// ---------------------------------------------------------------------------

export type StitchCode = z.infer<typeof StitchCodeSchema>;
export type Mod = z.infer<typeof ModSchema>;
export type ColorId = z.infer<typeof ColorIdSchema>;
export type Finish = z.infer<typeof FinishSchema>;
export type Stuffing = z.infer<typeof StuffingSchema>;
export type SchemaVersion = z.infer<typeof SchemaVersionSchema>;
export type StitchOp = z.infer<typeof StitchOpSchema>;
export type RepeatGroup = {
  kind: "repeat";
  times: number;
  ops: Op[];
};
/** A repeat inside a stitch group (no nested groups). Every `GroupRepeat` is a `RepeatGroup`. */
export type GroupRepeat = {
  kind: "repeat";
  times: number;
  ops: GroupOp[];
};
export type GroupOp = StitchOp | GroupRepeat;
export type StitchGroup = {
  kind: "group";
  ops: GroupOp[];
};
export type Op = StitchOp | RepeatGroup | StitchGroup;
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
   *   - BOBBLE / PUFF / POPCORN each produce 1 (many loops closed into one top).
   *   - PICOT produces 0 — a decorative loop nothing is worked into.
   */
  producesStitches: number;
  /**
   * How many stitches of the previous row one worked instance is worked into — the
   * vertical link in the stitch graph.
   *   - Standard stitches consume 1.
   *   - INC consumes 1 (both new stitches share one parent).
   *   - DEC / INVDEC consume 2 (one new stitch has two parents).
   *   - MR and CH consume 0 (anchors, see docs/FORMAT.md).
   *   - BOBBLE / PUFF / POPCORN consume 1, PICOT 0.
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
  BOBBLE: { producesStitches: 1, consumesStitches: 1 },
  PUFF: { producesStitches: 1, consumesStitches: 1 },
  POPCORN: { producesStitches: 1, consumesStitches: 1 },
  PICOT: { producesStitches: 0, consumesStitches: 0 },
};

/** Stitches of the previous row that one worked instance of `op` consumes (TOG-aware). */
export function consumesOf(op: StitchOp): number {
  const base = STITCH_PROPERTIES[op.code].consumesStitches;
  if (base === 1 && op.modifiers?.includes("TOG")) return 2;
  return base;
}

/**
 * Stitches of the previous row a stitch group consumes: 1 when at least one of its stitches
 * is worked into something (consumes > 0), else 0 — an empty group, or one of only chains and
 * picots, is not worked into any stitch.
 */
export function consumesOfGroup(group: StitchGroup): number {
  const worksInto = (ops: readonly GroupOp[]): boolean =>
    ops.some((op) => (op.kind === "stitch" ? consumesOf(op) > 0 : worksInto(op.ops)));
  return worksInto(group.ops) ? 1 : 0;
}

/**
 * Codes that cannot stand inside a stitch group: the magic ring and the decreases (they are
 * worked into two stitches, a group into one). `TOG` is not allowed there for the same reason.
 * An `INC` may: it adds its two stitches to the group's stitch ("(inc, sc) in one" = 3 sc).
 */
export const GROUP_FORBIDDEN_CODES: readonly StitchCode[] = ["MR", "DEC", "INVDEC"];

/** Stitches that can be worked around the post of a stitch below (FP / BP modifiers). */
export const POST_STITCH_CODES: readonly StitchCode[] = ["SC", "HDC", "DC", "TR", "DTR"];

/** Whether `code` can carry the relief modifiers `FP` / `BP` (SC, HDC, DC, TR, DTR). */
export function isPostStitch(code: StitchCode): boolean {
  return POST_STITCH_CODES.includes(code);
}
