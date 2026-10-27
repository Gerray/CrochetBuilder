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
import { PartContentSchema, type PartContent } from "./schema.js";

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

export const BuilderPartSchema = z
  .object({
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
    schemaVersion: z.literal(1),
    title: z.string(),
    overview: BuilderOverviewSchema,
    parts: z.array(BuilderPartSchema),
    rendered: RenderedRowsSchema.optional(),
  })
  .strict();

export type MaterialKind = z.infer<typeof MaterialKindSchema>;
export type Material = z.infer<typeof MaterialSchema>;
export type BuilderPart = z.infer<typeof BuilderPartSchema>;
export type BuilderOverview = z.infer<typeof BuilderOverviewSchema>;
export type RenderedRows = z.infer<typeof RenderedRowsSchema>;
export type BuilderExport = z.infer<typeof BuilderExportSchema>;

/**
 * One display line per row, e.g. `Runde 3: 6× (1 fM, 1 Zun) (18)` — the content of
 * `rendered.rows`. A row's own label replaces the automatic "Runde n"/"Reihe n"; a note is
 * appended after a dash. Free instructions render as their text ("Label: note" when both
 * are set); rows with neither stitches nor text are skipped.
 */
export function renderedRows(content: PartContent, locale: NotationLocale): string[] {
  const ordinals = rowOrdinals(content.rows);
  const lines: string[] = [];
  content.rows.forEach((row, i) => {
    const note = row.note?.trim() ?? "";
    if (row.ops.length === 0) {
      const label = row.label?.trim() ?? "";
      const text = label && note ? `${label}: ${note}` : instructionText(row);
      if (text) lines.push(text);
      return;
    }
    let line = `${rowLabel(row, ordinals[i] ?? 0, locale)}: ${renderRow(row, locale)} (${row.stitchCountTarget})`;
    if (note) line += ` – ${note}`;
    lines.push(line);
  });
  return lines;
}
