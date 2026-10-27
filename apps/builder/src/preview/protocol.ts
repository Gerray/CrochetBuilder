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
  toMesh,
  type Gauge,
  type MeshStyle,
  type Model,
  type PartContent,
  type Size,
} from "@crochetbuilder/engine";

/** Main thread → worker. */
export interface PreviewRequest {
  /** Increasing per client; a result is only used when its id is the latest one sent. */
  id: number;
  content: PartContent;
  gauge: Gauge | undefined;
  style: MeshStyle;
  /** Stitch budget (default `DEFAULT_MAX_STITCHES`). */
  maxStitches?: number;
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
  /** Bounding size of the relaxed piece, mm. */
  size: Size;
  /** Largest round diameter, mm; 0 for pieces without closed rounds. */
  maxDiameter: number;
  /** Gauge came from defaults or yarn weight, not from a swatch. */
  estimated: boolean;
  stitchCount: number;
  stitchWidthMm: number;
  yarnDiameterMm: number;
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
  return [m.positions, m.normals, m.indices, m.nodeIndex, m.nodeRow].map((a) => a.buffer as ArrayBuffer);
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
      const key = JSON.stringify([req.content, req.gauge ?? null, maxStitches]);
      let model = key === this.lastKey ? this.lastModel : null;
      if (!model) {
        model = this.build(req.content, req.gauge, { maxStitches });
        this.lastKey = key;
        this.lastModel = model;
      }
      const { graph } = model;
      if (graph.overBudget) return { id, kind: "overBudget", stitchCount: graph.stitchCount, maxStitches };
      if (graph.nodes.length === 0) return { id, kind: "empty" };
      const mesh = toMesh(graph, req.style);
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
          size: model.size,
          maxDiameter: model.maxDiameter,
          estimated: model.estimated,
          stitchCount: graph.stitchCount,
          stitchWidthMm: graph.gauge.stitchWidthMm,
          yarnDiameterMm: graph.gauge.yarnDiameterMm,
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

/**
 * Sends preview requests to a backend and hands back only the newest result.
 *
 * - At most one request is in flight; a request made meanwhile waits in a single slot and
 *   replaces whatever waited there, so a burst of edits costs at most two computations.
 * - `compute` resolves with the result, or with `null` once a newer request superseded it.
 * - When the backend fails (a Worker that cannot load), the client switches to `fallback`
 *   and re-sends the request that was in flight.
 */
export class PreviewClient {
  private latestId = 0;
  private inFlight: PreviewRequest | null = null;
  private queued: PreviewRequest | null = null;
  private waiters = new Map<number, (r: PreviewResult | null) => void>();
  private backend: PreviewBackend;
  private disposed = false;

  constructor(primary: BackendFactory, private fallback?: BackendFactory) {
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

  dispose(): void {
    this.disposed = true;
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
    this.inFlight = req;
    this.backend.post(req);
  }

  private onResult(result: PreviewResult): void {
    if (this.disposed || !this.inFlight || result.id !== this.inFlight.id) return;
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
    this.backend.dispose();
    const retry = this.queued ?? this.inFlight;
    this.inFlight = null;
    this.queued = null;
    const fallback = this.fallback ?? failingBackend(err);
    this.fallback = undefined;
    this.backend = this.connect(fallback);
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
    return {
      post: (req) => worker.postMessage(req),
      dispose: () => {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      },
    };
  };
}
