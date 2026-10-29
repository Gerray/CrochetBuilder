/**
 * Stitch graph — the topology of a crocheted part, built from its expanded rows.
 *
 * One node per worked stitch (atom of `expandRow`; free-instruction NOTE atoms are skipped).
 * Two kinds of edges, each with a rest length in millimetres from the resolved gauge:
 *
 *   - `prev`: the yarn path. Every node links to the node worked just before it, also across
 *     row boundaries, so the working path is one continuous chain.
 *   - `parent`: the vertical link to the stitches of the previous stitch row this stitch is
 *     worked into, assigned sequentially by `consumesStitches` (TOG-aware): a normal stitch
 *     has 1 parent, `DEC`/`INVDEC`/`… TOG` 2, `CH`/`MR` none. An `INC` is one node that
 *     offers two anchor slots to the next row (it is two fabric stitches on one parent).
 *
 * Format v2 constructs:
 *   - a stitch group ("3 SC in one stitch", a shell) is a generalised `INC`: one node per
 *     stitch, and the group as a whole takes ONE anchor slot — every stitch of it that is
 *     worked into something has that slot as its only parent (chains and picots inside the
 *     group have none). Their legs fan out from the slot like an INC's (`StitchNode.lean`,
 *     scaled by `LEG_LEAN`); each stitch offers its own slots to the next row, so 6 groups of
 *     3 SC on a round of 6 give a round of 18;
 *   - `BOBBLE` / `PUFF` / `POPCORN` are ordinary one-stitch nodes, as tall as a DC
 *     (`STITCH_HEIGHT_FACTOR`), with a `bulge` rendering hint;
 *   - `PICOT` is a decorative node of zero width and height: it sits on the yarn path between
 *     its neighbours, has no parent, offers no slot and is not part of the fabric
 *     (`isFabricNode`), so it never shapes the piece.
 *
 * Anchors (what a row offers the next one) follow `anchorsOffered` in validate.ts: one slot
 * per produced fabric stitch, except a foundation chain (a row of only `CH`), which offers
 * one slot per chain. A row that contains `MR` is a ring row: its MR node sits at the origin
 * and every stitch of that row is worked into it. After a `type: "row"` row the work turns,
 * so the next row consumes the anchors in reverse order; after a round it continues in the
 * same order (spiral).
 *
 * A round worked around a foundation chain (`Row.around`, oval start) walks the chain's slots
 * from the hook end to the far end (side 1, as a row into the chain would), then back along
 * the other side (side 2): its parents on side 2 are the same chain nodes, so the chain ends
 * up inside the oval, both sides attached to it. The round is closed (its last stitch next to
 * its first), and the rounds after it are worked into it as into any round. With fewer
 * stitches than both sides offer, the slots are skipped as patterns count: the chain next to
 * the hook on side 1 (as for a row), the far chain's second side (the stitch group there turns
 * around the end), the hook chain on side 2, then alternately inwards from the hook end.
 *
 * Joins (format v2): a stitch worked into another part (`StitchOp.from`) takes no slot of its
 * own previous row and has no parents in this graph (`StitchNode.joined`); the surface is not
 * zipped across it. A first round made only of such stitches closes on its own (a stem worked
 * into the top of a pumpkin). A stitch worked `through` another part is wired as usual. The
 * links between the parts live in the joined model (`relaxJoined`), not here, so the graph of
 * one part stays the standalone part.
 *
 * The graph never throws on an invalid pattern — `validate` reports problems. Here: a
 * stitch with no anchor left attaches to the last available anchor, surplus anchors stay
 * free, a row with nothing to work into gets no parents. When a row works into a foundation
 * chain with fewer stitches than chains, the chains nearest the hook are skipped ("sc into
 * the 2nd chain from the hook"), which is how crochet patterns count.
 *
 * Positions: `buildGraph` also lays the nodes out procedurally (rounds on circles stacked
 * along +Y, rows as a flat grid in the XY plane) so the graph is usable before `relax`.
 *
 * Pure functions, no UI or framework imports.
 */

import { expandRow, isInstructionRow } from "./expand.js";
import { resolveGauge, STITCH_BULGE, STITCH_HEIGHT_FACTOR, type Gauge, type ResolvedGauge } from "./gauge.js";
import { STITCH_PROPERTIES, type Mod, type PartContent, type StitchCode } from "./schema.js";
import { consumesOfAtom, countPartAtoms, DEFAULT_MAX_STITCHES } from "./validate.js";

