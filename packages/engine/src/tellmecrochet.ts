/**
 * Hand-off to TellmeCrochet — a builder export turned into a TellmeCrochet pattern draft.
 *
 * TellmeCrochet keeps its own copy of format version 1 and creates new patterns only from
 * drafts: `{ schemaVersion: 1, title?, materials?, parts: [{ name, quantity, content,
 * stitchCheck }] }`. This module maps a (version 2) builder export onto that shape and says
 * what it could not carry over as structure (`losses`). Nothing is dropped silently: what
 * version 1 cannot express becomes a free instruction (a row without stitches whose `note`
 * holds the text), which TellmeCrochet's guided mode shows as a step of its own.
 *
 * The draft travels in an envelope (`TmcEnvelope`) that also carries the notation and a hint
 * about the origin of the pattern, packed like a share payload with the prefix `tmc1.` (see
 * docs/FORMAT.md, "Hand-off to TellmeCrochet"). The schemas here are this repository's own
 * description of the documented target shape.
 *
 * Pure functions, no UI or framework imports.
 */

import { z } from "zod";
import type { Placement } from "./assembly.js";
import { isMirroredPair } from "./assembly-text.js";
import { instructionText, rowOrdinals } from "./expand.js";
import { renderedRowLine, type BuilderExport, type BuilderPart, type Material, type PaletteColor } from "./export.js";
import type { Gauge, YarnWeight } from "./gauge.js";
import { renderRow, rowLabel } from "./notation.js";
import type { Op, Row, StitchCode } from "./schema.js";
import { packJson, ShareDecodeError, unpackJson } from "./share.js";
import { checkPart, computeRowStitches } from "./stitch-count.js";

// ---------------------------------------------------------------------------
// Target shape (format version 1 as TellmeCrochet reads it)
// ---------------------------------------------------------------------------

/** Stitch codes of format version 1. */
export const TMC_STITCH_CODES = ["CH", "SL_ST", "SC", "HDC", "DC", "TR", "DTR", "MR", "INC", "DEC", "INVDEC", "ST"] as const;

export const TmcStitchCodeSchema = z.enum(TMC_STITCH_CODES);
export const TmcModSchema = z.enum(["BLO", "FLO", "TOG"]);

export const TmcStitchOpSchema = z
  .object({
    kind: z.literal("stitch"),
    code: TmcStitchCodeSchema,
    count: z.number().int().positive(),
    modifiers: z.array(TmcModSchema).optional(),
    into: z.string().optional(),
  })
  .strict();

export type TmcStitchCode = z.infer<typeof TmcStitchCodeSchema>;
export type TmcMod = z.infer<typeof TmcModSchema>;
export type TmcStitchOp = z.infer<typeof TmcStitchOpSchema>;
export type TmcRepeat = { kind: "repeat"; times: number; ops: TmcOp[] };
export type TmcOp = TmcStitchOp | TmcRepeat;

export const TmcRepeatSchema: z.ZodType<TmcRepeat> = z.lazy(() =>
  z
    .object({
      kind: z.literal("repeat"),
      times: z.number().int().positive(),
      ops: z.array(TmcOpSchema),
    })
    .strict(),
);

export const TmcOpSchema: z.ZodType<TmcOp> = z.lazy(() => z.union([TmcStitchOpSchema, TmcRepeatSchema]));

/** A row of format version 1: no colours. A row without stitches but with text is a free instruction. */
export const TmcRowSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().optional(),
    type: z.enum(["row", "round"]),
    ops: z.array(TmcOpSchema),
    stitchCountTarget: z.number().int().nonnegative(),
    note: z.string().optional(),
  })
  .strict();

export const TmcPartContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    rows: z.array(TmcRowSchema),
  })
  .strict();

/** A material line; unlike the builder's, the label (and every colour, the amount) is never empty. */
export const TmcMaterialSchema = z
  .object({
    kind: z.enum(["yarn", "hook", "accessory"]),
    label: z.string().min(1),
    colors: z.array(z.string().min(1)).optional(),
    amount: z.string().min(1).optional(),
  })
  .strict();

/** Stitch-count check of one row: declared target against the stitches its ops produce. */
export const TmcRowStitchCheckSchema = z
  .object({
    rowId: z.string(),
    expected: z.number().int().nonnegative(),
    actual: z.number().int().nonnegative(),
    ok: z.boolean(),
  })
  .strict();

export const TmcDraftPartSchema = z
  .object({
    name: z.string().min(1),
    quantity: z.number().int().positive(),
    content: TmcPartContentSchema,
    stitchCheck: z.array(TmcRowStitchCheckSchema),
  })
  .strict();

