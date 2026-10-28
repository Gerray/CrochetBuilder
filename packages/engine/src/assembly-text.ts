/**
 * Placements in words (German) — the compact wording of the assembly, shared by the builder's
 * "Montage" list, the PDF and the viewer (the TellmeCrochet hand-off words them as steps,
 * see `describePlacement`):
 *   "Ohr ×2 an Kopf, zwischen Runde 4 und 5, ±45°"
 *   "Augen 12 mm an Kopf, zwischen Runde 8 und 9, 6 M Abstand"
 *   "Kopf an Körper, auf Runde 14 (Ende)"
 *
 * Rows are named as everywhere else (`rowLabel` with `rowOrdinals`: an own label, else
 * "Runde n" / "Reihe n"). Pure, no UI imports.
 */

import type { Placement } from "./assembly.js";
import { rowOrdinals } from "./expand.js";
import { rowLabel } from "./notation.js";
import type { Row } from "./schema.js";

/** What the wording needs of a document (a `BuilderExport` satisfies it). */
export interface PlacementTextDoc {
  parts: ReadonlyArray<{ id?: string | undefined; name: string; quantity: number; content: { rows: readonly Row[] } }>;
  assembly?: readonly Placement[] | undefined;
}

const num = (value: number) => value.toLocaleString("de-DE", { maximumFractionDigits: 1 });

/** "30°", "−30°" (typographic minus). */
export function degreesText(a: number): string {
  return `${a < 0 ? "−" : ""}${num(Math.abs(a))}°`;
}

/** Display name of part `index`: its name, or "Teil n". */
export function placementPartName(name: string, index: number): string {
  return name.trim() || `Teil ${index + 1}`;
}

/** Index of the part with id `id`, or -1. */
export function partIndexById(doc: PlacementTextDoc, id: string | undefined): number {
  return id === undefined ? -1 : doc.parts.findIndex((p) => p.id === id);
}

/** Display name of the part with id `id` ("?" when there is none). */
export function partNameById(doc: PlacementTextDoc, id: string | undefined): string {
  const i = partIndexById(doc, id);
  return i < 0 ? "?" : placementPartName(doc.parts[i]!.name, i);
}

/** "Runde" or "Reihe": how the part's stitch rows are worked (its first stitch row; default Runde). */
export function rowWord(doc: PlacementTextDoc, partIndex: number): "Runde" | "Reihe" {
  const first = doc.parts[partIndex]?.content.rows.find((r) => r.ops.length > 0);
  return first?.type === "row" ? "Reihe" : "Runde";
}

/**
 * Where on the target a placement sits: "zwischen Runde 4 und 5", "zwischen Reihe 2 und 3",
 * "auf Runde 14 (Ende)" for the last stitch row, "Runde fehlt" / "Reihe fehlt" for a row the
 * target does not have.
 */
export function rowPositionText(doc: PlacementTextDoc, targetId: string, rowId: string): string {
  const t = partIndexById(doc, targetId);
  const rows = t < 0 ? [] : doc.parts[t]!.content.rows;
  const at = rows.findIndex((r) => r.id === rowId);
  if (at < 0 || rows[at]!.ops.length === 0) return `${t < 0 ? "Runde" : rowWord(doc, t)} fehlt`;
  const ordinals = rowOrdinals(rows);
  const label = (i: number) => rowLabel(rows[i]!, ordinals[i] ?? 0, "de");
  const here = label(at);
  const next = rows.findIndex((r, i) => i > at && r.ops.length > 0);
  if (next < 0) return `auf ${here} (Ende)`;
  const there = label(next);
  const a = /^(Runde|Reihe) (\d+)$/.exec(here);
  const b = /^(Runde|Reihe) (\d+)$/.exec(there);
  if (a && b && a[1] === b[1]) return `zwischen ${here} und ${b[2]}`;
  return `zwischen ${here} und ${there}`;
}

/**
 * Whether an attach placement can be used as it stands (the engine places it): its part and
 * target exist, differ, and the row is a stitch row of the target.
 */
export function isUsableAttach(doc: PlacementTextDoc, p: Placement): boolean {
  if (p.kind !== "attach") return false;
  const part = partIndexById(doc, p.part);
  const target = partIndexById(doc, p.target);
  if (part < 0 || target < 0 || part === target) return false;
  return doc.parts[target]!.content.rows.some((r) => r.id === p.row && r.ops.length > 0);
}

/**
 * Whether the attached part's second copy is the automatic mirror of this placement: the
 * part is made twice or more and this is its only usable attach placement.
 */
export function isMirroredPair(doc: PlacementTextDoc, p: Placement): boolean {
  if (!isUsableAttach(doc, p)) return false;
  const i = partIndexById(doc, p.part);
  if (doc.parts[i]!.quantity < 2) return false;
  return (doc.assembly ?? []).filter((q) => q.part === p.part && isUsableAttach(doc, q)).length === 1;
}

/** The angle as words: "vorne", "hinten", "30°", "−30°", "±30°" for a mirrored pair. */
export function angleText(angle: number, mirrored: boolean): string {
  if (angle === 0) return "vorne";
  if (Math.abs(angle) === 180) return "hinten";
  return mirrored ? `±${num(Math.abs(angle))}°` : degreesText(angle);
}

/** One placement in words (see the module doc). */
export function placementText(doc: PlacementTextDoc, p: Placement): string {
  const target = partNameById(doc, p.target);
  const where = rowPositionText(doc, p.target, p.row);
  const end = where.endsWith("(Ende)");
  let text: string;
  if (p.kind === "attach") {
    const mirrored = isMirroredPair(doc, p);
    const name = partNameById(doc, p.part);
    text = `${name}${mirrored ? " ×2" : ""} an ${target}, ${where}`;
    if (!(end && p.angle === 0)) text += `, ${angleText(p.angle, mirrored)}`;
  } else if (p.kind === "eyes") {
    const pair = (p.spacing ?? 0) > 0;
    const size = p.size !== undefined ? ` ${num(p.size)} mm` : "";
    text = `${pair ? "Augen" : "Auge"}${size} an ${target}, ${where}`;
    if (pair) text += `, ${num(p.spacing!)} M Abstand`;
    if (p.angle !== 0) text += `, ${angleText(p.angle, false)}`;
  } else {
    const size = p.size !== undefined ? ` ${num(p.size)} mm` : "";
    text = `Stickerei${size} an ${target}, ${where}, ${angleText(p.angle, false)}`;
  }
  const note = p.note?.trim();
  return note ? `${text} – ${note}` : text;
}

/** All placements of the document in words, in order. */
export function assemblyLines(doc: PlacementTextDoc): string[] {
  return (doc.assembly ?? []).map((p) => placementText(doc, p));
}
