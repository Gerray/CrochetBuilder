/**
 * Local persistence: the current document lives in IndexedDB (one record), with
 * localStorage as fallback when IndexedDB is unavailable (private mode, old browsers,
 * tests). No account, no server.
 */

import { BuilderExportSchema } from "@crochetbuilder/engine";
import type { BuilderDoc } from "./document.js";

export interface StoredState {
  doc: BuilderDoc;
  pinned: string[];
}

const DB_NAME = "crochetbuilder";
const STORE = "documents";
const KEY = "current";
const LS_KEY = "crochetbuilder:current";

/** Check a stored value; anything that is not a valid one-part document is ignored. */
export function parseStored(value: unknown): StoredState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { doc?: unknown; pinned?: unknown };
  const parsed = BuilderExportSchema.safeParse(record.doc);
  if (!parsed.success || parsed.data.parts.length === 0) return null;
  const pinned = Array.isArray(record.pinned) ? record.pinned.filter((x): x is string => typeof x === "string") : [];
  return { doc: parsed.data, pinned };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

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

function lsGet(): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function lsSet(state: StoredState): void {
  globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(state));
}

export async function loadState(): Promise<StoredState | null> {
  const db = await openDb();
  if (db) {
    try {
      const value = await request(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY));
      return parseStored(value);
    } catch {
      // fall through to localStorage
    }
  }
  return parseStored(lsGet());
}

export async function saveState(state: StoredState): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(state, KEY);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return;
    } catch {
      // fall through to localStorage
    }
  }
  lsSet(state);
}
