/**
 * The preview client the app uses: a Web Worker when the browser has one, otherwise (tests,
 * jsdom, very old browsers) the same computation on the main thread.
 */

import { mainThreadBackend, PreviewClient, workerBackend, type WorkerLike } from "./protocol.js";

/** `true` when module workers can be created here. */
export function canUseWorker(): boolean {
  return typeof Worker !== "undefined" && typeof URL !== "undefined";
}

export function createPreviewClient(): PreviewClient {
  const fallback = mainThreadBackend();
  if (!canUseWorker()) return new PreviewClient(fallback);
  const create = (): WorkerLike =>
    new Worker(new URL("./preview.worker.ts", import.meta.url), { type: "module", name: "crochet-preview" });
  try {
    return new PreviewClient(workerBackend(create), fallback);
  } catch {
    // e.g. a Content-Security-Policy without worker-src: compute on the main thread.
    return new PreviewClient(fallback);
  }
}
