/**
 * Editor state: the document plus undo/redo history. A pure reducer — ids for new rows
 * arrive inside the action (see `actions.ts`), so the reducer stays deterministic.
 *
 * Several parts: `part` is the index of the part shown in the editor — UI state, not part of
 * the document and no undo step of its own. Row edits find their part by row id (row ids are
 * unique across the document); every history entry remembers which part to show after undoing
 * or redoing it, so undo never silently changes a part that is out of sight.
 *
 * Soll (stitchCountTarget) rule: a row's Soll follows its Ist while the two agree and the
 * Soll was never set explicitly. Typing a Soll, "Soll übernehmen" or a trailing "(18)" in
 * the free text pins it; from then on a differing Ist is reported, never silently copied.
 */

import {
  GaugeSchema,
  MAX_STITCH_COUNT_TARGET,
  computeRowStitches,
  modifierAllowed,
  normalizeModifiers,
  opsWithinLimits,
  type Gauge,
  type Material,
  type Op,
  type PartContent,
  type Row,
  type StitchOp,
} from "@crochetbuilder/engine";
import { emptyRow, instructionRow, type BuilderDoc } from "./document.js";
import * as tree from "./op-tree.js";
import type { OpPath } from "./op-tree.js";

export const HISTORY_LIMIT = 200;

/** More parts are refused (keeps the parts bar and the export manageable). */
export const MAX_PARTS = 50;
/** Highest quantity of one part ("×99"). */
export const MAX_PART_QUANTITY = 99;

export interface EditorState {
  doc: BuilderDoc;
  /** Row ids whose Soll was set explicitly (see module doc). */
  pinned: readonly string[];
  /** Index of the part shown in the editor (always a valid index into `doc.parts`). */
  part: number;
  past: readonly Snapshot[];
  future: readonly Snapshot[];
  /** Key of the last coalescable edit (typing into one field = one undo step). */
  lastKey: string | undefined;
}

interface Snapshot {
  doc: BuilderDoc;
  pinned: readonly string[];
  /** Part to show after undoing this step (undefined: keep the current one). */
  undoPart: number | undefined;
  /** Part to show after redoing it. */
  redoPart: number | undefined;
}

type Part = BuilderDoc["parts"][number];

export type RowPatch = Partial<Pick<Row, "label" | "type" | "note">>;
export type StitchPatch = Partial<Pick<StitchOp, "code" | "count" | "modifiers">>;

export type EditorAction =
  // overview
  | { type: "setTitle"; title: string }
  | { type: "setGauge"; gauge: Gauge }
  | { type: "setNotes"; notes: string }
  | { type: "addMaterial"; material: Material }
  | { type: "updateMaterial"; index: number; material: Material }
  | { type: "removeMaterial"; index: number }
  // rows
  | { type: "addRow"; id: string; afterId?: string | null; instruction?: boolean }
  | { type: "deleteRow"; rowId: string }
  | { type: "moveRow"; rowId: string; delta: number }
  | { type: "duplicateRow"; rowId: string; newId: string }
  | { type: "updateRow"; rowId: string; patch: RowPatch }
  | { type: "setTarget"; rowId: string; target: number }
  | { type: "adoptTarget"; rowId: string }
  | { type: "setRowOps"; rowId: string; ops: Op[]; target?: number }
  // ops inside a row
  | { type: "updateStitch"; rowId: string; path: OpPath; patch: StitchPatch }
  | { type: "setRepeatTimes"; rowId: string; path: OpPath; times: number }
  | { type: "insertOp"; rowId: string; path: OpPath; op: Op }
  | { type: "removeOp"; rowId: string; path: OpPath }
  | { type: "moveOp"; rowId: string; path: OpPath; delta: number }
  | { type: "wrapInRepeat"; rowId: string; path: OpPath; times?: number; length?: number }
  | { type: "unwrapRepeat"; rowId: string; path: OpPath }
  // parts
  | { type: "selectPart"; index: number }
  | { type: "addPart"; rowId: string }
  | { type: "renamePart"; index: number; name: string }
  | { type: "setPartQuantity"; index: number; quantity: number }
  /** `rowIds`: one fresh id per row of the source part, in order (see `actions.ts`). */
  | { type: "duplicatePart"; index: number; rowIds: readonly string[] }
  | { type: "deletePart"; index: number }
  | { type: "movePart"; index: number; delta: number }
  // document
  | { type: "replaceDocument"; doc: BuilderDoc; pinned?: readonly string[] }
  | { type: "hydrate"; doc: BuilderDoc; pinned?: readonly string[]; part?: number }
  | { type: "undo" }
  | { type: "redo" }
  /** Typing in a field ended (blur): the next edit starts a new undo step. */
  | { type: "endTyping" };

