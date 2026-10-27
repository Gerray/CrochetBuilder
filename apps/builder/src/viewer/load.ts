/**
 * The viewer's data: the export in the page's own URL fragment (`#data=v1.…`). Nothing is
 * read from or written to browser storage.
 */

import { decodeShare, readShareFragment, type BuilderExport } from "@crochetbuilder/engine";
import { shareErrorMessage } from "../export/import.js";

export type ViewerData =
  | { status: "loading" }
  /** The URL has no `#data=`. */
  | { status: "missing" }
  /** The payload could not be decoded (German message). */
  | { status: "error"; message: string }
  | { status: "ready"; exp: BuilderExport; payload: string };

/** Decode the fragment of `hash`; never rejects. */
export async function loadViewerData(hash: string): Promise<ViewerData> {
  const payload = readShareFragment(hash);
  if (!payload) return { status: "missing" };
  try {
    const exp = await decodeShare(payload);
    if (exp.parts.length === 0) return { status: "error", message: "Der Link enthält keine Teile." };
    return { status: "ready", exp, payload };
  } catch (err) {
    return { status: "error", message: shareErrorMessage(err) };
  }
}

/** `?embed=1`: compact layout for iframes. */
export function isEmbed(search: string): boolean {
  const value = new URLSearchParams(search).get("embed");
  return value === "1" || value === "true";
}
