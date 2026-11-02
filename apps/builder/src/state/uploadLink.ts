/**
 * Which TellmeCrochet project a document belongs to. App-local: it lives next to the stored
 * document (like `imported`), never in the export. A document has it from its first upload on;
 * when the project is deleted in the app, the key stays for a new one and `lastUpload` goes.
 */

import type { BuilderDoc } from "./document.js";

export type TmcOrigin = "self_created" | "imported";

export interface LastUpload {
  patternId: string;
  /** Milliseconds since epoch. */
  at: number;
  origin: TmcOrigin;
}

export interface UploadLink {
  /** Random id that finds the project again (`crypto.randomUUID()`). */
  builderKey: string;
  /** Null: the project of this key is gone. */
  lastUpload: LastUpload | null;
}

function parseLastUpload(value: unknown): LastUpload | null {
  if (!value || typeof value !== "object") return null;
  const { patternId, at, origin } = value as { patternId?: unknown; at?: unknown; origin?: unknown };
  if (typeof patternId !== "string" || patternId === "") return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  if (origin !== "self_created" && origin !== "imported") return null;
  return { patternId, at, origin };
}

/** The link stored in `record`, or null without a key; what is unreadable counts as absent (the document stays valid). */
export function parseUploadLink(record: { builderKey?: unknown; lastUpload?: unknown }): UploadLink | null {
  const { builderKey, lastUpload } = record;
  if (typeof builderKey !== "string" || builderKey === "") return null;
  return { builderKey, lastUpload: parseLastUpload(lastUpload) };
}

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Which document this is, across a reload: its project's key, else a fingerprint of its title and
 * parts. Row ids make it its own, and they come back unchanged from the autosave. Any edit in
 * another tab counts as another document, which only ever makes the dialog ask again.
 */
export function documentIdentity(doc: BuilderDoc, link: UploadLink | null): string {
  if (link) return `key:${link.builderKey}`;
  const parts = doc.parts.map((p) => [p.name, p.quantity, p.content.rows.map((r) => r.id)]);
  return `doc:${hash(JSON.stringify([doc.title, parts]))}`;
}
