/**
 * Web Worker: builds, relaxes and meshes the model off the main thread. Messages are
 * `PreviewRequest` in, `PreviewResult` out; mesh buffers are transferred, not copied.
 */

import { PreviewComputer, transferablesOf, type PreviewRequest } from "./protocol.js";

interface WorkerScope {
  onmessage: ((e: MessageEvent<PreviewRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const computer = new PreviewComputer();

scope.onmessage = (e) => {
  const result = computer.compute(e.data);
  scope.postMessage(result, transferablesOf(result));
};
