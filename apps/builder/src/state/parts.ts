/**
 * Per-part figures for the parts bar, the stats and the PDF: stitch count, validation
 * findings and the total over all parts × quantity. Results are cached per `PartContent`
 * object — the reducer keeps unchanged parts identical, so an edit in one part never
 * re-validates the others.
 */

import { DEFAULT_MAX_STITCHES, computeRowStitches, validate, type Finding, type PartContent } from "@crochetbuilder/engine";
import type { BuilderDoc } from "./document.js";

const findingsCache = new WeakMap<PartContent, readonly Finding[]>();
const stitchCache = new WeakMap<PartContent, number>();

/**
 * `validate(content)` with the stitch budget of the 3D preview (reported like any other
 * finding), cached per content object.
 */
export function partFindings(content: PartContent): readonly Finding[] {
  let findings = findingsCache.get(content);
  if (!findings) {
    findings = validate(content, { maxStitches: DEFAULT_MAX_STITCHES });
    findingsCache.set(content, findings);
  }
  return findings;
}

/** Worked stitches of one piece (all stitch rows). */
export function partStitches(content: PartContent): number {
  let count = stitchCache.get(content);
  if (count === undefined) {
    count = content.rows.reduce((sum, r) => sum + (r.ops.length > 0 ? computeRowStitches(r) : 0), 0);
    stitchCache.set(content, count);
  }
  return count;
}

export type PartStatus = "ok" | "warning" | "error";

/** Traffic light of a part: any error → "error", only warnings → "warning", else "ok". */
export function partStatus(findings: readonly Finding[]): PartStatus {
  if (findings.some((f) => f.severity === "error")) return "error";
  return findings.length > 0 ? "warning" : "ok";
}

/** "2 Fehler · 1 Hinweis", or "keine Befunde". */
export function findingsSummary(findings: readonly Finding[]): string {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  const parts = [errors > 0 && `${errors} Fehler`, warnings > 0 && `${warnings} ${warnings === 1 ? "Hinweis" : "Hinweise"}`];
  return parts.filter(Boolean).join(" · ") || "keine Befunde";
}

/** Display name of a part: its name, or "Teil n" while it has none. */
export function partName(name: string, index: number): string {
  return name.trim() || `Teil ${index + 1}`;
}

export interface PartsTotal {
  /** Stitches of all parts, each times its quantity. */
  stitches: number;
  /** Pieces to crochet: the sum of all quantities. */
  pieces: number;
}

export function partsTotal(doc: BuilderDoc): PartsTotal {
  return doc.parts.reduce(
    (total, part) => ({
      stitches: total.stitches + part.quantity * partStitches(part.content),
      pieces: total.pieces + part.quantity,
    }),
    { stitches: 0, pieces: 0 },
  );
}

/** "Gesamt: 1.234 Maschen in 8 Teilen". */
export function totalText({ stitches, pieces }: PartsTotal): string {
  const s = stitches.toLocaleString("de-DE");
  return `Gesamt: ${s} ${stitches === 1 ? "Masche" : "Maschen"} in ${pieces} ${pieces === 1 ? "Teil" : "Teilen"}`;
}