export function initEditorState(doc: BuilderDoc, pinned: readonly string[] = [], part = 0): EditorState {
  return { doc, pinned, part: clampPart(doc, part), past: [], future: [], lastKey: undefined };
}

/** A valid part index of `doc` (documents always hold at least one part). */
export function clampPart(doc: BuilderDoc, index: number): number {
  const last = Math.max(0, doc.parts.length - 1);
  return Number.isInteger(index) ? Math.min(last, Math.max(0, index)) : 0;
}

/** Content of the part at `index` (default: the first), clamped to an existing part. */
export function currentPart(doc: BuilderDoc, index = 0): PartContent {
  return doc.parts[clampPart(doc, index)]!.content;
}

/** Content of the part shown in the editor. */
export function selectedPart(state: EditorState): PartContent {
  return currentPart(state.doc, state.part);
}

/** Index of the part that holds row `rowId`, or -1. */
export function partOfRow(doc: BuilderDoc, rowId: string): number {
  return doc.parts.findIndex((p) => p.content.rows.some((r) => r.id === rowId));
}

/** "Teil n" for a new part: n = number of parts after adding, skipping names in use. */
export function nextPartName(doc: BuilderDoc): string {
  const used = new Set(doc.parts.map((p) => p.name.trim()));
  let n = doc.parts.length + 1;
  while (used.has(`Teil ${n}`)) n++;
  return `Teil ${n}`;
}

/** The part shown after deleting the part at `deleted` (`remaining` parts are left). */
function indexAfterDelete(current: number, deleted: number, remaining: number): number {
  if (current > deleted) return current - 1;
  return Math.min(current, remaining - 1);
}

/** Where the part at `current` ends up when the part at `from` moves to `to`. */
function indexAfterMove(current: number, from: number, to: number): number {
  if (current === from) return to;
  if (from < current && to >= current) return current - 1;
  if (from > current && to <= current) return current + 1;
  return current;
}

// ---------------------------------------------------------------------------
// Document edits (no history concerns)
// ---------------------------------------------------------------------------

function withPart(doc: BuilderDoc, index: number, fn: (part: Part) => Part): BuilderDoc {
  const part = doc.parts[index];
  if (!part) return doc;
  const next = fn(part);
  if (next === part) return doc;
  const parts = [...doc.parts];
  parts[index] = next;
  return { ...doc, parts };
}

function withRows(doc: BuilderDoc, index: number, fn: (rows: Row[]) => Row[]): BuilderDoc {
  return withPart(doc, index, (part) => {
    const rows = fn(part.content.rows);
    return rows === part.content.rows ? part : { ...part, content: { ...part.content, rows } };
  });
}

