/**
 * Builder export — the document the builder saves and hands to other software
 * (docs/FORMAT.md, "Builder export").
 *
 * `parts[].content` is exactly the canonical `PartContentSchema`. `rendered` is a
 * redundant text view of the rows for consumers that only display text; it is never the
 * source of truth.
 */

import { z } from "zod";
import { instructionText, rowOrdinals } from "./expand.js";
import { GaugeSchema } from "./gauge.js";
import { renderRow, rowLabel, type NotationLocale } from "./notation.js";
import { PlacementSchema } from "./assembly.js";
import { planJoins, type JoinFindingCode } from "./join.js";
import { CURRENT_SCHEMA_VERSION, PartContentSchema, SchemaVersionSchema, type PartContent, type Row } from "./schema.js";
import { validate, type Finding, type FindingCode } from "./validate.js";

export const MaterialKindSchema = z.enum(["yarn", "hook", "accessory"]);

/** A material line: yarn, hook or accessory, described in free text. */
export const MaterialSchema = z
  .object({
    kind: MaterialKindSchema,
    label: z.string(),
    colors: z.array(z.string()).optional(),
    amount: z.string().optional(),
  })
  .strict();

export const NotationLocaleSchema = z.enum(["de", "en_us", "en_uk"]);

/**
 * A palette colour (format v2). `id` is what rows and stitches refer to (`Row.color`,
 * `StitchOp.color`), `name` what the material list shows ("Weiß", "Altrosa"), `hex` an
 * optional display colour `#rrggbb`.
 */
export const PaletteColorSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    hex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Expected a colour as #rrggbb")
      .optional(),
  })
  .strict();

/** One part of the export. `id` (format v2) is a stable reference for the assembly. */
export const BuilderPartSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string(),
    quantity: z.number().int().positive(),
    content: PartContentSchema,
  })
  .strict();

export const BuilderOverviewSchema = z
  .object({
    materials: z.array(MaterialSchema).optional(),
    gauge: GaugeSchema.optional(),
    notes: z.string().optional(),
    colors: z.array(PaletteColorSchema).optional(),
  })
  .strict();

export const RenderedRowsSchema = z
  .object({
    locale: NotationLocaleSchema,
    rows: z.array(z.string()),
  })
  .strict();

export const BuilderExportSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    title: z.string(),
    overview: BuilderOverviewSchema,
    parts: z.array(BuilderPartSchema),
    rendered: RenderedRowsSchema.optional(),
    assembly: z.array(PlacementSchema).optional(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    if (doc.schemaVersion !== 1) return;
    const v2 =
      doc.overview.colors !== undefined ||
      doc.assembly !== undefined ||
      doc.parts.some((p) => p.id !== undefined || p.content.schemaVersion !== 1);
    if (v2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schemaVersion"],
        message: "Uses format version 2 (palette, part ids, assembly or version-2 parts) but says schemaVersion 1",
      });
    }
  });

/**
 * `doc` as writers write it: the export and every part stamped with `CURRENT_SCHEMA_VERSION`
 * (2). Every version-1 document is a valid version-2 document, so nothing else changes.
 */
export function withCurrentVersion(doc: BuilderExport): BuilderExport {
  return {
    ...doc,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    parts: doc.parts.map((p) =>
      p.content.schemaVersion === CURRENT_SCHEMA_VERSION
        ? p
        : { ...p, content: { ...p.content, schemaVersion: CURRENT_SCHEMA_VERSION } },
    ),
  };
}

export type MaterialKind = z.infer<typeof MaterialKindSchema>;
export type Material = z.infer<typeof MaterialSchema>;
export type PaletteColor = z.infer<typeof PaletteColorSchema>;
export type BuilderPart = z.infer<typeof BuilderPartSchema>;
export type BuilderOverview = z.infer<typeof BuilderOverviewSchema>;
export type RenderedRows = z.infer<typeof RenderedRowsSchema>;
export type BuilderExport = z.infer<typeof BuilderExportSchema>;

/**
 * One display line per row, e.g. `Runde 3: 6× (1 fM, 1 Zun) (18)` — the content of
 * `rendered.rows`. A row's own label replaces the automatic "Runde n"/"Reihe n"; a note is
 * appended after a dash. Free instructions render as their text ("Label: note" when both
 * are set); rows with neither stitches nor text are skipped. With a `palette`
 * (`overview.colors`) colour changes are shown with the colour names: `[Farbe: Weiß] 6 fM`;
 * a free instruction that changes the colour gets the mark in front.
 */
export function renderedRows(
  content: PartContent,
  locale: NotationLocale,
  palette?: readonly { id: string; name?: string }[],
): string[] {
  const ordinals = rowOrdinals(content.rows);
  const lines: string[] = [];
  content.rows.forEach((row, i) => {
    const line = renderedRowLine(row, ordinals[i] ?? 0, locale, palette);
    if (line) lines.push(line);
  });
  return lines;
}

/**
 * The display line of one row as in `renderedRows` (`ordinal` from `rowOrdinals`), or "" for
 * a row with neither stitches nor text. `target` replaces the shown stitch count.
 */
export function renderedRowLine(
  row: Row,
  ordinal: number,
  locale: NotationLocale,
  palette?: readonly { id: string; name?: string }[],
  target: number = row.stitchCountTarget,
): string {
  const opts = palette ? { colors: palette } : {};
  const note = row.note?.trim() ?? "";
  if (row.ops.length === 0) {
    const label = row.label?.trim() ?? "";
    const text = label && note ? `${label}: ${note}` : instructionText(row);
    const mark = renderRow(row, locale, opts);
    if (!text) return "";
    return mark ? `${mark} ${text}` : text;
  }
  let line = `${rowLabel(row, ordinal, locale)}: ${renderRow(row, locale, opts)} (${target})`;
  if (note) line += ` – ${note}`;
  return line;
}