/** A TellmeCrochet pattern draft: version 1, optional title and materials, at least one part. */
export const TmcDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().optional(),
    materials: z.array(TmcMaterialSchema).optional(),
    parts: z.array(TmcDraftPartSchema).min(1),
  })
  .strict();

/**
 * Where the pattern presumably comes from: `imported` once text from elsewhere was pasted into
 * the document, else `self_created`. Only a hint — the receiving app decides (see
 * docs/FORMAT.md, "Hand-off to TellmeCrochet").
 */
export const TmcOriginHintSchema = z.enum(["self_created", "imported"]);

/**
 * What the hand-off link and file carry: the draft plus the two facts TellmeCrochet stores
 * next to it — the notation the text is written in and a hint where the pattern comes from.
 */
export const TmcEnvelopeSchema = z
  .object({
    format: z.literal("tmc-draft"),
    version: z.literal(1),
    sourceNotation: z.enum(["de", "us", "uk"]),
    originHint: TmcOriginHintSchema,
    draft: TmcDraftSchema,
  })
  .strict();

export type TmcRow = z.infer<typeof TmcRowSchema>;
export type TmcPartContent = z.infer<typeof TmcPartContentSchema>;
export type TmcMaterial = z.infer<typeof TmcMaterialSchema>;
export type TmcRowStitchCheck = z.infer<typeof TmcRowStitchCheckSchema>;
export type TmcDraftPart = z.infer<typeof TmcDraftPartSchema>;
export type TmcDraft = z.infer<typeof TmcDraftSchema>;
export type TmcEnvelope = z.infer<typeof TmcEnvelopeSchema>;
export type TmcOriginHint = z.infer<typeof TmcOriginHintSchema>;

// ---------------------------------------------------------------------------
// Losses
// ---------------------------------------------------------------------------

export type TmcLossCode =
  /**
   * A row with stitch groups, bobble-family stitches, picots or relief stitches, or a round
   * worked around a foundation chain, became text.
   */
  | "row-as-text"
  /** The colour a part starts with became an instruction (palettes of two or more colours). */
  | "color-start"
  /** A colour change at the start of a row became an instruction before it. */
  | "color-change"
  /** A colour change inside a row became a note on the row. */
  | "color-in-row"
  /** The part's finish became an instruction at its end. */
  | "finish"
  /** The part's stuffing became an instruction at its end. */
  | "stuffing"
  /** A placement of the assembly became an instruction of the part "Zusammensetzen". */
  | "assembly"
  /** The notes became an instruction at the start of the first part. */
  | "notes"
  /** Gauge, yarn and hook became an instruction at the start of the first part. */
  | "gauge"
  /** The palette became colours of the yarn materials. */
  | "palette"
  /** A material without a name was left out. */
  | "material-dropped"
  /** A part without a name is called "Teil n". */
  | "part-unnamed"
  /** A part without rows got a placeholder instruction. */
  | "part-empty"
  /** A row id that occurs twice in a part got a new id. */
  | "row-id-changed";

/**
 * What became text in a row: stitch groups, the bobble family, picots, relief stitches, a
 * round worked around a foundation chain (`around`).
 */
export type TmcTextFeature = "group" | "bobble" | "puff" | "popcorn" | "picot" | "relief" | "around";

/** Something the draft carries differently from the builder export (German `message`). */
export interface TmcLoss {
  code: TmcLossCode;
  /** Index of the part in the builder export. */
  partIndex?: number;
  /** Row id in the builder export. */
  rowId?: string;
  /** Placement id (`assembly`). */
  placementId?: string;
  /** Row type (`row-as-text`, `color-start`, `color-change`, `color-in-row`). */
  rowType?: "row" | "round";
  /** Name of the extra part that holds the assembly (`assembly`). */
  partName?: string;
  /** What made the row text (`row-as-text`). */
  features?: TmcTextFeature[];
  message: string;
}

export interface TmcDraftResult {
  draft: TmcDraft;
  losses: TmcLoss[];
}

export interface TmcDraftOptions {
  /** Name of the extra last part that holds the assembly. Default "Zusammensetzen". */
  assemblyPartName?: string;
}

export const TMC_ASSEMBLY_PART_NAME = "Zusammensetzen";

// ---------------------------------------------------------------------------
// German wording
// ---------------------------------------------------------------------------

