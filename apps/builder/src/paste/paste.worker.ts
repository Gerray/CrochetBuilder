/**
 * Web Worker: reads a pasted pattern off the main thread (a 100 KB paste takes a few hundred
 * milliseconds to parse and validate). `PasteRequest` in, `PasteResponse` out.
 */

import type { PasteRequest, PasteResponse } from "./client.js";
import { buildPastePreview } from "./preview.js";

interface WorkerScope {
  onmessage: ((e: MessageEvent<PasteRequest>) => void) | null;
  postMessage(message: PasteResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, text, choice } = e.data;
  try {
    scope.postMessage({ id, preview: buildPastePreview(text, choice) });
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
