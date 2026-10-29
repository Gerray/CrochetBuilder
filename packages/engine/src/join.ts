/**
 * Joining while crocheting (format v2, `StitchOp.from` / `StitchOp.through`): which stitches of
 * which part every joined stitch works into, and what can be wrong with it across parts.
 *
 * `planJoins(doc)` walks the document in order — parts, then each copy of a part, then rows,
 * then stitches — and gives every stitch of a joined op its place in the other part:
 *
 *   - `from` ("18 sc around leg 1"): the stitch is worked into the stitches of a row of another
 *     part instead of its own previous row. It takes as many stitches there as it would take of
 *     its own row (`consumesOfAtom`: 1, a decrease 2). The source row offers what it would offer
 *     the next row of its own part (`anchorsOffered`).
 *   - `through` ("5 sc through both layers of the arm and the body"): the stitch is worked into
 *     its own previous row as usual and additionally through one place of the other part's row.
 *     A ROUND is flattened for that: a place is a pair of stitches lying on top of each other
 *     (its k-th stitch and its k-th from the end, as a flat finish pairs them), so a round of 10
 *     offers 5 places; a flat row offers one place per stitch.
 *
 * Where an op starts in the source row: at its `start` when it has one (applied at the op's
 * first stitch, once per row, for the first copy of the joining part); otherwise where the
 * previous join into the same source row — the same part copy, row and kind — stopped, in
 * document order across all parts (the first one at 0). Two branches worked from one round
 * without `start` thus take its first and its second half. Copies: `copy` is 1-based (default
 * 1); every copy of a joined part makes its own joins, one after the other: the second copy of
 * a branch continues where the first stopped, also when the first had a `start`.
 *
 * A stitch that is worked into nothing (chain, magic ring, picot) makes no join; validation
 * reports it (`INVALID_JOIN`).
 *
 * Findings (`validateExport` reports them): unknown part, copy or row; a part joined to itself;
 * a cycle (A works from B, B from A); a source row worked into beyond its end (overflow), the
 * same stitches taken twice (overlap) or not all of them taken (underflow, a warning — the
 * stitches stay free); `through` on a row that is not an edge finished flat or open (warning:
 * a gathered end has no edge to work through); `from` into a last round that is explicitly
 * gathered (warning: the join goes on from it, it cannot be pulled shut); and an attach
 * placement of a joined part copy that is not its component's root (warning: the join decides
 * where it sits — see `droppedPlacements`).
 *
 * Each component has a root (`JoinPlan.roots`): its copy with the most stitches, ties broken by
 * part id, then copy — independent of the order of the parts. The root takes the component's
 * pose in the joint relaxation and may be sewn on like any part, carrying the others along.
 *
 * Pure functions, no UI or framework imports.
 */

import { countRowAtoms, expandRow, isInstructionRow, type AtomJoin } from "./expand.js";
import type { JoinRef, PartContent, Row } from "./schema.js";
import { computeRowStitches } from "./stitch-count.js";
import { anchorsOffered, consumesOfAtom, isChainRow, isRingRow, worksAroundChain } from "./validate.js";

export type JoinKind = "from" | "through";

/** What `planJoins` needs of a document (a `BuilderExport` satisfies it). */
export interface JoinDocument {
  parts: ReadonlyArray<{ id?: string | undefined; name?: string; quantity: number; content: PartContent }>;
  assembly?: ReadonlyArray<{ id: string; kind: string; part?: string | undefined }> | undefined;
}

/** A part copy: index into `doc.parts` and the 0-based copy. */
export interface JoinInstance {
  part: number;
  copy: number;
}

/** A source row of joins: a row of a part copy, worked into by `from` or `through`. */
export interface JoinSource extends JoinInstance {
  rowId: string;
  kind: JoinKind;
  /** Places the row offers: stitches (`from`, `through` on a flat row) or pairs (`through` on a round). */
  capacity: number;
  /** `through` on a round: a place is a pair of stitches (both layers). */
  layered: boolean;
}

/** One joined stitch and the places it takes in the other part. */
export interface JoinLink {
  kind: JoinKind;
  /** The joined stitch: part, 0-based copy, row id and index of the stitch in the row (`expandRow`). */
  part: number;
  copy: number;
  rowId: string;
  offset: number;
  /** Index into `JoinPlan.sources`. */
  source: number;
  /** First place it takes in the source row and how many (`count` ≥ 1). */
  slot: number;
  count: number;
  /** The reference of the joining op (the object in the document). */
  ref: JoinRef;
}