/** Index of a node in `StitchGraph.nodes` (equal to its position in working order). */
export type NodeId = number;

export interface StitchNode {
  /** Index in `graph.nodes`; nodes are stored in working order. */
  id: NodeId;
  /** Position of the atom in `expandPart(content)` (counts NOTE atoms, like TellmeCrochet). */
  globalIndex: number;
  rowId: string;
  /** 0-based index of the row in `content.rows`. */
  rowIndex: number;
  code: StitchCode;
  /** Index of the atom within its row (`expandRow(row)[offset]`), as TellmeCrochet's cursor. */
  offset: number;
  modifiers?: Mod[];
  /** Node worked just before this one (yarn path), `null` for the very first node. */
  prev: NodeId | null;
  /** Distinct nodes of the previous stitch row this stitch is worked into, in working order. */
  parents: NodeId[];
  /**
   * The anchor slots this stitch consumed, in consumption order: the parent node and the
   * index of the slot among the slots that parent offers (0 … producesStitches − 1, in the
   * parent's own working order). An `INC` parent offers slots 0 and 1. Finer-grained than
   * `parents`; the relaxation uses it to model each fabric stitch of an `INC` on its own.
   */
  parentSlots?: AnchorSlot[];
  /** Width of the stitch top along its row, in stitch widths (INC 2, MR 0, otherwise 1). */
  span: number;
  /** Vertical rest length in mm: `stitchHeightMm × STITCH_HEIGHT_FACTOR[code]`. */
  height: number;
  /**
   * A turning / standing chain: chains before the first worked stitch of a row or round, or
   * chains after the last worked stitch of a `type: "row"` row ("6 sc, ch 1, turn"). It lifts
   * the yarn to the next stitch's height instead of adding width.
   */
  lift: boolean;
  /**
   * Format v2 stitch group: the first node of the group this stitch belongs to. All stitches
   * of a group are worked into the same anchor slot (like the two stitches of an `INC`).
   */
  group?: NodeId;
  /**
   * Group stitches only: how far the stitch's foot leans from the shared slot along the row,
   * in stitch widths before `LEG_LEAN` (the offset of the stitch's centre from the centre of
   * the group's width; the outer stitches of "3 SC in one" lean −1 and +1, the middle one 0).
   */
  lean?: number;
  /** Bobble family: how far the stitch stands proud of the fabric (`STITCH_BULGE`). */
  bulge?: number;
  /**
   * Format v2 join: `"from"` — worked into another part (no parents in this graph; the parts
   * are linked by `relaxJoined`); `"through"` — worked into the own row and through another part.
   */
  joined?: "from" | "through";
}

/**
 * Whether a node is part of the fabric of its row: not a turning/standing chain (`lift`),
 * not the magic ring and not a picot (decorative, zero width). The relaxation's rings and
 * bending, the measurements and the mesh frames work on these.
 */
export function isFabricNode(node: StitchNode): boolean {
  return !node.lift && node.code !== "MR" && node.code !== "PICOT";
}

/** One anchor slot consumed by a stitch (see `StitchNode.parentSlots`). */
export interface AnchorSlot {
  node: NodeId;
  /** Index of the slot among the slots `node` offers to the next row. */
  slot: number;
}

export type EdgeKind = "prev" | "parent";

export interface StitchEdge {
  a: NodeId;
  b: NodeId;
  kind: EdgeKind;
  /** Rest length in mm. */
  restLength: number;
}

/** `chain`: only CH (foundation chain) · `ring`: contains MR · `stitch`: anything else. */
export type GraphRowKind = "chain" | "ring" | "stitch";

export interface GraphRow {
  rowId: string;
  rowIndex: number;
  type: "row" | "round";
  kind: GraphRowKind;
  /** First node of the row; the row's nodes are `firstNode … firstNode + nodeCount − 1`. */
  firstNode: NodeId;
  nodeCount: number;
  /** `true` when this row consumed the previous stitch row's anchors in reverse (work turned). */
  reversed: boolean;
  /** Working direction relative to the first row: flips at every turn. */
  direction: 1 | -1;
  /**
   * `true` when the row forms a closed ring (a round worked into a round or a magic ring, or a
   * round worked around a foundation chain).
   */
  closed: boolean;
  /** `true` for a round worked around both sides of the foundation chain before it (`Row.around`). */
  around?: true;
  /** Anchor slots this row offers to the next row. */
  anchorsOffered: number;
  /** Total width of the row in stitch widths (Σ span); for rounds this is the circumference. */
  widthStitches: number;
}

