/**
 * Action creators that need fresh ids. Keeping `crypto.randomUUID()` here (and not in the
 * reducer) keeps the reducer pure and its tests deterministic.
 */

import { currentPart, type EditorAction } from "./editor.js";
import { demoDocument, emptyDocument, newId, type BuilderDoc } from "./document.js";

export function addRow(afterId?: string | null, instruction = false): Extract<EditorAction, { type: "addRow" }> {
  return { type: "addRow", id: newId(), afterId: afterId ?? null, instruction };
}

export function duplicateRow(rowId: string): EditorAction {
  return { type: "duplicateRow", rowId, newId: newId() };
}

export function newDocument(): EditorAction {
  return { type: "replaceDocument", doc: emptyDocument(newId()) };
}

/** The demo's targets are declared by the pattern, so they are pinned. */
export function loadDemo(): EditorAction {
  const doc: BuilderDoc = demoDocument(newId);
  return { type: "replaceDocument", doc, pinned: currentPart(doc).rows.map((r) => r.id) };
}