export type JoinFindingCode =
  | "JOIN_UNKNOWN_PART"
  | "JOIN_UNKNOWN_COPY"
  | "JOIN_UNKNOWN_ROW"
  | "JOIN_SELF"
  | "JOIN_CYCLE"
  | "JOIN_OVERFLOW"
  | "JOIN_OVERLAP"
  | "JOIN_UNDERFLOW"
  | "THROUGH_NOT_FLAT"
  | "JOIN_INTO_GATHERED"
  | "JOINED_AND_PLACED";

export interface JoinFinding {
  severity: "error" | "warning";
  code: JoinFindingCode;
  message: string;
  /** The part whose row makes the join (for `JOINED_AND_PLACED`: the joined part). */
  partIndex: number;
  /** The joining row (absent for `JOINED_AND_PLACED`). */
  rowId?: string;
  /** The placement (`JOINED_AND_PLACED`). */
  placementId?: string;
  /** The offending reference (part id, row id). */
  ref?: string;
  expected?: number;
  actual?: number;
}

export interface JoinPlan {
  links: JoinLink[];
  sources: JoinSource[];
  findings: JoinFinding[];
  /**
   * Part copies connected by joins, each a component of at least two copies (sorted by part,
   * then copy); components in order of their first copy. Unjoined copies are in none.
   */
  components: JoinInstance[][];
  /** Per component: index into it of its root (see the module doc). */
  roots: number[];
}

/** The last row of a part that has stitches (the default source row of a join). */
export function lastStitchRow(content: PartContent): Row | undefined {
  for (let i = content.rows.length - 1; i >= 0; i--) {
    const row = content.rows[i]!;
    if (row.ops.length > 0 && !isInstructionRow(row)) return row;
  }
  return undefined;
}

/** Whether a row has a stitch with a join (`from` or `through`). */
export function rowHasJoin(row: Row): boolean {
  const any = (ops: Row["ops"]): boolean =>
    ops.some((op) => (op.kind === "stitch" ? op.from !== undefined || op.through !== undefined : any(op.ops)));
  return any(row.ops);
}

/** Whether a part has a stitch with a join. */
export function partHasJoin(content: PartContent): boolean {
  return content.rows.some(rowHasJoin);
}

/**
 * Whether the engine closes the part's last round by default (no `finish`): it starts closed
 * (magic ring or oval start), is worked in rounds and ends in less than half its widest round —
 * the rule of `isClosedPiece`, computed from the rows.
 */
export function gathersByDefault(content: PartContent): boolean {
  const rows = content.rows.filter((r) => r.ops.length > 0 && !isInstructionRow(r));
  if (rows.length < 3) return false;
  const oval = isChainRow(rows[0]!) && worksAroundChain(rows[1]!, rows[0]!);
  if (!isRingRow(rows[0]!) && !oval) return false;
  const rounds = oval ? rows.slice(1) : rows;
  if (!rounds.every((r) => r.type === "round")) return false;
  const counts = rounds.map(computeRowStitches);
  return counts[counts.length - 1]! < 0.5 * Math.max(...counts);
}

/** Places a source row offers to joins of `kind`. */
export function joinCapacity(row: Row, kind: JoinKind): { capacity: number; layered: boolean } {
  const stitches = anchorsOffered(row);
  if (kind === "from") return { capacity: stitches, layered: false };
  const layered = row.type === "round" && !isChainRow(row);
  return { capacity: layered ? Math.floor(stitches / 2) : stitches, layered };
}

const partLabel = (doc: JoinDocument, i: number) => {
  const p = doc.parts[i]!;
  return p.name?.trim() ? `"${p.name.trim()}"` : p.id ? `"${p.id}"` : `${i + 1}`;
};

