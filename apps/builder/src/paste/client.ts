/**
 * Where the paste preview is computed: a Web Worker when the browser has one (large pastes
 * never block typing), otherwise — tests, jsdom, a worker that fails to load — the same
 * function on the main thread.
 */

import { buildPastePreview, type LocaleChoice, type PastePreview } from "./preview.js";

export interface PasteRequest {
  id: number;
  text: string;
  choice: LocaleChoice;
}

export type PasteResponse = { id: number; preview: PastePreview } | { id: number; error: string };

export interface PasteParser {
  parse(text: string, choice: LocaleChoice): Promise<PastePreview>;
  dispose(): void;
}

/** Same computation on the main thread (after the current task, so the keystroke paints first). */
export function mainThreadParser(): PasteParser {
  return {
    parse: (text, choice) =>
      new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            resolve(buildPastePreview(text, choice));
          } catch (err) {
            reject(err);
          }
        }, 0);
      }),
    dispose: () => {},
  };
}

interface WorkerLike {
  postMessage(message: PasteRequest): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<PasteResponse>) => void) | null;
  onerror: ((e: Event) => void) | null;
}

/** A parser backed by `create()`'s worker; falls back to the main thread if it fails. */
export function workerParser(create: () => WorkerLike): PasteParser {
  const fallback = mainThreadParser();
  let worker: WorkerLike | null = null;
  let failed = false;
  let nextId = 1;
  const pending = new Map<number, { text: string; choice: LocaleChoice; resolve: (p: PastePreview) => void; reject: (e: unknown) => void }>();

  const fail = () => {
    failed = true;
    worker?.terminate();
    worker = null;
    // Everything still waiting is computed here instead.
    for (const [id, job] of pending) {
      pending.delete(id);
      fallback.parse(job.text, job.choice).then(job.resolve, job.reject);
    }
  };

  const ensure = (): WorkerLike | null => {
    if (failed) return null;
    if (worker) return worker;
    try {
      worker = create();
    } catch {
      failed = true;
      return null;
    }
    worker.onmessage = (e) => {
      const job = pending.get(e.data.id);
      if (!job) return;
      pending.delete(e.data.id);
      if ("preview" in e.data) job.resolve(e.data.preview);
      else job.reject(new Error(e.data.error));
    };
    worker.onerror = fail;
    return worker;
  };

  return {
    parse(text, choice) {
      const w = ensure();
      if (!w) return fallback.parse(text, choice);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { text, choice, resolve, reject });
        w.postMessage({ id, text, choice });
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}

export function createPasteParser(): PasteParser {
  if (typeof Worker === "undefined" || typeof URL === "undefined") return mainThreadParser();
  return workerParser(
    () =>
      new Worker(new URL("./paste.worker.ts", import.meta.url), {
        type: "module",
        name: "crochet-paste",
      }) as unknown as WorkerLike,
  );
}
