import { describe, expect, it } from "vitest";
import type { Op, Row } from "@crochetbuilder/engine";
import { insertRounds, setRunLength } from "./actions.js";
import { emptyDocument } from "./document.js";
import {
  canUndo,
  currentPart,
  editorReducer,
  fanOut,
  followsActual,
  initEditorState,
  isAutoTarget,
  type EditorAction,
  type EditorState,
} from "./editor.js";
import { countLabel, groupRows, rangeLabel } from "./grouping.js";
import { ballStart } from "./snippets.js";

const sc = (count: number): Op => ({ kind: "stitch", code: "SC", count });
const inc = (count: number): Op => ({ kind: "stitch", code: "INC", count });
const mr: Op = { kind: "stitch", code: "MR", count: 1 };
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s);
const rows = (s: EditorState): Row[] => currentPart(s.doc).rows;
const row = (s: EditorState, id: string): Row => rows(s).find((r) => r.id === id)!;
const ids = (s: EditorState) => rows(s).map((r) => r.id);
const fresh = () => initEditorState(emptyDocument("r1"));
const stitchRow = (id: string, ops: Op[], target: number, extra: Partial<Row> = {}): Row => ({
  id,
  type: "round",
  ops,
  stitchCountTarget: target,
  ...extra,
});

/** A part with the given rows. */
function withRows(list: Row[], pinned: string[] = []): EditorState {
  const doc = emptyDocument("x");
  doc.parts[0]!.content.rows = list;
  return initEditorState(doc, pinned);
}

describe("Soll follows Ist", () => {
  it("follows while automatic, stays when typed, and follows from 0", () => {
    let s = run(fresh(), { type: "setRowOps", rowId: "r1", ops: [mr, sc(6)] });
    expect(row(s, "r1").stitchCountTarget).toBe(6);
    expect(isAutoTarget(row(s, "r1"), s.pinned)).toBe(true);
    s = run(s, { type: "setRowOps", rowId: "r1", ops: [mr, sc(8)] });
    expect(row(s, "r1").stitchCountTarget).toBe(8);

    // A typed Soll is kept and checked.
    s = run(s, { type: "setTarget", rowId: "r1", target: 9 });
    expect(isAutoTarget(row(s, "r1"), s.pinned)).toBe(false);
    s = run(s, { type: "setRowOps", rowId: "r1", ops: [mr, sc(9)] });
    expect(isAutoTarget(row(s, "r1"), s.pinned)).toBe(false); // equal, but typed
    s = run(s, { type: "setRowOps", rowId: "r1", ops: [mr, sc(7)] });
    expect(row(s, "r1").stitchCountTarget).toBe(9);

    // A Soll of 0 (imported row without a declared count) follows even when pinned.
    const zero = withRows([stitchRow("a", [sc(5)], 0)], ["a"]);
    expect(followsActual(row(zero, "a"), zero.pinned)).toBe(true);
    expect(row(run(zero, { type: "setRowOps", rowId: "a", ops: [sc(6)] }), "a").stitchCountTarget).toBe(6);
  });

  it("goes back to automatic when unpinned", () => {
    let s = run(fresh(), { type: "setRowOps", rowId: "r1", ops: [sc(6)], target: 7 });
    expect(s.pinned).toEqual(["r1"]);
    s = run(s, { type: "unpinTarget", rowId: "r1" });
    expect(s.pinned).toEqual([]);
    expect(row(s, "r1").stitchCountTarget).toBe(6);
    expect(isAutoTarget(row(s, "r1"), s.pinned)).toBe(true);
    expect(run(s, { type: "unpinTarget", rowId: "nope" })).toBe(s);
  });
});

