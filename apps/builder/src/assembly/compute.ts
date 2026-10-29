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
 * - Parts crocheted together (`StitchOp.from` / `.through`) are relaxed together
 *   (`buildJoinedModels`, cached by the shapes of all parts): every copy of a joined component
 *   gets its own mesh (`joined`), with the fabric across the joins (`JoinBridge`) added to the
 *   copy that works the join, and `composeAssembly` draws them in their common frame.
 */

import {
  buildJoinedModels,
  buildModel,
  composeAssembly,
  countPartAtoms,
  DEFAULT_MAX_STITCHES,
  joinedKey,
  maxRoundDiameter,
  measure,
  nodeAnchorAngles,
  partHasJoin,
  type AssemblyScene,
  type BuilderExport,
  type Gauge,
  type JoinBridge,
  type JoinedComponent,
  type JoinedModels,
  type MeshStyle,
  type Model,
} from "@crochetbuilder/engine";
import {
  geometryKey,
  PreviewComputer,
  previewModelOf,
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

/** A copy of a part crocheted onto others, relaxed together with them. */
export interface JoinedMeshResult {
  part: number;
  /** 0-based copy. */
  copy: number;
  /** Key of its mesh (the shapes of the whole component's parts and the style). */
  key: string;
  /** The mesh (in the component's common frame), unless the client said it has it. */
  mesh?: PartMesh;
}

/**
 * Parts crocheted together that the Montage shows without their joins: joined in a circle
 * (`cycle`, finding `JOIN_CYCLE`), over the stitch budget or empty, or a joint relaxation
 * that did not give finite positions (`invalid`).
 */
export interface UnjoinedComponent {
  parts: number[];
  reason: "cycle" | "overBudget" | "empty" | "invalid";
}

/** Worker → main thread. */
export type AssemblyResult =
  | {
      id: number;
      kind: "scene";
      parts: AssemblyPartResult[];
      /** Copies of parts crocheted together (drawn instead of the part's own mesh). */
      joined: JoinedMeshResult[];
      /** Joined parts shown without their joins (and why). */
      unjoined: UnjoinedComponent[];
      scene: AssemblyScene;
      maxTotal: number;
    }
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

/** A short, stable hash of a string (FNV-1a, hex) for mesh keys. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * The fabric across joins (`JoinBridge`) worked by copy `instance` of its component, appended
 * to that copy's mesh as extra triangles (each with its own three vertices and face normal);
 * a vertex of another copy belongs to the joining stitch of its triangle. Point meshes stay.
 */
export function withBridge(model: PreviewModel, bridge: JoinBridge, instance: number): PreviewModel {
  if (model.primitive !== "triangles") return model;
  const tris: number[] = [];
  for (let t = 0; t + 2 < bridge.triangles.length; t += 3) {
    if (bridge.vertices[bridge.triangles[t]!]!.instance === instance) tris.push(t);
  }
  if (tris.length === 0) return model;
  const base = model.positions.length / 3;
  const extra = 3 * tris.length;
  const positions = new Float32Array(model.positions.length + 3 * extra);
  positions.set(model.positions);
  const normals = new Float32Array(model.normals.length + 3 * extra);
  normals.set(model.normals);
  const nodeIndex = new Uint32Array(model.nodeIndex.length + extra);
  nodeIndex.set(model.nodeIndex);
  const indices = new Uint32Array(model.indices.length + extra);
  indices.set(model.indices);
  let v = base;
  let k = model.indices.length;
  const p = bridge.positions;
  for (const t of tris) {
    const corners = [bridge.triangles[t]!, bridge.triangles[t + 1]!, bridge.triangles[t + 2]!];
    const at = (c: number, i: number) => p[3 * c + i]!;
    const [a, b, c] = corners as [number, number, number];
    const ux = at(b, 0) - at(a, 0), uy = at(b, 1) - at(a, 1), uz = at(b, 2) - at(a, 2);
    const wx = at(c, 0) - at(a, 0), wy = at(c, 1) - at(a, 1), wz = at(c, 2) - at(a, 2);
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const own = bridge.vertices[a]!.node;
    for (const corner of corners) {
      for (let i = 0; i < 3; i++) positions[3 * v + i] = at(corner, i);
      normals[3 * v] = nx;
      normals[3 * v + 1] = ny;
      normals[3 * v + 2] = nz;
      const vert = bridge.vertices[corner]!;
      nodeIndex[v] = vert.instance === instance ? vert.node : own;
      indices[k++] = v++;
    }
  }
  return { ...model, positions, normals, nodeIndex, indices };
}

export class AssemblyComputer {
  /** Per shape key: the part's computer and its model (the keys of the last request). */
  private cache = new Map<string, CacheEntry>();
  /** The last joint relaxation, by the shapes of all parts. */
  private joinedCache: { key: string; models: JoinedModels } | null = null;

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
      const { components, joined, unjoined } = this.joinedMeshes(doc, style, maxStitches, parts, have);
      // The toy faces the viewer (the default camera looks from +Z).
      const scene = composeAssembly(doc, models, { faceFront: true, joined: components });
      return { id, kind: "scene", parts, joined, unjoined, scene, maxTotal: this.maxTotal };
    } catch (err) {
      this.cache.clear();
      this.joinedCache = null;
      return { id, kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Joint relaxation of the parts crocheted together (only components whose parts all have a
   * model in this Montage) and the meshes of their copies (only those the client lacks).
   */
  private joinedMeshes(
    doc: AssemblyDoc,
    style: MeshStyle,
    maxStitches: number,
    parts: readonly AssemblyPartResult[],
    have: ReadonlySet<string>,
  ): { components: JoinedComponent[]; joined: JoinedMeshResult[]; unjoined: UnjoinedComponent[] } {
    if (!doc.parts.some((p) => partHasJoin(p.content))) {
      this.joinedCache = null;
      return { components: [], joined: [], unjoined: [] };
    }
    const shapes = JSON.stringify([
      doc.parts.map((p, i) => [p.id ?? null, p.quantity, shapeKey(doc, i, maxStitches)]),
    ]);
    const key = hash(shapes);
    if (this.joinedCache?.key !== key) {
      this.joinedCache = { key, models: buildJoinedModels(doc, doc.overview.gauge, { maxStitches }) };
    }
    const ok = (part: number) => parts[part]?.status === "model";
    const partsOf = (list: ReadonlyArray<{ part: number }>) => [...new Set(list.map((x) => x.part))].sort((a, b) => a - b);
    const unjoined: UnjoinedComponent[] = this.joinedCache.models.skipped.map((s) => ({ parts: partsOf(s.instances), reason: s.reason }));
    // Never hand on positions that are not finite: such a component is shown unjoined.
    const components = this.joinedCache.models.components.filter((c) => {
      if (!c.parts.every((p) => ok(p.part))) return false;
      if (isFiniteComponent(c)) return true;
      unjoined.push({ parts: partsOf(c.parts), reason: "invalid" });
      return false;
    });
    const palette = paletteIds(doc);
    const joined: JoinedMeshResult[] = [];
    for (const c of components) {
      c.parts.forEach((p, instance) => {
        const meshKey = `${style}|joined|${key}|${p.part}:${p.copy}`;
        const out: JoinedMeshResult = { part: p.part, copy: p.copy, key: meshKey };
        if (!have.has(meshKey)) {
          const model = previewModelOf(
            { graph: p.graph, finish: p.finish, size: measure(p.graph), maxDiameter: maxRoundDiameter(p.graph), estimated: p.graph.estimated },
            style,
            doc.parts[p.part]!.content,
            palette.length > 0 ? palette : undefined,
          );
          out.mesh = { key: meshKey, model: withBridge(model, c.bridge, instance), nodeAngle: Float32Array.from(nodeAnchorAngles(p.graph)) };
        }
        joined.push(out);
      });
    }
    return { components, joined, unjoined };
  }
}

/** Whether every position of a joined component (copies and the bridge) is finite. */
export function isFiniteComponent(c: Pick<JoinedComponent, "parts" | "bridge">): boolean {
  const finite = (a: ArrayLike<number>) => {
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i]!)) return false;
    return true;
  };
  return c.parts.every((p) => finite(p.graph.positions)) && finite(c.bridge.positions);
}

/** Meshes of the joined part copies of a result by `joinedKey(part, copy)` (held ones by key). */
export function joinedMeshesOf(
  result: Extract<AssemblyResult, { kind: "scene" }>,
  held: ReadonlyMap<string, PartMesh> = new Map(),
): Map<string, PartMesh> {
  const out = new Map<string, PartMesh>();
  for (const j of result.joined) {
    const mesh = j.mesh ?? held.get(j.key);
    if (mesh) out.set(joinedKey(j.part, j.copy), mesh);
  }
  return out;
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
  const meshes = [...result.parts.map((p) => p.mesh), ...result.joined.map((j) => j.mesh)];
  for (const mesh of meshes) {
    if (!mesh) continue;
    out.push(...transferablesOf({ id: 0, kind: "model", model: mesh.model }), mesh.nodeAngle.buffer as ArrayBuffer);
  }
  return out;
}
