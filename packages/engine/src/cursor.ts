/**
 * Cursor → node: maps TellmeCrochet's guided-mode position (row id + index of the atomic
 * stitch within that row, as in `expandRow(row)`) to the stitch graph node, so the model can
 * mark "you are here".
 */

import type { NodeId, StitchGraph } from "./graph.js";

export interface StitchCursor {
  rowId: string;
  /** 0-based index of the atomic stitch within the row (`expandRow(row)[offset]`). */
  offset: number;
}

/**
 * Node of the stitch under the cursor, or `null` when there is none: unknown row, a free
 * instruction (NOTE) or empty row (no nodes), or an offset outside the row.
 */
export function nodeForCursor(graph: StitchGraph, cursor: StitchCursor): NodeId | null {
  const row = graph.rows.find((r) => r.rowId === cursor.rowId);
  if (!row || !Number.isInteger(cursor.offset)) return null;
  if (cursor.offset < 0 || cursor.offset >= row.nodeCount) return null;
  const id = row.firstNode + cursor.offset;
  // Nodes are created one per atom of the row, so the offset maps directly; check anyway.
  return graph.nodes[id]?.offset === cursor.offset ? id : null;
}