export interface StitchGraph {
  nodes: StitchNode[];
  edges: StitchEdge[];
  /** Rows that produced at least one node, in document order. */
  rows: GraphRow[];
  /** Fabric surface: node triples (3 per triangle), consistently wound. */
  triangles: Uint32Array;
  /** Node positions in mm, `[x0, y0, z0, x1, …]`. Procedural layout until `relax` runs. */
  positions: Float64Array;
  gauge: ResolvedGauge;
  /** `true` when the gauge came from defaults rather than a swatch (sizes are estimates). */
  estimated: boolean;
  /** `true` once `relax` has run. */
  relaxed: boolean;
  /** Atomic stitches of the part (NOTE excluded), also when the graph was not built. */
  stitchCount: number;
  /** `true` when the part exceeded the stitch budget and the graph was left empty. */
  overBudget: boolean;
}

export interface BuildGraphOptions {
  /**
   * Stitch budget (default `DEFAULT_MAX_STITCHES`, 20,000). Above it no graph is built — the
   * result is empty with `overBudget: true` — so a runaway repeat cannot hang the app.
   */
  maxStitches?: number;
}

/** One anchor slot offered to the next row, in the consumer's frame. */
interface Slot {
  node: NodeId;
  /** Index of the slot among its node's slots, in the node's own working order. */
  index: number;
  /** Horizontal offset of the slot from its node's centre, in mm, along the consumer's direction. */
  offset: number;
}

/**
 * How far a slanted leg leans, as a fraction of the half-stitch offset it would need. The two
 * stitches of an increase splay out of one loop and the two legs of a decrease meet in one
 * top; such a leg's rest length is `√(h² + (LEG_LEAN · w/2)²)`. 1 would keep the full row
 * height on the slant, 0 the leg length of an upright stitch; real legs do some of both.
 * 0.7 keeps stacked increases and decreases from bulging into hexagon corners while a disc
 * of six increases per round still lies flat.
 */
export const LEG_LEAN = 0.7;

function spanOf(code: StitchCode): number {
  if (code === "MR" || code === "PICOT") return 0;
  if (code === "CH") return 1;
  return Math.max(1, STITCH_PROPERTIES[code].producesStitches);
}

/**
 * Build the stitch graph of a part. Never throws for well-shaped content; see the module doc
 * for how invalid patterns degrade.
 */
