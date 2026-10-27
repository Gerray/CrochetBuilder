/**
 * The document as it leaves the app (JSON download, share link, TellmeCrochet, PDF): a
 * `BuilderExport` with `rendered` filled in German, validated against `BuilderExportSchema`.
 */

import { BuilderExportSchema, renderedRows, type BuilderExport } from "@crochetbuilder/engine";
import type { BuilderDoc } from "../state/document.js";

/** The export failed schema validation — a bug, never a user error. */
export class ExportValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Export ist ungültig: ${issues.join("; ")}`);
    this.name = "ExportValidationError";
  }
}

/** Text lines of all parts; with several parts each starts with a "Name (n×):" line. */
export function renderedLines(doc: BuilderDoc): string[] {
  if (doc.parts.length === 1) return renderedRows(doc.parts[0]!.content, "de");
  return doc.parts.flatMap((part) => [
    `${part.name.trim() || "Teil"}${part.quantity > 1 ? ` (${part.quantity}×)` : ""}:`,
    ...renderedRows(part.content, "de"),
  ]);
}

/**
 * The export of `doc`: materials without a name are left out, `rendered` holds the German
 * text of every row. Throws `ExportValidationError` when the result does not match the
 * schema (so nothing invalid ever leaves the app).
 */
export function prepareExport(doc: BuilderDoc): BuilderExport {
  const overview = { ...doc.overview };
  if (overview.materials) overview.materials = overview.materials.filter((m) => m.label.trim() !== "");
  const candidate: BuilderExport = {
    schemaVersion: doc.schemaVersion,
    title: doc.title.trim(),
    overview,
    parts: doc.parts,
    rendered: { locale: "de", rows: renderedLines(doc) },
  };
  const parsed = BuilderExportSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ExportValidationError(parsed.error.issues.map((i) => `${i.path.join(".") || "(Dokument)"}: ${i.message}`));
  }
  return parsed.data;
}

/** A document with nothing worth keeping: no title, notes, named materials or row content. */
export function isDocumentEmpty(doc: BuilderDoc): boolean {
  if (doc.title.trim() || doc.overview.notes?.trim()) return false;
  if ((doc.overview.materials ?? []).some((m) => m.label.trim())) return false;
  return doc.parts.every((part) =>
    part.content.rows.every((r) => r.ops.length === 0 && !r.note?.trim() && !r.label?.trim()),
  );
}

/** A safe file name from the title: "Amigurumi-Kugel" → "amigurumi-kugel.json". */
export function exportFileName(title: string, extension: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${base || "anleitung"}.${extension}`;
}

/** Offer a blob as a download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "JSON herunterladen": the validated export, pretty-printed. */
export function downloadJson(doc: BuilderDoc): void {
  const exp = prepareExport(doc);
  const blob = new Blob([JSON.stringify(exp, null, 2) + "\n"], { type: "application/json" });
  downloadBlob(blob, exportFileName(exp.title, "json"));
}
