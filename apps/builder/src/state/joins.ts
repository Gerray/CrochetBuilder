/**
 * Joining while crocheting (B5b) in the editor: parts as the row text names them, the join of
 * a stitch as the editor sets it, defaults of the picker and the cross-part findings per row.
 *
 * Joins refer to parts by `BuilderPart.id`. Parts without an id get one the moment a join
 * needs it — the same readable, deterministic id the assembly gives (`withPartId`): the row
 * text may name a part before it has an id (`joinPartsFor` lists every part with the id it
 * will get), and the edit that stores the join gives the ids (`withJoinIds`).
 */

import {
  joinPartsOf,
  lastStitchRow,
  planJoins,
  rowOrdinals,
  type JoinFinding,
  type JoinKind,
  type JoinNotationPart,
  type JoinRef,
  type Finding,
  type Op,
  type Row,
} from "@crochetbuilder/engine";
import { withPartId } from "./assembly.js";
import type { BuilderDoc } from "./document.js";

/** The document with an id on every part (ids as the assembly would give them, in order). */
export function withAllPartIds(doc: BuilderDoc): BuilderDoc {
  let next = doc;
  for (let i = 0; i < doc.parts.length; i++) next = withPartId(next, i);
  return next;
}

/**
 * The parts the row text of part `exclude` may join to (all others), with the ids they have
 * or will get, names ("Teil n" when empty), quantities and rows.
 */
export function joinPartsFor(doc: BuilderDoc, exclude?: number): JoinNotationPart[] {
  const all = joinPartsOf(withAllPartIds(doc));
  return exclude === undefined ? all : all.filter((_, i) => i !== exclude);
}

/** Part ids `ops` join to (`from` / `through`), at any depth. */
export function joinIdsOf(ops: readonly Op[], out = new Set<string>()): Set<string> {
  for (const op of ops) {
    if (op.kind === "stitch") {
      if (op.from) out.add(op.from.part);
      if (op.through) out.add(op.through.part);
    } else joinIdsOf(op.ops, out);
  }
  return out;
}

/**
 * `doc` with ids on the parts `ops` refer to that do not have one yet (a part named in the row
 * text before it had an id): every part then gets its id, as `joinPartsFor` promised.
 */
export function withJoinIds(doc: BuilderDoc, ops: readonly Op[]): BuilderDoc {
  const ids = joinIdsOf(ops);
  if (ids.size === 0) return doc;
  const known = new Set(doc.parts.flatMap((p) => (p.id === undefined ? [] : [p.id])));
  return [...ids].every((id) => known.has(id)) ? doc : withAllPartIds(doc);
}

/** The join of a stitch as the editor sets it: the other part by index (it may lack an id). */
export interface JoinDraft {
  kind: JoinKind;
  part: number;
  /** 1-based copy (absent: copy 1). */
  copy?: number;
  /** Row id in the other part (absent: its last stitch row). */
  row?: string;
  /** 0-based first stitch (absent: where the previous join into that row stopped). */
  start?: number;
}

/** `doc` with an id on the draft's part, and the join reference to store. */
export function joinRefOf(doc: BuilderDoc, draft: JoinDraft): { doc: BuilderDoc; ref: JoinRef } | null {
  if (!doc.parts[draft.part]) return null;
  const next = withPartId(doc, draft.part);
  const ref: JoinRef = { part: next.parts[draft.part]!.id! };
  if (draft.copy !== undefined && draft.copy >= 1) ref.copy = Math.floor(draft.copy);
  if (draft.row !== undefined) ref.row = draft.row;
  if (draft.start !== undefined && draft.start >= 0) ref.start = Math.floor(draft.start);
  return { doc: next, ref };
}

/** Index of the part with id `id`, or −1. */
export function partIndexOfId(doc: BuilderDoc, id: string): number {
  return doc.parts.findIndex((p) => p.id === id);
}

/** Stitch rows of a part for the picker: id and label ("Runde 12"). Last one is the default. */
export function stitchRowsOf(doc: BuilderDoc, part: number): Array<{ id: string; label: string }> {
  const rows = doc.parts[part]?.content.rows ?? [];
  const ordinals = rowOrdinals(rows);
  return rows.flatMap((r, i) => (r.ops.length > 0 ? [{ id: r.id, label: r.label?.trim() || `${r.type === "row" ? "Reihe" : "Runde"} ${ordinals[i]}` }] : []));
}

/** The default row of a join into part `part`: its last stitch row. */
export function defaultJoinRow(doc: BuilderDoc, part: number): string | undefined {
  const content = doc.parts[part]?.content;
  return content ? lastStitchRow(content)?.id : undefined;
}

/**
 * The next free stitch (0-based) of row `rowId` of copy `copy` (1-based) of part `part` for a
 * join of `kind`: where the joins of the document into that row stopped (0 when none).
 */
