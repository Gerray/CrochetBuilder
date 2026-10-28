/**
 * Hand-off to TellmeCrochet: the export as a TellmeCrochet draft in an envelope (engine,
 * `toTellmeCrochetDraft`), as a link (`#data=tmc1.…`) or as a file to save, plus the short
 * German notice of what arrives differently (`summary`).
 */

import {
  buildTmcImportUrl,
  encodeTmcPayload,
  summarizeTmcLosses,
  toTellmeCrochetDraft,
  toTmcEnvelope,
  type BuilderExport,
  type TmcEnvelope,
  type TmcOriginHint,
} from "@crochetbuilder/engine";
import type { BuilderDoc } from "../state/document.js";
import { downloadBlob, exportFileName, prepareExport } from "./prepare.js";

export interface TmcHandoff {
  envelope: TmcEnvelope;
  /** What arrives differently in TellmeCrochet, in short German sentences (may be empty). */
  summary: string[];
}

export interface TmcLink extends TmcHandoff {
  payload: string;
  /** `https://tellmecrochet.de/import#data=tmc1.…` */
  url: string;
}

/** The envelope of a (validated) export and the notice of what changes on the way. */
export function tmcHandoff(exp: BuilderExport, originHint: TmcOriginHint): TmcHandoff {
  const { draft, losses } = toTellmeCrochetDraft(exp);
  return { envelope: toTmcEnvelope(draft, originHint), summary: summarizeTmcLosses(losses) };
}

/** The hand-off as a link. Throws like `encodeShare` (too large, no compression). */
export async function tmcLink(exp: BuilderExport, originHint: TmcOriginHint): Promise<TmcLink> {
  const handoff = tmcHandoff(exp, originHint);
  const payload = await encodeTmcPayload(handoff.envelope);
  return { ...handoff, payload, url: buildTmcImportUrl(payload) };
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
