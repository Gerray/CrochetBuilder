/**
 * Preview model computation and its message protocol.
 *
 * The 3D preview runs `buildModel` + `toMesh` off the main thread (see `preview.worker.ts`);
 * this module holds everything that is not tied to a Worker so it can run — and be tested —
 * anywhere: the request/response shapes, the computation itself (`PreviewComputer`), the
 * list of transferable buffers, and the request bookkeeping that drops stale results.
 */

import {
  buildModel,
  DEFAULT_MAX_STITCHES,
  isInstructionRow,
  nodeColorIndices,
  stitchYarnRadius,
  toMesh,
  type Finish,
  type Gauge,
  type MeshStyle,
  type Model,
  type PartContent,
  type Size,
  type StitchGraph,
} from "@crochetbuilder/engine";
import type { MeshBacking } from "../three/mapping.js";

export type { MeshBacking };

/** Main thread → worker. */
export interface PreviewRequest {
  /** Increasing per client; a result is only used when its id is the latest one sent. */
  id: number;
  content: PartContent;
  gauge: Gauge | undefined;
  style: MeshStyle;
  /** Stitch budget (default `DEFAULT_MAX_STITCHES`). */
  maxStitches?: number;
  /**
   * Palette ids (`overview.colors`, in order). When not empty the model carries the palette
   * index of every stitch (`nodeColor`).
   */
  palette?: readonly string[];
}

/**
 * Everything the view needs from a model: the mesh (typed arrays, transferable) plus the
 * row of every graph node, so that row highlight and stitch picking work without the graph.
 */
export interface PreviewModel {
  style: MeshStyle;
  primitive: "triangles" | "points";
  /** xyz per vertex, mm (canonical pose: rounds grow along +Y, flat pieces lie in XY). */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Graph node of every vertex. */
  nodeIndex: Uint32Array;
  /** Per graph node: index into `rowIds`. */
  nodeRow: Uint32Array;
  /** Ids of the rows that produced stitches, in document order. */
  rowIds: string[];
  /** Per graph node: palette index of its yarn colour; only with a palette in the request. */
  nodeColor?: Uint16Array;
  /** Bounding size of the relaxed piece, mm. */
  size: Size;
  /** Largest round diameter, mm; 0 for pieces without closed rounds. */
  maxDiameter: number;
  /** Gauge came from defaults or yarn weight, not from a swatch. */
  estimated: boolean;
  stitchCount: number;
  stitchWidthMm: number;
  yarnDiameterMm: number;
  /** `"stitches"` style: the fabric surface behind the lattice (picking, faint backing). */
  backing?: MeshBacking;
}

/**
 * The fabric surface behind the stitch lattice, moved back by about a yarn radius along its
 * normals so the yarn always lies in front of it.
 */
export function backingOf(graph: StitchGraph, finish?: Finish): MeshBacking {
  const surface = toMesh(graph, "surface", { smooth: "auto", finish });
  const inset = 0.75 * stitchYarnRadius(graph.gauge);
  const positions = surface.positions;
  for (let i = 0; i < positions.length; i++) positions[i] = positions[i]! - inset * surface.normals[i]!;
  return { positions, normals: surface.normals, indices: surface.indices };
}

/** Worker → main thread. */
export type PreviewResult =
  | { id: number; kind: "model"; model: PreviewModel }
  /** No stitches yet (empty pattern, only notes). */
  | { id: number; kind: "empty" }
  /** Above the stitch budget: no model was built. */
  | { id: number; kind: "overBudget"; stitchCount: number; maxStitches: number }
  | { id: number; kind: "error"; message: string };

/** Buffers of a result that can be moved (not copied) through `postMessage`. */
export function transferablesOf(result: PreviewResult): ArrayBuffer[] {
  if (result.kind !== "model") return [];
  const m = result.model;
  const arrays: ArrayBufferView[] = [m.positions, m.normals, m.indices, m.nodeIndex, m.nodeRow];
  if (m.nodeColor) arrays.push(m.nodeColor);
  if (m.backing) arrays.push(m.backing.positions, m.backing.normals, m.backing.indices);
  return arrays.map((a) => a.buffer as ArrayBuffer);
}

/** Row of every node as an index into the list of row ids. */
export function nodeRows(model: Pick<Model, "graph">): { nodeRow: Uint32Array; rowIds: string[] } {
  const { graph } = model;
  const rowIds = graph.rows.map((r) => r.rowId);
  const index = new Map(rowIds.map((id, i) => [id, i]));
  const nodeRow = new Uint32Array(graph.nodes.length);
  for (let i = 0; i < graph.nodes.length; i++) nodeRow[i] = index.get(graph.nodes[i]!.rowId) ?? 0;
  return { nodeRow, rowIds };
}

/**
 * Cache key of a relaxed model: only what shapes the stitch graph (row ids, types, ops and
 * whether a row is a free instruction), the part's finish and stuffing, gauge and budget.
 * Labels, note texts, stitch-count targets and colours do not change the model, so editing
 * them does not relax again.
 */
