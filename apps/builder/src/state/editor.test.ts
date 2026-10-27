import { describe, expect, it } from "vitest";
import { BuilderExportSchema, validate, type Op, type Row } from "@crochetbuilder/engine";
import { demoDocument, emptyDocument, newId } from "./document.js";
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  currentPart,
  editorReducer,
  initEditorState,
  type EditorAction,
  type EditorState,
} from "./editor.js";
import { addRow, duplicateRow, loadDemo, newDocument } from "./actions.js";
import { findingMessage, parseErrorMessage } from "./messages.js";
import { parseStored } from "./storage.js";
import { parseRowText } from "@crochetbuilder/engine";

const sc = (count: number): Op => ({ kind: "stitch", code: "SC", count });
const inc = (count: number): Op => ({ kind: "stitch", code: "INC", count });
const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}
const rows = (s: EditorState): Row[] => currentPart(s.doc).rows;
const row = (s: EditorState, id: string): Row => rows(s).find((r) => r.id === id)!;
const fresh = () => initEditorState(emptyDocument("r1"));

describe("documents", () => {
  it("empty and demo documents are valid builder exports", () => {
    expect(BuilderExportSchema.safeParse(emptyDocument("x")).success).toBe(true);
    const demo = demoDocument();
    expect(BuilderExportSchema.safeParse(demo).success).toBe(true);
    expect(currentPart(demo).rows).toHaveLength(8);
    expect(validate(currentPart(demo))).toEqual([]);
  });

  it("creates distinct uuid row ids", () => {
    const ids = new Set(currentPart(demoDocument()).rows.map((r) => r.id));
    expect(ids.size).toBe(8);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newId()).not.toBe(newId());
  });
});

describe("rows", () => {
  it("adds rows at the end or after a given row, inheriting the type", () => {
    let s = run(fresh(), { type: "updateRow", rowId: "r1", patch: { type: "row" } });
    s = run(s, { type: "addRow", id: "r2" }, { type: "addRow", id: "r3", afterId: "r1" });
    expect(rows(s).map((r) => r.id)).toEqual(["r1", "r3", "r2"]);
    expect(row(s, "r3")).toEqual({ id: "r3", type: "row", ops: [], stitchCountTarget: 0 });
  });

  it("adds free instruction rows with a note only", () => {
    const s = run(fresh(), { type: "addRow", id: "n1", instruction: true }, {
      type: "updateRow",
      rowId: "n1",
      patch: { note: "Sicherheitsaugen einsetzen" },
    });
    expect(row(s, "n1")).toEqual({ id: "n1", type: "round", ops: [], stitchCountTarget: 0, note: "Sicherheitsaugen einsetzen" });
    expect(validate(currentPart(s.doc))).toEqual([]);
  });

  it("deletes, moves and duplicates rows with stable ids", () => {
    let s = run(
      fresh(),
      { type: "setRowOps", rowId: "r1", ops: [sc(6)] },
      { type: "addRow", id: "r2" },
      { type: "addRow", id: "r3" },
    );
    s = run(s, { type: "moveRow", rowId: "r3", delta: -2 });
    expect(rows(s).map((r) => r.id)).toEqual(["r3", "r1", "r2"]);
    s = run(s, { type: "moveRow", rowId: "r3", delta: -1 });
    expect(rows(s).map((r) => r.id)).toEqual(["r3", "r1", "r2"]);
    s = run(s, { type: "duplicateRow", rowId: "r1", newId: "r1b" });
    expect(rows(s).map((r) => r.id)).toEqual(["r3", "r1", "r1b", "r2"]);
    expect(row(s, "r1b").ops).toEqual(row(s, "r1").ops);
    expect(row(s, "r1b").ops).not.toBe(row(s, "r1").ops);
    s = run(s, { type: "deleteRow", rowId: "r3" });
    expect(rows(s).map((r) => r.id)).toEqual(["r1", "r1b", "r2"]);
  });

  it("never regenerates ids on edit or reorder", () => {
    let s = initEditorState(demoDocument());
    const ids = rows(s).map((r) => r.id);
    s = run(
      s,
      { type: "moveRow", rowId: ids[0]!, delta: 3 },
      { type: "setRowOps", rowId: ids[1]!, ops: [sc(12)] },
      { type: "updateRow", rowId: ids[2]!, patch: { label: "Kopf", type: "row" } },
      { type: "updateStitch", rowId: ids[3]!, path: [0, 0], patch: { count: 3 } },
    );
    expect(new Set(rows(s).map((r) => r.id))).toEqual(new Set(ids));
  });

  it("sets and clears labels, notes and the row type", () => {
    let s = run(
      fresh(),
      { type: "setRowOps", rowId: "r1", ops: [sc(6)] },
      { type: "updateRow", rowId: "r1", patch: { label: "Boden", note: "fest anziehen", type: "row" } },
    );
    expect(row(s, "r1")).toMatchObject({ label: "Boden", note: "fest anziehen", type: "row" });
    s = run(s, { type: "updateRow", rowId: "r1", patch: { label: "", note: "" } });
    expect(row(s, "r1")).not.toHaveProperty("label");
    expect(row(s, "r1")).not.toHaveProperty("note");
  });

  it("action creators generate fresh ids", () => {
    const a = addRow("r1");
    const b = addRow("r1", true);
    expect(a.id).not.toBe(b.id);
    expect(b.instruction).toBe(true);
    const s = run(fresh(), a, duplicateRow("r1"));
    expect(new Set(rows(s).map((r) => r.id)).size).toBe(3);
  });
});