describe("batch", () => {
  it("applies several edits as one undo step", () => {
    const s0 = withRows([stitchRow("a", [sc(6)], 6), stitchRow("b", [sc(6)], 6)]);
    const s = run(s0, fanOut({ type: "setRowOps", rowId: "a", ops: [sc(8)] }, ["a", "b"]));
    expect(rows(s).map((r) => r.stitchCountTarget)).toEqual([8, 8]);
    expect(s.past).toHaveLength(1);
    expect(rows(run(s, { type: "undo" })).map((r) => r.stitchCountTarget)).toEqual([6, 6]);
    // A batch that changes nothing is no step; undo/redo inside are ignored.
    expect(run(s0, { type: "batch", actions: [{ type: "undo" }, { type: "setTarget", rowId: "a", target: 6 }] })).toBe(s0);
  });

  it("fans out row edits only, and coalesces typing into a group field", () => {
    const other: EditorAction = { type: "setTitle", title: "x" };
    expect(fanOut(other, ["a", "b"])).toBe(other);
    const single: EditorAction = { type: "setTarget", rowId: "a", target: 3 };
    expect(fanOut(single, ["a"])).toBe(single);
    const s0 = withRows([stitchRow("a", [sc(6)], 6), stitchRow("b", [sc(6)], 6)]);
    const s = run(
      s0,
      fanOut({ type: "setTarget", rowId: "a", target: 1 }, ["a", "b"]),
      fanOut({ type: "setTarget", rowId: "a", target: 12 }, ["a", "b"]),
    );
    expect(rows(s).map((r) => r.stitchCountTarget)).toEqual([12, 12]);
    expect(s.past).toHaveLength(1);
    expect(s.pinned).toEqual(["a", "b"]);
  });
});

describe("inserting rows", () => {
  it("inserts snippet rounds after a row, as one undo step", () => {
    const s0 = withRows([stitchRow("a", [mr, sc(6)], 6), stitchRow("b", [inc(6)], 12)]);
    const action = insertRounds("a", ballStart(18).slice(1));
    const s = run(s0, action);
    expect(ids(s)).toEqual(["a", action.rows[0]!.id, action.rows[1]!.id, "b"]);
    expect(rows(s).map((r) => r.stitchCountTarget)).toEqual([6, 12, 18, 12]);
    expect(s.past).toHaveLength(1);
    expect(run(s, { type: "undo" }).doc).toBe(s0.doc);
  });

  it("replaces an empty row being written and appends at the end without an anchor", () => {
    const s = run(fresh(), insertRounds(null, ballStart(12)));
    expect(rows(s).map((r) => r.stitchCountTarget)).toEqual([6, 12]);
    expect(ids(s)).not.toContain("r1");
    // An instruction is kept.
    const note = withRows([stitchRow("n", [], 0, { note: "Füllen" })]);
    expect(rows(run(note, insertRounds("n", ballStart(6))))).toHaveLength(2);
  });

  it("refuses duplicate or used ids and empty inserts", () => {
    const s0 = withRows([stitchRow("a", [sc(6)], 6)]);
    expect(run(s0, { type: "insertRows", afterId: "a", rows: [] })).toBe(s0);
    expect(run(s0, { type: "insertRows", afterId: "a", rows: [stitchRow("a", [sc(1)], 1)] })).toBe(s0);
    const twice = stitchRow("n", [sc(1)], 1);
    expect(run(s0, { type: "insertRows", afterId: "a", rows: [twice, twice] })).toBe(s0);
  });
});

