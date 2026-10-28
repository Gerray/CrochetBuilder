/**
 * Turning the paste preview into an editor action: "Als neue Anleitung übernehmen" (a new
 * document, undoable like "Neu") or "Teile hinzufügen" (parts appended to the current one).
 * Checks the editor's limits and gives every refusal a German message.
 */

import { MAX_STITCH_COUNT_TARGET, opsWithinLimits, rowLabel, rowOrdinals, type Row } from "@crochetbuilder/engine";
import { isDocumentEmpty } from "../export/prepare.js";
import { emptyDocument, newId, type BuilderDoc } from "../state/document.js";
import { MAX_PART_QUANTITY, MAX_PARTS, type EditorAction } from "../state/editor.js";
import type { PastePreview } from "./preview.js";

export type PasteMode = "replace" | "append";

/** Name and quantity of a part as it will be imported. */
export interface PartEdit {
  name: string;
  quantity: number;
}

export interface PasteOptions {
  mode: PasteMode;
  /**
   * Per part index: what was edited in the dialog — only the edited field, so a name edit
   * never freezes the quantity read from the text (and the other way round).
   */
  edits?: ReadonlyMap<number, Partial<PartEdit>>;
  /** Put the preamble (materials, abbreviations, intro) into the pattern notes. */
  includePreamble: boolean;
}

export type PasteResult =
  | {
      ok: true;
      action: EditorAction;
      /** What was done: adding parts to an empty pattern is a new pattern. */
      mode: PasteMode;
      /** Number of parts imported. */
      parts: number;
      /** Rows that stayed unread text (marked with a label). */
      unread: number;
    }
  | { ok: false; message: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The mode that is really applied: adding parts to an empty pattern replaces it, so the empty
 * placeholder part "Teil 1" does not stay in front of the imported parts.
 */
export function effectiveMode(mode: PasteMode, doc: BuilderDoc): PasteMode {
  return mode === "append" && isDocumentEmpty(doc) ? "replace" : mode;
}

/** The name and quantity a part will get (edited fields, else as read). */
export function partEdit(
  preview: PastePreview,
  index: number,
  edits?: ReadonlyMap<number, Partial<PartEdit>>,
): PartEdit {
  const part = preview.parts[index]!;
  const edit = edits?.get(index);
  return { name: edit?.name ?? part.name, quantity: edit?.quantity ?? part.quantity };
}

/** Why the preview cannot be imported as it is (German), or null. */
export function pasteBlocker(preview: PastePreview, options: PasteOptions, doc: BuilderDoc): string | null {
  if (preview.parts.length === 0) {
    return "Im Text wurden keine Runden oder Reihen gefunden. Beispiel: „Runde 1: 6 fM in den Fadenring (6)“.";
  }
  if (preview.localeUncertain) return "Bitte zuerst die Schreibweise bestätigen: Deutsch, US oder UK.";
  const count = preview.parts.length;
  const mode = effectiveMode(options.mode, doc);
  if (mode === "replace" && count > MAX_PARTS) {
    return `Der Text ergibt ${count} Teile – der Builder bearbeitet höchstens ${MAX_PARTS}. Bitte den Text kürzen.`;
  }
  if (mode === "append" && doc.parts.length + count > MAX_PARTS) {
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

/**
 * Notes after the import: the old ones (when appending) plus the preamble — unless the old
 * notes already hold it (the same pattern imported twice).
 */
export function notesWith(previous: string | undefined, preamble: readonly string[]): string {
  const added = preamble.join("\n").trim();
  const old = previous?.trim() ?? "";
  if (!added || old.includes(added)) return old;
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
  const mode = effectiveMode(options.mode, doc);

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
  const useTitle = mode === "replace" && preview.title !== undefined;
  const preamble = options.includePreamble ? preview.preamble.filter((_, i) => !(useTitle && i === 0)) : [];

  if (mode === "replace") {
    const fresh = emptyDocument(makeId());
    const notes = notesWith(undefined, preamble);
    const next: BuilderDoc = {
      ...fresh,
      // A new pattern: its title comes from the text, or stays empty.
      title: preview.title ?? "",
      overview: notes ? { ...fresh.overview, notes } : fresh.overview,
      parts,
    };
    // `source`: provenance for the TellmeCrochet hand-off (E25).
    return { ok: true, action: { type: "replaceDocument", doc: next, pinned, source: "paste" }, mode, parts: parts.length, unread };
  }

  const action: EditorAction = { type: "appendParts", parts, pinned };
  if (preamble.length > 0) {
    const notes = notesWith(doc.overview.notes, preamble);
    if (notes !== (doc.overview.notes?.trim() ?? "")) action.notes = notes;
  }
  return { ok: true, action, mode, parts: parts.length, unread };
}
