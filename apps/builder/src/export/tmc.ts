/**
 * Hand-off to TellmeCrochet: the export as a TellmeCrochet draft in an envelope (engine,
 * `toTellmeCrochetDraft`), as a file to save or as what the upload sends, plus the short German
 * notice of what arrives differently (`summary`).
 */

import {
  summarizeTmcLosses,
  tmcPartKeys,
  toTellmeCrochetDraft,
  toTmcEnvelope,
  type BuilderExport,
  type TmcEnvelope,
  type TmcOriginHint,
} from "@crochetbuilder/engine";
import { withAllPartIds } from "../state/assembly.js";
import type { BuilderDoc } from "../state/document.js";
import { downloadBlob, exportFileName, prepareExport } from "./prepare.js";

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
 * What an upload of `doc` sends. Parts count with the ids they get at their first upload, so the
 * keys are the same now and later, however they are moved or renamed. Throws like `prepareExport`.
 */
export function tmcUpload(doc: BuilderDoc, originHint: TmcOriginHint): TmcUpload {
  const exp = prepareExport(withAllPartIds(doc));
  return { ...tmcHandoff(exp, originHint), partKeys: tmcPartKeys(exp) };
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
