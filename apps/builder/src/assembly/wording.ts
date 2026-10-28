/**
 * Placements in words (German), shared by the "Montage" list, the PDF and the viewer:
 *   "Ohr ×2 an Kopf, zwischen Runde 4 und 5, ±60°"
 *   "Augen 12 mm an Kopf, zwischen Runde 8 und 9, 6 M Abstand"
 *   "Kopf an Körper, auf Runde 14 (Ende)"
 */

import type { Placement } from "@crochetbuilder/engine";
import type { BuilderDoc } from "../state/document.js";
import { displayRowLabels } from "../state/labels.js";
import { partName } from "../state/parts.js";

const num = (value: number) => value.toLocaleString("de-DE", { maximumFractionDigits: 1 });
/** "30°", "−30°" (typographic minus). */
export const degrees = (a: number) => `${a < 0 ? "−" : ""}${num(Math.abs(a))}°`;

/** Index of the part with id `id`, or -1. */
export function partIndexById(doc: BuilderDoc, id: string | undefined): number {
  return id === undefined ? -1 : doc.parts.findIndex((p) => p.id === id);
}

/** Display name of the part with id `id` ("?" when there is none). */
export function partNameById(doc: BuilderDoc, id: string | undefined): string {
  const i = partIndexById(doc, id);
  return i < 0 ? "?" : partName(doc.parts[i]!.name, i);
}

/**
 * Where on the target a placement sits: "zwischen Runde 4 und 5", "zwischen Reihe 2 und 3",
 * "auf Runde 14 (Ende)" for the last stitch row, "Zeile fehlt" for an unknown row.
 */
export function rowPositionText(doc: BuilderDoc, targetId: string, rowId: string): string {
  const t = partIndexById(doc, targetId);
  const rows = t < 0 ? [] : doc.parts[t]!.content.rows;
  const at = rows.findIndex((r) => r.id === rowId);
  if (at < 0) return "Zeile fehlt";
  const labels = displayRowLabels(rows);
  const here = labels[at]!;
  const next = rows.findIndex((r, i) => i > at && r.ops.length > 0);
  if (next < 0) return `auf ${here} (Ende)`;
  const there = labels[next]!;
  const a = /^(Runde|Reihe) (\d+)$/.exec(here);
  const b = /^(Runde|Reihe) (\d+)$/.exec(there);
  if (a && b && a[1] === b[1]) return `zwischen ${here} und ${b[2]}`;
  return `zwischen ${here} und ${there}`;
}

/** Whether the attached part's second copy is the automatic mirror of this placement. */
export function isMirroredPair(doc: BuilderDoc, p: Placement): boolean {
  if (p.kind !== "attach") return false;
  const i = partIndexById(doc, p.part);
  if (i < 0 || doc.parts[i]!.quantity < 2) return false;
  return (doc.assembly ?? []).filter((q) => q.kind === "attach" && q.part === p.part).length === 1;
}

/** The angle as words: "vorne", "hinten", "30°", "−30°", "±30°" for a mirrored pair. */
export function angleText(angle: number, mirrored: boolean): string {
  if (angle === 0) return "vorne";
  if (Math.abs(angle) === 180) return "hinten";
  return mirrored ? `±${num(Math.abs(angle))}°` : degrees(angle);
}

/** One placement in words (see the module doc). */
export function placementText(doc: BuilderDoc, p: Placement): string {
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
export function assemblyLines(doc: BuilderDoc): string[] {
  return (doc.assembly ?? []).map((p) => placementText(doc, p));
}
