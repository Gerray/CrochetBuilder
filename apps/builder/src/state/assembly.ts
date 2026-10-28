/**
 * Assembly (B4) edits of the document: placements of parts, safety eyes and embroidery on
 * other parts (`BuilderExport.assembly`, format v2). Pure — the editor reducer calls
 * `applyAssemblyAction` from its assembly block, so every edit is one undo step.
 *
 * Placements refer to parts by `BuilderPart.id`. Parts without an id get one the moment a
 * placement needs it: derived from the part's name ("Kopf" → "kopf", "Körper" → "koerper"),
 * made unique — deterministic, so the reducer stays pure, and readable in the exported JSON.
 */

import type { Placement } from "@crochetbuilder/engine";
import type { BuilderDoc } from "./document.js";

/** A placement as the editor creates it: parts by index (they may not have an id yet). */
export interface PlacementDraft {
  id: string;
  kind: Placement["kind"];
  /** Index of the attached part (`attach`). */
  part?: number;
  /** Index of the target part. */
  target: number;
  row: string;
  angle: number;
  spacing?: number;
  size?: number;
  note?: string;
}

/** Fields a placement edit may change. `target` (an index) moves it to another part. */
export interface PlacementPatch {
  target?: number;
  row?: string;
  angle?: number;
  /** `null` removes the field. */
  spacing?: number | null;
  size?: number | null;
  note?: string;
}

export type AssemblyAction =
  | { type: "addPlacement"; placement: PlacementDraft }
  | { type: "updatePlacement"; id: string; patch: PlacementPatch }
  | { type: "removePlacement"; id: string };

export const ASSEMBLY_ACTION_TYPES: ReadonlySet<string> = new Set(["addPlacement", "updatePlacement", "removePlacement"]);

/** Largest spacing (stitches) and size (mm) the fields accept. */
export const MAX_SPACING = 99;
export const MAX_SIZE_MM = 100;

