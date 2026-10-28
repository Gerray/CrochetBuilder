/**
 * Web Worker of the "Montage" view: relaxes, meshes and places all parts off the main
 * thread. `AssemblyRequest` in, `AssemblyResult` out; mesh buffers are transferred.
 */

import { AssemblyComputer, assemblyTransferables, type AssemblyRequest } from "./compute.js";

interface WorkerScope {
  onmessage: ((e: MessageEvent<AssemblyRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const computer = new AssemblyComputer();

scope.onmessage = (e) => {
  const result = computer.compute(e.data);
  scope.postMessage(result, assemblyTransferables(result));
};