describe("ops", () => {
  it("edits stitch ops: code, count, modifiers", () => {
    let s = run(fresh(), { type: "setRowOps", rowId: "r1", ops: [sc(6)] });
    s = run(s, { type: "updateStitch", rowId: "r1", path: [0], patch: { code: "DC", count: 4, modifiers: ["BLO"] } });
    expect(row(s, "r1").ops).toEqual([{ kind: "stitch", code: "DC", count: 4, modifiers: ["BLO"] }]);
    s = run(s, { type: "updateStitch", rowId: "r1", path: [0], patch: { modifiers: [] } });
    expect(row(s, "r1").ops).toEqual([{ kind: "stitch", code: "DC", count: 4 }]);
    const unchanged = run(s, { type: "updateStitch", rowId: "r1", path: [0], patch: { count: 0 } });
    expect(unchanged).toBe(s);
  });

  it("builds nested repeat groups and unwraps them", () => {
    let s = run(
      fresh(),
      { type: "insertOp", rowId: "r1", path: [0], op: sc(1) },
      { type: "insertOp", rowId: "r1", path: [1], op: inc(1) },
      { type: "wrapInRepeat", rowId: "r1", path: [0], length: 2, times: 6 },
    );
    expect(row(s, "r1").ops).toEqual([rep(6, [sc(1), inc(1)])]);
    s = run(
      s,
      { type: "wrapInRepeat", rowId: "r1", path: [0, 1] },
      { type: "setRepeatTimes", rowId: "r1", path: [0, 1], times: 3 },
    );
    expect(row(s, "r1").ops).toEqual([rep(6, [sc(1), rep(3, [inc(1)])])]);
    s = run(s, { type: "unwrapRepeat", rowId: "r1", path: [0] });
    expect(row(s, "r1").ops).toEqual([sc(1), rep(3, [inc(1)])]);
    s = run(s, { type: "moveOp", rowId: "r1", path: [1], delta: -1 }, { type: "removeOp", rowId: "r1", path: [1] });
    expect(row(s, "r1").ops).toEqual([rep(3, [inc(1)])]);
    expect(run(s, { type: "setRepeatTimes", rowId: "r1", path: [0], times: 0 })).toBe(s);
  });

  it("free-text ops round-trip through the reducer", () => {
    const parsed = parseRowText("6× (1 fM, 1 Zun)", "de");
    if (!parsed.ok) throw new Error("parse failed");
    const s = run(fresh(), { type: "setRowOps", rowId: "r1", ops: parsed.ops });
    expect(row(s, "r1").ops).toEqual([rep(6, [sc(1), inc(1)])]);
  });
});