// ---------------------------------------------------------------------------
// Export-level validation (format v2: palette, part ids, assembly)
// ---------------------------------------------------------------------------

export type ExportFindingCode =
  | FindingCode
  | "DUPLICATE_PART_ID"
  | "DUPLICATE_COLOR_ID"
  | "DUPLICATE_PLACEMENT_ID"
  | "UNKNOWN_PART"
  | "UNKNOWN_ROW"
  | "ATTACH_WITHOUT_PART"
  | JoinFindingCode;

/**
 * A finding about a whole export. Part findings (`validate` with the palette) carry the
 * part's index and their row; assembly findings carry the placement's id.
 */
export interface ExportFinding {
  severity: "error" | "warning";
  code: ExportFindingCode;
  message: string;
  /** Index of the part in `parts` the finding is about. */
  partIndex?: number;
  /** Row id (part findings; `UNKNOWN_ROW`). */
  rowId?: string;
  /** Placement id (assembly findings). */
  placementId?: string;
  /** The offending id (duplicates, unknown references). */
  ref?: string;
  expected?: number;
  actual?: number;
}

function duplicates(ids: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (id === undefined) continue;
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

/**
 * Everything the engine can say about an export: every part's findings (`validate`, with
 * the palette, so unknown colours are reported), duplicate ids (parts, colours, placements)
 * and assembly references — the target and attached part must be part ids, the row a row of
 * the target, and an `attach` placement needs the part it attaches — and the joins between
 * parts (`StitchOp.from` / `.through`, see `planJoins`): references, cycles, stitches of the
 * other part taken twice, beyond its row or not at all, `through` without an edge, a joined
 * part that is also sewn on. The schema only checks the shape, so a document with a dangling
 * reference still loads and can be repaired.
 */
export function validateExport(doc: BuilderExport): ExportFinding[] {
  const out: ExportFinding[] = [];
  const palette = doc.overview.colors ?? [];

  doc.parts.forEach((part, partIndex) => {
    for (const f of validate(part.content, { palette })) out.push(fromPartFinding(f, partIndex));
  });

  for (const id of duplicates(doc.parts.map((p) => p.id))) {
    out.push({ severity: "error", code: "DUPLICATE_PART_ID", message: `Part id "${id}" is used by more than one part.`, ref: id });
  }
  for (const id of duplicates(palette.map((c) => c.id))) {
    out.push({ severity: "error", code: "DUPLICATE_COLOR_ID", message: `Colour id "${id}" is used by more than one colour.`, ref: id });
  }
  const placements = doc.assembly ?? [];
  for (const id of duplicates(placements.map((p) => p.id))) {
    out.push({
      severity: "error",
      code: "DUPLICATE_PLACEMENT_ID",
      message: `Placement id "${id}" is used by more than one placement.`,
      ref: id,
    });
  }

  const partById = new Map<string, number>();
  doc.parts.forEach((p, i) => {
    if (p.id !== undefined && !partById.has(p.id)) partById.set(p.id, i);
  });
  for (const pl of placements) {
    const target = partById.get(pl.target);
    if (target === undefined) {
      out.push({
        severity: "error",
        code: "UNKNOWN_PART",
        message: `Placement "${pl.id}" targets part "${pl.target}", which does not exist.`,
        placementId: pl.id,
        ref: pl.target,
      });
    } else if (!doc.parts[target]!.content.rows.some((r) => r.id === pl.row)) {
      out.push({
        severity: "error",
        code: "UNKNOWN_ROW",
        message: `Placement "${pl.id}" refers to row "${pl.row}", which part "${pl.target}" does not have.`,
        placementId: pl.id,
        partIndex: target,
        rowId: pl.row,
        ref: pl.row,
      });
    }
    if (pl.part !== undefined && !partById.has(pl.part)) {
      out.push({
        severity: "error",
        code: "UNKNOWN_PART",
        message: `Placement "${pl.id}" attaches part "${pl.part}", which does not exist.`,
        placementId: pl.id,
        ref: pl.part,
      });
    }
    if (pl.kind === "attach" && pl.part === undefined) {
      out.push({
        severity: "warning",
        code: "ATTACH_WITHOUT_PART",
        message: `Placement "${pl.id}" attaches something, but does not say which part.`,
        placementId: pl.id,
      });
    }
  }

  for (const f of planJoins(doc).findings) {
    const finding: ExportFinding = { severity: f.severity, code: f.code, message: f.message, partIndex: f.partIndex };
    if (f.rowId !== undefined) finding.rowId = f.rowId;
    if (f.placementId !== undefined) finding.placementId = f.placementId;
    if (f.ref !== undefined) finding.ref = f.ref;
    if (f.expected !== undefined) finding.expected = f.expected;
    if (f.actual !== undefined) finding.actual = f.actual;
    out.push(finding);
  }
  return out;
}

function fromPartFinding(f: Finding, partIndex: number): ExportFinding {
  const out: ExportFinding = { severity: f.severity, code: f.code, message: f.message, partIndex, rowId: f.rowId };
  if (f.expected !== undefined) out.expected = f.expected;
  if (f.actual !== undefined) out.actual = f.actual;
  return out;
}
