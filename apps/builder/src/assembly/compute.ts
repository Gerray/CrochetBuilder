/**
 * The assembled 3D scene ("Montage") off the main thread: every part is relaxed and meshed
 * exactly as the part preview does it (one `PreviewComputer` per part shape, so the mesh —
 * and whatever the preview adds to it, like yarn colours — is the same), then
 * `composeAssembly` places them. Like the part preview it runs in a Worker
 * (`assembly.worker.ts`) or, as a fallback, on the main thread.
 *
 * Meshes are the bulk of a result. The client says which part meshes it already holds
 * (`have`, by key); only the others are sent. Editing a placement therefore only sends the
 * new transforms.
 */

import {
  buildModel,
  composeAssembly,
  DEFAULT_MAX_STITCHES,
  nodeAnchorAngles,
  type AssemblyScene,
  type BuilderExport,
  type Gauge,
  type MeshStyle,
  type Model,
} from "@crochetbuilder/engine";
import {
  geometryKey,
  PreviewComputer,
  transferablesOf,
  type PreviewModel,
  type PreviewRequest,
  type PreviewResult,
} from "../preview/protocol.js";

/** What the assembly needs of the document. */
export type AssemblyDoc = Pick<BuilderExport, "parts" | "assembly" | "overview">;

/** Main thread → worker. */
export interface AssemblyRequest {
  id: number;
  doc: AssemblyDoc;
  style: MeshStyle;
  /** Stitch budget per part (default `DEFAULT_MAX_STITCHES`). */
  maxStitches?: number;
  /** Keys of the part meshes the client already holds (not sent again). */
  have: readonly string[];
}

/** A part's mesh plus the angle of every node for picking (`nodeAnchorAngles`). */
export interface PartMesh {
  key: string;
  model: PreviewModel;
  /** Per graph node: its placement angle in degrees (NaN: none). */
  nodeAngle: Float32Array;
}

export interface AssemblyPartResult {
  /** Index into `doc.parts`. */
  part: number;
  /** Key of the part's mesh (shape, gauge, budget and style). */
  key: string;
  status: "model" | "empty" | "overBudget" | "error";
  /** The mesh, unless the client said it has it. */
  mesh?: PartMesh;
  message?: string;
}

/** Worker → main thread. */
export type AssemblyResult =
  | { id: number; kind: "scene"; parts: AssemblyPartResult[]; scene: AssemblyScene }
  | { id: number; kind: "error"; message: string };

/**
 * The mesh key of a part: its geometry key (see `geometryKey`), the mesh style and the
 * colours (palette and row colour changes), which the mesh may carry.
 */
export function partMeshKey(doc: AssemblyDoc, index: number, style: MeshStyle, maxStitches: number): string {
  const part = doc.parts[index]!;
  const colors = JSON.stringify([doc.overview.colors ?? null, part.content.rows.map((r) => r.color ?? null)]);
  return `${style}|${colors}|${geometryKey(part.content, doc.overview.gauge, maxStitches)}`;
}

/**
 * The preview request of one part. The one place where a part's preview input is assembled:
 * when the part preview learns new inputs (a palette for yarn colours …), add them here too.
 */
export function partRequest(doc: AssemblyDoc, index: number, style: MeshStyle, maxStitches: number): PreviewRequest {
  const gauge: Gauge | undefined = doc.overview.gauge;
  return { id: 0, content: doc.parts[index]!.content, gauge, style, maxStitches };
}

interface CacheEntry {
  computer: PreviewComputer;
  /** The relaxed model (set by the computer's build). */
  model: Model | null;
  /** Kind of the last preview result (only "model" has a mesh). */
  kind: PreviewResult["kind"] | null;
  message?: string;
}

export class AssemblyComputer {
  /** Per mesh key: the part's computer and its last model (only the keys of the last request). */
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly build: typeof buildModel = buildModel) {}

  compute(req: AssemblyRequest): AssemblyResult {
    const { id, doc, style } = req;
    try {
      const maxStitches = req.maxStitches ?? DEFAULT_MAX_STITCHES;
      const have = new Set(req.have);
      const next = new Map<string, CacheEntry>();
      const parts: AssemblyPartResult[] = [];
      const models: Array<Model | null> = [];
      doc.parts.forEach((_, index) => {
        const key = partMeshKey(doc, index, style, maxStitches);
        const seen = next.get(key);
        let entry = seen ?? this.cache.get(key);
        if (!entry) {
          const fresh: CacheEntry = { computer: null as unknown as PreviewComputer, model: null, kind: null };
          fresh.computer = new PreviewComputer((content, gauge, opts) => {
            fresh.model = this.build(content, gauge, opts);
            return fresh.model;
          });
          entry = fresh;
        }
        next.set(key, entry);
        // The client holds the mesh (or it is sent for an earlier part of this request): only
        // the model is needed. Otherwise mesh it — the model itself stays cached.
        const known = (have.has(key) || seen !== undefined) && entry.kind === "model" && entry.model !== null;
        let mesh: PreviewModel | undefined;
        if (!known) {
          const result = entry.computer.compute(partRequest(doc, index, style, maxStitches));
          entry.kind = result.kind;
          if (result.kind === "error") entry.message = result.message;
          else delete entry.message;
          if (result.kind === "model") mesh = result.model;
        }
        const out: AssemblyPartResult = { part: index, key, status: entry.kind ?? "error" };
        if (entry.message !== undefined) out.message = entry.message;
        if (mesh && entry.model) {
          out.mesh = { key, model: mesh, nodeAngle: Float32Array.from(nodeAnchorAngles(entry.model.graph)) };
        }
        models.push(entry.kind === "model" ? entry.model : null);
        parts.push(out);
      });
      this.cache = next;
      // The toy faces the viewer (the default camera looks from +Z).
      const scene = composeAssembly(doc, models, { faceFront: true });
      return { id, kind: "scene", parts, scene };
    } catch (err) {
      this.cache.clear();
      return { id, kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Buffers of a result that can be moved (not copied) through `postMessage`. */
export function assemblyTransferables(result: AssemblyResult): ArrayBuffer[] {
  if (result.kind !== "scene") return [];
  const out: ArrayBuffer[] = [];
  for (const p of result.parts) {
    if (!p.mesh) continue;
    out.push(...transferablesOf({ id: 0, kind: "model", model: p.mesh.model }), p.mesh.nodeAngle.buffer as ArrayBuffer);
  }
  return out;
}