describe("Soll / Ist", () => {
  it("Soll follows Ist while it was never set explicitly", () => {
    let s = run(fresh(), { type: "setRowOps", rowId: "r1", ops: [sc(6)] });
    expect(row(s, "r1").stitchCountTarget).toBe(6);
    s = run(s, { type: "updateStitch", rowId: "r1", path: [0], patch: { count: 8 } });
    expect(row(s, "r1").stitchCountTarget).toBe(8);
  });

  it("an explicit Soll is pinned and mismatches are reported", () => {
    let s = run(fresh(), { type: "setTarget", rowId: "r1", target: 6 }, { type: "setRowOps", rowId: "r1", ops: [sc(5)] });
    expect(row(s, "r1").stitchCountTarget).toBe(6);
    expect(validate(currentPart(s.doc)).map((f) => f.code)).toContain("STITCH_COUNT_MISMATCH");
    s = run(s, { type: "adoptTarget", rowId: "r1" });
    expect(row(s, "r1").stitchCountTarget).toBe(5);
    s = run(s, { type: "updateStitch", rowId: "r1", path: [0], patch: { count: 6 } });
    expect(row(s, "r1").stitchCountTarget).toBe(5); // still pinned
  });

  it("a target from the free text pins the row", () => {
    let s = run(fresh(), { type: "setRowOps", rowId: "r1", ops: [sc(6)], target: 7 });
    expect(row(s, "r1").stitchCountTarget).toBe(7);
    expect(s.pinned).toEqual(["r1"]);
    s = run(s, { type: "setRowOps", rowId: "r1", ops: [sc(7)] });
    expect(row(s, "r1").stitchCountTarget).toBe(7);
  });

  it("demo rows are pinned; duplicates inherit the pin", () => {
    let s = run(fresh(), loadDemo());
    expect(s.pinned).toHaveLength(8);
    const first = rows(s)[0]!.id;
    s = run(s, { type: "duplicateRow", rowId: first, newId: "copy" });
    expect(s.pinned).toContain("copy");
    s = run(s, { type: "deleteRow", rowId: "copy" });
    expect(s.pinned).not.toContain("copy");
  });
});

describe("overview", () => {
  it("edits title, gauge, notes and materials", () => {
    let s = run(
      fresh(),
      { type: "setTitle", title: "Kugel" },
      { type: "setGauge", gauge: { yarnWeight: "dk", hookMm: 3.5, stitchesPer10cm: undefined } },
      { type: "setNotes", notes: "Spiralrunden" },
      { type: "addMaterial", material: { kind: "yarn", label: "Baumwolle" } },
      { type: "addMaterial", material: { kind: "hook", label: "3 mm" } },
      { type: "updateMaterial", index: 0, material: { kind: "yarn", label: "Baumwolle", colors: ["Rot"] } },
      { type: "removeMaterial", index: 1 },
    );
    expect(s.doc.title).toBe("Kugel");
    expect(s.doc.overview).toEqual({
      materials: [{ kind: "yarn", label: "Baumwolle", colors: ["Rot"] }],
      gauge: { yarnWeight: "dk", hookMm: 3.5 },
      notes: "Spiralrunden",
    });
    s = run(s, { type: "setGauge", gauge: { hookMm: Number.NaN } }, { type: "setNotes", notes: "" });
    expect(s.doc.overview).toEqual({ materials: [{ kind: "yarn", label: "Baumwolle", colors: ["Rot"] }] });
    expect(BuilderExportSchema.safeParse(s.doc).success).toBe(true);
  });
});

