/**
 * Local persistence: the current document lives in IndexedDB and, as a second copy, in
 * localStorage. Every record carries `savedAt`; on load the newer copy wins, so a failed
 * IndexedDB write can never resurrect an older state. No account, no server.
 *
 * A stored value that is not a valid document (older/foreign format, over the limits) is
 * never discarded: it is copied to a backup key and reported as `invalid`, and the app
 * must not autosave over it until the person decided what to do.
 */

import {
  BuilderExportSchema,
  MAX_STITCH_COUNT_TARGET,
  opsWithinLimits,
} from "@crochetbuilder/engine";
import type { BuilderDoc } from "./document.js";

export interface StoredState {
  doc: BuilderDoc;
  pinned: string[];
  /** Index of the part shown in the editor (0 for saves from before several parts). */
  part: number;
  /** Milliseconds since epoch of the save. */
  savedAt: number;
}

export type LoadResult =
  | { kind: "empty" }
  | { kind: "ok"; state: StoredState }
  /** `raw` is the unreadable stored value (also copied to the backup key). */
  | { kind: "invalid"; raw: unknown };

const DB_NAME = "crochetbuilder";
const STORE = "documents";
const KEY = "current";
const BACKUP_IDB_KEY = "backup";
export const LS_KEY = "crochetbuilder:current";
export const BACKUP_KEY = "crochetbuilder:backup";

function savedAtOf(value: unknown): number {
  const at = (value as { savedAt?: unknown } | null)?.savedAt;
  return typeof at === "number" && Number.isFinite(at) ? at : 0;
}

/**
 * Check a stored value; anything that is not a valid document with at least one part within
 * the limits → null. Saves from the one-part builder load unchanged (shown part: the first).
 */
export function parseStored(value: unknown): StoredState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { doc?: unknown; pinned?: unknown; part?: unknown };
  const parsed = BuilderExportSchema.safeParse(record.doc);
  if (!parsed.success || parsed.data.parts.length === 0) return null;
  const withinLimits = parsed.data.parts.every((part) =>
    part.content.rows.every(
      (row) => opsWithinLimits(row.ops) && row.stitchCountTarget <= MAX_STITCH_COUNT_TARGET,
    ),
  );
  if (!withinLimits) return null;
  const pinned = Array.isArray(record.pinned) ? record.pinned.filter((x): x is string => typeof x === "string") : [];
  const last = parsed.data.parts.length - 1;
  const part = Number.isInteger(record.part) ? Math.min(last, Math.max(0, record.part as number)) : 0;
  return { doc: parsed.data, pinned, part, savedAt: savedAtOf(value) };
}

// ---------------------------------------------------------------------------
// IndexedDB (tiny wrapper)
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase | null> | undefined;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbGet(key: string): Promise<unknown> {
  const db = await openDb();
  if (!db) return undefined;
  try {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    return await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function idbPut(key: string, value: unknown): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// localStorage
// ---------------------------------------------------------------------------

function lsGet(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

function lsPut(key: string, value: unknown): boolean {
  try {
    if (!globalThis.localStorage) return false;
    globalThis.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Keep an unreadable stored value under the backup key (both stores, best effort). */
async function backup(raw: unknown): Promise<void> {
  const record = { backedUpAt: Date.now(), raw };
  lsPut(BACKUP_KEY, record);
  await idbPut(BACKUP_IDB_KEY, record);
}

/** Load the newest stored copy. */
export async function loadState(): Promise<LoadResult> {
  const fromIdb = await idbGet(KEY);
  const fromLs = lsGet(LS_KEY);
  const candidates = [fromIdb, fromLs].filter((v) => v !== undefined && v !== null);
  if (candidates.length === 0) return { kind: "empty" };
  const newest = candidates.reduce((a, b) => (savedAtOf(b) > savedAtOf(a) ? b : a));
  const state = parseStored(newest);
  if (state) return { kind: "ok", state };
  await backup(newest);
  return { kind: "invalid", raw: newest };
}

/**
 * Save a state to both stores. The localStorage copy is written synchronously before the
 * first `await`, so a save started on `pagehide` survives the tab closing. Rejects only if
 * neither store took the write.
 */
export async function saveState(state: { doc: BuilderDoc; pinned: readonly string[]; part?: number }): Promise<void> {
  const record: StoredState = { doc: state.doc, pinned: [...state.pinned], part: state.part ?? 0, savedAt: Date.now() };
  const lsOk = lsPut(LS_KEY, record);
  const idbOk = await idbPut(KEY, record);
  if (!lsOk && !idbOk) throw new Error("Speichern fehlgeschlagen");
}

/** Test hook: forget the cached database connection. */
export function resetStorageConnection(): void {
  dbPromise = undefined;
}
