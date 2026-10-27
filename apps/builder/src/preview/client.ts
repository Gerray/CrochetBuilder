/**
 * The preview client the app uses: a Web Worker when the browser has one, otherwise (tests,
 * jsdom, very old browsers, a worker that fails to load) the same computation on the main
 * thread — with a smaller stitch budget there, so typing never freezes.
 */

import {
  MAIN_THREAD_MAX_STITCHES,
  mainThreadBackend,
  PreviewClient,
  workerBackend,
  type WorkerLike,
} from "./protocol.js";

/** `true` when module workers can be created here. */
export function canUseWorker(): boolean {
  return typeof Worker !== "undefined" && typeof URL !== "undefined";
}

let warned = false;
function warnOnce(err: unknown) {
  if (warned) return;
  warned = true;
  console.warn(
    `CrochetBuilder: 3D-Vorschau rechnet ohne Web Worker auf dem Haupt-Thread (höchstens ${MAIN_THREAD_MAX_STITCHES} Maschen).`,
    err,
  );
}

export function createPreviewClient(): PreviewClient {
  const mainThread = () =>
    new PreviewClient(mainThreadBackend(), { maxStitches: MAIN_THREAD_MAX_STITCHES, mainThread: true });
  if (!canUseWorker()) return mainThread();
  const create = (): WorkerLike =>
    new Worker(new URL("./preview.worker.ts", import.meta.url), { type: "module", name: "crochet-preview" });
  try {
    return new PreviewClient(workerBackend(create), {
      fallback: mainThreadBackend(),
      fallbackMaxStitches: MAIN_THREAD_MAX_STITCHES,
      onFallback: warnOnce,
    });
  } catch (err) {
    // e.g. a Content-Security-Policy without worker-src.
    warnOnce(err);
    return mainThread();
  }
}