describe("undo / redo", () => {
  it("undoes and redoes document edits", () => {
    let s = run(fresh(), { type: "setRowOps", rowId: "r1", ops: [sc(6)] }, { type: "addRow", id: "r2" });
    expect(canUndo(s)).toBe(true);
    s = run(s, { type: "undo" });
    expect(rows(s).map((r) => r.id)).toEqual(["r1"]);
    s = run(s, { type: "undo" });
    expect(row(s, "r1").ops).toEqual([]);
    expect(canUndo(s)).toBe(false);
    expect(run(s, { type: "undo" })).toBe(s);
    s = run(s, { type: "redo" }, { type: "redo" });
    expect(rows(s).map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(canRedo(s)).toBe(false);
  });

  it("a new edit clears the redo stack", () => {
    let s = run(fresh(), { type: "addRow", id: "r2" }, { type: "undo" });
    expect(canRedo(s)).toBe(true);
    s = run(s, { type: "addRow", id: "r3" });
    expect(canRedo(s)).toBe(false);
  });

  it("typing into one field is one undo step", () => {
    let s = run(fresh(), { type: "setTitle", title: "K" }, { type: "setTitle", title: "Ku" }, { type: "setTitle", title: "Kugel" });
    expect(s.past).toHaveLength(1);
    s = run(s, { type: "addRow", id: "r2" }, { type: "setTitle", title: "Kugel 2" });
    expect(s.past).toHaveLength(3);
    s = run(s, { type: "undo" });
    expect(s.doc.title).toBe("Kugel");
  });

  it("no-op edits do not create history", () => {
    const s = fresh();
    expect(run(s, { type: "setTitle", title: "" })).toBe(s);
    expect(run(s, { type: "setRowOps", rowId: "r1", ops: [] })).toBe(s);
    expect(run(s, { type: "deleteRow", rowId: "nope" })).toBe(s);
  });

  it("Neu and Demo laden are undoable; hydrate resets history", () => {
    let s = run(fresh(), { type: "setTitle", title: "Meins" }, loadDemo());
    expect(s.doc.title).toBe("Amigurumi-Kugel");
    s = run(s, { type: "undo" });
    expect(s.doc.title).toBe("Meins");
    s = run(s, newDocument());
    expect(rows(s)).toHaveLength(1);
    s = run(s, { type: "hydrate", doc: demoDocument() });
    expect(canUndo(s)).toBe(false);
  });

  it("caps the history", () => {
    let s = fresh();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = run(s, { type: "addRow", id: `x${i}` });
    expect(s.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("messages", () => {
  it("translates findings and parse errors to German", () => {
    const r: Row = { id: "a", type: "round", ops: [], stitchCountTarget: 0 };
    expect(findingMessage({ rowId: "a", severity: "error", code: "STITCH_COUNT_MISMATCH", message: "", expected: 6, actual: 5 }, r)).toBe(
      "Maschenzahl stimmt nicht: Soll 6, Ist 5.",
    );
    expect(findingMessage({ rowId: "a", severity: "error", code: "CONSUMES_OVERFLOW", message: "", expected: 6, actual: 12 }, r)).toContain(
      "die Vorrunde hat nur 6",
    );
    expect(
      findingMessage({ rowId: "a", severity: "warning", code: "CONSUMES_UNDERFLOW", message: "", expected: 6, actual: 5 }, { ...r, type: "row" }),
    ).toBe("Wird nur in 5 von 6 Maschen gearbeitet – 1 bleibt frei.");
    expect(findingMessage({ rowId: "a", severity: "error", code: "NO_ANCHOR_ROW", message: "", actual: 6 }, r)).toContain("keine Runde");
    expect(parseErrorMessage(parseRowText("6 Quatsch"))).toBe("Unbekannter Begriff: „Quatsch“");
    expect(parseErrorMessage(parseRowText("6× (1 fM"))).toContain("Zeichen 9");
    expect(parseErrorMessage(parseRowText("6 fM"))).toBeNull();
  });
});

describe("storage", () => {
  it("accepts valid stored documents and rejects anything else", () => {
    const doc = demoDocument();
    expect(parseStored({ doc, pinned: ["a", 3], savedAt: 5 })).toEqual({ doc, pinned: ["a"], savedAt: 5 });
    expect(parseStored({ doc })).toEqual({ doc, pinned: [], savedAt: 0 });
    expect(parseStored({ doc: { ...doc, parts: [] } })).toBeNull();
    expect(parseStored({ doc: { title: 1 } })).toBeNull();
    expect(parseStored(null)).toBeNull();
  });
});
