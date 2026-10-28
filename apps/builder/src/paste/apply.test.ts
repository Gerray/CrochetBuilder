import { describe, expect, it } from "vitest";
import { demoDocument, emptyDocument, type BuilderDoc } from "../state/document.js";
import {
  MAX_PARTS,
  MAX_PART_QUANTITY,
  canUndo,
  editorReducer,
  initEditorState,
  type EditorAction,
} from "../state/editor.js";
import { UNREAD_ROW_LABEL } from "../state/import-messages.js";
import { SAMPLE_PATTERN } from "../test/samplePattern.js";
import {
  applyPaste,
  effectiveMode,
  notesWith,
  partEdit,
  pasteBlocker,
  type PartEdit,
  type PasteOptions,
} from "./apply.js";
import { buildPastePreview, type PastePreview } from "./preview.js";

const ids = (prefix = "new") => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};
const preview = buildPastePreview(SAMPLE_PATTERN);
const replace: PasteOptions = { mode: "replace", includePreamble: true };
const append: PasteOptions = { mode: "append", includePreamble: true };

function actionOf(p: PastePreview, doc: BuilderDoc, options: PasteOptions): EditorAction {
  const result = applyPaste(p, doc, options, ids());
  if (!result.ok) throw new Error(result.message);
  return result.action;
}

/** A preview with `n` small parts. */
function manyParts(n: number): PastePreview {
  const text = Array.from({ length: n }, (_, i) => `Teil ${i + 1}\nRunde 1: 6 fM in den Fadenring (6)`).join("\n\n");
  return buildPastePreview(text);
}

describe("applyPaste — as a new pattern", () => {
  it("replaces the document: title from the text, preamble in the notes, fresh ids, all targets pinned", () => {
    const old = demoDocument(ids("old"), "sphere");
    const result = applyPaste(preview, old, replace, ids());
    expect(result).toMatchObject({ ok: true, parts: 3, unread: 2 });
    if (!result.ok || result.action.type !== "replaceDocument") throw new Error("expected replaceDocument");
    const { doc, pinned } = result.action;
    expect(doc.title).toBe("Kleiner Igel");
    expect(doc.overview).toEqual({
      materials: [],
      notes:
        "Material: 50 g Baumwollgarn in Braun und Creme, Häkelnadel 3 mm, Füllwatte\nAbkürzungen: fM = feste Masche, Zun = Zunahme, Abn = Abnahme",
    });
    expect(doc.parts.map((p) => [p.name, p.quantity, p.content.rows.length])).toEqual([
      ["Kopf", 1, 13],
      ["Körper", 1, 6],
      ["Ohren", 2, 4],
    ]);
    const rowIds = doc.parts.flatMap((p) => p.content.rows.map((r) => r.id));
    expect(rowIds[0]).toBe("new-1");
    expect(new Set(rowIds).size).toBe(rowIds.length);
    expect(pinned).toEqual(rowIds);
    // The declared (wrong) count is kept, so the editor reports it.
    expect(doc.parts[1]!.content.rows[2]!.stitchCountTarget).toBe(20);
    expect(doc.parts[2]!.content.rows[3]).toMatchObject({ label: UNREAD_ROW_LABEL, ops: [] });
  });

  it("gives a new pattern an empty title when the text has none, and empty notes without preamble", () => {
    const text = SAMPLE_PATTERN.split("\n").slice(4).join("\n");
    const old = { ...demoDocument(ids("old"), "sphere"), title: "Mein Igel" };
    const action = actionOf(buildPastePreview(text), old, replace);
    if (action.type !== "replaceDocument") throw new Error("expected replaceDocument");
    expect(action.doc.title).toBe("");
    expect(action.doc.overview.notes).toBeUndefined();
  });

  it("leaves the preamble out when asked to (the title is still taken)", () => {
    const action = actionOf(preview, emptyDocument("x"), { ...replace, includePreamble: false });
    if (action.type !== "replaceDocument") throw new Error("expected replaceDocument");
    expect(action.doc.overview.notes).toBeUndefined();
    expect(action.doc.title).toBe("Kleiner Igel");
  });

  it("applies edited names and quantities", () => {
    const edits = new Map<number, Partial<PartEdit>>([
      [2, { name: "  Ohr  ", quantity: 4 }],
      [0, { name: "" }],
    ]);
    const action = actionOf(preview, emptyDocument("x"), { ...replace, edits });
    if (action.type !== "replaceDocument") throw new Error("expected replaceDocument");
    expect(action.doc.parts.map((p) => [p.name, p.quantity])).toEqual([
      ["Teil 1", 1],
      ["Körper", 1],
      ["Ohr", 4],
    ]);
  });

  it("is undoable in one step and shows the first part", () => {
    const start = initEditorState(demoDocument(ids("old"), "bunny"), [], 3);
    const next = editorReducer(start, actionOf(preview, start.doc, replace));
    expect(next.part).toBe(0);
    expect(next.doc.parts).toHaveLength(3);
    expect(canUndo(next)).toBe(true);
    const undone = editorReducer(next, { type: "undo" });
    expect(undone.doc).toBe(start.doc);
  });
});