/** Resolve every join of `doc` (see the module doc). */
export function planJoins(doc: JoinDocument): JoinPlan {
  const findings: JoinFinding[] = [];
  const seenFinding = new Set<string>();
  const report = (f: JoinFinding) => {
    const key = `${f.code}|${f.partIndex}|${f.rowId ?? ""}|${f.ref ?? ""}|${f.placementId ?? ""}`;
    if (seenFinding.has(key)) return;
    seenFinding.add(key);
    findings.push(f);
  };
  const byId = new Map<string, number>();
  doc.parts.forEach((p, i) => {
    if (p.id !== undefined && !byId.has(p.id)) byId.set(p.id, i);
  });
  const quantity = (i: number) => Math.max(1, Math.floor(doc.parts[i]!.quantity));

  const sources: JoinSource[] = [];
  const sourceIndex = new Map<string, number>();
  const cursors: number[] = [];
  const links: JoinLink[] = [];
  /** Per source: the places taken, with the joining part and row. */
  const taken: Array<Array<{ slot: number; count: number; part: number; rowId: string }>> = [];
  const edges = new Map<number, Set<number>>();

  const resolveSource = (
    consumer: number,
    rowId: string,
    join: AtomJoin,
  ): number | null => {
    const ref: JoinRef = join.ref;
    const target = byId.get(ref.part);
    if (target === undefined) {
      report({
        severity: "error",
        code: "JOIN_UNKNOWN_PART",
        message: `Row works into part "${ref.part}", which does not exist.`,
        partIndex: consumer,
        rowId,
        ref: ref.part,
      });
      return null;
    }
    if (target === consumer) {
      report({
        severity: "error",
        code: "JOIN_SELF",
        message: "Row is joined to its own part; a join works into another part.",
        partIndex: consumer,
        rowId,
        ref: ref.part,
      });
      return null;
    }
    const copy = (ref.copy ?? 1) - 1;
    if (copy >= quantity(target)) {
      report({
        severity: "error",
        code: "JOIN_UNKNOWN_COPY",
        message: `Row works into copy ${copy + 1} of part ${partLabel(doc, target)}, which has only ${quantity(target)}.`,
        partIndex: consumer,
        rowId,
        ref: ref.part,
        expected: quantity(target),
        actual: copy + 1,
      });
      return null;
    }
    const content = doc.parts[target]!.content;
    const row = ref.row === undefined ? lastStitchRow(content) : content.rows.find((r) => r.id === ref.row);
    if (!row || row.ops.length === 0 || isInstructionRow(row)) {
      report({
        severity: "error",
        code: "JOIN_UNKNOWN_ROW",
        message:
          ref.row === undefined
            ? `Part ${partLabel(doc, target)} has no stitches to work into.`
            : `Row works into row "${ref.row}" of part ${partLabel(doc, target)}, which it does not have (or which has no stitches).`,
        partIndex: consumer,
        rowId,
        ref: ref.row ?? ref.part,
      });
      return null;
    }
    const key = `${join.kind}|${target}|${copy}|${row.id}`;
    let index = sourceIndex.get(key);
    if (index === undefined) {
      index = sources.length;
      sourceIndex.set(key, index);
      sources.push({ part: target, copy, rowId: row.id, kind: join.kind, ...joinCapacity(row, join.kind) });
      cursors.push(0);
      taken.push([]);
      if (join.kind === "through") checkThroughEdge(doc, target, row, consumer, rowId, report);
      else checkFromEdge(doc, target, row, consumer, rowId, report);
    }
    const out = edges.get(consumer) ?? new Set<number>();
    out.add(target);
    edges.set(consumer, out);
    return index;
  };

  doc.parts.forEach((part, p) => {
    for (let copy = 0; copy < quantity(p); copy++) {
      for (const row of part.content.rows) {
        if (row.ops.length === 0 || isInstructionRow(row)) continue;
        const started = new Set<JoinRef>();
        expandRow(row).forEach((atom, offset) => {
          const join = atom.join;
          // Inside a stitch group a join is invalid (`INVALID_JOIN`) and ignored.
          if (!join || atom.group !== undefined || atom.code === "NOTE") return;
          // Worked into nothing (chain, magic ring, picot): no join (`INVALID_JOIN`).
          const consumes = consumesOfAtom(atom);
          if (consumes === 0) return;
          const count = join.kind === "from" ? consumes : 1;
          const source = resolveSource(p, row.id, join);
          if (source === null) return;
          // `start` places the first copy; later copies continue after it.
          if (copy === 0 && join.first && join.ref.start !== undefined && !started.has(join.ref)) {
            started.add(join.ref);
            cursors[source] = join.ref.start;
          }
          const slot = cursors[source]!;
          cursors[source] = slot + count;
          links.push({ kind: join.kind, part: p, copy, rowId: row.id, offset, source, slot, count, ref: join.ref });
          const list = taken[source]!;
          const last = list[list.length - 1];
          if (last && last.part === p && last.rowId === row.id && last.slot + last.count === slot) last.count += count;
          else list.push({ slot, count, part: p, rowId: row.id });
        });
      }
    }
  });

  // Over-, under- and double consumption per source row.
  sources.forEach((src, i) => {
    const list = taken[i]!;
    const what = src.layered ? "places (stitch pairs)" : "stitches";
    let covered = 0;
    const marks = new Uint8Array(Math.max(0, src.capacity));
    for (const t of list) {
      if (t.slot + t.count > src.capacity) {
        report({
          severity: "error",
          code: "JOIN_OVERFLOW",
          message: `Row works into ${what} ${t.slot + 1}–${t.slot + t.count} of part ${partLabel(doc, src.part)}, but that row only has ${src.capacity}.`,
          partIndex: t.part,
          rowId: t.rowId,
          ref: doc.parts[src.part]!.id,
          expected: src.capacity,
          actual: t.slot + t.count,
        });
      }
      let overlap = false;
      for (let s = t.slot; s < Math.min(src.capacity, t.slot + t.count); s++) {
        if (marks[s]) overlap = true;
        else {
          marks[s] = 1;
          covered++;
        }
      }
      if (overlap) {
        report({
          severity: "error",
          code: "JOIN_OVERLAP",
          message: `Row works into ${what} of part ${partLabel(doc, src.part)} that another join already took.`,
          partIndex: t.part,
          rowId: t.rowId,
          ref: doc.parts[src.part]!.id,
        });
      }
    }
    if (covered < src.capacity && list.length > 0) {
      const t = list[list.length - 1]!;
      report({
        severity: "warning",
        code: "JOIN_UNDERFLOW",
        message: `Joins take ${covered} of the ${src.capacity} ${what} of part ${partLabel(doc, src.part)}; ${src.capacity - covered} stay free.`,
        partIndex: t.part,
        rowId: t.rowId,
        ref: doc.parts[src.part]!.id,
        expected: src.capacity,
        actual: covered,
      });
    }
  });

  // Cycles between parts (A works into B, B into A).
  for (const cycle of partCycles(doc.parts.length, edges)) {
    for (const p of cycle) {
      const link = links.find((l) => l.part === p && cycle.includes(sources[l.source]!.part));
      report({
        severity: "error",
        code: "JOIN_CYCLE",
        message: `Parts ${cycle.map((i) => partLabel(doc, i)).join(", ")} are joined into each other in a circle.`,
        partIndex: p,
        ...(link ? { rowId: link.rowId } : {}),
      });
    }
  }

  // Connected part copies.
  const parent = new Map<string, string>();
  const key = (part: number, copy: number) => `${part}:${copy}`;
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = k;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const touch = (k: string) => {
    if (!parent.has(k)) parent.set(k, k);
  };
  for (const l of links) {
    const a = key(l.part, l.copy);
    const s = sources[l.source]!;
    const b = key(s.part, s.copy);
    touch(a);
    touch(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<string, JoinInstance[]>();
  for (const k of parent.keys()) {
    const r = find(k);
    const [part, copy] = k.split(":").map(Number) as [number, number];
    const list = groups.get(r) ?? [];
    list.push({ part, copy });
    groups.set(r, list);
  }
  const components = [...groups.values()]
    .map((list) => list.sort((a, b) => a.part - b.part || a.copy - b.copy))
    .sort((a, b) => a[0]!.part - b[0]!.part || a[0]!.copy - b[0]!.copy);

  // Roots: the copy with the most stitches; ties by part id, then copy (not by part order).
  const size = new Map<number, number>();
  const sizeOf = (part: number) => {
    let n = size.get(part);
    if (n === undefined) {
      n = doc.parts[part]!.content.rows.reduce((s, r) => s + (isInstructionRow(r) ? 0 : countRowAtoms(r)), 0);
      size.set(part, n);
    }
    return n;
  };
  const idOf = (part: number) => doc.parts[part]!.id ?? "";
  const roots = components.map((list) => {
    let best = 0;
    list.forEach((x, i) => {
      const b = list[best]!;
      const d = sizeOf(x.part) - sizeOf(b.part);
      if (d > 0 || (d === 0 && (idOf(x.part) < idOf(b.part) || (idOf(x.part) === idOf(b.part) && x.copy < b.copy)))) best = i;
    });
    return best;
  });

  // An attach placement of a joined copy that is not a root: the join decides.
  const plan: JoinPlan = { links, sources, findings, components, roots };
  for (const { placement: pl, part: p } of droppedPlacements(doc, plan)) {
    report({
      severity: "warning",
      code: "JOINED_AND_PLACED",
      message: `Part ${partLabel(doc, p)} is crocheted onto another part and also sewn on by placement "${pl.id}"; the crocheted join decides where it sits.`,
      partIndex: p,
      placementId: pl.id,
      ...(pl.part !== undefined ? { ref: pl.part } : {}),
    });
  }

  return plan;
}

/**
 * Copies of part `part` that take attach placements, in copy order: all copies except those
 * crocheted onto a component whose root they are not (`joinedNonRoot`: keys `part:copy`).
 */
export function placeableCopies(quantity: number, part: number, joinedNonRoot: ReadonlySet<string>): number[] {
  const out: number[] = [];
  for (let copy = 0; copy < quantity; copy++) if (!joinedNonRoot.has(`${part}:${copy}`)) out.push(copy);
  return out;
}

/** Keys `part:copy` of the joined copies that are not their component's root. */
export function joinedNonRootKeys(plan: Pick<JoinPlan, "components" | "roots">): Set<string> {
  const out = new Set<string>();
  plan.components.forEach((list, c) => list.forEach((x, i) => i !== plan.roots[c] && out.add(`${x.part}:${x.copy}`)));
  return out;
}

/**
 * Attach placements the join overrides: a part's placements go, in order, to its copies that
 * are not crocheted onto another component's root (see `placeableCopies`); a placement left
 * over while some copy of the part is joined is dropped — the join decides where that copy
 * sits. The assembly (`composeAssembly`) applies the same rule.
 */
export function droppedPlacements<P extends { id: string; kind: string; part?: string | undefined }>(
  doc: { parts: JoinDocument["parts"]; assembly?: ReadonlyArray<P> | undefined },
  plan: Pick<JoinPlan, "components" | "roots">,
): Array<{ placement: P; part: number }> {
  const nonRoot = joinedNonRootKeys(plan);
  if (nonRoot.size === 0) return [];
  const byId = new Map<string, number>();
  doc.parts.forEach((p, i) => {
    if (p.id !== undefined && !byId.has(p.id)) byId.set(p.id, i);
  });
  const seen = new Map<number, number>();
  const out: Array<{ placement: P; part: number }> = [];
  for (const pl of doc.assembly ?? []) {
    if (pl.kind !== "attach" || pl.part === undefined) continue;
    const p = byId.get(pl.part);
    if (p === undefined) continue;
    const q = Math.max(1, Math.floor(doc.parts[p]!.quantity));
    const free = placeableCopies(q, p, nonRoot);
    if (free.length === q) continue; // no copy of the part is joined below a root
    const k = seen.get(p) ?? 0;
    seen.set(p, k + 1);
    if (k >= free.length) out.push({ placement: pl, part: p });
  }
  return out;
}

/** `through` needs an edge: the part's last row, a flat row or a round finished flat or open. */
function checkThroughEdge(
  doc: JoinDocument,
  target: number,
  row: Row,
  consumer: number,
  rowId: string,
  report: (f: JoinFinding) => void,
): void {
  const content = doc.parts[target]!.content;
  const edge = lastStitchRow(content) === row;
  const finish = content.finish;
  const ok =
    edge && (row.type === "row" || finish === "flat" || finish === "open" || (finish === undefined && !gathersByDefault(content)));
  if (ok) return;
  report({
    severity: "warning",
    code: "THROUGH_NOT_FLAT",
    message: edge
      ? `Row is worked through the end of part ${partLabel(doc, target)}, which is gathered shut; set its finish to flat or open.`
      : `Row is worked through row "${row.id}" of part ${partLabel(doc, target)}, which is not its edge.`,
    partIndex: consumer,
    rowId,
    ref: doc.parts[target]!.id,
  });
}

/** `from` into a last round that is explicitly gathered: the join goes on from it. */
function checkFromEdge(
  doc: JoinDocument,
  target: number,
  row: Row,
  consumer: number,
  rowId: string,
  report: (f: JoinFinding) => void,
): void {
  const content = doc.parts[target]!.content;
  if (content.finish !== "gather" || row.type !== "round" || lastStitchRow(content) !== row) return;
  report({
    severity: "warning",
    code: "JOIN_INTO_GATHERED",
    message: `Row is worked into the last round of part ${partLabel(doc, target)}, which is gathered shut; set its finish to open.`,
    partIndex: consumer,
    rowId,
    ref: doc.parts[target]!.id,
  });
}

/** Strongly connected components with more than one part (Tarjan), each sorted. */
function partCycles(n: number, edges: Map<number, Set<number>>): number[][] {
  let index = 0;
  const idx = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const stack: number[] = [];
  const out: number[][] = [];
  const strong = (v: number) => {
    idx[v] = low[v] = index++;
    stack.push(v);
    onStack[v] = true;
    for (const w of edges.get(v) ?? []) {
      if (idx[w] === -1) {
        strong(w);
        low[v] = Math.min(low[v]!, low[w]!);
      } else if (onStack[w]) low[v] = Math.min(low[v]!, idx[w]!);
    }
    if (low[v] === idx[v]) {
      const comp: number[] = [];
      let w: number;
      do {
        w = stack.pop()!;
        onStack[w] = false;
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) out.push(comp.sort((a, b) => a - b));
    }
  };
  for (let v = 0; v < n; v++) if (idx[v] === -1) strong(v);
  return out.sort((a, b) => a[0]! - b[0]!);
}
