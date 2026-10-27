import { describe, it, expect } from "vitest";
import { nodeForCursor } from "./cursor.js";
import { buildGraph } from "./graph.js";
import { expandRow } from "./expand.js";
import type { Op, PartContent, Row, StitchCode } from "./schema.js";

const st = (code: StitchCode, count = 1): Op => ({ kind: "stitch", code, count });
const row = (id: string, ops: Op[], t: number, extra: Partial<Row> = {}): Row => ({
  id,
  type: "round",
  ops,
  stitchCountTarget: t,
  ...extra,
});

const CONTENT: PartContent = {
  schemaVersion: 1,
  rows: [
    row("r1", [st("MR"), st("SC", 6)], 6),
    row("r2", [st("INC", 6)], 12),
    row("note", [], 12, { note: "Insert safety eyes" }),
    row("r3", [{ kind: "repeat", times: 6, ops: [st("SC"), st("INC")] }], 18),
  ],
};

describe("nodeForCursor", () => {
  const g = buildGraph(CONTENT);

  it("maps row id + atom offset to the node", () => {
    expect(nodeForCursor(g, { rowId: "r1", offset: 0 })).toBe(0); // the magic ring
    expect(g.nodes[nodeForCursor(g, { rowId: "r1", offset: 1 })!]!.code).toBe("SC");
    expect(nodeForCursor(g, { rowId: "r2", offset: 5 })).toBe(12);
    expect(nodeForCursor(g, { rowId: "r3", offset: 0 })).toBe(13);
  });

  it("round-trips every node and agrees with expandRow", () => {
    for (const n of g.nodes) {
      expect(nodeForCursor(g, { rowId: n.rowId, offset: n.offset })).toBe(n.id);
      const r = CONTENT.rows.find((x) => x.id === n.rowId)!;
      expect(expandRow(r)[n.offset]!.code).toBe(n.code);
    }
  });

  it("returns null where there is no stitch", () => {
    expect(nodeForCursor(g, { rowId: "note", offset: 0 })).toBeNull(); // free instruction
    expect(nodeForCursor(g, { rowId: "nope", offset: 0 })).toBeNull();
    expect(nodeForCursor(g, { rowId: "r2", offset: 6 })).toBeNull();
    expect(nodeForCursor(g, { rowId: "r2", offset: -1 })).toBeNull();
    expect(nodeForCursor(g, { rowId: "r2", offset: 1.5 })).toBeNull();
  });
});