export function nextFreeStitch(doc: BuilderDoc, part: number, copy: number, rowId: string, kind: JoinKind): number {
  const plan = planJoins(withAllPartIds(doc));
  let end = 0;
  plan.links.forEach((l) => {
    const s = plan.sources[l.source]!;
    if (s.part === part && s.copy === copy - 1 && s.rowId === rowId && s.kind === kind) end = Math.max(end, l.slot + l.count);
  });
  return end;
}

/** Cross-part findings of joins (`planJoins`) by the joining row's id. */
export function joinFindingsByRow(doc: BuilderDoc): Map<string, JoinFinding[]> {
  const out = new Map<string, JoinFinding[]>();
  if (!doc.parts.some((p) => p.content.rows.some((r) => joinIdsOf(r.ops).size > 0))) return out;
  for (const f of planJoins(doc).findings) {
    if (f.rowId === undefined) continue;
    const list = out.get(f.rowId) ?? [];
    list.push(f);
    out.set(f.rowId, list);
  }
  return out;
}

/**
 * A cross-part join finding shown like the part's own findings (on the row card and in the
 * findings panel): code `INVALID_JOIN` for the editor's plumbing, the join finding in `join`
 * (its German text: `joinFindingMessage`).
 */
export type JoinBackedFinding = Finding & { join: JoinFinding };

/** Whether a finding comes from the joins between parts. */
export function isJoinFinding(f: Finding): f is JoinBackedFinding {
  return "join" in f && (f as JoinBackedFinding).join !== undefined;
}

/** The part's own findings plus the join findings of its rows, in row order. */
export function withJoinFindings(findings: readonly Finding[], rows: readonly Row[], byRow: ReadonlyMap<string, readonly JoinFinding[]>): readonly Finding[] {
  if (byRow.size === 0 || !rows.some((r) => byRow.has(r.id))) return findings;
  const own = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = own.get(f.rowId) ?? [];
    list.push(f);
    own.set(f.rowId, list);
  }
  return rows.flatMap((r) => [
    ...(own.get(r.id) ?? []),
    ...(byRow.get(r.id) ?? []).map((join): JoinBackedFinding => ({ rowId: r.id, severity: join.severity, code: "INVALID_JOIN", message: join.message, join })),
  ]);
}

/**
 * Names of the parts part `index` is crocheted together with (either way), for the preview's
 * hint; empty when it is not joined.
 */
export function joinedPartNames(doc: BuilderDoc, index: number): string[] {
  if (!doc.parts.some((p) => p.content.rows.some((r) => joinIdsOf(r.ops).size > 0))) return [];
  const plan = planJoins(doc);
  const names = new Set<number>();
  for (const l of plan.links) {
    const s = plan.sources[l.source]!;
    if (l.part === index) names.add(s.part);
    if (s.part === index) names.add(l.part);
  }
  names.delete(index);
  return [...names].sort((a, b) => a - b).map((i) => doc.parts[i]!.name.trim() || `Teil ${i + 1}`);
}

/** German text of a join finding. */
export function joinFindingMessage(f: JoinFinding): string {
  const { expected, actual } = f;
  switch (f.code) {
    case "JOIN_UNKNOWN_PART":
      return "Das Teil, in das diese Maschen gearbeitet werden, gibt es nicht (mehr).";
    case "JOIN_UNKNOWN_COPY":
      return `Das Teil gibt es nur ${expected ?? 1}-mal – Kopie ${actual ?? ""} fehlt.`;
    case "JOIN_UNKNOWN_ROW":
      return "Die Runde des anderen Teils gibt es nicht (mehr) oder sie hat keine Maschen.";
    case "JOIN_SELF":
      return "Ein Teil kann nicht in sich selbst gehäkelt werden – ein anderes Teil wählen.";
    case "JOIN_CYCLE":
      return "Diese Teile werden im Kreis ineinander gehäkelt – eines muss zuerst fertig sein.";
    case "JOIN_OVERFLOW":
      return `Geht über das Ende der Runde des anderen Teils hinaus: dort gibt es nur ${expected} Maschen.`;
    case "JOIN_OVERLAP":
      return "Diese Maschen des anderen Teils sind schon von einer anderen Verbindung belegt.";
    case "JOIN_UNDERFLOW": {
      const left = (expected ?? 0) - (actual ?? 0);
      return `Von ${expected} Maschen des anderen Teils werden nur ${actual} verbunden – ${left} ${left === 1 ? "bleibt" : "bleiben"} frei.`;
    }
    case "THROUGH_NOT_FLAT":
      return "„Zusammen mit“ braucht eine Kante: die letzte Runde des anderen Teils, flach zusammengelegt oder offen – nicht zusammengezogen.";
    case "JOINED_AND_PLACED":
      return "Das Teil wird angehäkelt und hat außerdem eine Platzierung zum Annähen – es sitzt dort, wo es angehäkelt ist.";
  }
}
