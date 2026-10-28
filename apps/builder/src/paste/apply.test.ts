import { describe, expect, it } from "vitest";
import { validateExport } from "@crochetbuilder/engine";
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
import { SAMPLE_PATTERN, SAMPLE_V2_PATTERN } from "../test/samplePattern.js";
import {
  applyPaste,
  effectiveMode,
  droppedPlacements,
  mergePalette,
  paletteNotes,
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
    // Provenance for the TellmeCrochet hand-off (E25).
    expect(result.action.source).toBe("paste");
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

describe("applyPaste — colours, finish, stuffing and assembly (format v2)", () => {
  const v2 = buildPastePreview(SAMPLE_V2_PATTERN);
  /** Findings of the whole export (palette, part ids, assembly references). */
  const problems = (d: BuilderDoc) => validateExport(d);

  it("merges colours by name and keeps the ids of the colours already there", () => {
    const existing = [
      { id: "braun", name: "Mokka" },
      { id: "c1", name: "creme", hex: "#eeeeee" },
    ];
    const { colors, ids } = mergePalette(existing, v2.colors);
    expect(colors).toEqual([...existing, { id: "braun-2", name: "Braun", hex: "#8b5a2b" }]);
    expect(Object.fromEntries(ids)).toEqual({ braun: "braun-2", creme: "c1" });
    expect(mergePalette([], v2.colors).colors).toEqual(v2.colors);
  });

  it("brings palette, finish, stuffing and placements into a new pattern, with the new ids", () => {
    const action = actionOf(v2, emptyDocument("old"), replace);
    if (action.type !== "replaceDocument") throw new Error("expected replaceDocument");
    const next = action.doc;
    expect(next.overview.colors).toEqual(v2.colors);
    expect(next.parts.map((p) => [p.id, p.content.schemaVersion, p.content.finish, p.content.stuffing])).toEqual([
      ["kopf", 2, "gather", "firm"],
      ["fluegel", 2, "flat", "none"],
    ]);
    const colorRows = next.parts.flatMap((p) => p.content.rows.filter((r) => r.color).map((r) => r.color));
    expect(colorRows).toEqual(["braun", "creme", "braun"]);
    const rowIds = new Set(next.parts.flatMap((p) => p.content.rows.map((r) => r.id)));
    expect(next.assembly).toHaveLength(2);
    for (const placement of next.assembly!) {
      expect(rowIds.has(placement.row), placement.kind).toBe(true);
      expect(placement.id).toMatch(/^new-\d+$/);
    }
    expect(next.assembly!.map((p) => [p.kind, p.part, p.target, p.spacing, p.size])).toEqual([
      ["eyes", undefined, "kopf", 4, 8],
      ["attach", "fluegel", "kopf", undefined, undefined],
    ]);
    // Round 3 of the head (the eyes sit between 3 and 4).
    expect(next.parts[0]!.content.rows.filter((r) => r.ops.length > 0)[2]!.id).toBe(next.assembly![0]!.row);
    expect(problems(next)).toEqual([]);
  });

  it("adds them to an existing pattern: palette merged, taken part ids renamed, placements appended", () => {
    const base = demoDocument(ids("old"), "sphere");
    const existing: BuilderDoc = {
      ...base,
      overview: { ...base.overview, colors: [{ id: "c1", name: "Braun", hex: "#7a4a2a" }] },
      parts: [{ ...base.parts[0]!, id: "kopf" }],
      assembly: [{ id: "p0", kind: "embroidery", target: "kopf", row: base.parts[0]!.content.rows[3]!.id, angle: 0 }],
    };
    const action = actionOf(v2, existing, append);
    if (action.type !== "appendParts") throw new Error("expected appendParts");
    expect(action.colors).toEqual([{ id: "c1", name: "Braun", hex: "#7a4a2a" }, { id: "creme", name: "Creme", hex: "#fffdd0" }]);
    expect(action.parts.map((p) => p.id)).toEqual(["kopf-2", "fluegel"]);
    expect(action.parts.flatMap((p) => p.content.rows.filter((r) => r.color).map((r) => r.color))).toEqual(["c1", "creme", "c1"]);
    expect(action.assembly!.map((p) => [p.part, p.target])).toEqual([
      [undefined, "kopf-2"],
      ["fluegel", "kopf-2"],
    ]);

    const state = editorReducer(initEditorState(existing), action);
    expect(state.doc.overview.colors).toEqual(action.colors);
    expect(state.doc.assembly!.map((p) => p.id)).toEqual(["p0", ...action.assembly!.map((p) => p.id)]);
    expect(problems(state.doc)).toEqual([]);
    expect(editorReducer(state, { type: "undo" }).doc).toEqual(existing);
  });

  it("matches the main colour in every spelling, and names a kept shade when adding parts", () => {
    const merged = mergePalette([{ id: "m", name: "Hauptfarbe" }], [{ id: "main-color", name: "Main color" }]);
    expect(merged.ids.get("main-color")).toBe("m");
    const base = demoDocument(ids("old"), "sphere");
    const doc: BuilderDoc = {
      ...base,
      overview: { ...base.overview, colors: [{ id: "x", name: "BRAUN", hex: "#123456" }, { id: "y", name: "Creme", hex: "#FFFDD0" }] },
    };
    expect(paletteNotes(v2, doc, "append")).toEqual(["BRAUN: vorhandener Farbton bleibt"]); // Creme: same shade
    expect(paletteNotes(v2, doc, "replace")).toEqual([]);
    expect(paletteNotes(v2, emptyDocument("e"), "append")).toEqual([]); // an empty pattern is replaced
  });

  it("counts placements whose part or row is gone, and leaves them out", () => {
    expect(droppedPlacements(v2)).toBe(0);
    const broken = structuredClone(v2);
    broken.assembly[0]!.row = "nowhere";
    broken.assembly[1]!.part = "nobody";
    expect(droppedPlacements(broken)).toBe(2);
    const action = actionOf(broken, emptyDocument("old"), replace);
    if (action.type !== "replaceDocument") throw new Error("expected replaceDocument");
    expect(action.doc.assembly).toBeUndefined();
  });

  it("leaves palette and assembly alone when the text has none", () => {
    const action = actionOf(preview, demoDocument(ids("old"), "sphere"), append);
    if (action.type !== "appendParts") throw new Error("expected appendParts");
    expect(action.colors).toBeUndefined();
    expect(action.assembly).toEqual([
      expect.objectContaining({ kind: "eyes", target: "kopf" }), // "Sicherheitsaugen zwischen Runde 6 und 7"
    ]);
  });
});