export function geometryKey(content: PartContent, gauge: Gauge | undefined, maxStitches: number): string {
  const rows = content.rows.map((r) => [r.id, r.type, r.ops, isInstructionRow(r)]);
  // Colour changes (`StitchOp.color`) are left out of the ops.
  return JSON.stringify([rows, content.finish ?? null, content.stuffing ?? null, gauge ?? null, maxStitches], (k, v) =>
    k === "color" ? undefined : v,
  );
}

/**
 * Computes preview results. Keeps the last relaxed model, so switching only the mesh style
 * does not relax again.
 */
export class PreviewComputer {
  private lastKey: string | null = null;
  private lastModel: Model | null = null;

  constructor(private readonly build: typeof buildModel = buildModel) {}

  compute(req: PreviewRequest): PreviewResult {
    const { id } = req;
    try {
      const maxStitches = req.maxStitches ?? DEFAULT_MAX_STITCHES;
      const key = geometryKey(req.content, req.gauge, maxStitches);
      let model = key === this.lastKey ? this.lastModel : null;
      if (!model) {
        model = this.build(req.content, req.gauge, { maxStitches });
        this.lastKey = key;
        this.lastModel = model;
      }
      const { graph } = model;
      if (graph.overBudget) return { id, kind: "overBudget", stitchCount: graph.stitchCount, maxStitches };
      if (graph.nodes.length === 0) return { id, kind: "empty" };
      // Close the mesh as the relaxation closed the piece (the part's finish, else the guess).
      const mesh = toMesh(graph, req.style, { smooth: "auto", finish: model.finish });
      return {
        id,
        kind: "model",
        model: {
          style: mesh.style,
          primitive: mesh.primitive,
          positions: mesh.positions,
          normals: mesh.normals,
          indices: mesh.indices,
          nodeIndex: mesh.nodeIndex,
          ...nodeRows(model),
          ...(req.palette && req.palette.length > 0
            ? { nodeColor: nodeColorIndices(graph, req.content, req.palette.map((id) => ({ id }))) }
            : {}),
          size: model.size,
          maxDiameter: model.maxDiameter,
          estimated: model.estimated,
          stitchCount: graph.stitchCount,
          stitchWidthMm: graph.gauge.stitchWidthMm,
          yarnDiameterMm: graph.gauge.yarnDiameterMm,
          ...(req.style === "stitches" ? { backing: backingOf(graph, model.finish) } : {}),
        },
      };
    } catch (err) {
      this.lastKey = null;
      this.lastModel = null;
      return { id, kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ---------------------------------------------------------------------------
// Client side: one request in flight, newest wins
// ---------------------------------------------------------------------------

/** Where requests are computed: a Worker, the main thread, or a fake in tests. */
export interface PreviewBackend {
  post(req: PreviewRequest): void;
  dispose(): void;
}

/** Creates a backend that reports results (and fatal backend failures) through callbacks. */
export type BackendFactory = (onResult: (r: PreviewResult) => void, onFailure: (err: unknown) => void) => PreviewBackend;

export type PreviewInput = Omit<PreviewRequest, "id">;

/** Stitch budget while computing on the main thread: keeps an edit well under a second. */
export const MAIN_THREAD_MAX_STITCHES = 5_000;

/** A request without an answer after this long counts as a dead backend (ms). */
export const WATCHDOG_MS = 15_000;

export interface PreviewClientOptions {
  /** Backend to switch to once the primary one fails (a Worker that cannot load). */
  fallback?: BackendFactory;
  /** Budget for requests computed by the fallback (it runs on the main thread). */
  fallbackMaxStitches?: number;
  /** Treat the backend as dead when a request has no answer after this long. */
  watchdogMs?: number;
  /** Budget for requests computed by the primary backend (default: as requested). */
  maxStitches?: number;
  /** The primary backend already runs on the main thread (no Worker available). */
  mainThread?: boolean;
  /** Called once when the client switches to the fallback. */
  onFallback?: (err: unknown) => void;
}

/**
 * Sends preview requests to a backend and hands back only the newest result.
 *
 * - At most one request is in flight; a request made meanwhile waits in a single slot and
 *   replaces whatever waited there, so a burst of edits costs at most two computations.
 * - `compute` resolves with the result, or with `null` once a newer request superseded it.
 *   It never rejects.
 * - A backend fails when it says so (worker `error` / `messageerror`), when `post` throws
 *   (e.g. `DataCloneError`) or when a request stays unanswered for `watchdogMs`. The client
 *   then switches to `fallback` (with the smaller `fallbackMaxStitches` budget) and re-sends
 *   the pending request; without a fallback left the request ends with an error result.
 */
export class PreviewClient {
  private latestId = 0;
  private inFlight: PreviewRequest | null = null;
  private queued: PreviewRequest | null = null;
  private waiters = new Map<number, (r: PreviewResult | null) => void>();
  private backend: PreviewBackend;
  private fallback: BackendFactory | undefined;
  private budget: number | undefined;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private usingFallback = false;

  constructor(
    primary: BackendFactory,
    private readonly options: PreviewClientOptions = {},
  ) {
    this.fallback = options.fallback;
    this.budget = options.maxStitches;
    this.usingFallback = options.mainThread ?? false;
    this.backend = this.connect(primary);
  }

  compute(input: PreviewInput): Promise<PreviewResult | null> {
    if (this.disposed) return Promise.resolve(null);
    const id = ++this.latestId;
    for (const resolve of this.waiters.values()) resolve(null);
    this.waiters.clear();
    const req: PreviewRequest = { ...input, id };
    return new Promise((resolve) => {
      this.waiters.set(id, resolve);
      if (this.inFlight) this.queued = req;
      else this.send(req);
    });
  }

  /** `true` while a request is computing or waiting. */
  get busy(): boolean {
    return this.inFlight !== null || this.queued !== null;
  }

  /** `true` while the client computes on the main thread (fallback or no Worker). */
  get degraded(): boolean {
    return this.usingFallback;
  }

  dispose(): void {
    this.disposed = true;
    this.clearWatchdog();
    for (const resolve of this.waiters.values()) resolve(null);
    this.waiters.clear();
    this.inFlight = null;
    this.queued = null;
    this.backend.dispose();
  }

  private connect(factory: BackendFactory): PreviewBackend {
    return factory(
      (r) => this.onResult(r),
      (err) => this.onFailure(err),
    );
  }

  private send(req: PreviewRequest): void {
    const sent =
      this.budget === undefined
        ? req
        : { ...req, maxStitches: Math.min(req.maxStitches ?? DEFAULT_MAX_STITCHES, this.budget) };
    this.inFlight = sent;
    this.clearWatchdog();
    const ms = this.options.watchdogMs ?? WATCHDOG_MS;
    if (Number.isFinite(ms) && ms > 0) {
      this.watchdog = setTimeout(() => this.onFailure(new Error("Keine Antwort von der Vorschau-Berechnung")), ms);
    }
    try {
      this.backend.post(sent);
    } catch (err) {
      this.onFailure(err);
    }
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private onResult(result: PreviewResult): void {
    if (this.disposed || !this.inFlight || result.id !== this.inFlight.id) return;
    this.clearWatchdog();
    this.inFlight = null;
    const resolve = this.waiters.get(result.id);
    if (resolve && result.id === this.latestId) {
      this.waiters.delete(result.id);
      resolve(result);
    }
    const next = this.queued;
    this.queued = null;
    if (next) this.send(next);
  }

  private onFailure(err: unknown): void {
    if (this.disposed) return;
    this.clearWatchdog();
    try {
      this.backend.dispose();
    } catch {
      // a broken backend may fail to clean up; it is dropped either way
    }
    const retry = this.queued ?? this.inFlight;
    this.inFlight = null;
    this.queued = null;
    let next: BackendFactory;
    if (this.fallback) {
      next = this.fallback;
      this.fallback = undefined;
      this.usingFallback = true;
      this.budget = this.options.fallbackMaxStitches;
      this.options.onFallback?.(err);
    } else {
      next = failingBackend(err);
    }
    this.backend = this.connect(next);
    if (retry) this.send(retry);
  }
}

/** A backend that answers every request with an error (no fallback left). */
function failingBackend(err: unknown): BackendFactory {
  const message = err instanceof Error ? err.message : String(err);
  return (onResult) => ({
    post: (req) => queueMicrotask(() => onResult({ id: req.id, kind: "error", message })),
    dispose: () => {},
  });
}

/** Computes on the main thread, asynchronously (one macrotask later), skipping stale work. */
export function mainThreadBackend(computer = new PreviewComputer()): BackendFactory {
  return (onResult) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: PreviewRequest | null = null;
    return {
      post(req) {
        pending = req;
        timer ??= setTimeout(() => {
          timer = null;
          const next = pending;
          pending = null;
          if (next) onResult(computer.compute(next));
        }, 0);
      },
      dispose() {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        pending = null;
      },
    };
  };
}

/** Minimal Worker surface the backend uses (lets tests pass a fake). */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onmessageerror?: ((e: MessageEvent) => void) | null;
}

/** Computes in a Worker created by `create`; a load or runtime failure is reported once. */
export function workerBackend(create: () => WorkerLike): BackendFactory {
  return (onResult, onFailure) => {
    const worker = create();
    worker.onmessage = (e) => onResult(e.data as PreviewResult);
    worker.onerror = (e) => {
      e.preventDefault?.();
      onFailure(new Error(e.message || "Worker konnte nicht starten"));
    };
    // A result that cannot be deserialised would otherwise never arrive.
    worker.onmessageerror = () => onFailure(new Error("Antwort der Vorschau-Berechnung unlesbar"));
    return {
      post: (req) => worker.postMessage(req),
      dispose: () => {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      },
    };
  };
}
