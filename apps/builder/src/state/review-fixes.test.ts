import { describe, expect, it } from "vitest";
import { MAX_COUNT, MAX_STITCH_COUNT_TARGET, type Mod, type Op, type Row } from "@crochetbuilder/engine";
import { demoDocument, emptyDocument } from "./document.js";
import { currentPart, editorReducer, initEditorState, type EditorAction, type EditorState } from "./editor.js";
import { autoRowLabels, displayRowLabels, isInstructionLike } from "./labels.js";
import { findingMessage, parseErrorMessage } from "./messages.js";
import { shortcutFor, type KeyInfo } from "./shortcuts.js";
import { parseStored } from "./storage.js";
import { parseRowText } from "@crochetbuilder/engine";

const sc = (count: number, modifiers?: Mod[]): Op =>
  modifiers ? { kind: "stitch", code: "SC", count, modifiers } : { kind: "stitch", code: "SC", count };
const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s);
const fresh = () => initEditorState(emptyDocument("r1"));
const row = (s: EditorState, id = "r1"): Row => currentPart(s.doc).rows.find((r) => r.id === id)!;

describe("reducer limits", () => {
  it("refuses counts, repeats and rows over the limits", () => {
    const s = run(fresh(), { type: "setRowOps", rowId: "r1", ops: [sc(6)] });
    expect(run(s, { type: "updateStitch", rowId: "r1", path: [0], patch: { count: MAX_COUNT + 1 } })).toBe(s);
    expect(run(s, { type: "setRowOps", rowId: "r1", ops: [rep(1000, [sc(1)])] })).toBe(s);
    expect(run(s, { type: "setRowOps", rowId: "r1", ops: [rep(999, [rep(999, [sc(999)])])] })).toBe(s);
    const grouped = run(s, { type: "wrapInRepeat", rowId: "r1", path: [0], times: 999 });
    expect(row(grouped).ops).toEqual([rep(999, [sc(6)])]);
    // 999 × 6 = 5,994 worked stitches is fine; × 999 more is not.
    expect(run(grouped, { type: "wrapInRepeat", rowId: "r1", path: [0], times: 999 })).toBe(grouped);
    expect(run(s, { type: "setTarget", rowId: "r1", target: MAX_STITCH_COUNT_TARGET + 1 })).toBe(s);
  });
});

describe("reducer modifiers", () => {
  it("refuses contradictory toggles and drops modifiers a new code cannot have", () => {
    let s = run(fresh(), { type: "setRowOps", rowId: "r1", ops: [sc(2, ["BLO", "TOG"])] });
    expect(run(s, { type: "updateStitch", rowId: "r1", path: [0], patch: { modifiers: ["BLO", "FLO"] } })).toBe(s);
    s = run(s, { type: "updateStitch", rowId: "r1", path: [0], patch: { code: "INC" } });
    expect(row(s).ops).toEqual([{ kind: "stitch", code: "INC", count: 2, modifiers: ["BLO"] }]);
    s = run(s, { type: "updateStitch", rowId: "r1", path: [0], patch: { code: "CH" } });
    expect(row(s).ops).toEqual([{ kind: "stitch", code: "CH", count: 2 }]);
    s = run(s, { type: "updateStitch", rowId: "r1", path: [0], patch: { code: "SC", modifiers: ["TOG", "TOG"] } });
    expect(row(s).ops).toEqual([sc(2, ["TOG"])]);
  });
});

describe("undo steps", () => {
  it("leaving a field starts a new undo step", () => {
    let s = run(fresh(), { type: "setTitle", title: "A" }, { type: "setTitle", title: "AB" });
    expect(s.past).toHaveLength(1);
    s = run(s, { type: "endTyping" }, { type: "setTitle", title: "ABC" });
    expect(s.past).toHaveLength(2);
    s = run(s, { type: "undo" });
    expect(s.doc.title).toBe("AB");
  });

  it("endTyping without a typing streak changes nothing", () => {
    const s = fresh();
    expect(run(s, { type: "endTyping" })).toBe(s);
  });

  it("setting an unchanged Soll is a no-op (no pin, no history)", () => {
    const s = run(fresh(), { type: "setRowOps", rowId: "r1", ops: [sc(6)] });
    const same = run(s, { type: "setTarget", rowId: "r1", target: 6 });
    expect(same).toBe(s);
    expect(same.pinned).toEqual([]);
  });
});