export function buildGraph(content: PartContent, gauge?: Gauge, opts: BuildGraphOptions = {}): StitchGraph {
  const g = resolveGauge(gauge ?? {});
  const w = g.stitchWidthMm;
  const stitchCount = countPartAtoms(content);
  const maxStitches = Number.isFinite(opts.maxStitches) ? opts.maxStitches! : DEFAULT_MAX_STITCHES;
  if (stitchCount > maxStitches) {
    return {
      nodes: [],
      edges: [],
      rows: [],
      triangles: new Uint32Array(0),
      positions: new Float64Array(0),
      gauge: g,
      estimated: g.estimated,
      relaxed: false,
      stitchCount,
      overBudget: true,
    };
  }
  const nodes: StitchNode[] = [];
  const rows: GraphRow[] = [];
  const parentDx: number[][] = []; // per node: horizontal offset to each parent (mm)
  const consumes: number[] = []; // per node: anchors its own code consumes (0 in a chain row)
  const groupPos: number[] = []; // per node: position within its stitch group, −1 outside

  let globalIndex = 0;
  let lastNode: NodeId | null = null;
  let prevRow: GraphRow | null = null;
  let prevSlots: Slot[] = [];

  content.rows.forEach((row, rowIndex) => {
    const atoms = expandRow(row);
    const atomCount = atoms.length;
    if (isInstructionRow(row) || atomCount === 0) {
      globalIndex += atomCount;
      return;
    }
    const allChain = atoms.every((a) => a.code === "CH");
    const hasRing = atoms.some((a) => a.code === "MR");
    const kind: GraphRowKind = allChain ? "chain" : hasRing ? "ring" : "stitch";
    // Around a foundation chain (oval start); without a chain before it, a plain round.
    const around = row.around === true && row.type === "round" && kind === "stitch" && prevRow?.kind === "chain";
    const firstNode = nodes.length;

    // Nodes.
    let seenConsumer = false;
    let joinedFrom = false;
    atoms.forEach((atom, offset) => {
      if (atom.code === "NOTE") return; // cannot happen in a stitch row; defensive
      const code = atom.code;
      const c = consumesOfAtom(atom);
      const lift = kind !== "chain" && code === "CH" && !seenConsumer;
      if (c > 0) seenConsumer = true;
      const node: StitchNode = {
        id: nodes.length,
        globalIndex: globalIndex + offset,
        rowId: row.id,
        rowIndex,
        code,
        offset,
        prev: lastNode,
        parents: [],
        span: spanOf(code),
        height: g.stitchHeightMm * STITCH_HEIGHT_FACTOR[code],
        lift,
      };
      if (atom.modifiers) node.modifiers = [...atom.modifiers];
      const bulge = STITCH_BULGE[code];
      if (bulge !== undefined) node.bulge = bulge;
      // A join inside a stitch group is invalid (`INVALID_JOIN`) and ignored here.
      const join = atom.join && atom.group === undefined && c > 0 ? atom.join.kind : undefined;
      if (join) {
        node.joined = join;
        joinedFrom ||= join === "from";
      }
      nodes.push(node);
      parentDx.push([]);
      // Worked into another part: nothing of the own previous row.
      consumes.push(kind === "chain" || join === "from" ? 0 : c);
      groupPos.push(atom.group ?? -1);
      lastNode = node.id;
    });
    globalIndex += atomCount;
    const nodeCount = nodes.length - firstNode;

    // Trailing turning chain of a row that turns: "6 sc, ch 1, turn".
    if (row.type === "row" && kind !== "chain" && seenConsumer) {
      for (let id = firstNode + nodeCount - 1; id >= firstNode; id--) {
        const n = nodes[id]!;
        if (n.code !== "CH" || consumes[id]! > 0) break;
        n.lift = true;
      }
    }

    // Stitch groups: mark the members and how far each one's foot leans from the shared slot.
    for (let id = firstNode; id < firstNode + nodeCount; id++) {
      if (groupPos[id] !== 0) continue;
      let end = id + 1;
      while (end < firstNode + nodeCount && groupPos[end]! > 0) end++;
      const fabric: number[] = [];
      for (let k = id; k < end; k++) {
        nodes[k]!.group = id;
        if (isFabricNode(nodes[k]!)) fabric.push(k);
      }
      const width = fabric.reduce((s, k) => s + nodes[k]!.span, 0);
      let cum = 0;
      for (const k of fabric) {
        const span = nodes[k]!.span;
        nodes[k]!.lean = cum + span / 2 - width / 2;
        cum += span;
      }
    }

    // Parents. The work turns after a row; a foundation chain is always worked back from the
    // hook end (the last chain made is next to the hook), whatever its declared type.
    const reversed =
      prevRow !== null && kind !== "ring" && (prevRow.type === "row" || prevRow.kind === "chain");
    if (kind === "ring") {
      const mr = nodes.slice(firstNode).find((n) => n.code === "MR")!;
      for (let id = firstNode; id < firstNode + nodeCount; id++) {
        if (consumes[id]! > 0) {
          nodes[id]!.parents.push(mr.id);
          nodes[id]!.parentSlots = [{ node: mr.id, slot: 0 }];
          parentDx[id]!.push(0);
        }
      }
    } else if (kind === "stitch" && prevSlots.length > 0) {
      let slots = reversed
        ? prevSlots.map((s) => ({ node: s.node, index: s.index, offset: -s.offset })).reverse()
        : prevSlots;
      // A stitch group takes one slot, at its first stitch that is worked into something; a group
      // of only chains and picots takes none (as `consumesOfGroup` in validation).
      let total = 0;
      let counted = false;
      for (let id = firstNode; id < firstNode + nodeCount; id++) {
        if (groupPos[id]! < 0) {
          total += consumes[id]!;
          continue;
        }
        if (groupPos[id] === 0) counted = false;
        if (consumes[id]! > 0 && !counted) {
          total++;
          counted = true;
        }
      }
      if (around) slots = aroundSlots(slots, prevSlots, total);
      // Working into a foundation chain with fewer stitches than chains: skip from the hook.
      let cursor = !around && prevRow!.kind === "chain" && total < slots.length ? slots.length - total : 0;
      let groupSlot: Slot | null = null;
      for (let id = firstNode; id < firstNode + nodeCount; id++) {
        if (groupPos[id]! >= 0) {
          if (groupPos[id] === 0) groupSlot = null;
          // Stitches of the group that are worked into something (not its chains or picots)
          // all go into the group's slot, their legs fanning out like an INC's.
          if (consumes[id]! > 0) {
            if (!groupSlot) {
              groupSlot = slots[Math.min(cursor, slots.length - 1)]!;
              cursor++;
            }
            const node = nodes[id]!;
            node.parents.push(groupSlot.node);
            node.parentSlots = [{ node: groupSlot.node, slot: groupSlot.index }];
            parentDx[id]!.push(groupSlot.offset + LEG_LEAN * (node.lean ?? 0) * w);
          }
          continue;
        }
        const c = consumes[id]!;
        if (c === 0) continue;
        const sums = new Map<NodeId, { dx: number; n: number }>();
        const order: NodeId[] = [];
        const used: AnchorSlot[] = [];
        for (let j = 0; j < c; j++) {
          const slot = slots[Math.min(cursor, slots.length - 1)]!;
          cursor++;
          used.push({ node: slot.node, slot: slot.index });
          const dx = slot.offset - LEG_LEAN * (j - (c - 1) / 2) * w;
          const acc = sums.get(slot.node);
          if (acc) {
            acc.dx += dx;
            acc.n++;
          } else {
            sums.set(slot.node, { dx, n: 1 });
            order.push(slot.node);
          }
        }
        for (const p of order) {
          const acc = sums.get(p)!;
          nodes[id]!.parents.push(p);
          parentDx[id]!.push(acc.dx / acc.n);
        }
        nodes[id]!.parentSlots = used;
      }
    }

    // Anchors offered to the next row.
    const slots: Slot[] = [];
    for (let id = firstNode; id < firstNode + nodeCount; id++) {
      const n = nodes[id]!;
      const p = kind === "chain" ? 1 : STITCH_PROPERTIES[n.code].producesStitches;
      for (let k = 0; k < p; k++) slots.push({ node: id, index: k, offset: (k - (p - 1) / 2) * w });
    }

    const direction: 1 | -1 = prevRow === null ? 1 : reversed ? (-prevRow.direction as 1 | -1) : prevRow.direction;
    const closed =
      row.type === "round" &&
      (kind === "ring" ||
        around ||
        // A first round worked into another part (a stem on a pumpkin) closes on its own.
        (kind === "stitch" && prevRow === null && joinedFrom) ||
        (kind === "stitch" && prevRow !== null && !reversed && prevRow.kind !== "chain" && prevRow.type === "round"));
    let widthStitches = 0;
    for (let id = firstNode; id < firstNode + nodeCount; id++) {
      const n = nodes[id]!;
      if (!n.lift) widthStitches += n.span;
    }
    const graphRow: GraphRow = {
      rowId: row.id,
      rowIndex,
      type: row.type,
      kind,
      firstNode,
      nodeCount,
      reversed,
      direction,
      closed,
      anchorsOffered: slots.length,
      widthStitches,
    };
    if (around) graphRow.around = true;
    rows.push(graphRow);
    prevRow = graphRow;
    prevSlots = slots;
  });

  const positions = layout(nodes, rows, g);
  const edges = buildEdges(nodes, rows, parentDx, positions, g);
  const triangles = triangulate(nodes, rows);
  return {
    nodes,
    edges,
    rows,
    triangles,
    positions,
    gauge: g,
    estimated: g.estimated,
    relaxed: false,
    stitchCount,
    overBudget: false,
  };
}