describe("run length (Runde ×N)", () => {
  const base = () =>
    withRows([stitchRow("a", [sc(6)], 6), stitchRow("b", [sc(12)], 12), stitchRow("c", [sc(12)], 12), stitchRow("z", [sc(6)], 6)], [
      "b",
    ]);

  it("adds copies of the first row after the run", () => {
    const s = run(base(), { type: "setRunLength", rowIds: ["b", "c"], length: 4, newIds: ["n1", "n2", "unused"] });
    expect(ids(s)).toEqual(["a", "b", "c", "n1", "n2", "z"]);
    expect(row(s, "n2")).toEqual({ ...row(s, "b"), id: "n2" });
    expect(s.pinned).toEqual(["b", "n1", "n2"]);
    expect(s.past).toHaveLength(1);
  });

  it("removes rows at the end of the run", () => {
    const s = run(base(), { type: "setRunLength", rowIds: ["b", "c"], length: 1, newIds: [] });
    expect(ids(s)).toEqual(["a", "b", "z"]);
  });

  it("refuses runs that are not consecutive, bad lengths and missing ids", () => {
    const s0 = base();
    expect(run(s0, { type: "setRunLength", rowIds: ["a", "c"], length: 3, newIds: ["n"] })).toBe(s0);
    expect(run(s0, { type: "setRunLength", rowIds: ["b"], length: 0, newIds: [] })).toBe(s0);
    expect(run(s0, { type: "setRunLength", rowIds: ["b"], length: 1, newIds: [] })).toBe(s0);
    expect(run(s0, { type: "setRunLength", rowIds: ["b"], length: 3, newIds: ["n"] })).toBe(s0);
    expect(run(s0, { type: "setRunLength", rowIds: ["b"], length: 2, newIds: ["a"] })).toBe(s0);
    expect(run(s0, { type: "setRunLength", rowIds: [], length: 2, newIds: ["n"] })).toBe(s0);
  });

  it("the action creator brings exactly the missing ids", () => {
    expect(setRunLength(["a"], 4).newIds).toHaveLength(3);
    expect(setRunLength(["a", "b", "c"], 2).newIds).toHaveLength(0);
    const s = run(base(), setRunLength(["a"], 3));
    expect(rows(s).filter((r) => r.stitchCountTarget === 6)).toHaveLength(4);
    expect(canUndo(s)).toBe(true);
  });
});

describe("grouping", () => {
  const list = [
    stitchRow("1", [mr, sc(6)], 6),
    stitchRow("2", [sc(6)], 6),
    stitchRow("3", [sc(6)], 6),
    stitchRow("4", [sc(6)], 6),
    stitchRow("n", [], 0, { note: "Füllen" }),
    stitchRow("5", [sc(6)], 6),
    stitchRow("6", [sc(6)], 6, { label: "Hals" }),
    stitchRow("7", [sc(6)], 6),
    stitchRow("8", [sc(6)], 7),
    stitchRow("e1", [], 0),
    stitchRow("e2", [], 0),
  ];

  it("groups consecutive identical stitch rows only", () => {
    const items = groupRows(list);
    expect(items.map((i) => i.rows.map((r) => r.id))).toEqual([
      ["1"],
      ["2", "3", "4"],
      ["n"],
      ["5"],
      ["6"],
      ["7"],
      ["8"],
      ["e1"],
      ["e2"],
    ]);
    expect(items.map((i) => i.start)).toEqual([0, 1, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("split rows stay single", () => {
    expect(groupRows(list, new Set(["3"])).map((i) => i.rows.length).slice(0, 4)).toEqual([1, 1, 1, 1]);
    expect(groupRows(list, new Set(["4"])).map((i) => i.rows.length).slice(0, 3)).toEqual([1, 2, 1]);
  });

  it("rows with different findings never share a card", () => {
    const findings = new Map([["3", [{ rowId: "3", severity: "warning", code: "CONSUMES_UNDERFLOW", message: "", expected: 9, actual: 6 } as const]]]);
    expect(groupRows(list, new Set(), findings).map((i) => i.rows.length).slice(0, 4)).toEqual([1, 1, 1, 1]);
  });

  it("labels ranges and counts", () => {
    expect(rangeLabel("Runde 7", "Runde 12")).toBe("Runde 7–12");
    expect(rangeLabel("Runde 7", "Runde 7")).toBe("Runde 7");
    expect(rangeLabel("Reihe 2", "Runde 3")).toBe("Reihe 2 – Runde 3");
    expect(countLabel(6, "round")).toBe("6 Runden");
    expect(countLabel(1, "round")).toBe("1 Runde");
    expect(countLabel(2, "row")).toBe("2 Reihen");
    expect(countLabel(1, "row")).toBe("1 Reihe");
  });
});