describe("applyPaste — adding parts", () => {
  it("into an empty pattern replaces it, so no empty Teil 1 stays in front", () => {
    const empty = emptyDocument("x");
    expect(effectiveMode("append", empty)).toBe("replace");
    const result = applyPaste(preview, empty, append, ids());
    if (!result.ok || result.action.type !== "replaceDocument") throw new Error("expected replaceDocument");
    expect(result.mode).toBe("replace");
    expect(result.action.doc.parts.map((p) => p.name)).toEqual(["Kopf", "Körper", "Ohren"]);
    expect(result.action.doc.title).toBe("Kleiner Igel");
    // A pattern with content keeps "append".
    expect(applyPaste(preview, demoDocument(ids("old"), "sphere"), append, ids())).toMatchObject({ mode: "append" });
  });

  it("does not repeat a preamble the notes already hold (the same text imported twice)", () => {
    const old = demoDocument(ids("old"), "sphere");
    const once = editorReducer(initEditorState(old), actionOf(preview, old, append));
    const second = applyPaste(preview, once.doc, append, ids("second"));
    if (!second.ok) throw new Error(second.message);
    expect(second.action).not.toHaveProperty("notes");
    const twice = editorReducer(once, second.action);
    expect(twice.doc.parts).toHaveLength(7);
    expect(twice.doc.overview.notes).toBe(once.doc.overview.notes);
    expect(notesWith("A\n\nB\nC", ["B", "C"])).toBe("A\n\nB\nC");
    expect(notesWith("A", ["B"])).toBe("A\n\nB");
    expect(notesWith(undefined, [])).toBe("");
  });

  it("appends the parts, adds the preamble (with the title line) to the notes and selects the first new part", () => {
    const old = demoDocument(ids("old"), "sphere");
    const start = initEditorState(old, [], 0);
    const action = actionOf(preview, old, append);
    expect(action).toMatchObject({ type: "appendParts" });
    const next = editorReducer(start, action);
    expect(next.doc.parts.map((p) => p.name)).toEqual(["Kugel", "Kopf", "Körper", "Ohren"]);
    expect(next.part).toBe(1);
    expect(next.doc.title).toBe(old.title);
    expect(next.doc.overview.notes).toBe(`${old.overview.notes}\n\n${preview.preamble.join("\n")}`);
    expect(next.doc.overview.materials).toEqual(old.overview.materials);
    const newIds = next.doc.parts.slice(1).flatMap((p) => p.content.rows.map((r) => r.id));
    expect(next.pinned).toEqual(newIds);

    const undone = editorReducer(next, { type: "undo" });
    expect(undone.doc).toBe(old);
    expect(undone.part).toBe(0);
    const redone = editorReducer(undone, { type: "redo" });
    expect(redone.doc).toBe(next.doc);
    expect(redone.part).toBe(1);
  });

  it("does not touch the notes without preamble", () => {
    const old = demoDocument(ids("old"), "sphere");
    const action = actionOf(preview, old, { ...append, includePreamble: false });
    expect(editorReducer(initEditorState(old), action).doc.overview).toBe(old.overview);
  });

  it("is refused by the reducer for ids in use, too many parts or bad quantities", () => {
    const old = demoDocument(ids("old"), "sphere");
    const start = initEditorState(old);
    const usedId = old.parts[0]!.content.rows[0]!.id;
    const part = {
      name: "X",
      quantity: 1,
      content: {
        schemaVersion: 1 as const,
        rows: [{ id: usedId, type: "round" as const, ops: [], stitchCountTarget: 0, note: "x" }],
      },
    };
    expect(editorReducer(start, { type: "appendParts", parts: [part], pinned: [] })).toBe(start);
    const fresh = (i: number) => ({
      ...part,
      content: { ...part.content, rows: [{ ...part.content.rows[0]!, id: `f${i}` }] },
    });
    const tooMany = Array.from({ length: MAX_PARTS }, (_, i) => fresh(i));
    expect(editorReducer(start, { type: "appendParts", parts: tooMany, pinned: [] })).toBe(start);
    expect(editorReducer(start, { type: "appendParts", parts: [{ ...fresh(1), quantity: 0 }], pinned: [] })).toBe(
      start,
    );
    expect(editorReducer(start, { type: "appendParts", parts: [], pinned: [] })).toBe(start);
  });
});