describe("labels", () => {
  it("are the same for list and preview, counting empty stitch rows", () => {
    const rows: Row[] = [
      { id: "a", type: "round", ops: [sc(6)], stitchCountTarget: 6 },
      { id: "b", type: "round", ops: [], stitchCountTarget: 0 },
      { id: "c", type: "round", ops: [], stitchCountTarget: 0, note: "Augen" },
      { id: "d", type: "row", ops: [sc(6)], stitchCountTarget: 6, label: "Boden" },
      { id: "e", type: "round", ops: [sc(6)], stitchCountTarget: 6 },
    ];
    expect(autoRowLabels(rows)).toEqual(["Runde 1", "Runde 2", "Hinweis", "Reihe 3", "Runde 4"]);
    expect(displayRowLabels(rows)).toEqual(["Runde 1", "Runde 2", "Hinweis", "Boden", "Runde 4"]);
    expect(isInstructionLike(rows[1]!)).toBe(false);
    expect(isInstructionLike(rows[2]!)).toBe(true);
  });
});

describe("shortcuts by produced character", () => {
  const key = (k: string, code: string, extra: Partial<KeyInfo> = {}): KeyInfo => ({
    key: k,
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...extra,
  });

  it("QWERTY", () => {
    expect(shortcutFor(key("z", "KeyZ", { ctrlKey: true }))).toBe("undo");
    expect(shortcutFor(key("y", "KeyY", { ctrlKey: true }))).toBe("redo");
    expect(shortcutFor(key("Z", "KeyZ", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(shortcutFor(key("z", "KeyZ", { metaKey: true }))).toBe("undo");
  });

  it("German QWERTZ: the Z key sits at KeyY", () => {
    expect(shortcutFor(key("z", "KeyY", { ctrlKey: true }))).toBe("undo");
    expect(shortcutFor(key("y", "KeyZ", { ctrlKey: true }))).toBe("redo");
    expect(shortcutFor(key("Z", "KeyY", { ctrlKey: true, shiftKey: true }))).toBe("redo");
  });

  it("French AZERTY and Alt+N", () => {
    expect(shortcutFor(key("z", "KeyW", { ctrlKey: true }))).toBe("undo");
    expect(shortcutFor(key("n", "KeyN", { altKey: true }))).toBe("addRow");
    expect(shortcutFor(key("˜", "KeyN", { altKey: true }))).toBe("addRow"); // macOS Option+N
    expect(shortcutFor(key("b", "KeyN", { altKey: true }))).toBeNull(); // Dvorak: N position is "b"
    expect(shortcutFor(key("z", "KeyZ"))).toBeNull();
    expect(shortcutFor(key("z", "KeyZ", { ctrlKey: true, altKey: true }))).toBeNull();
  });
});

describe("messages for new codes", () => {
  it("explains limits, modifiers and empty repeats in German", () => {
    expect(parseErrorMessage(parseRowText("1000 fM"))).toBe("Zahl zu groß – höchstens 999.");
    expect(parseErrorMessage(parseRowText("999× (999× (999 fM))"))).toBe(
      "Zu viele Maschen in einer Zeile – höchstens 10.000.",
    );
    expect(parseErrorMessage(parseRowText("6 Zun (zus)"))).toContain("„zus“ passt hier nicht");
    expect(
      findingMessage({ rowId: "a", severity: "warning", code: "EMPTY_REPEAT", message: "", actual: 1 }, undefined),
    ).toBe("Eine Wiederholung enthält keine Maschen.");
  });
});

describe("load guard", () => {
  it("rejects stored documents over the limits", () => {
    const doc = demoDocument();
    currentPart(doc).rows[0]!.ops = [rep(999, [rep(999, [sc(100)])])];
    expect(parseStored({ doc, pinned: [] })).toBeNull();
  });
});
