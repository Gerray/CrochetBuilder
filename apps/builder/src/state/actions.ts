/**
 * Action creators that need fresh ids. Keeping `crypto.randomUUID()` here (and not in the
 * reducer) keeps the reducer pure and its tests deterministic.
 */

import type { EditorAction } from "./editor.js";
import { demoDocument, emptyDocument, newId, type BuilderDoc, type DemoKind } from "./document.js";

export function addRow(afterId?: string | null, instruction = false): Extract<EditorAction, { type: "addRow" }> {
  return { type: "addRow", id: newId(), afterId: afterId ?? null, instruction };
}

export function duplicateRow(rowId: string): EditorAction {
  return { type: "duplicateRow", rowId, newId: newId() };
}

export function newDocument(): EditorAction {
  return { type: "replaceDocument", doc: emptyDocument(newId()) };
}

/** A new part "Teil n" with one empty round. */
export function addPart(): Extract<EditorAction, { type: "addPart" }> {
  return { type: "addPart", rowId: newId() };
}

/** A copy of part `index` with fresh row ids. */
export function duplicatePart(doc: BuilderDoc, index: number): EditorAction {
  const rows = doc.parts[index]?.content.rows ?? [];
  return { type: "duplicatePart", index, rowIds: rows.map(() => newId()) };
}

/** The demo's targets are declared by the pattern, so they are pinned (in every part). */
export function loadDemo(kind: DemoKind = "sphere"): EditorAction {
  const doc: BuilderDoc = demoDocument(newId, kind);
  return { type: "replaceDocument", doc, pinned: doc.parts.flatMap((p) => p.content.rows.map((r) => r.id)) };
}