describe("partEdit", () => {
  it("takes only the edited field, the other one as read from the text", () => {
    expect(partEdit(preview, 2, new Map([[2, { name: "Ohr" }]]))).toEqual({ name: "Ohr", quantity: 2 });
    expect(partEdit(preview, 2, new Map([[2, { quantity: 5 }]]))).toEqual({ name: "Ohren", quantity: 5 });
    expect(partEdit(preview, 0)).toEqual({ name: "Kopf", quantity: 1 });
  });
});

describe("pasteBlocker — limits and guidance", () => {
  const doc = emptyDocument("x");

  it("needs rounds", () => {
    expect(pasteBlocker(buildPastePreview("Material: Garn"), replace, doc)).toMatch(/keine Runden oder Reihen/);
  });

  it("needs a confirmed notation when the detection is doubtful", () => {
    const text = "Body\n1. 6 dc in a magic ring (6)\n2. 6 inc (12)\n3. 18 dc (18)";
    expect(pasteBlocker(buildPastePreview(text), replace, doc)).toBe(
      "Bitte zuerst die Schreibweise bestätigen: Deutsch, US oder UK.",
    );
    expect(pasteBlocker(buildPastePreview(text, "en_uk"), replace, doc)).toBeNull();
  });

  it(`allows at most ${MAX_PARTS} parts`, () => {
    expect(pasteBlocker(manyParts(MAX_PARTS), replace, doc)).toBeNull();
    expect(pasteBlocker(manyParts(MAX_PARTS + 1), replace, doc)).toBe(
      `Der Text ergibt ${MAX_PARTS + 1} Teile – der Builder bearbeitet höchstens ${MAX_PARTS}. Bitte den Text kürzen.`,
    );
    const full = { ...doc, parts: Array.from({ length: MAX_PARTS - 2 }, () => doc.parts[0]!) };
    expect(pasteBlocker(manyParts(2), append, full)).toBeNull();
    expect(pasteBlocker(manyParts(3), append, full)).toBe(
      `Die Anleitung hat schon ${MAX_PARTS - 2} Teile, höchstens ${MAX_PARTS} sind möglich – es passen nur noch 2 dazu, der Text ergibt 3.`,
    );
    const applied = applyPaste(manyParts(3), full, append);
    expect(applied.ok).toBe(false);
  });

  it(`checks quantities (1 to ${MAX_PART_QUANTITY})`, () => {
    const edits = new Map<number, Partial<PartEdit>>([[1, { quantity: MAX_PART_QUANTITY + 1 }]]);
    expect(pasteBlocker(preview, { ...replace, edits }, doc)).toBe(
      `„Körper“: Die Anzahl muss zwischen 1 und ${MAX_PART_QUANTITY} liegen.`,
    );
  });

  it("refuses rows beyond the editor limits", () => {
    const big = structuredClone(preview);
    big.parts[0]!.rows[1] = { ...big.parts[0]!.rows[1]!, ops: [{ kind: "stitch", code: "SC", count: 1000 }] };
    expect(pasteBlocker(big, replace, doc)).toMatch(/^„Kopf“, Runde 2: zu groß für den Builder/);
  });
});
