/**
 * Which TellmeCrochet project a document belongs to. App-local: it lives next to the stored
 * document (like `imported`), never in the export. A document has it from its first upload on.
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
  lastUpload: LastUpload;
}

/** The link stored in `record`, or null when it is missing or unreadable (the document stays valid). */
export function parseUploadLink(record: { builderKey?: unknown; lastUpload?: unknown }): UploadLink | null {
  const { builderKey, lastUpload } = record;
  if (typeof builderKey !== "string" || builderKey === "" || !lastUpload || typeof lastUpload !== "object") return null;
  const { patternId, at, origin } = lastUpload as { patternId?: unknown; at?: unknown; origin?: unknown };
  if (typeof patternId !== "string" || patternId === "") return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  if (origin !== "self_created" && origin !== "imported") return null;
  return { builderKey, lastUpload: { patternId, at, origin } };
}
