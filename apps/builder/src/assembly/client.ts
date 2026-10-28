/**
 * The client of the "Montage" computation: the preview's `PreviewClient` (newest request
 * wins, Worker with main-thread fallback) with the assembly's request and result.
 *
 * The app shares ONE client (`sharedAssemblyClient`): the Montage view and the PDF use the
 * same worker and its cache of relaxed parts. A request superseded by the other user comes
 * back as `null`; `computeAssembly` asks again.
 */

import {
  MAIN_THREAD_MAX_STITCHES,
  mainThreadBackend,
  PreviewClient,
  WATCHDOG_MS,
  workerBackend,
  type WorkerLike,
} from "../preview/protocol.js";
import { canUseWorker } from "../preview/client.js";
import { buildModel } from "@crochetbuilder/engine";
import {
  AssemblyComputer,
  MAIN_THREAD_ASSEMBLY_STITCHES,
  totalStitches,
  type AssemblyRequest,
  type AssemblyResult,
} from "./compute.js";

export type AssemblyClient = PreviewClient<AssemblyRequest, AssemblyResult>;

/** Extra time the watchdog allows per stitch of a request (ms): relaxing is linear in stitches. */
export const WATCHDOG_MS_PER_STITCH = 1.5;

/** How long a request may stay unanswered before the backend counts as dead. */
export function assemblyWatchdogMs(req: Pick<AssemblyRequest, "doc">): number {
  return WATCHDOG_MS + WATCHDOG_MS_PER_STITCH * totalStitches(req.doc);
}

const mainThread = () =>
  mainThreadBackend<AssemblyRequest, AssemblyResult>(new AssemblyComputer(buildModel, MAIN_THREAD_ASSEMBLY_STITCHES));

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
      watchdogFor: assemblyWatchdogMs,
    });
  } catch {
    return fallback();
  }
}

let shared: AssemblyClient | null = null;

/**
 * The app's one assembly client, created on first use and kept (with its worker and cache)
 * for the page's lifetime. Its `dispose` only lets go of this handle.
 */
export function sharedAssemblyClient(): AssemblyClient {
  shared ??= createAssemblyClient();
  const client = shared;
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "dispose") return () => {};
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * Compute once with `client`; a result superseded by another request on the shared client
 * (`null`) is asked for again, up to `tries` times.
 */
export async function computeAssembly(
  client: AssemblyClient,
  input: Omit<AssemblyRequest, "id">,
  tries = 4,
): Promise<AssemblyResult | null> {
  for (let i = 0; i < tries; i++) {
    const result = await client.compute(input);
    if (result) return result;
  }
  return null;
}
