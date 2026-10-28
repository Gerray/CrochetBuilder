/**
 * Turning the paste preview into an editor action: "Als neue Anleitung übernehmen" (a new
 * document, undoable like "Neu") or "Teile hinzufügen" (parts appended to the current one).
 * Checks the editor's limits and gives every refusal a German message.
 */

import { MAX_STITCH_COUNT_TARGET, opsWithinLimits, rowLabel, rowOrdinals, type Row } from "@crochetbuilder/engine";
import { emptyDocument, newId, type BuilderDoc } from "../state/document.js";
import { MAX_PART_QUANTITY, MAX_PARTS, type EditorAction } from "../state/editor.js";
import type { PastePreview } from "./preview.js";

export type PasteMode = "replace" | "append";

/** Name and quantity of a part as edited in the dialog. */
export interface PartEdit {
  name: string;
  quantity: number;
}

export interface PasteOptions {
  mode: PasteMode;
  /** Per part index: the edited name and quantity (default: as read from the text). */
  edits?: ReadonlyMap<number, PartEdit>;
  /** Put the preamble (materials, abbreviations, intro) into the pattern notes. */
  includePreamble: boolean;
}

export type PasteResult =
  | {
      ok: true;
      action: EditorAction;
      /** Number of parts imported. */
      parts: number;
      /** Rows that stayed unread text (marked with a label). */
      unread: number;
    }
  | { ok: false; message: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The name and quantity a part will get (edited, else as read). */
export function partEdit(preview: PastePreview, index: number, edits?: ReadonlyMap<number, PartEdit>): PartEdit {
  const part = preview.parts[index]!;
  return edits?.get(index) ?? { name: part.name, quantity: part.quantity };
}

/** Why the preview cannot be imported as it is (German), or null. */
export function pasteBlocker(preview: PastePreview, options: PasteOptions, doc: BuilderDoc): string | null {
  if (preview.parts.length === 0) {
    return "Im Text wurden keine Runden oder Reihen gefunden. Beispiel: „Runde 1: 6 fM in den Fadenring (6)“.";
  }
  if (preview.localeUncertain) return "Bitte zuerst die Schreibweise bestätigen: Deutsch, US oder UK.";
  const count = preview.parts.length;
  if (options.mode === "replace" && count > MAX_PARTS) {
    return `Der Text ergibt ${count} Teile – der Builder bearbeitet höchstens ${MAX_PARTS}. Bitte den Text kürzen.`;
  }
  if (options.mode === "append" && doc.parts.length + count > MAX_PARTS) {
    const free = MAX_PARTS - doc.parts.length;
    return `Die Anleitung hat schon ${plural(doc.parts.length, "Teil", "Teile")}, höchstens ${MAX_PARTS} sind möglich – ${
      free > 0 ? `es passen nur noch ${free} dazu` : "es passt keins mehr dazu"
    }, der Text ergibt ${count}.`;
  }
  for (let i = 0; i < count; i++) {
    const { name, quantity } = partEdit(preview, i, options.edits);
    const shown = name.trim() || `Teil ${i + 1}`;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PART_QUANTITY) {
      return `„${shown}“: Die Anzahl muss zwischen 1 und ${MAX_PART_QUANTITY} liegen.`;
    }
    const rows = preview.parts[i]!.rows;
    const ordinals = rowOrdinals(rows);
    const big = rows.findIndex((r) => !opsWithinLimits(r.ops) || r.stitchCountTarget > MAX_STITCH_COUNT_TARGET);
    if (big >= 0) {
      return `„${shown}“, ${rowLabel(rows[big]!, ordinals[big] ?? 0, "de")}: zu groß für den Builder (Anzahl über 999 oder mehr als 10.000 Maschen in einer Reihe).`;
    }
  }
  return null;
}

/** Notes after the import: the old ones (when appending) plus the preamble. */
function notesWith(previous: string | undefined, preamble: readonly string[]): string {
  const added = preamble.join("\n").trim();
  const old = previous?.trim() ?? "";
  if (!added) return old;
  return old ? `${old}\n\n${added}` : added;
}

/**
 * The editor action for the preview, or why it cannot be imported. Rows get fresh ids; the
 * declared stitch counts are pinned (an author's mistake is reported, never silently fixed).
 */
export function applyPaste(
  preview: PastePreview,
  doc: BuilderDoc,
  options: PasteOptions,
  makeId: () => string = newId,
): PasteResult {
  const blocker = pasteBlocker(preview, options, doc);
  if (blocker) return { ok: false, message: blocker };

  const pinned: string[] = [];
  const parts: BuilderDoc["parts"] = preview.parts.map((part, i) => {
    const { name, quantity } = partEdit(preview, i, options.edits);
    const rows = part.rows.map((row): Row => {
      const id = makeId();
      pinned.push(id);
      return { ...structuredClone(row), id };
    });
    return { name: name.trim() || `Teil ${i + 1}`, quantity, content: { schemaVersion: 1, rows } };
  });
  const unread = preview.counts.unread;

  // A title taken from the text is not repeated in the notes.
  const useTitle = options.mode === "replace" && preview.title !== undefined;
  const preamble = options.includePreamble ? preview.preamble.filter((line, i) => !(useTitle && i === 0)) : [];

  if (options.mode === "replace") {
    const fresh = emptyDocument(makeId());
    const notes = notesWith(undefined, preamble);
    const next: BuilderDoc = {
      ...fresh,
      title: useTitle ? preview.title! : doc.title,
      overview: notes ? { ...fresh.overview, notes } : fresh.overview,
      parts,
    };
    return { ok: true, action: { type: "replaceDocument", doc: next, pinned }, parts: parts.length, unread };
  }

  const action: EditorAction = { type: "appendParts", parts, pinned };
  if (preamble.length > 0) action.notes = notesWith(doc.overview.notes, preamble);
  return { ok: true, action, parts: parts.length, unread };
}
