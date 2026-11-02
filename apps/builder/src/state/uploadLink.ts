/**
 * Which TellmeCrochet project a document belongs to. App-local: it lives next to the stored
 * document (like `imported`), never in the export. A document has it from its first upload on;
 * when the project is deleted in the app, the key stays for a new one and `lastUpload` goes.
 */

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
