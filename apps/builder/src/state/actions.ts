/**
 * Action creators that need fresh ids. Keeping `crypto.randomUUID()` here (and not in the
 * reducer) keeps the reducer pure and its tests deterministic.
 */

import type { Row } from "@crochetbuilder/engine";
import { MAX_RUN_LENGTH, type EditorAction } from "./editor.js";
import { demoDocument, emptyDocument, newId, type BuilderDoc, type DemoKind } from "./document.js";
import type { RoundSpec } from "./rounds.js";

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

/** Rounds of a snippet (or any finished rows) inserted after `afterId` with fresh ids. */
export function insertRounds(
  afterId: string | null,
  rounds: readonly RoundSpec[],
  type: Row["type"] = "round",
): Extract<EditorAction, { type: "insertRows" }> {
  const rows: Row[] = rounds.map((r) => ({ id: newId(), type, ops: structuredClone(r.ops), stitchCountTarget: r.count }));
  return { type: "insertRows", afterId, rows };
}

/** The run `rowIds` becomes `length` rows ("Runde ×N"); fresh ids for the copies. */
export function setRunLength(rowIds: readonly string[], length: number): Extract<EditorAction, { type: "setRunLength" }> {
  const missing = Math.max(0, Math.min(MAX_RUN_LENGTH, length) - rowIds.length);
  return { type: "setRunLength", rowIds, length, newIds: Array.from({ length: missing }, () => newId()) };
}
