/**
 * Hand-off to TellmeCrochet: the export as a TellmeCrochet draft in an envelope (engine,
 * `toTellmeCrochetDraft`), as a file to save or as what the upload sends, plus the short German
 * notice of what arrives differently (`summary`).
 */

import {
  summarizeTmcLosses,
  TMC_MAX_TAP_STEPS_PER_PART,
  TMC_MAX_TAP_STEPS_PER_PATTERN,
  tmcPartKeys,
  tmcTapSteps,
  toTellmeCrochetDraft,
  toTmcEnvelope,
  type BuilderExport,
  type TmcEnvelope,
  type TmcOriginHint,
} from "@crochetbuilder/engine";
import { withAllPartIds } from "../state/assembly.js";
import type { BuilderDoc } from "../state/document.js";
import { downloadBlob, exportFileName, prepareExport } from "./prepare.js";

export const EMPTY_PATTERN_LINE = "Die Anleitung hat noch keine Reihen. Schreibe zuerst mindestens eine Reihe, dann kannst du sie hochladen.";

export interface TmcHandoff {
  envelope: TmcEnvelope;
  /** What arrives differently in TellmeCrochet, in short German sentences (may be empty). */
  summary: string[];
}

export interface TmcUpload extends TmcHandoff {
  /** One stable key per entry of `envelope.draft.parts`. */
  partKeys: string[];
}

/** The envelope of a (validated) export and the notice of what changes on the way. */
export function tmcHandoff(exp: BuilderExport, originHint: TmcOriginHint): TmcHandoff {
  const { draft, losses } = toTellmeCrochetDraft(exp);
  return { envelope: toTmcEnvelope(draft, originHint), summary: summarizeTmcLosses(losses) };
}

/**
 * Why `doc` cannot be uploaded although it can be exported (German), or null. The endpoint refuses
 * a pattern without any row. A part whose name is only spaces cannot get there: it arrives as
 * "Teil n".
 */
export function uploadBlocker(doc: BuilderDoc): string | null {
  const hasRow = doc.parts.some((part) => part.content.rows.some((r) => r.ops.length > 0 || r.note?.trim() || r.label?.trim()));
  return hasRow ? null : EMPTY_PATTERN_LINE;
}

/**
 * What an upload of `doc` sends. Parts count with the ids they get at their first upload, so the
 * keys are the same now and later, however they are moved or renamed. Without materials the list
 * is left out, so an update does not wipe the ones added in the app. Throws like `prepareExport`.
 */
export function tmcUpload(doc: BuilderDoc, originHint: TmcOriginHint): TmcUpload {
  const exp = prepareExport(withAllPartIds(doc));
  const handoff = tmcHandoff(exp, originHint);
  const { materials, ...draft } = handoff.envelope.draft;
  const envelope = materials?.length ? handoff.envelope : { ...handoff.envelope, draft };
  return { ...handoff, envelope, partKeys: tmcPartKeys(exp) };
}

const count = (n: number) => n.toLocaleString("de-DE");

/** Why what `tmcUpload` made is too long for the receiver (German), or null. */
export function uploadTooLong({ envelope }: Pick<TmcUpload, "envelope">): string | null {
  const steps = tmcTapSteps(envelope.draft);
  const part = steps.parts.findIndex((n) => n > TMC_MAX_TAP_STEPS_PER_PART);
  if (part >= 0) {
    const name = envelope.draft.parts[part]!.name;
    return `Zu lang zum Hochladen: „${name}“ hat ${count(steps.parts[part]!)} Maschen, TellmeCrochet nimmt höchstens ${count(TMC_MAX_TAP_STEPS_PER_PART)} je Teil.`;
  }
  if (steps.total > TMC_MAX_TAP_STEPS_PER_PATTERN) {
    return `Zu lang zum Hochladen: Die Anleitung hat ${count(steps.total)} Maschen, TellmeCrochet nimmt höchstens ${count(TMC_MAX_TAP_STEPS_PER_PATTERN)}.`;
  }
  return null;
}

/** File name of the saved hand-off: "amigurumi-kugel.tellmecrochet.json". */
export function tmcFileName(title: string): string {
  return exportFileName(title, "tellmecrochet.json");
}

/** "Für TellmeCrochet speichern (.json)": the envelope, pretty-printed. */
export function downloadTmcJson(doc: BuilderDoc, originHint: TmcOriginHint): void {
  const exp = prepareExport(doc);
  const { envelope } = tmcHandoff(exp, originHint);
  const blob = new Blob([JSON.stringify(envelope, null, 2) + "\n"], { type: "application/json" });
  downloadBlob(blob, tmcFileName(exp.title));
}
