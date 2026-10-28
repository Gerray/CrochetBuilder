/**
 * Share, embed and TellmeCrochet links of the current document. Share and embed links carry
 * the export in the URL fragment (`#data=v1.…`), the TellmeCrochet link a TellmeCrochet
 * draft (`#data=tmc1.…`, see `tmc.ts`); fragments never reach a server.
 */

import { buildViewerUrl, encodeShare, type TmcOriginHint } from "@crochetbuilder/engine";
import type { BuilderDoc } from "../state/document.js";
import { prepareExport } from "./prepare.js";
import { tmcLink } from "./tmc.js";

/** Above this length some programs (mail, chat, CMS) shorten or break a link. */
export const LONG_URL_CHARS = 8000;

export interface ShareLinks {
  payload: string;
  /** Read-only viewer page. */
  viewer: string;
  /** Viewer page in compact embed mode (`?embed=1`). */
  embed: string;
  /** `https://tellmecrochet.de/import#data=tmc1.…` */
  tmc: string;
  /** What arrives differently in TellmeCrochet (German sentences; empty: nothing). */
  tmcSummary: string[];
}

/** The viewer page next to the builder page: `<builder>/viewer/`. */
export function viewerBaseUrl(pageUrl: string): string {
  return new URL("viewer/", pageUrl).href;
}

/** The builder page next to the viewer page: `<viewer>/../`. */
export function builderBaseUrl(viewerUrl: string): string {
  return new URL("../", viewerUrl).href;
}

/**
 * Validated export → payloads → links. `pageUrl` is the builder page (default: this page),
 * `originHint` the provenance the TellmeCrochet link reports (E25).
 */
export async function shareLinks(
  doc: BuilderDoc,
  pageUrl: string = globalThis.location.href,
  originHint: TmcOriginHint = "self_created",
): Promise<ShareLinks> {
  const exp = prepareExport(doc);
  const [payload, tmc] = await Promise.all([encodeShare(exp), tmcLink(exp, originHint)]);
  const base = viewerBaseUrl(pageUrl);
  return {
    payload,
    viewer: buildViewerUrl(base, payload),
    embed: buildViewerUrl(base, payload, { embed: true }),
    tmc: tmc.url,
    tmcSummary: tmc.summary,
  };
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** HTML snippet for blogs and shops. */
export function embedSnippet(embedUrl: string, title: string): string {
  const label = title.trim() ? `${title.trim()} – 3D-Modell` : "Häkelanleitung – 3D-Modell";
  return `<iframe src="${escapeAttr(embedUrl)}" title="${escapeAttr(label)}" width="480" height="420" style="border:0;max-width:100%" loading="lazy" allowfullscreen></iframe>`;
}