/** Edit row `rowId`, in whichever part it lives. */
function withRow(doc: BuilderDoc, rowId: string, fn: (row: Row) => Row): BuilderDoc {
  return withRows(doc, partOfRow(doc, rowId), (rows) => {
    const index = rows.findIndex((r) => r.id === rowId);
    if (index < 0) return rows;
    const row = rows[index]!;
    const next = fn(row);
    if (next === row) return rows;
    const copy = [...rows];
    copy[index] = next;
    return copy;
  });
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * New ops for a row, applying the Soll-follows-Ist rule. Edits that would break the limits
 * (count/times > 999, more than 10,000 worked stitches) are refused: the row stays as is.
 */
function rowWithOps(row: Row, ops: Op[], pinned: readonly string[], target?: number): Row {
  if (sameJson(ops, row.ops) && (target === undefined || target === row.stitchCountTarget)) return row;
  if (!opsWithinLimits(ops)) return row;
  if (target !== undefined && (target < 0 || target > MAX_STITCH_COUNT_TARGET)) return row;
  const next: Row = { ...row, ops };
  if (target !== undefined) next.stitchCountTarget = target;
  else if (!pinned.includes(row.id) && row.stitchCountTarget === computeRowStitches(row)) {
    next.stitchCountTarget = computeRowStitches(next);
  }
  return next;
}

function setOptionalText<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined): T {
  const next = { ...obj };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/**
 * Remove undefined fields and fields the schema rejects (non-finite, ≤ 0, too thick a yarn,
 * unknown keys) so the gauge stays schema-clean.
 */
function cleanGauge(gauge: Gauge): Gauge | undefined {
  const out: Gauge = {};
  const shape: Record<string, { safeParse(v: unknown): { success: boolean } } | undefined> = GaugeSchema.shape;
  for (const [k, v] of Object.entries(gauge)) {
    if (v === undefined) continue;
    if (!shape[k]?.safeParse(v).success) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

interface DocResult {
  doc: BuilderDoc;
  pinned: readonly string[];
  /** The part this edit concerns, shown after undoing it (undefined: a document-wide edit). */
  scope?: number;
  /** The part to show from now on (default: unchanged); also shown after redoing it. */
  select?: number;
}

function applyEdit(state: EditorState, action: EditorAction): DocResult {
  const { doc, pinned } = state;
  const same = { doc, pinned };
  const pin = (rowId: string) => (pinned.includes(rowId) ? pinned : [...pinned, rowId]);
  // A row edit concerns the part that holds the row.
  const rowScope = "rowId" in action ? partOfRow(doc, action.rowId) : -1;
  const scoped = (result: DocResult): DocResult => (rowScope >= 0 ? { ...result, scope: rowScope } : result);
  const opsEdit = (rowId: string, fn: (ops: Op[]) => Op[]): DocResult =>
    scoped({ doc: withRow(doc, rowId, (row) => rowWithOps(row, fn(row.ops), pinned)), pinned });

  switch (action.type) {
    case "setTitle":
      return action.title === doc.title ? same : { doc: { ...doc, title: action.title }, pinned };

    case "setGauge": {
      const gauge = cleanGauge(action.gauge);
      if (sameJson(gauge, doc.overview.gauge)) return same;
      return { doc: { ...doc, overview: setOptionalText(doc.overview, "gauge", gauge) }, pinned };
    }

    case "setNotes": {
      const notes = action.notes === "" ? undefined : action.notes;
      if (notes === doc.overview.notes) return same;
      return { doc: { ...doc, overview: setOptionalText(doc.overview, "notes", notes) }, pinned };
    }

    case "addMaterial": {
      const materials = [...(doc.overview.materials ?? []), action.material];
      return { doc: { ...doc, overview: { ...doc.overview, materials } }, pinned };
    }

    case "updateMaterial": {
      const list = doc.overview.materials ?? [];
      if (!list[action.index] || sameJson(list[action.index], action.material)) return same;
      const materials = list.map((m, i) => (i === action.index ? action.material : m));
      return { doc: { ...doc, overview: { ...doc.overview, materials } }, pinned };
    }

    case "removeMaterial": {
      const list = doc.overview.materials ?? [];
      if (!list[action.index]) return same;
      const materials = list.filter((_, i) => i !== action.index);
      return { doc: { ...doc, overview: { ...doc.overview, materials } }, pinned };
    }

    case "addRow": {
      // After a given row (in its part), else at the end of the part being edited.
      const anchor = action.afterId ? partOfRow(doc, action.afterId) : -1;
      const index = anchor >= 0 ? anchor : state.part;
      return {
        doc: withRows(doc, index, (rows) => {
          const anchor = action.afterId ? rows.findIndex((r) => r.id === action.afterId) : rows.length - 1;
          const at = anchor < 0 ? rows.length : anchor + 1;
          // A new line takes the type (row/round) of the line above it.
          const type = rows[at - 1]?.type ?? "round";
          const row = action.instruction ? instructionRow(action.id, type) : emptyRow(action.id, type);
          return [...rows.slice(0, at), row, ...rows.slice(at)];
        }),
        pinned,
        scope: index,
      };
    }

    case "deleteRow":
      if (rowScope < 0) return same;
      return scoped({
        doc: withRows(doc, rowScope, (rows) => rows.filter((r) => r.id !== action.rowId)),
        pinned: pinned.includes(action.rowId) ? pinned.filter((id) => id !== action.rowId) : pinned,
      });

    case "moveRow":
      return scoped({
        doc: withRows(doc, rowScope, (rows) => {
          const from = rows.findIndex((r) => r.id === action.rowId);
          const to = Math.max(0, Math.min(rows.length - 1, from + action.delta));
          if (from < 0 || to === from) return rows;
          const copy = [...rows];
          const [row] = copy.splice(from, 1);
          copy.splice(to, 0, row!);
          return copy;
        }),
        pinned,
      });

    case "duplicateRow": {
      const source = doc.parts[rowScope]?.content.rows.find((r) => r.id === action.rowId);
      if (!source || partOfRow(doc, action.newId) >= 0) return same;
      return scoped({
        doc: withRows(doc, rowScope, (rows) => {
          const at = rows.findIndex((r) => r.id === action.rowId) + 1;
          const copy: Row = { ...structuredClone(source), id: action.newId };
          return [...rows.slice(0, at), copy, ...rows.slice(at)];
        }),
        pinned: pinned.includes(source.id) ? [...pinned, action.newId] : pinned,
      });
    }

    case "updateRow":
      return scoped({
        doc: withRow(doc, action.rowId, (row) => {
          let next = row;
          for (const key of ["label", "type", "note"] as const) {
            if (!(key in action.patch)) continue;
            const value = action.patch[key];
            if (value === row[key]) continue;
            // An empty label disappears (the automatic "Runde n" shows instead); so does an
            // empty note on a stitch row. A free instruction keeps its (empty) note.
            const drop = value === "" && (key === "label" || (key === "note" && row.ops.length > 0));
            next = drop ? setOptionalText(next, key, undefined) : { ...next, [key]: value };
          }
          return next;
        }),
        pinned,
      });

    case "setTarget": {
      const target = action.target;
      if (!Number.isInteger(target) || target < 0 || target > MAX_STITCH_COUNT_TARGET) return same;
      const row = doc.parts[rowScope]?.content.rows.find((r) => r.id === action.rowId);
      // An unchanged value is a no-op: no pin, no history entry.
      if (!row || row.stitchCountTarget === target) return same;
      const next = withRow(doc, action.rowId, (r) => ({ ...r, stitchCountTarget: target }));
      return scoped({ doc: next, pinned: pin(action.rowId) });
    }

    case "adoptTarget": {
      const next = withRow(doc, action.rowId, (row) => {
        const actual = computeRowStitches(row);
        return row.stitchCountTarget === actual ? row : { ...row, stitchCountTarget: actual };
      });
      if (rowScope < 0) return same;
      return scoped({ doc: next, pinned: pin(action.rowId) });
    }

    case "setRowOps":
      if (rowScope < 0) return same;
      return scoped({
        doc: withRow(doc, action.rowId, (row) => rowWithOps(row, action.ops, pinned, action.target)),
        pinned: action.target === undefined ? pinned : pin(action.rowId),
      });

    case "updateStitch":
      return opsEdit(action.rowId, (ops) =>
        tree.updateOp(ops, action.path, (op) => {
          if (op.kind !== "stitch") return op;
          const next: StitchOp = { ...op, ...action.patch };
          if (!Number.isInteger(next.count) || next.count < 1) return op;
          if (next.modifiers) {
            let mods = normalizeModifiers(next.code, next.modifiers);
            if (mods === null) {
              // A new code drops modifiers that no longer apply; an invalid toggle is refused.
              if (action.patch.modifiers !== undefined) return op;
              mods = normalizeModifiers(next.code, next.modifiers.filter((m) => modifierAllowed(next.code, m))) ?? [];
            }
            next.modifiers = mods;
            if (mods.length === 0) delete next.modifiers;
          }
          return next;
        }),
      );

    case "setRepeatTimes":
      if (!Number.isInteger(action.times) || action.times < 1) return same;
      return opsEdit(action.rowId, (ops) =>
        tree.updateOp(ops, action.path, (op) => (op.kind === "repeat" ? { ...op, times: action.times } : op)),
      );

    case "insertOp":
      return opsEdit(action.rowId, (ops) => tree.insertOp(ops, action.path, action.op));

    case "removeOp":
      return opsEdit(action.rowId, (ops) => tree.removeOp(ops, action.path));

    case "moveOp":
      return opsEdit(action.rowId, (ops) => tree.moveOp(ops, action.path, action.delta));

    case "wrapInRepeat":
      return opsEdit(action.rowId, (ops) =>
        tree.wrapInRepeat(ops, action.path, action.times ?? 2, action.length ?? 1),
      );

    case "unwrapRepeat":
      return opsEdit(action.rowId, (ops) => tree.unwrapRepeat(ops, action.path));

    case "addPart": {
      if (doc.parts.length >= MAX_PARTS || partOfRow(doc, action.rowId) >= 0) return same;
      const part: Part = {
        name: nextPartName(doc),
        quantity: 1,
        content: { schemaVersion: 1, rows: [emptyRow(action.rowId)] },
      };
      return { doc: { ...doc, parts: [...doc.parts, part] }, pinned, scope: state.part, select: doc.parts.length };
    }

    case "renamePart":
      return {
        doc: withPart(doc, action.index, (p) => (p.name === action.name ? p : { ...p, name: action.name })),
        pinned,
        scope: action.index,
      };

    case "setPartQuantity": {
      const quantity = action.quantity;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PART_QUANTITY) return same;
      return {
        doc: withPart(doc, action.index, (p) => (p.quantity === quantity ? p : { ...p, quantity })),
        pinned,
        scope: action.index,
      };
    }

    case "duplicatePart": {
      const source = doc.parts[action.index];
      if (!source || doc.parts.length >= MAX_PARTS) return same;
      const ids = action.rowIds;
      const rows = source.content.rows;
      // One fresh id per row, none in use yet: ids stay unique across the document.
      if (ids.length !== rows.length || new Set(ids).size !== ids.length) return same;
      if (ids.some((id) => partOfRow(doc, id) >= 0)) return same;
      const copy: Part = structuredClone(source);
      copy.name = `${source.name.trim() || `Teil ${action.index + 1}`} (Kopie)`;
      copy.content.rows = copy.content.rows.map((r, i) => ({ ...r, id: ids[i]! }));
      const at = action.index + 1;
      const copiedPins = rows.flatMap((r, i) => (pinned.includes(r.id) ? [ids[i]!] : []));
      return {
        doc: { ...doc, parts: [...doc.parts.slice(0, at), copy, ...doc.parts.slice(at)] },
        pinned: copiedPins.length > 0 ? [...pinned, ...copiedPins] : pinned,
        scope: action.index,
        select: at,
      };
    }

    case "deletePart": {
      // A document always keeps at least one part.
      const part = doc.parts[action.index];
      if (!part || doc.parts.length <= 1) return same;
      const gone = new Set(part.content.rows.map((r) => r.id));
      const parts = doc.parts.filter((_, i) => i !== action.index);
      return {
        doc: { ...doc, parts },
        pinned: pinned.some((id) => gone.has(id)) ? pinned.filter((id) => !gone.has(id)) : pinned,
        scope: action.index,
        // The next part takes its place in view (the previous one after the last part).
        select: indexAfterDelete(state.part, action.index, parts.length),
      };
    }

    case "movePart": {
      const from = action.index;
      const to = Math.max(0, Math.min(doc.parts.length - 1, from + action.delta));
      if (!doc.parts[from] || to === from) return same;
      const parts = [...doc.parts];
      const [moved] = parts.splice(from, 1);
      parts.splice(to, 0, moved!);
      return { doc: { ...doc, parts }, pinned, scope: from, select: indexAfterMove(state.part, from, to) };
    }

    case "replaceDocument":
      return { doc: action.doc, pinned: action.pinned ?? [], scope: state.part, select: 0 };

    case "hydrate":
      return { doc: action.doc, pinned: action.pinned ?? [] };

    case "selectPart":
    case "undo":
    case "redo":
    case "endTyping":
      return same;
  }
}

/** Edits that coalesce into one undo step while the same field is being typed into. */
function coalesceKey(action: EditorAction): string | undefined {
  switch (action.type) {
    case "setTitle":
      return "title";
    case "setNotes":
      return "notes";
    case "setGauge":
      return "gauge";
    case "updateMaterial":
      return `material:${action.index}`;
    case "renamePart":
      return `part:${action.index}:name`;
    case "updateRow":
      return "label" in action.patch || "note" in action.patch ? `row:${action.rowId}:text` : undefined;
    case "setTarget":
      return `row:${action.rowId}:target`;
    case "updateStitch":
      return "count" in action.patch ? `op:${action.rowId}:${action.path.join(".")}` : undefined;
    case "setRepeatTimes":
      return `op:${action.rowId}:${action.path.join(".")}`;
    default:
      return undefined;
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === "undo") {
    const previous = state.past[state.past.length - 1];
    if (!previous) return state;
    return {
      doc: previous.doc,
      pinned: previous.pinned,
      part: clampPart(previous.doc, previous.undoPart ?? state.part),
      past: state.past.slice(0, -1),
      future: [{ ...previous, doc: state.doc, pinned: state.pinned }, ...state.future],
      lastKey: undefined,
    };
  }
  if (action.type === "redo") {
    const next = state.future[0];
    if (!next) return state;
    return {
      doc: next.doc,
      pinned: next.pinned,
      part: clampPart(next.doc, next.redoPart ?? state.part),
      past: [...state.past, { ...next, doc: state.doc, pinned: state.pinned }],
      future: state.future.slice(1),
      lastKey: undefined,
    };
  }
  if (action.type === "hydrate") {
    return initEditorState(action.doc, action.pinned ?? [], action.part ?? 0);
  }
  if (action.type === "endTyping") {
    return state.lastKey === undefined ? state : { ...state, lastKey: undefined };
  }
  if (action.type === "selectPart") {
    // Switching parts is no edit, but it ends a typing streak.
    const part = clampPart(state.doc, action.index);
    return part === state.part ? state : { ...state, part, lastKey: undefined };
  }

  const result = applyEdit(state, action);
  if (result.doc === state.doc && result.pinned === state.pinned) return state;

  const key = coalesceKey(action);
  const coalesce = key !== undefined && key === state.lastKey;
  const entry: Snapshot = {
    doc: state.doc,
    pinned: state.pinned,
    undoPart: result.scope,
    redoPart: result.select ?? result.scope,
  };
  const past = coalesce ? state.past : [...state.past, entry].slice(-HISTORY_LIMIT);
  const part = clampPart(result.doc, result.select ?? state.part);
  return { doc: result.doc, pinned: result.pinned, part, past, future: [], lastKey: key };
}

export const canUndo = (state: EditorState): boolean => state.past.length > 0;
export const canRedo = (state: EditorState): boolean => state.future.length > 0;