/**
 * The slots of a round worked around a foundation chain: side 1 (`side1`, the chain from the
 * hook end) followed by side 2 (`chain`, the chain in its own order), less the slots patterns
 * skip when the round works into fewer (`total`) — see the module doc for the order.
 */
function aroundSlots(side1: Slot[], chain: Slot[], total: number): Slot[] {
  const n = chain.length;
  const full = [...side1, ...chain];
  const drop = Math.max(0, 2 * n - total);
  if (drop === 0) return full;
  // Indices into `full`: chain k is at n − 1 − k on side 1 and at n + k on side 2.
  const order: number[] = [0, n, 2 * n - 1];
  for (let k = n - 2; k >= 0; k--) order.push(n - 1 - k, n + k);
  const skipped = new Set<number>();
  for (const i of order) {
    if (skipped.size >= drop) break;
    if (i >= 0 && i < full.length) skipped.add(i);
  }
  return full.filter((_, i) => !skipped.has(i));
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

function buildEdges(
  nodes: StitchNode[],
  rows: GraphRow[],
  parentDx: number[][],
  positions: Float64Array,
  g: ResolvedGauge,
): StitchEdge[] {
  const w = g.stitchWidthMm;
  const lo = 0.5 * Math.min(w, g.stitchHeightMm);
  const hi = 3 * Math.max(w, g.stitchHeightMm * 4);
  const edges: StitchEdge[] = [];
  const seen = new Set<number>();
  const n = nodes.length;
  const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  const rowOf = new Int32Array(n);
  rows.forEach((r, i) => rowOf.fill(i, r.firstNode, r.firstNode + r.nodeCount));

  // Lift runs (turning/standing chains, possibly a trailing run followed by a leading one):
  // the run plus the step into the next real stitch climb that stitch's height together.
  const liftRest = new Map<NodeId, number>();
  for (let s = 0; s < n; s++) {
    if (!nodes[s]!.lift || (s > 0 && nodes[s - 1]!.lift)) continue;
    let e = s;
    while (e + 1 < n && nodes[e + 1]!.lift) e++;
    const next = nodes[e + 1];
    const climb = next && next.height > 0 ? next.height : g.stitchHeightMm;
    const rest = climb / (e - s + 2);
    for (let id = s; id <= e + 1 && id < n; id++) liftRest.set(id, rest);
  }

  // Parent edges first: they dominate the shape, and prev edges that duplicate them are dropped.
  for (const node of nodes) {
    node.parents.forEach((p, k) => {
      const dx = parentDx[node.id]![k]!;
      const h = node.height > 0 ? node.height : g.stitchHeightMm;
      edges.push({ a: p, b: node.id, kind: "parent", restLength: Math.sqrt(h * h + dx * dx) });
      seen.add(key(p, node.id));
    });
  }

  for (const node of nodes) {
    const a = node.prev;
    if (a === null || seen.has(key(a, node.id))) continue;
    seen.add(key(a, node.id));
    const prev = nodes[a]!;
    let rest: number;
    if (liftRest.has(node.id)) {
      rest = liftRest.get(node.id)!;
    } else if (rowOf[a] === rowOf[node.id]) {
      rest = ((prev.span + node.span) / 2) * w;
      if (rest === 0) rest = w;
    } else {
      // Across a row boundary: the procedural layout is the ideal geometry there.
      const dx = positions[3 * a]! - positions[3 * node.id]!;
      const dy = positions[3 * a + 1]! - positions[3 * node.id + 1]!;
      const dz = positions[3 * a + 2]! - positions[3 * node.id + 2]!;
      rest = Math.min(hi, Math.max(lo, Math.sqrt(dx * dx + dy * dy + dz * dz)));
    }
    edges.push({ a, b: node.id, kind: "prev", restLength: rest });
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Surface triangulation
// ---------------------------------------------------------------------------

/**
 * Zip every row to its parents: a fan from each child to its parents, and one or two
 * triangles between neighbouring children. Closed rings also zip the seam. Triangles are wound
 * so that their normals agree across turned rows.
 */
function triangulate(nodes: StitchNode[], rows: GraphRow[]): Uint32Array {
  const out: number[] = [];
  for (const row of rows) {
    const children: StitchNode[] = [];
    for (let id = row.firstNode; id < row.firstNode + row.nodeCount; id++) {
      const n = nodes[id]!;
      if (n.parents.length > 0) children.push(n);
    }
    if (children.length === 0) continue;
    const flip = row.direction === -1;
    const tri = (a: number, b: number, c: number) => {
      if (a === b || b === c || a === c) return;
      if (flip) out.push(a, c, b);
      else out.push(a, b, c);
    };
    const zip = (c1: StitchNode, c2: StitchNode) => {
      const last = c1.parents[c1.parents.length - 1]!;
      const first = c2.parents[0]!;
      tri(c1.id, last, c2.id);
      if (first !== last) tri(c2.id, last, first);
    };
    // Stitches worked into another part (`from`) have no parents here: the fabric between
    // their neighbours is not zipped across them (it is in the joined model).
    const fromBefore = new Int32Array(row.nodeCount + 1);
    for (let k = 0; k < row.nodeCount; k++) {
      fromBefore[k + 1] = fromBefore[k]! + (nodes[row.firstNode + k]!.joined === "from" ? 1 : 0);
    }
    const gapFree = (a: StitchNode, b: StitchNode) => {
      const i = a.id - row.firstNode;
      const j = b.id - row.firstNode;
      if (i < j) return fromBefore[j]! - fromBefore[i + 1]! === 0;
      // Around the seam: after `a` to the end, and before `b`.
      return fromBefore[row.nodeCount]! - fromBefore[i + 1]! + fromBefore[j]! === 0;
    };
    for (let i = 0; i < children.length; i++) {
      const c = children[i]!;
      for (let k = 0; k + 1 < c.parents.length; k++) tri(c.id, c.parents[k]!, c.parents[k + 1]!);
      if (i + 1 < children.length && gapFree(c, children[i + 1]!)) zip(c, children[i + 1]!);
    }
    // Close the ring around the magic ring (a fan), or around at least three distinct parents:
    // on a parent ring of two the seam would reuse the edge between them a third time and
    // break the surface's orientation.
    const ringOk = row.kind === "ring" || new Set(children.flatMap((c) => c.parents)).size > 2;
    if (row.closed && children.length > 2 && ringOk && gapFree(children[children.length - 1]!, children[0]!)) {
      zip(children[children.length - 1]!, children[0]!);
    }
  }
  return Uint32Array.from(out);
}

// ---------------------------------------------------------------------------
// Procedural layout
// ---------------------------------------------------------------------------

/**
 * A point at arc length `s` on a stadium (two straight sides of length 2·`half` joined by half
 * circles of radius `r`) centred on the origin of the XZ plane: starting at (half, −r), along
 * the side z = −r towards −x, around the −x end, back along z = +r and around the +x end —
 * the same sense as the circles of `layout`.
 */
function stadiumPoint(s: number, half: number, r: number): [number, number] {
  const perimeter = 4 * half + 2 * Math.PI * r;
  if (!(perimeter > 1e-9)) return [0, 0];
  let t = ((s % perimeter) + perimeter) % perimeter;
  if (t < 2 * half) return [half - t, -r];
  t -= 2 * half;
  if (t < Math.PI * r) return [-half - r * Math.sin(t / r), -r * Math.cos(t / r)];
  t -= Math.PI * r;
  if (t < 2 * half) return [-half + t, r];
  t -= 2 * half;
  return r > 1e-9 ? [half + r * Math.sin(t / r), r * Math.cos(t / r)] : [half, 0];
}

/**
 * Initial positions: rounds on circles around the Y axis whose circumference is the row's
 * width in stitches × stitch width, stacked so that consecutive rounds are one stitch height
 * apart along the surface; rows as a flat grid in the XY plane, turning at each row. A round
 * worked around a foundation chain and the closed rounds after it lie on stadiums (ovals)
 * around the chain instead, which runs along X.
 */
function layout(nodes: StitchNode[], rows: GraphRow[], g: ResolvedGauge): Float64Array {
  const w = g.stitchWidthMm;
  const pos = new Float64Array(nodes.length * 3);
  const set = (id: number, x: number, y: number, z: number) => {
    pos[3 * id] = x;
    pos[3 * id + 1] = y;
    pos[3 * id + 2] = z;
  };
  let prevRadius: number | null = null; // radius of the previous round, null after a flat row
  let baseY = 0; // y of the previous row
  let placedAny = false;
  // Oval rounds (worked around a chain, and the closed rounds after it): the straight part of
  // their stadium, centred at `cx` along X; `sgn` mirrors it for a chain laid out towards −X.
  let oval: { cx: number; half: number; sgn: 1 | -1 } | null = null;

  rows.forEach((row, rowIndex) => {
    const ids: number[] = [];
    for (let id = row.firstNode; id < row.firstNode + row.nodeCount; id++) ids.push(id);
    const real = ids.filter((id) => !nodes[id]!.lift && nodes[id]!.code !== "MR");
    const lifts = ids.filter((id) => nodes[id]!.lift);
    const heights = real.map((id) => nodes[id]!.height).filter((h) => h > 0);
    const hv = heights.length > 0 ? heights.reduce((s, h) => s + h, 0) / heights.length : g.stitchHeightMm;

    if (row.kind === "chain") {
      let x = 0;
      let y = baseY;
      if (placedAny && row.firstNode > 0) {
        x = pos[3 * (row.firstNode - 1)]! + row.direction * w;
        y = pos[3 * (row.firstNode - 1) + 1]!;
      }
      ids.forEach((id, i) => set(id, x + row.direction * i * w, y, 0));
      baseY = y;
      prevRadius = null;
      oval = null;
    } else if (row.around || (oval && row.closed && row.kind !== "ring")) {
      // A stadium around the chain: its straight part spans the chains worked into.
      let r0 = prevRadius ?? 0;
      if (row.around) {
        let xmin = Infinity;
        let xmax = -Infinity;
        for (const id of real) {
          for (const p of nodes[id]!.parents) {
            xmin = Math.min(xmin, pos[3 * p]!);
            xmax = Math.max(xmax, pos[3 * p]!);
          }
        }
        if (!Number.isFinite(xmin)) xmin = xmax = pos[3 * (row.firstNode - 1)]!;
        oval = { cx: (xmin + xmax) / 2, half: (xmax - xmin) / 2, sgn: rows[rowIndex - 1]!.direction };
        r0 = 0;
      }
      const o = oval!;
      const S = Math.max(1, row.widthStitches);
      const C = S * w;
      // A round too short for the straight part shortens it (keeping a small turn radius).
      const half = Math.max(0, Math.min(o.half, (C - 2 * Math.PI * 0.25 * w) / 4));
      const r = Math.max(0, (C - 4 * half) / (2 * Math.PI));
      const y0 = placedAny ? baseY : 0;
      const dR = r - r0;
      const dy = Math.sqrt(Math.max(0, hv * hv - dR * dR));
      const place = (id: number, s: number, t = 1) => {
        const [lx, lz] = stadiumPoint(s, half, r * t);
        set(id, o.cx + o.sgn * lx, y0 + dy * t, o.sgn * lz);
      };
      let cum = 0;
      for (const id of real) {
        const n = nodes[id]!;
        place(id, (cum + n.span / 2) * w);
        cum += n.span;
      }
      lifts.forEach((id, i) => place(id, 0, (i + 1) / (lifts.length + 1)));
      baseY = y0 + dy;
      prevRadius = r;
    } else if (row.type === "round" || row.kind === "ring") {
      oval = null;
      const S = Math.max(1, row.widthStitches);
      const R = (S * w) / (2 * Math.PI);
      let y0 = placedAny ? baseY : 0;
      let r0 = prevRadius ?? R;
      if (row.kind === "ring") {
        if (placedAny) y0 = baseY + hv;
        r0 = 0;
      }
      const dR = R - r0;
      const dy = Math.sqrt(Math.max(0, hv * hv - dR * dR));
      const y = y0 + dy;
      let cum = 0;
      for (const id of real) {
        const n = nodes[id]!;
        const phi = (2 * Math.PI * (cum + n.span / 2)) / S;
        cum += n.span;
        set(id, R * Math.cos(phi), y, -R * Math.sin(phi));
      }
      for (const id of ids) if (nodes[id]!.code === "MR") set(id, 0, y0, 0);
      lifts.forEach((id, i) => {
        const t = (i + 1) / (lifts.length + 1);
        set(id, r0 + (R - r0) * t, y0 + dy * t, 0);
      });
      baseY = y;
      prevRadius = R;
    } else {
      // Flat row: start above the first anchor this row works into, then step along the row.
      let x0 = 0;
      const firstConsumer = real.find((id) => nodes[id]!.parents.length > 0);
      if (firstConsumer !== undefined) x0 = pos[3 * nodes[firstConsumer]!.parents[0]!]!;
      else if (row.firstNode > 0) x0 = pos[3 * (row.firstNode - 1)]!;
      const y0 = placedAny ? baseY : 0;
      let x = x0;
      real.forEach((id, i) => {
        const n = nodes[id]!;
        if (i > 0) x += row.direction * ((nodes[real[i - 1]!]!.span + n.span) / 2) * w;
        set(id, x, y0 + (n.height > 0 ? n.height : hv), 0);
      });
      // Leading lifts climb from the previous row at the row start; trailing lifts climb from
      // this row at its end, towards the next row.
      const firstReal = real.length > 0 ? real[0]! : Infinity;
      const leading = lifts.filter((id) => id < firstReal);
      const trailing = lifts.filter((id) => id > firstReal);
      leading.forEach((id, i) => set(id, x0, y0 + (hv * (i + 1)) / (leading.length + 1), 0));
      trailing.forEach((id, i) => set(id, x, y0 + hv + (hv * (i + 1)) / (trailing.length + 1), 0));
      for (const id of ids) {
        if (nodes[id]!.code === "MR") set(id, x0, y0, 0);
      }
      baseY = y0 + hv;
      prevRadius = null;
      oval = null;
    }
    placedAny = true;
  });
  return pos;
}

/** Node range of a row, or `null` when the row has no nodes (free instruction, empty row). */
export function nodesOfRow(graph: StitchGraph, rowId: string): { first: NodeId; count: number } | null {
  const row = graph.rows.find((r) => r.rowId === rowId);
  return row ? { first: row.firstNode, count: row.nodeCount } : null;
}