/** "Körper" → "koerper"; empty for names without letters or digits. */
export function slug(name: string): string {
  return name
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
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** `base`, else `base-2`, `base-3` … — the first that is not in `used`. */
export function uniqueId(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** The document with an id on part `index` (unchanged when it has one). */
export function withPartId(doc: BuilderDoc, index: number): BuilderDoc {
  const part = doc.parts[index];
  if (!part || part.id !== undefined) return doc;
  const used = new Set(doc.parts.flatMap((p) => (p.id === undefined ? [] : [p.id])));
  const id = uniqueId(slug(part.name) || `teil-${index + 1}`, used);
  const parts = [...doc.parts];
  parts[index] = { ...part, id };
  return { ...doc, parts };
}

/** A fresh placement id for the document: "ohr", "augen", "ohr-2" … */
export function nextPlacementId(doc: BuilderDoc, base: string): string {
  return uniqueId(slug(base) || "platzierung", new Set((doc.assembly ?? []).map((p) => p.id)));
}

const finite = (v: number | undefined) => v === undefined || Number.isFinite(v);

/** Angle in (−180, 180], whole degrees kept as they are. */
export function normalizeAngle(angle: number): number {
  let a = angle % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  return Object.is(a, -0) ? 0 : a;
}

function hasRow(doc: BuilderDoc, part: number, rowId: string): boolean {
  return doc.parts[part]?.content.rows.some((r) => r.id === rowId) ?? false;
}

function setAssembly(doc: BuilderDoc, assembly: Placement[]): BuilderDoc {
  if (assembly.length > 0) return { ...doc, assembly };
  const { assembly: _gone, ...rest } = doc;
  return rest;
}

/**
 * Apply an assembly edit. Invalid edits (unknown part or row, a part attached to itself,
 * duplicate ids, out-of-range numbers) return `doc` unchanged — no undo step.
 */
export function applyAssemblyAction(doc: BuilderDoc, action: AssemblyAction): BuilderDoc {
  const list = doc.assembly ?? [];
  switch (action.type) {
    case "addPlacement": {
      const d = action.placement;
      if (!d.id || list.some((p) => p.id === d.id)) return doc;
      if (!hasRow(doc, d.target, d.row) || !Number.isFinite(d.angle)) return doc;
      if (!finite(d.spacing) || !finite(d.size)) return doc;
      if (d.kind === "attach" && (d.part === undefined || !doc.parts[d.part] || d.part === d.target)) return doc;
      let next = withPartId(doc, d.target);
      if (d.kind === "attach") next = withPartId(next, d.part!);
      const placement: Placement = {
        id: d.id,
        kind: d.kind,
        ...(d.kind === "attach" ? { part: next.parts[d.part!]!.id! } : {}),
        target: next.parts[d.target]!.id!,
        row: d.row,
        angle: normalizeAngle(d.angle),
      };
      if (d.spacing !== undefined && d.spacing >= 0) placement.spacing = Math.min(MAX_SPACING, d.spacing);
      if (d.size !== undefined && d.size > 0) placement.size = Math.min(MAX_SIZE_MM, d.size);
      if (d.note) placement.note = d.note;
      return setAssembly(next, [...list, placement]);
    }

    case "updatePlacement": {
      const index = list.findIndex((p) => p.id === action.id);
      if (index < 0) return doc;
      const old = list[index]!;
      const patch = action.patch;
      let next = doc;
      const p: Placement = { ...old };
      if (patch.target !== undefined) {
        const target = patch.target;
        if (!doc.parts[target]) return doc;
        // Moving to another part needs a row of that part.
        if (patch.row === undefined || !hasRow(doc, target, patch.row)) return doc;
        next = withPartId(next, target);
        const id = next.parts[target]!.id!;
        if (old.kind === "attach" && old.part === id) return doc;
        p.target = id;
      }
      if (patch.row !== undefined) {
        const target = next.parts.findIndex((part) => part.id === p.target);
        if (target < 0 || !hasRow(next, target, patch.row)) return doc;
        p.row = patch.row;
      }
      if (patch.angle !== undefined) {
        if (!Number.isFinite(patch.angle)) return doc;
        p.angle = normalizeAngle(patch.angle);
      }
      if (patch.spacing !== undefined) {
        if (patch.spacing === null) delete p.spacing;
        else if (!Number.isFinite(patch.spacing) || patch.spacing < 0) return doc;
        else p.spacing = Math.min(MAX_SPACING, patch.spacing);
      }
      if (patch.size !== undefined) {
        if (patch.size === null) delete p.size;
        else if (!Number.isFinite(patch.size) || patch.size <= 0) return doc;
        else p.size = Math.min(MAX_SIZE_MM, patch.size);
      }
      if (patch.note !== undefined) {
        if (patch.note === "") delete p.note;
        else p.note = patch.note;
      }
      if (JSON.stringify(p) === JSON.stringify(old) && next === doc) return doc;
      const assembly = [...list];
      assembly[index] = p;
      return setAssembly(next, assembly);
    }

    case "removePlacement": {
      if (!list.some((p) => p.id === action.id)) return doc;
      return setAssembly(
        doc,
        list.filter((p) => p.id !== action.id),
      );
    }
  }
}

/** Typing into one field of one placement is one undo step. */
export function assemblyCoalesceKey(action: AssemblyAction): string | undefined {
  if (action.type !== "updatePlacement") return undefined;
  return `placement:${action.id}:${Object.keys(action.patch).sort().join(",")}`;
}

/**
 * The document without placements that refer to part id `partId` (as attached part or
 * target) — used when that part is deleted. Unchanged without such placements.
 */
export function withoutPlacementsOf(doc: BuilderDoc, partId: string | undefined): BuilderDoc {
  if (partId === undefined || !doc.assembly) return doc;
  const kept = doc.assembly.filter((p) => p.target !== partId && p.part !== partId);
  return kept.length === doc.assembly.length ? doc : setAssembly(doc, kept);
}
