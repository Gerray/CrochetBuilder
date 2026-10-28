/**
 * Where the paste preview is computed: a Web Worker when the browser has one (large pastes
 * never block typing), otherwise — tests, jsdom, a worker that fails to load — the same
 * function on the main thread, for a smaller text size.
 *
 * Both run at most one job at a time and keep at most one waiting: always the latest text.
 * A waiting job that is overtaken by a newer one is rejected with `SupersededError` (its
 * result would be outdated anyway), so fast typing never builds up a backlog.
 */

import { buildPastePreview, type LocaleChoice, type PastePreview } from "./preview.js";

/** Longest text read in the worker (characters). */
export const MAX_PASTE_CHARS = 200_000;
/**
 * Longest text read on the main thread: about a tenth of a second per reading, so typing
 * stays responsive without a worker.
 */
export const MAX_MAIN_THREAD_PASTE_CHARS = 30_000;

export interface PasteRequest {
  id: number;
  text: string;
  choice: LocaleChoice;
}

export type PasteResponse = { id: number; preview: PastePreview } | { id: number; error: string };

/** A request was overtaken by a newer one before it started. */
export class SupersededError extends Error {
  constructor() {
    super("superseded");
    this.name = "SupersededError";
  }
}

export interface PasteParser {
  parse(text: string, choice: LocaleChoice): Promise<PastePreview>;
  /** Longest text this parser reads (see `MAX_PASTE_CHARS`). */
  readonly maxChars: number;
  dispose(): void;
}

interface Job {
  text: string;
  choice: LocaleChoice;
  resolve: (p: PastePreview) => void;
  reject: (e: unknown) => void;
}

/**
 * One job running, at most one waiting (the latest): `start(job, done)` runs a job and calls
 * `done` when it settled.
 */
function queue(start: (job: Job, done: () => void) => void) {
  let running = false;
  let waiting: Job | null = null;
  const next = () => {
    running = false;
    const job = waiting;
    waiting = null;
    if (job) run(job);
  };
  const run = (job: Job) => {
    running = true;
    start(job, next);
  };
  return {
    push(job: Job) {
      if (!running) return run(job);
      waiting?.reject(new SupersededError());
      waiting = job;
    },
    clear() {
      waiting?.reject(new SupersededError());
      waiting = null;
    },
  };
}

/** Same computation on the main thread (after the current task, so the keystroke paints first). */
export function mainThreadParser(): PasteParser {
  const jobs = queue((job, done) => {
    setTimeout(() => {
      try {
        job.resolve(buildPastePreview(job.text, job.choice));
      } catch (err) {
        job.reject(err);
      }
      done();
    }, 0);
  });
  return {
    maxChars: MAX_MAIN_THREAD_PASTE_CHARS,
    parse: (text, choice) => new Promise((resolve, reject) => jobs.push({ text, choice, resolve, reject })),
    dispose: () => jobs.clear(),
  };
}

export interface WorkerLike {
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
  // The job in the worker, with the callback that lets the next one start.
  let current: { id: number; job: Job; done: () => void } | null = null;

  const fail = () => {
    failed = true;
    worker?.terminate();
    worker = null;
    // The running job is computed here instead; the waiting one follows through the queue.
    const job = current;
    current = null;
    if (job) {
      fallback.parse(job.job.text, job.job.choice).then(job.job.resolve, job.job.reject).finally(job.done);
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
      if (!current || e.data.id !== current.id) return;
      const { job, done } = current;
      current = null;
      if ("preview" in e.data) job.resolve(e.data.preview);
      else job.reject(new Error(e.data.error));
      done();
    };
    worker.onerror = fail;
    return worker;
  };

  const jobs = queue((job, done) => {
    const w = ensure();
    if (!w) {
      fallback.parse(job.text, job.choice).then(job.resolve, job.reject).finally(done);
      return;
    }
    const id = nextId++;
    current = { id, job, done };
    w.postMessage({ id, text: job.text, choice: job.choice });
  });

  return {
    get maxChars() {
      return failed ? MAX_MAIN_THREAD_PASTE_CHARS : MAX_PASTE_CHARS;
    },
    parse: (text, choice) => new Promise((resolve, reject) => jobs.push({ text, choice, resolve, reject })),
    dispose() {
      jobs.clear();
      worker?.terminate();
      worker = null;
      current = null;
      fallback.dispose();
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
