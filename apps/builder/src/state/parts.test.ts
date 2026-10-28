import { describe, expect, it } from "vitest";
import { BuilderExportSchema, type Op } from "@crochetbuilder/engine";
import { addPart, duplicatePart } from "./actions.js";
import { emptyDocument } from "./document.js";
import {
  MAX_PART_QUANTITY,
  MAX_PARTS,
  canUndo,
  clampPart,
  editorReducer,
  initEditorState,
  nextPartName,
  selectedPart,
  type EditorAction,
  type EditorState,
} from "./editor.js";

const sc = (count: number): Op => ({ kind: "stitch", code: "SC", count });

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}
const names = (s: EditorState) => s.doc.parts.map((p) => p.name);
const rowIds = (s: EditorState, index = s.part) => s.doc.parts[index]!.content.rows.map((r) => r.id);

/** Three parts: "Teil 1" (r1, 6 sc), "Teil 2" (r2), "Teil 3" (r3); part 3 selected. */
function threeParts(): EditorState {
  return run(
    initEditorState(emptyDocument("r1")),
    { type: "setRowOps", rowId: "r1", ops: [sc(6)] },
    { type: "addPart", rowId: "r2" },
    { type: "addPart", rowId: "r3" },
  );
}

describe("parts", () => {
  it("adds a part 'Teil n' with one empty round and shows it", () => {
    const s = threeParts();
    expect(names(s)).toEqual(["Teil 1", "Teil 2", "Teil 3"]);
    expect(s.part).toBe(2);
    expect(s.doc.parts[2]).toEqual({
      name: "Teil 3",
      quantity: 1,
      content: { schemaVersion: 1, rows: [{ id: "r3", type: "round", ops: [], stitchCountTarget: 0 }] },
    });
    expect(BuilderExportSchema.safeParse(s.doc).success).toBe(true);
    // A new name never repeats one in use.
    const renamed = run(s, { type: "renamePart", index: 0, name: "Teil 4" });
    expect(nextPartName(renamed.doc)).toBe("Teil 5");
    // addPart() makes a fresh row id each time.
    expect(addPart().rowId).not.toBe(addPart().rowId);
  });

  it("refuses a part whose row id is in use, and more than MAX_PARTS parts", () => {
    const s = threeParts();
    expect(run(s, { type: "addPart", rowId: "r1" })).toBe(s);
    let many = initEditorState(emptyDocument("x0"));
    for (let i = 1; i < MAX_PARTS + 5; i++) many = run(many, { type: "addPart", rowId: `x${i}` });
    expect(many.doc.parts).toHaveLength(MAX_PARTS);
  });

  it("selects parts (clamped) without an undo step; row edits go to the shown part", () => {
    let s = threeParts();
    const history = s.past.length;
    s = run(s, { type: "selectPart", index: 0 });
    expect(s.part).toBe(0);
    expect(s.past).toHaveLength(history);
    expect(run(s, { type: "selectPart", index: 99 }).part).toBe(2);
    expect(run(s, { type: "selectPart", index: -3 }).part).toBe(0);
    expect(run(s, { type: "selectPart", index: 0 })).toBe(s);

    s = run(s, { type: "addRow", id: "r1b" });
    expect(rowIds(s, 0)).toEqual(["r1", "r1b"]);
    // An edit addressed by row id lands in that row's part, whichever part is shown.
    s = run(s, { type: "selectPart", index: 1 }, { type: "setRowOps", rowId: "r3", ops: [sc(4)] });
    expect(s.doc.parts[2]!.content.rows[0]!.ops).toEqual([sc(4)]);
    expect(s.part).toBe(1);
    // Adding after a row of another part adds in that part.
    s = run(s, { type: "addRow", id: "r3b", afterId: "r3" });
    expect(rowIds(s, 2)).toEqual(["r3", "r3b"]);
    expect(rowIds(s, 1)).toEqual(["r2"]);
  });

  it("renames a part; typing the name is one undo step", () => {
    let s = run(threeParts(), { type: "endTyping" });
    const before = s.past.length;
    s = run(s, { type: "renamePart", index: 1, name: "K" }, { type: "renamePart", index: 1, name: "Kopf" });
    expect(names(s)).toEqual(["Teil 1", "Kopf", "Teil 3"]);
    expect(s.past).toHaveLength(before + 1);
    expect(run(s, { type: "renamePart", index: 1, name: "Kopf" })).toBe(s);
    expect(names(run(s, { type: "undo" }))).toEqual(["Teil 1", "Teil 2", "Teil 3"]);
  });

  it("sets the quantity: whole numbers from 1 to MAX_PART_QUANTITY", () => {
    let s = run(threeParts(), { type: "setPartQuantity", index: 0, quantity: 2 });
    expect(s.doc.parts[0]!.quantity).toBe(2);
    for (const bad of [0, -1, 1.5, Number.NaN, MAX_PART_QUANTITY + 1]) {
      expect(run(s, { type: "setPartQuantity", index: 0, quantity: bad })).toBe(s);
    }
    s = run(s, { type: "setPartQuantity", index: 0, quantity: MAX_PART_QUANTITY });
    expect(s.doc.parts[0]!.quantity).toBe(MAX_PART_QUANTITY);
  });

  it("duplicates a part with fresh row ids and '(Kopie)', right after it, and shows the copy", () => {
    let s = run(threeParts(), { type: "renamePart", index: 0, name: "Bein" }, { type: "setPartQuantity", index: 0, quantity: 2 });
    s = run(s, { type: "adoptTarget", rowId: "r1" }); // pinned
    s = run(s, { type: "duplicatePart", index: 0, rowIds: ["c1"] });
    expect(names(s)).toEqual(["Bein", "Bein (Kopie)", "Teil 2", "Teil 3"]);
    expect(s.part).toBe(1);
    const [original, copy] = s.doc.parts;
    expect(copy!.quantity).toBe(2);
    expect(copy!.content.rows.map((r) => r.id)).toEqual(["c1"]);
    expect(copy!.content.rows[0]!.ops).toEqual(original!.content.rows[0]!.ops);
    expect(copy!.content.rows[0]!.ops).not.toBe(original!.content.rows[0]!.ops);
    expect(s.pinned).toEqual(["r1", "c1"]);
    // Editing the copy leaves the original alone.
    s = run(s, { type: "setRowOps", rowId: "c1", ops: [sc(8)] });
    expect(s.doc.parts[0]!.content.rows[0]!.ops).toEqual([sc(6)]);

    // Wrong id lists are refused: count mismatch, duplicates, ids in use.
    expect(run(s, { type: "duplicatePart", index: 0, rowIds: [] })).toBe(s);
    expect(run(s, { type: "duplicatePart", index: 0, rowIds: ["r2"] })).toBe(s);
    expect(run(s, { type: "duplicatePart", index: 9, rowIds: ["z"] })).toBe(s);

    // The action creator makes one fresh id per row.
    const action = duplicatePart(s.doc, 0);
    expect(action.type === "duplicatePart" && action.rowIds).toHaveLength(1);
    // An unnamed part is copied as "Teil n (Kopie)".
    const unnamed = run(s, { type: "renamePart", index: 2, name: "  " }, { type: "duplicatePart", index: 2, rowIds: ["c2"] });
    expect(unnamed.doc.parts[3]!.name).toBe("Teil 3 (Kopie)");
  });

  it("deletes a part (never the last one) and undo brings it back in view", () => {
    let s = run(threeParts(), { type: "setTarget", rowId: "r2", target: 0 }, { type: "selectPart", index: 1 });
    s = run(s, { type: "setTarget", rowId: "r2", target: 3 });
    expect(s.pinned).toContain("r2");
    s = run(s, { type: "deletePart", index: 1 });
    expect(names(s)).toEqual(["Teil 1", "Teil 3"]);
    expect(s.part).toBe(1); // the next part moved into its place
    expect(s.pinned).not.toContain("r2");

    s = run(s, { type: "selectPart", index: 0 }, { type: "undo" });
    expect(names(s)).toEqual(["Teil 1", "Teil 2", "Teil 3"]);
    expect(s.part).toBe(1);
    expect(s.pinned).toContain("r2");
    s = run(s, { type: "redo" });
    expect(names(s)).toEqual(["Teil 1", "Teil 3"]);
    expect(s.part).toBe(1);

    // Deleting the last part in the list shows the one before it.
    s = run(s, { type: "deletePart", index: 1 });
    expect(names(s)).toEqual(["Teil 1"]);
    expect(s.part).toBe(0);
    // The only part stays.
    expect(run(s, { type: "deletePart", index: 0 })).toBe(s);
  });

  it("deleting a part before the shown one keeps showing the same part", () => {
    let s = run(threeParts(), { type: "deletePart", index: 0 });
    expect(names(s)).toEqual(["Teil 2", "Teil 3"]);
    expect(s.part).toBe(1);
    expect(selectedPart(s).rows[0]!.id).toBe("r3");
  });

  it("moves parts; the shown part stays in view at its new place", () => {
    let s = threeParts(); // shows Teil 3
    s = run(s, { type: "movePart", index: 2, delta: -1 });
    expect(names(s)).toEqual(["Teil 1", "Teil 3", "Teil 2"]);
    expect(s.part).toBe(1);
    expect(run(s, { type: "movePart", index: 0, delta: -1 })).toBe(s);
    expect(run(s, { type: "movePart", index: 2, delta: 1 })).toBe(s);
    // Moving another part past the shown one.
    s = run(s, { type: "movePart", index: 0, delta: 2 });
    expect(names(s)).toEqual(["Teil 3", "Teil 2", "Teil 1"]);
    expect(names(s)[s.part]).toBe("Teil 3");
    s = run(s, { type: "undo" }, { type: "undo" });
    expect(names(s)).toEqual(["Teil 1", "Teil 2", "Teil 3"]);
    expect(names(s)[s.part]).toBe("Teil 3");
  });

  it("undo shows the part an edit was made in; redo of 'add part' shows the new part", () => {
    let s = threeParts();
    s = run(s, { type: "selectPart", index: 0 }, { type: "setRowOps", rowId: "r1", ops: [sc(9)] });
    s = run(s, { type: "selectPart", index: 2 });
    s = run(s, { type: "undo" });
    expect(s.part).toBe(0);
    expect(s.doc.parts[0]!.content.rows[0]!.ops).toEqual([sc(6)]);

    // Undo both added parts: back to one part, the index is clamped.
    s = run(s, { type: "undo" }, { type: "undo" });
    expect(s.doc.parts).toHaveLength(1);
    expect(s.part).toBe(0);
    s = run(s, { type: "redo" });
    expect(s.doc.parts).toHaveLength(2);
    expect(s.part).toBe(1);
    // Document-wide edits keep the shown part.
    s = run(s, { type: "selectPart", index: 0 }, { type: "setTitle", title: "Hase" }, { type: "selectPart", index: 1 }, { type: "undo" });
    expect(s.doc.title).toBe("");
    expect(s.part).toBe(1);
  });

  it("replacing the document shows its first part; undo returns to the part shown before", () => {
    let s = threeParts();
    s = run(s, { type: "replaceDocument", doc: emptyDocument("n1") });
    expect(s.part).toBe(0);
    s = run(s, { type: "undo" });
    expect(s.doc.parts).toHaveLength(3);
    expect(s.part).toBe(2);
    expect(canUndo(s)).toBe(true);
  });

  it("hydrate restores the shown part, clamped", () => {
    const doc = threeParts().doc;
    expect(run(initEditorState(emptyDocument()), { type: "hydrate", doc, part: 1 }).part).toBe(1);
    expect(run(initEditorState(emptyDocument()), { type: "hydrate", doc, part: 7 }).part).toBe(2);
    expect(run(initEditorState(emptyDocument()), { type: "hydrate", doc }).part).toBe(0);
    expect(clampPart(doc, Number.NaN)).toBe(0);
  });
});