/** German number with at most two decimals: 3.5 → "3,5". */
function deNum(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

const YARN_WEIGHT_NAMES: Record<YarnWeight, string> = {
  lace: "Lace",
  fingering: "Fingering",
  sport: "Sport",
  dk: "DK",
  worsted: "Worsted",
  aran: "Aran",
  bulky: "Bulky",
  jumbo: "Jumbo",
};

/**
 * Gauge, yarn and hook in one German line, or null when nothing is given:
 * "Maschenprobe: 20 M × 22 R = 10 × 10 cm · Garn: DK · Garndicke: 2,5 mm · Nadel: 3,5 mm".
 */
export function gaugeText(gauge: Gauge | undefined): string | null {
  const g = gauge ?? {};
  const parts: string[] = [];
  if (g.stitchesPer10cm !== undefined || g.rowsPer10cm !== undefined) {
    const counts = [
      g.stitchesPer10cm !== undefined ? `${deNum(g.stitchesPer10cm)} M` : "",
      g.rowsPer10cm !== undefined ? `${deNum(g.rowsPer10cm)} R` : "",
    ].filter(Boolean);
    parts.push(`Maschenprobe: ${counts.join(" × ")} = 10 × 10 cm`);
  }
  if (g.yarnWeight) parts.push(`Garn: ${YARN_WEIGHT_NAMES[g.yarnWeight]}`);
  if (g.yarnDiameterMm !== undefined) parts.push(`Garndicke: ${deNum(g.yarnDiameterMm)} mm`);
  if (g.hookMm !== undefined) parts.push(`Nadel: ${deNum(g.hookMm)} mm`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Name of a part as both apps show it: its own name, else "Teil n" (`index` from 0). */
export function partDisplayName(name: string, index: number): string {
  return name.trim() || `Teil ${index + 1}`;
}

/** "vorne", "vorne rechts", …, "hinten" around a round; positive angles turn right (seen from the front). */
function roundSide(angle: number): string {
  const a = ((((angle + 180) % 360) + 360) % 360) - 180;
  const abs = Math.abs(a);
  const side = a > 0 ? "rechts" : "links";
  if (abs <= 22.5) return "vorne";
  if (abs <= 67.5) return `vorne ${side}`;
  if (abs <= 112.5) return side;
  if (abs <= 157.5) return `hinten ${side}`;
  return "hinten";
}

/** Along a flat row: −180 is the left end, 0 the middle, 180 the right end. */
function rowSide(angle: number): string {
  const a = Math.max(-180, Math.min(180, angle));
  if (Math.abs(a) <= 20) return "in der Mitte";
  if (Math.abs(a) >= 160) return a > 0 ? "am rechten Rand" : "am linken Rand";
  return a > 0 ? "rechts" : "links";
}

/** "zwischen Runde 8 und 9", "in Runde 12" (last row) or "bei „Augen einsetzen“" (free instruction). */
function rowPhrase(rows: readonly Row[], rowId: string): { text: string; type: "row" | "round" } | null {
  const index = rows.findIndex((r) => r.id === rowId);
  if (index < 0) return null;
  const row = rows[index]!;
  if (row.ops.length === 0) {
    const text = instructionText(row);
    return { text: text ? `bei „${text}“` : "", type: row.type };
  }
  const ordinals = rowOrdinals(rows);
  const nextIndex = rows.findIndex((r, i) => i > index && r.ops.length > 0);
  const label = (i: number) => rowLabel(rows[i]!, ordinals[i] ?? 0, "de");
  if (nextIndex < 0) return { text: `in ${label(index)}`, type: row.type };
  const next = rows[nextIndex]!;
  if (!row.label?.trim() && !next.label?.trim() && row.type === next.type) {
    return { text: `zwischen ${label(index)} und ${ordinals[nextIndex]}`, type: row.type };
  }
  return { text: `zwischen ${label(index)} und ${label(nextIndex)}`, type: row.type };
}

/**
 * One placement of the assembly in German words, e.g.
 * "Kopf: Sicherheitsaugen 12 mm vorne zwischen Runde 8 und 9 einsetzen, 6 Maschen Abstand." or
 * "Kopf: Ohr links zwischen Runde 14 und 15 annähen." `parts` are the export's parts (for names
 * and rows); unknown parts are named by their id, an unknown row leaves the position out.
 */
export function describePlacement(
  placement: Placement,
  parts: readonly BuilderPart[],
  assembly: readonly Placement[] = [placement],
): string {
  const indexOf = (id: string | undefined) => (id === undefined ? -1 : parts.findIndex((p) => p.id === id));
  const nameOf = (id: string) => {
    const i = indexOf(id);
    return i < 0 ? id : partDisplayName(parts[i]!.name, i);
  };
  const targetIndex = indexOf(placement.target);
  const target = nameOf(placement.target);
  const phrase = targetIndex < 0 ? null : rowPhrase(parts[targetIndex]!.content.rows, placement.row);
  const side = phrase?.type === "row" ? rowSide(placement.angle) : roundSide(placement.angle);
  const where = [side, phrase?.text ?? ""].filter(Boolean).join(" ");
  // The sentence ends with our own full stop: a note's closing punctuation is dropped.
  const note = (placement.note ?? "").trim().replace(/[\s.!?…]+$/u, "");
  const size = placement.size !== undefined ? `${deNum(placement.size)} mm` : "";

  let text: string;
  switch (placement.kind) {
    case "eyes": {
      text = `${target}: Sicherheitsaugen${size ? ` ${size}` : ""} ${where} einsetzen`;
      if (placement.spacing !== undefined) {
        text += `, ${deNum(placement.spacing)} ${placement.spacing === 1 ? "Masche" : "Maschen"} Abstand`;
      }
      if (note) text += ` – ${note}`;
      break;
    }
    case "attach": {
      const what = placement.part !== undefined ? nameOf(placement.part) : "Teil";
      text = `${target}: ${what} ${where} annähen`;
      // A part made twice with one placement: its second copy goes mirrored on the other side.
      if (isMirroredPair({ parts, assembly }, placement)) text += ", das zweite gespiegelt auf der anderen Seite";
      if (note) text += ` – ${note}`;
      break;
    }
    case "embroidery": {
      text = `${target}: ${note || "Stickerei"}${size ? ` (${size})` : ""} ${where} aufsticken`;
      break;
    }
  }
  return `${text}.`;
}

const FINISH_TEXT = {
  open: "Abschluss: das Teil bleibt offen.",
  gather: "Abschluss: die restlichen Maschen zusammenziehen und den Faden vernähen.",
  flat: "Abschluss: die Öffnung flach zusammenlegen und die Kanten zusammenhäkeln.",
} as const;

const STUFFING_TEXT = {
  none: "Füllung: nicht füllen.",
  light: "Füllung: leicht mit Füllwatte füllen.",
  firm: "Füllung: fest mit Füllwatte füllen.",
} as const;

const FEATURE_WORDS: Record<TmcTextFeature, string> = {
  group: "mehreren Maschen in einer Einstichstelle",
  bobble: "Noppen",
  puff: "Büschelmaschen",
  popcorn: "Popcornmaschen",
  picot: "Pikots",
  relief: "Reliefmaschen",
  around: "Maschen um die Luftmaschenkette herum",
};
const FEATURE_ORDER: readonly TmcTextFeature[] = ["around", "group", "bobble", "puff", "popcorn", "picot", "relief"];

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} und ${words[words.length - 1]}`;
}

/**
 * The losses of a hand-off in a few short German sentences, for a notice before opening
 * TellmeCrochet, e.g. "3 Runden mit Noppen werden in TellmeCrochet als Text-Schritt gezeigt."
 * Technical changes (new row ids) are not mentioned.
 */
export function summarizeTmcLosses(losses: readonly TmcLoss[]): string[] {
  const of = (code: TmcLossCode) => losses.filter((l) => l.code === code);
  const out: string[] = [];

  const asText = of("row-as-text");
  if (asText.length > 0) {
    const features = new Set(asText.flatMap((l) => l.features ?? []));
    const types = new Set(asText.map((l) => l.rowType ?? "round"));
    const n = asText.length;
    const noun =
      types.size > 1 ? (n === 1 ? "Zeile" : "Zeilen") : types.has("row") ? (n === 1 ? "Reihe" : "Reihen") : n === 1 ? "Runde" : "Runden";
    const words = FEATURE_ORDER.filter((f) => features.has(f)).map((f) => FEATURE_WORDS[f]);
    const with_ = words.length > 0 ? ` mit ${joinWords(words)}` : "";
    out.push(`${n} ${noun}${with_} ${n === 1 ? "wird" : "werden"} in TellmeCrochet als Text-Schritt gezeigt.`);
  }
  // "Runde", "Reihe" or both, after the rows the losses are about.
  const rowWord = (list: readonly TmcLoss[], round: string, row: string) => {
    const types = new Set(list.map((l) => l.rowType ?? "round"));
    return types.size > 1 ? `${round} bzw. ${row}` : types.has("row") ? row : round;
  };
  if (of("color-start").length > 0) out.push("Die Anfangsfarbe jedes Teils steht als eigener Schritt am Anfang.");
  const changes = of("color-change");
  if (changes.length > 0) out.push(`Farbwechsel stehen als eigener Schritt vor der ${rowWord(changes, "Runde", "Reihe")}.`);
  const inside = of("color-in-row");
  if (inside.length > 0) {
    out.push(
      `Farbwechsel mitten in einer ${rowWord(inside, "Runde", "Reihe")} stehen als Notiz an der ${rowWord(inside, "Runde", "Reihe")}.`,
    );
  }
  const finish = of("finish").length > 0;
  const stuffing = of("stuffing").length > 0;
  if (finish || stuffing) {
    const what = finish && stuffing ? "Füllung und Abschluss stehen" : finish ? "Der Abschluss steht" : "Die Füllung steht";
    out.push(`${what} als Schritt am Ende des Teils.`);
  }
  const assembly = of("assembly");
  if (assembly.length > 0) out.push(`Die Montage wird zum Teil „${assembly[0]!.partName ?? TMC_ASSEMBLY_PART_NAME}“.`);
  const notes = of("notes").length > 0;
  const gauge = of("gauge").length > 0;
  if (notes || gauge) {
    const what = [notes ? "Hinweise" : "", gauge ? "Angaben zu Garn, Nadel und Maschenprobe" : ""].filter(Boolean);
    out.push(`${joinWords(what)} stehen als Schritt am Anfang des ersten Teils.`);
  }
  if (of("palette").length > 0) out.push("Die Farben stehen beim Garn in der Materialliste.");
  const dropped = of("material-dropped").length;
  if (dropped > 0) out.push(dropped === 1 ? "1 Material ohne Namen entfällt." : `${dropped} Materialien ohne Namen entfallen.`);
  const unnamed = of("part-unnamed").map((l) => `„Teil ${(l.partIndex ?? 0) + 1}“`);
  if (unnamed.length > 0) {
    out.push(
      unnamed.length === 1
        ? `Ein Teil ohne Namen heißt ${unnamed[0]}.`
        : `Teile ohne Namen heißen ${joinWords(unnamed)}.`,
    );
  }
  const empty = of("part-empty").length;
  if (empty > 0) out.push(empty === 1 ? "1 Teil ohne Reihen bekommt einen Hinweis-Schritt." : `${empty} Teile ohne Reihen bekommen einen Hinweis-Schritt.`);
  return out;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

const V2_CODE_FEATURES: Partial<Record<StitchCode, TmcTextFeature>> = {
  BOBBLE: "bobble",
  PUFF: "puff",
  POPCORN: "popcorn",
  PICOT: "picot",
};

/** What in `ops` format version 1 cannot express (empty: the ops can be carried over). */
function textFeatures(ops: readonly Op[], out: Set<TmcTextFeature> = new Set()): Set<TmcTextFeature> {
  for (const op of ops) {
    if (op.kind === "stitch") {
      const feature = V2_CODE_FEATURES[op.code];
      if (feature) out.add(feature);
      if (op.modifiers?.some((m) => m === "FP" || m === "BP")) out.add("relief");
    } else {
      if (op.kind === "group") out.add("group");
      textFeatures(op.ops, out);
    }
  }
  return out;
}

/** `ops` in format version 1 (colours removed). Only for ops without `textFeatures`. */
function toTmcOps(ops: readonly Op[]): TmcOp[] {
  return ops.map((op): TmcOp => {
    if (op.kind === "stitch") {
      const out: TmcStitchOp = { kind: "stitch", code: op.code as TmcStitchCode, count: op.count };
      if (op.modifiers !== undefined) out.modifiers = op.modifiers as TmcMod[];
      if (op.into !== undefined) out.into = op.into;
      return out;
    }
    return { kind: "repeat", times: op.kind === "repeat" ? op.times : 1, ops: toTmcOps(op.ops) };
  });
}

/**
 * `ops` without the colour marks that only repeat the working colour (`current`), in working
 * order (a repeat's body once). Marks with ids outside the palette (`known`) stay as they are.
 * Returns the ops, the working colour after them and how many real changes they hold.
 */
function cleanColors(
  ops: readonly Op[],
  current: string | undefined,
  known: ReadonlyMap<string, string>,
): { ops: Op[]; current: string | undefined; changes: number } {
  let cur = current;
  let changes = 0;
  const walk = (list: readonly Op[]): Op[] =>
    list.map((op): Op => {
      if (op.kind !== "stitch") return { ...op, ops: walk(op.ops) } as Op;
      if (op.color === undefined || !known.has(op.color)) return op;
      if (op.color === cur) {
        const { color: _same, ...rest } = op;
        return rest;
      }
      cur = op.color;
      changes++;
      return op;
    });
  const out = walk(ops);
  return { ops: out, current: cur, changes };
}

/**
 * Ids of one draft part. The source rows' ids are reserved up front, so they keep their ids;
 * added steps and repeated source ids get a free id ("-2", "-3", … when taken).
 */
class IdPool {
  private readonly used: Set<string>;
  constructor(reserved: Iterable<string> = []) {
    this.used = new Set(reserved);
  }
  fresh(id: string): string {
    if (!this.used.has(id)) {
      this.used.add(id);
      return id;
    }
    for (let n = 2; ; n++) {
      const next = `${id}-${n}`;
      if (!this.used.has(next)) {
        this.used.add(next);
        return next;
      }
    }
  }
}

function instruction(id: string, type: "row" | "round", note: string): TmcRow {
  return { id, type, ops: [], stitchCountTarget: 0, note };
}

function finishPart(name: string, quantity: number, rows: TmcRow[]): TmcDraftPart {
  const content: TmcPartContent = { schemaVersion: 1, rows };
  return { name, quantity, content, stitchCheck: checkPart(content) };
}

function draftMaterials(materials: readonly Material[], palette: readonly PaletteColor[], losses: TmcLoss[]): TmcMaterial[] {
  const out: TmcMaterial[] = [];
  for (const m of materials) {
    const label = m.label.trim();
    if (!label) {
      losses.push({ code: "material-dropped", message: "Ein Material ohne Namen wurde weggelassen." });
      continue;
    }
    const entry: TmcMaterial = { kind: m.kind, label };
    const colors = (m.colors ?? []).map((c) => c.trim()).filter(Boolean);
    if (colors.length > 0) entry.colors = colors;
    const amount = m.amount?.trim();
    if (amount) entry.amount = amount;
    out.push(entry);
  }

  const yarns = out.filter((m) => m.kind === "yarn");
  const listed = new Set(yarns.flatMap((m) => m.colors ?? []));
  const missing: string[] = [];
  for (const c of palette) {
    const name = c.name.trim();
    if (name && !listed.has(name)) {
      listed.add(name);
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    if (yarns.length === 1) yarns[0]!.colors = [...(yarns[0]!.colors ?? []), ...missing];
    else out.push({ kind: "yarn", label: yarns.length === 0 ? "Garn" : "Garnfarben", colors: missing });
    losses.push({ code: "palette", message: `Die Farben ${missing.map((n) => `„${n}“`).join(", ")} stehen beim Garn in der Materialliste.` });
  }
  return out;
}

/**
 * The builder export `doc` as a TellmeCrochet draft (format version 1), plus what was carried
 * over differently (`losses`):
 *   - parts keep name ("Teil n" when empty) and quantity; row ids stay unique per part;
 *   - rows with stitch groups, bobble-family stitches, picots or relief stitches, and rounds
 *     worked around a foundation chain, become free instructions holding the row's full German
 *     text ("Runde 3: 6× (3 fM in dieselbe M) (18)", "Runde 2: um die Lm-Kette: 1 fM, …");
 *     the rows after such a row keep their numbers as labels ("Runde 4");
 *   - colour changes at the start of a row become an instruction before it ("Farbwechsel: Weiß"),
 *     changes inside a row a note on it; with two or more colours each part says its first colour;
 *   - stuffing and finish become instructions at the end of the part, notes and gauge
 *     instructions at the start of the first part;
 *   - the assembly becomes an extra last part "Zusammensetzen", one instruction per placement;
 *   - the palette becomes colours of the yarn materials; materials without a name are left out;
 *   - a stitch-count target of 0 on a row with stitches ("no number given") becomes the count;
 *   - every part has at least one row.
 * The result always matches `TmcDraftSchema` (checked; a mismatch would be a bug and throws).
 */
export function toTellmeCrochetDraft(doc: BuilderExport, opts: TmcDraftOptions = {}): TmcDraftResult {
  const losses: TmcLoss[] = [];
  const palette = doc.overview.colors ?? [];
  const known = new Map(palette.map((c) => [c.id, c.name.trim() || c.id]));
  const colorName = (id: string) => (known.get(id) ?? id).replace(/[[\]]/g, "");

  const assemblyName = opts.assemblyPartName?.trim() || TMC_ASSEMBLY_PART_NAME;

  const parts: TmcDraftPart[] = doc.parts.map((part, partIndex) => {
    const sourceRows = part.content.rows;
    // Real rows keep their ids: they are reserved before any step id is made.
    const ids = new IdPool(sourceRows.map((r) => r.id));
    const emitted = new Set<string>();
    const rows: TmcRow[] = [];
    const ordinals = rowOrdinals(sourceRows);
    const partType = sourceRows.find((r) => r.ops.length > 0)?.type ?? sourceRows[0]?.type ?? "round";
    const take = (id: string) => ids.fresh(id);
    const takeSource = (sourceId: string) => {
      if (!emitted.has(sourceId)) {
        emitted.add(sourceId);
        return sourceId;
      }
      const id = ids.fresh(sourceId);
      losses.push({
        code: "row-id-changed",
        partIndex,
        rowId: sourceId,
        message: `Die Zeilen-ID „${sourceId}“ kommt mehrfach vor und heißt jetzt „${id}“.`,
      });
      return id;
    };

    if (partIndex === 0) {
      const notes = doc.overview.notes?.trim();
      if (notes) {
        rows.push(instruction(take("tmc-hinweise"), partType, `Hinweise: ${notes}`));
        losses.push({ code: "notes", partIndex, message: "Die Hinweise stehen als Schritt am Anfang des ersten Teils." });
      }
      const gauge = gaugeText(doc.overview.gauge);
      if (gauge) {
        rows.push(instruction(take("tmc-maschenprobe"), partType, gauge));
        losses.push({ code: "gauge", partIndex, message: "Garn, Nadel und Maschenprobe stehen als Schritt am Anfang des ersten Teils." });
      }
    }

    let current: string | undefined = palette[0]?.id;
    let started = false;
    let shifted = false;

    sourceRows.forEach((row, i) => {
      const where = row.type === "round" ? "Runde" : "Reihe";
      const label = rowLabel(row, ordinals[i] ?? 0, "de");

      // Colour at the start of the row: the first stitch's colour, else the row's.
      const first = row.ops[0];
      const isKnown = (id: string | undefined): id is string => id !== undefined && known.has(id);
      const firstColor = first?.kind === "stitch" && isKnown(first.color) ? first.color : undefined;
      const start = firstColor ?? (isKnown(row.color) ? row.color : undefined);
      const colorStep = (code: "color-start" | "color-change", text: string) => {
        rows.push(instruction(take(`${row.id}-farbe`), row.type, text));
        losses.push({ code, partIndex, rowId: row.id, rowType: row.type, message: `${label}: „${text}“ steht als eigener Schritt davor.` });
      };
      if (!started && (row.ops.length > 0 || start !== undefined)) {
        started = true;
        const c = start ?? current;
        if (palette.length >= 2 && c !== undefined) colorStep("color-start", `Farbe: ${colorName(c)}`);
        current = c;
      } else if (start !== undefined && start !== current) {
        colorStep("color-change", `Farbwechsel: ${colorName(start)}`);
        current = start;
      }
      // The row's own colour is said by the step before it; marks that repeat the working
      // colour (also the start colour on the first stitch) are left out.
      const cleaned = cleanColors(row.ops, current, known);
      current = cleaned.current;
      const shown: Row = { ...row, ops: cleaned.ops };
      if (isKnown(row.color)) delete shown.color;

      if (row.ops.length === 0) {
        if (!instructionText(row)) return; // nothing but (at most) a colour change
        const out: TmcRow = { id: takeSource(row.id), type: row.type, ops: [], stitchCountTarget: 0 };
        if (row.label !== undefined) out.label = row.label;
        if (row.note !== undefined) out.note = row.note;
        // TellmeCrochet shows the note of a free instruction, else its label: keep both.
        const ownLabel = row.label?.trim();
        const ownNote = row.note?.trim();
        if (ownLabel && ownNote) out.note = `${ownLabel}: ${ownNote}`;
        rows.push(out);
        return;
      }

      const target = row.stitchCountTarget === 0 ? computeRowStitches(row) : row.stitchCountTarget;
      const features = textFeatures(row.ops);
      // Format version 1 has no rounds around a chain (oval start).
      if (row.around) features.add("around");
      if (features.size > 0) {
        const line = renderedRowLine(shown, ordinals[i] ?? 0, "de", palette, target);
        rows.push({ id: takeSource(row.id), type: row.type, ops: [], stitchCountTarget: 0, label, note: line });
        shifted = true;
        const list = FEATURE_ORDER.filter((f) => features.has(f));
        losses.push({
          code: "row-as-text",
          partIndex,
          rowId: row.id,
          rowType: row.type,
          features: list,
          message: `${label} enthält ${joinWords(list.map((f) => FEATURE_WORDS[f]).map((w) => w.replace(/^mehreren/, "mehrere")))} und steht als Text-Schritt da.`,
        });
        return;
      }

      const out: TmcRow = { id: takeSource(row.id), type: row.type, ops: toTmcOps(row.ops), stitchCountTarget: target };
      // TellmeCrochet numbers only rows with stitches: after a row that became text, the
      // following rows keep their numbers as labels.
      if (shifted && !row.label?.trim()) out.label = label;
      else if (row.label !== undefined) out.label = row.label;
      if (row.note !== undefined) out.note = row.note;
      if (cleaned.changes > 0) {
        const colourNote = `Farbwechsel in dieser ${where}: ${renderRow(shown, "de", { colors: palette })}`;
        out.note = row.note?.trim() ? `${row.note} – ${colourNote}` : colourNote;
        losses.push({
          code: "color-in-row",
          partIndex,
          rowId: row.id,
          rowType: row.type,
          message: `${label}: der Farbwechsel mitten in der ${where} steht als Notiz da.`,
        });
      }
      rows.push(out);
    });

    if (part.content.stuffing !== undefined) {
      rows.push(instruction(take("tmc-fuellung"), partType, STUFFING_TEXT[part.content.stuffing]));
      losses.push({ code: "stuffing", partIndex, message: "Die Füllung steht als Schritt am Ende des Teils." });
    }
    if (part.content.finish !== undefined) {
      rows.push(instruction(take("tmc-abschluss"), partType, FINISH_TEXT[part.content.finish]));
      losses.push({ code: "finish", partIndex, message: "Der Abschluss steht als Schritt am Ende des Teils." });
    }
    if (rows.length === 0) {
      rows.push(instruction(take("tmc-leer"), partType, "Für dieses Teil sind noch keine Reihen angegeben."));
      losses.push({ code: "part-empty", partIndex, message: "Das Teil hat keine Reihen und bekommt einen Hinweis-Schritt." });
    }
    if (!part.name.trim()) {
      losses.push({ code: "part-unnamed", partIndex, message: `Das Teil ohne Namen heißt „Teil ${partIndex + 1}“.` });
    }
    return finishPart(partDisplayName(part.name, partIndex), part.quantity, rows);
  });

  const placements = doc.assembly ?? [];
  if (placements.length > 0) {
    const ids = new IdPool();
    const rows = placements.map((pl) => {
      losses.push({
        code: "assembly",
        placementId: pl.id,
        partName: assemblyName,
        message: `Die Platzierung steht im Teil „${assemblyName}“.`,
      });
      return instruction(ids.fresh(`montage-${pl.id}`), "round", describePlacement(pl, doc.parts, doc.assembly));
    });
    parts.push(finishPart(assemblyName, 1, rows));
  }
  if (parts.length === 0) {
    // A builder export always has a part; a draft needs one.
    parts.push(finishPart("Teil 1", 1, [instruction("tmc-leer", "round", "Für dieses Teil sind noch keine Reihen angegeben.")]));
    losses.push({ code: "part-empty", partIndex: 0, message: "Die Anleitung hat keine Teile und bekommt einen Hinweis-Schritt." });
  }

  const draft: TmcDraft = {
    schemaVersion: 1,
    ...(doc.title.trim() ? { title: doc.title.trim() } : {}),
    materials: draftMaterials(doc.overview.materials ?? [], palette, losses),
    parts,
  };
  return { draft: TmcDraftSchema.parse(draft), losses };
}

/**
 * The envelope the hand-off carries: the draft in German notation with the origin hint
 * (`imported` when the document took in pasted text, else `self_created`).
 */
export function toTmcEnvelope(draft: TmcDraft, originHint: TmcOriginHint): TmcEnvelope {
  return { format: "tmc-draft", version: 1, sourceNotation: "de", originHint, draft };
}

// ---------------------------------------------------------------------------
// Payload and link
// ---------------------------------------------------------------------------

/** Prefix of a hand-off payload. */
export const TMC_PAYLOAD_VERSION = "tmc1";

/** Where TellmeCrochet takes a hand-off (its fragment carries the payload). */
export const TMC_IMPORT_URL = "https://tellmecrochet.de/import";

/**
 * Pack an envelope into a payload: `tmc1.` + base64url(deflate-raw(UTF-8(JSON))) — the same
 * packing as share links. Validated first; throws like `encodeShare` beyond the limits.
 */
export async function encodeTmcPayload(envelope: TmcEnvelope): Promise<string> {
  return packJson(TmcEnvelopeSchema.parse(envelope), TMC_PAYLOAD_VERSION, "Draft");
}

/** Unpack and validate a `tmc1.` payload. Throws `ShareDecodeError` only. */
export async function decodeTmcPayload(payload: string): Promise<TmcEnvelope> {
  const data = await unpackJson(payload, TMC_PAYLOAD_VERSION);
  let parsed: ReturnType<typeof TmcEnvelopeSchema.safeParse>;
  try {
    parsed = TmcEnvelopeSchema.safeParse(data);
  } catch (err) {
    throw new ShareDecodeError("invalid", "Payload cannot be validated.", { cause: err });
  }
  if (!parsed.success) {
    throw new ShareDecodeError("invalid", "Payload is not a valid TellmeCrochet draft.", { cause: parsed.error });
  }
  return parsed.data;
}

/** "Open in TellmeCrochet": `https://tellmecrochet.de/import#data=tmc1.…`. Only takes hand-off payloads. */
export function buildTmcImportUrl(payload: string): string {
  if (!payload.startsWith(`${TMC_PAYLOAD_VERSION}.`)) {
    throw new TypeError(`A TellmeCrochet link carries a "${TMC_PAYLOAD_VERSION}." payload.`);
  }
  return `${TMC_IMPORT_URL}#data=${payload}`;
}
