/**
 * The client of the "Montage" computation: the preview's `PreviewClient` (newest request
 * wins, Worker with main-thread fallback) with the assembly's request and result.
 */

import {
  MAIN_THREAD_MAX_STITCHES,
  mainThreadBackend,
  PreviewClient,
  workerBackend,
  type WorkerLike,
} from "../preview/protocol.js";
import { canUseWorker } from "../preview/client.js";
import { AssemblyComputer, type AssemblyRequest, type AssemblyResult } from "./compute.js";

export type AssemblyClient = PreviewClient<AssemblyRequest, AssemblyResult>;

const mainThread = () => mainThreadBackend<AssemblyRequest, AssemblyResult>(new AssemblyComputer());

export function createAssemblyClient(): AssemblyClient {
  const fallback = () =>
    new PreviewClient<AssemblyRequest, AssemblyResult>(mainThread(), { maxStitches: MAIN_THREAD_MAX_STITCHES, mainThread: true });
  if (!canUseWorker()) return fallback();
  const create = (): WorkerLike =>
    new Worker(new URL("./assembly.worker.ts", import.meta.url), { type: "module", name: "crochet-assembly" });
  try {
    return new PreviewClient<AssemblyRequest, AssemblyResult>(workerBackend(create), {
      fallback: mainThread(),
      fallbackMaxStitches: MAIN_THREAD_MAX_STITCHES,
    });
  } catch {
    return fallback();
  }
}
