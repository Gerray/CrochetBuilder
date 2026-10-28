/**
 * The assembled 3D scene ("Montage") off the main thread: every part is relaxed and meshed
 * exactly as the part preview does it (one `PreviewComputer` per part shape, so the mesh —
 * and whatever the preview adds to it, like yarn colours — is the same), then
 * `composeAssembly` places them. Like the part preview it runs in a Worker
 * (`assembly.worker.ts`) or, as a fallback, on the main thread.
 *
 * - Meshes are the bulk of a result. The client says which part meshes it already holds
 *   (`have`, by key); only the others are sent. Editing a placement only sends transforms.
 * - Relaxed models are cached by shape, independent of the mesh style: the PDF (stitches)
 *   after the view (any style) relaxes nothing again.
 * - A total stitch budget keeps big documents responsive: parts beyond it (in document
 *   order) are left out and reported as `skipped`.
 */

import {
  buildModel,
  composeAssembly,
  countPartAtoms,
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

/** Stitches of all parts together (each part once) the Montage builds in a Worker. */
export const MAX_ASSEMBLY_STITCHES = 60_000;
/** The same on the main thread (no Worker): keeps the page responsive. */
export const MAIN_THREAD_ASSEMBLY_STITCHES = 15_000;

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
  /** Key of the part's mesh (shape, gauge, budget, colours and style). */
  key: string;
  /** `skipped`: left out, over the total stitch budget of the Montage. */
  status: "model" | "empty" | "overBudget" | "error" | "skipped";
  /** The mesh, unless the client said it has it. */
  mesh?: PartMesh;
  message?: string;
}

/** Worker → main thread. */
export type AssemblyResult =
  | { id: number; kind: "scene"; parts: AssemblyPartResult[]; scene: AssemblyScene; maxTotal: number }
  | { id: number; kind: "error"; message: string };

/** Palette ids of the document (the mesh's colour indices refer to them; names and hex do not matter). */
function paletteIds(doc: AssemblyDoc): string[] {
  return (doc.overview.colors ?? []).map((c) => c.id);
}

/**
 * Shape key of a part: what its relaxed model depends on, plus what its mesh's colour
 * indices depend on (palette ids, colour changes in rows and stitches — those are in the ops).
 */
function shapeKey(doc: AssemblyDoc, index: number, maxStitches: number): string {
  const part = doc.parts[index]!;
  const colors = JSON.stringify([paletteIds(doc), part.content.rows.map((r) => r.color ?? null)]);
  return `${colors}|${geometryKey(part.content, doc.overview.gauge, maxStitches)}`;
}

/** The mesh key of a part: its shape key (geometry and colours) and the mesh style. */
export function partMeshKey(doc: AssemblyDoc, index: number, style: MeshStyle, maxStitches: number): string {
  return `${style}|${shapeKey(doc, index, maxStitches)}`;
}

/**
 * The preview request of one part, as the part preview builds it: with the palette's ids the
 * mesh carries every stitch's colour (`nodeColor` / `paletteIds`), which the view looks up
 * in the palette's CSS colours — so the assembled toy is coloured like each part. The one
 * place where a part's preview input is assembled: new preview inputs go here too.
 */
export function partRequest(doc: AssemblyDoc, index: number, style: MeshStyle, maxStitches: number): PreviewRequest {
  const gauge: Gauge | undefined = doc.overview.gauge;
  const palette = paletteIds(doc);
  return { id: 0, content: doc.parts[index]!.content, gauge, style, maxStitches, ...(palette.length > 0 ? { palette } : {}) };
}

/** Stitches of all parts (each once), as the budget counts them. */
export function totalStitches(doc: Pick<AssemblyDoc, "parts">): number {
  return doc.parts.reduce((sum, p) => sum + countPartAtoms(p.content), 0);
}

interface CacheEntry {
  computer: PreviewComputer;
  /** The relaxed model (set by the computer's build). */
  model: Model | null;
  /** Kind of the last preview result (style-independent: it depends on the model). */
  kind: Exclude<PreviewResult["kind"], "colors"> | null;
  message?: string;
}

export class AssemblyComputer {
  /** Per shape key: the part's computer and its model (the keys of the last request). */
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly build: typeof buildModel = buildModel,
    private readonly maxTotal: number = MAX_ASSEMBLY_STITCHES,
  ) {}

  compute(req: AssemblyRequest): AssemblyResult {
    const { id, doc, style } = req;
    try {
      const maxStitches = req.maxStitches ?? DEFAULT_MAX_STITCHES;
      const have = new Set(req.have);
      const next = new Map<string, CacheEntry>();
      const sent = new Set<string>();
      const parts: AssemblyPartResult[] = [];
      const models: Array<Model | null> = [];
      let budget = this.maxTotal;
      doc.parts.forEach((part, index) => {
        const key = partMeshKey(doc, index, style, maxStitches);
        const shape = shapeKey(doc, index, maxStitches);
        let entry = next.get(shape) ?? this.cache.get(shape);
        // A shape built before (another copy or style) costs nothing; anything else counts.
        if (!next.has(shape)) {
          const stitches = countPartAtoms(part.content);
          if (stitches > budget) {
            parts.push({ part: index, key, status: "skipped" });
            models.push(null);
            return;
          }
          budget -= stitches;
        }
        if (!entry) {
          const fresh: CacheEntry = { computer: null as unknown as PreviewComputer, model: null, kind: null };
          fresh.computer = new PreviewComputer((content, gauge, opts) => {
            fresh.model = this.build(content, gauge, opts);
            return fresh.model;
          });
          entry = fresh;
        }
        next.set(shape, entry);
        // The client holds the mesh (or gets it with an earlier part of this request): only
        // the model is needed. Otherwise mesh it — the model itself stays cached.
        const known = (have.has(key) || sent.has(key)) && entry.kind === "model" && entry.model !== null;
        let mesh: PreviewModel | undefined;
        if (!known) {
          // Never a colours-only request here: the result is a model, empty, over budget or an error.
          const result = entry.computer.compute(partRequest(doc, index, style, maxStitches));
          entry.kind = result.kind === "colors" ? "error" : result.kind;
          if (result.kind === "error") entry.message = result.message;
          else delete entry.message;
          if (result.kind === "model") mesh = result.model;
        }
        const out: AssemblyPartResult = { part: index, key, status: entry.kind ?? "error" };
        if (entry.message !== undefined) out.message = entry.message;
        if (mesh && entry.model) {
          out.mesh = { key, model: mesh, nodeAngle: Float32Array.from(nodeAnchorAngles(entry.model.graph)) };
          sent.add(key);
        }
        models.push(entry.kind === "model" ? entry.model : null);
        parts.push(out);
      });
      this.cache = next;
      // The toy faces the viewer (the default camera looks from +Z).
      const scene = composeAssembly(doc, models, { faceFront: true });
      return { id, kind: "scene", parts, scene, maxTotal: this.maxTotal };
    } catch (err) {
      this.cache.clear();
      return { id, kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** The part meshes of a result by part, also for parts whose mesh came with an earlier part. */
export function meshesByPart(result: Extract<AssemblyResult, { kind: "scene" }>, held: ReadonlyMap<string, PartMesh> = new Map()): Array<PartMesh | undefined> {
  const byKey = new Map(held);
  for (const p of result.parts) if (p.mesh) byKey.set(p.key, p.mesh);
  return result.parts.map((p) => (p.status === "model" ? byKey.get(p.key) : undefined));
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
