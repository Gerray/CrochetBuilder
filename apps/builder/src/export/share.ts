/**
 * Share and embed links of the current document. They carry the export in the URL fragment
 * (`#data=v1.…`), which never reaches a server. The TellmeCrochet link is made on its own
 * (`tmc.ts`), so a failing hand-off never takes the share links with it.
 */

import { buildViewerUrl, encodeShare } from "@crochetbuilder/engine";
import type { BuilderDoc } from "../state/document.js";
import { prepareExport } from "./prepare.js";

/** Above this length some programs (mail, chat, CMS) shorten or break a link. */
export const LONG_URL_CHARS = 8000;

export interface ShareLinks {
  payload: string;
  /** Read-only viewer page. */
  viewer: string;
  /** Viewer page in compact embed mode (`?embed=1`). */
  embed: string;
}

/** The viewer page next to the builder page: `<builder>/viewer/`. */
export function viewerBaseUrl(pageUrl: string): string {
  return new URL("viewer/", pageUrl).href;
}

/** The builder page next to the viewer page: `<viewer>/../`. */
export function builderBaseUrl(viewerUrl: string): string {
  return new URL("../", viewerUrl).href;
}

/** Validated export → payload → links. `pageUrl` is the builder page (default: this page). */
export async function shareLinks(doc: BuilderDoc, pageUrl: string = globalThis.location.href): Promise<ShareLinks> {
  const payload = await encodeShare(prepareExport(doc));
  const base = viewerBaseUrl(pageUrl);
  return {
    payload,
    viewer: buildViewerUrl(base, payload),
    embed: buildViewerUrl(base, payload, { embed: true }),
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
