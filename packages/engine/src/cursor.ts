/**
 * Cursor → node: maps TellmeCrochet's guided-mode position to the stitch graph node, so the
 * model can mark "you are here".
 *
 * TellmeCrochet's cursor is `{ rowId, offset }` where `offset` is the number of atomic
 * stitches already completed in the row — the 0-based index of the NEXT stitch to work — and
 * ranges over `[0, rowLength]`; `offset === rowLength` means the row is done. Offsets are
 * clamped to that range (as TellmeCrochet does for stale cursors).
 */

import type { NodeId, StitchGraph } from "./graph.js";

export interface StitchCursor {
  rowId: string;
  /** Stitches completed in the row = index of the next stitch (`expandRow(row)[offset]`). */
  offset: number;
}

/**
 * Node to mark for the cursor:
 *   - `offset` in `[0, rowLength)`: the next stitch to work (`expandRow(row)[offset]`);
 *   - `offset >= rowLength` (row done): the row's last stitch — the one just finished;
 *   - negative offsets are clamped to the row's first stitch.
 * `null` when there is no stitch to mark: unknown row, a free instruction (NOTE) or empty
 * row (no nodes), or an offset that is not a finite number.
 */
export function nodeForCursor(graph: StitchGraph, cursor: StitchCursor): NodeId | null {
  if (!Number.isFinite(cursor.offset)) return null;
  const row = graph.rows.find((r) => r.rowId === cursor.rowId);
  if (!row || row.nodeCount === 0) return null;
  const offset = Math.min(row.nodeCount - 1, Math.max(0, Math.floor(cursor.offset)));
  return row.firstNode + offset;
}
