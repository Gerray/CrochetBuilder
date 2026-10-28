import { describe, expect, it } from "vitest";
import { BuilderExportSchema, buildGraph, isClosedPiece, type Op, type PartContent, type Row } from "@crochetbuilder/engine";
import { demoDocument, emptyDocument, type BuilderDoc } from "./document.js";
import { naturalRuns } from "./grouping.js";
import { isClosedPart } from "./parts.js";
import { canUndo, editorReducer, initEditorState, type EditorAction, type EditorState } from "./editor.js";
import {
  adoptWrittenColors,
  colorCss,
  colorNameProblem,
  colorUsage,
  newColorId,
  nextSuggestion,
  paletteCss,
  reuseRowColors,
  rowStartColors,
  suggestionFor,
} from "./palette.js";
import { prepareExport } from "../export/prepare.js";

const sc = (count: number, color?: string): Op =>
  color === undefined ? { kind: "stitch", code: "SC", count } : { kind: "stitch", code: "SC", count, color };
const row = (id: string, ops: Op[], color?: string): Row => ({
  id,
  type: "round",
  ops,
  stitchCountTarget: 0,
  ...(color === undefined ? {} : { color }),
});

const PALETTE = [
  { id: "weiss", name: "Weiß", hex: "#ffffff" },
  { id: "rosa", name: "Rosa" },
];

/** A document with two parts using the palette. */
function doc(): BuilderDoc {
  const base = emptyDocument("r1");
  return {
    ...base,
    overview: { materials: [], colors: structuredClone(PALETTE) },
    parts: [
      {
        name: "Kopf",
        quantity: 1,
        content: {
          schemaVersion: 2,
          rows: [row("r1", [sc(6)]), row("r2", [sc(6)], "rosa"), row("r3", [sc(3), sc(3, "weiss")])],
        },
      },
      { name: "Ohr", quantity: 2, content: { schemaVersion: 2, rows: [row("o1", [{ kind: "repeat", times: 2, ops: [sc(1, "rosa")] }])] } },
    ],
  };
}

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state);

describe("palette helpers", () => {
  it("display colours: hex, else the built-in name, else a fallback by position", () => {
    expect(colorCss({ name: "x", hex: "#ABCDEF" }, 0)).toBe("#abcdef");
    expect(colorCss({ name: " rosa " }, 3)).toBe(suggestionFor("Rosa")!.hex);
    expect(colorCss({ name: "Natur" }, 0)).toBe(suggestionFor("Creme")!.hex);
    expect(colorCss({ name: "Altrosa" }, 0)).toBe(suggestionFor("Rosa")!.hex);
    expect(colorCss({ name: "Fantasie" }, 0)).toMatch(/^#[0-9a-f]{6}$/);
    expect(colorCss({ name: "Fantasie" }, 0)).not.toBe(colorCss({ name: "Fantasie" }, 1));
    expect(paletteCss(PALETTE)).toEqual(["#ffffff", suggestionFor("Rosa")!.hex]);
  });

  it("new ids are readable slugs, unique against the palette and references in the parts", () => {
    const d = doc();
    expect(newColorId("Hell Blau", d)).toBe("hell-blau");
    expect(newColorId("Weiß", d)).toBe("weiss-2");
    expect(newColorId("Grün", d)).toBe("gruen");
    expect(newColorId("", d)).toBe("farbe");
    // An id only referenced (not in the palette) is taken too.
    d.parts[0]!.content.rows[0]!.color = "mint";
    expect(newColorId("Mint", d)).toBe("mint-2");
  });

  it("suggests the first built-in name not in the palette", () => {
    expect(nextSuggestion([]).name).toBe("Weiß");
    expect(nextSuggestion(PALETTE).name).toBe("Schwarz");
  });

  it("counts the rows that use a colour, in all parts — the start colour also where it is implicit", () => {
    expect(colorUsage(doc(), "rosa")).toEqual({ count: 2, text: "2 Runden" });
    // Weiß is the start colour: Kopf round 1 (before the first change), round 3 (a stitch
    // switches to it) and the Ohr's only round (no change at the row).
    expect(colorUsage(doc(), "weiss")).toEqual({ count: 3, text: "3 Runden" });
    expect(colorUsage(doc(), "gelb")).toEqual({ count: 0, text: "0 Runden" });
    const flat = doc();
    flat.parts[1]!.content.rows[0]!.type = "row";
    expect(colorUsage(flat, "rosa").text).toBe("2 Runden/Reihen");
    delete flat.parts[0]!.content.rows[1]!.color;
    expect(colorUsage(flat, "rosa").text).toBe("1 Reihe");
  });

  it("refuses palette names with brackets or taken by another colour (any case)", () => {
    expect(colorNameProblem("Alt[rosa]", PALETTE)).toMatch(/Klammern/);
    expect(colorNameProblem("rosa", PALETTE)).toMatch(/schon/);
    expect(colorNameProblem(" ROSA ", PALETTE, "weiss")).toMatch(/schon/);
    expect(colorNameProblem("Rosa", PALETTE, "rosa")).toBeNull();
    expect(colorNameProblem("", PALETTE)).toBeNull();
  });

  it("an empty palette gets a start colour before a colour written after the start of a part", () => {
    const empty = emptyDocument("r1");
    const later = adoptWrittenColors([sc(6)], "Rosa", empty);
    expect(later.added.map((c) => [c.id, c.name])).toEqual([
      ["weiss", "Weiß"],
      ["rosa", "Rosa"],
    ]);
    expect(later.color).toBe("rosa");
    // Weiß written: the start colour is a neutral "Grundfarbe".
    const white = adoptWrittenColors([sc(3), sc(3, "Weiß")], undefined, empty, true);
    expect(white.added.map((c) => c.name)).toEqual(["Grundfarbe", "Weiß"]);
    expect(white.ops).toEqual([sc(3), sc(3, "weiss")]);
    // The first row's own colour is the start colour itself.
    expect(adoptWrittenColors([sc(6)], "Rosa", empty, true).added.map((c) => c.name)).toEqual(["Rosa"]);
    // With a palette nothing extra.
    expect(adoptWrittenColors([sc(6)], "Mint", doc()).added.map((c) => c.name)).toEqual(["Mint"]);
  });

  it("the colour at the start of each row: first palette colour, row changes, mid-row changes carry over", () => {
    const rows = [
      row("a", [sc(6)]),
      row("b", [sc(6)], "rosa"),
      row("c", [sc(3), sc(3, "weiss")]),
      row("d", [sc(6)], "unbekannt"),
      row("e", [sc(6)]),
    ];
    expect(rowStartColors(rows, PALETTE)).toEqual([
      { id: "weiss", changed: false, unknown: false, before: "weiss" },
      { id: "rosa", changed: true, unknown: false, before: "weiss" },
      { id: "rosa", changed: false, unknown: false, before: "rosa" },
      // Row c ended in Weiß (mid-row change); d's own colour is unknown and ignored.
      { id: "weiss", changed: true, unknown: true, before: "weiss" },
      { id: "weiss", changed: false, unknown: false, before: "weiss" },
    ]);
    expect(rowStartColors(rows, [])[0]).toEqual({ id: undefined, changed: false, unknown: false, before: undefined });
  });

  it("adopts colours written in a row's text into the palette", () => {
    const d = doc();
    const result = adoptWrittenColors([sc(3, "Mint"), sc(3, "rosa"), sc(1, "mint")], "Lila", d);
    expect(result.added).toEqual([
      { id: "lila", name: "Lila", hex: suggestionFor("Lila")!.hex },
      { id: "mint", name: "Mint", hex: suggestionFor("Mint")!.hex },
    ]);
    expect(result.color).toBe("lila");
    expect(result.ops).toEqual([sc(3, "mint"), sc(3, "rosa"), sc(1, "mint")]);
    // Nothing unknown: the same ops come back.
    const ops = [sc(3, "rosa")];
    expect(adoptWrittenColors(ops, undefined, d)).toEqual({ ops, color: undefined, added: [] });
  });
});

describe("palette actions", () => {
  it("adds, renames, recolours and reorders colours, each one undo step", () => {
    let s = initEditorState(emptyDocument("r1"));
    s = run(s, { type: "addColor", color: { id: "weiss", name: "Weiß", hex: "#FFFFFF" } });
    expect(s.doc.overview.colors).toEqual([{ id: "weiss", name: "Weiß", hex: "#ffffff" }]);
    s = run(s, { type: "addColor", color: { id: "rosa", name: "Rosa" } });
    // Duplicate ids and bad hex values are refused.
    expect(run(s, { type: "addColor", color: { id: "rosa", name: "x" } })).toBe(s);
    expect(run(s, { type: "addColor", color: { id: "x", name: "x", hex: "red" } })).toBe(s);
    // Typing a name coalesces into one step.
    const before = s.past.length;
    s = run(s, { type: "updateColor", id: "rosa", patch: { name: "Alt" } }, { type: "updateColor", id: "rosa", patch: { name: "Altrosa" } });
    expect(s.past.length).toBe(before + 1);
    s = run(s, { type: "updateColor", id: "rosa", patch: { hex: "#d99ab8" } });
    expect(s.doc.overview.colors![1]).toEqual({ id: "rosa", name: "Altrosa", hex: "#d99ab8" });
    expect(run(s, { type: "updateColor", id: "rosa", patch: { hex: "nope" } })).toBe(s);
    s = run(s, { type: "updateColor", id: "rosa", patch: { hex: null } });
    expect(s.doc.overview.colors![1]).toEqual({ id: "rosa", name: "Altrosa" });
    s = run(s, { type: "moveColor", id: "rosa", to: 0 });
    expect(s.doc.overview.colors!.map((c) => c.id)).toEqual(["rosa", "weiss"]);
    expect(run(s, { type: "moveColor", id: "rosa", to: 0 })).toBe(s);
    s = run(s, { type: "undo" });
    expect(s.doc.overview.colors!.map((c) => c.id)).toEqual(["weiss", "rosa"]);
  });

  it("removing a colour replaces its uses in every part, or drops them, in one undo step", () => {
    const s = initEditorState(doc());
    const replaced = run(s, { type: "removeColor", id: "rosa", replacement: "weiss" });
    expect(replaced.doc.overview.colors!.map((c) => c.id)).toEqual(["weiss"]);
    expect(replaced.doc.parts[0]!.content.rows[1]!.color).toBe("weiss");
    expect(replaced.doc.parts[1]!.content.rows[0]!.ops).toEqual([{ kind: "repeat", times: 2, ops: [sc(1, "weiss")] }]);
    expect(replaced.past).toHaveLength(1);

    const dropped = run(s, { type: "removeColor", id: "rosa" });
    expect(dropped.doc.parts[0]!.content.rows[1]).not.toHaveProperty("color");
    expect(dropped.doc.parts[1]!.content.rows[0]!.ops).toEqual([{ kind: "repeat", times: 2, ops: [sc(1)] }]);
    // Untouched rows and parts keep their identity.
    expect(dropped.doc.parts[0]!.content.rows[0]).toBe(s.doc.parts[0]!.content.rows[0]);

    // The last colour gone: no palette left at all.
    const empty = run(dropped, { type: "removeColor", id: "weiss" });
    expect(empty.doc.overview).not.toHaveProperty("colors");
    expect(run(empty, { type: "undo" }, { type: "undo" }).doc).toEqual(s.doc);
  });

  it("sets and clears the colour of a row and of a stitch", () => {
    let s = initEditorState(doc());
    s = run(s, { type: "setRowColor", rowId: "r1", color: "rosa" });
    expect(s.doc.parts[0]!.content.rows[0]!.color).toBe("rosa");
    expect(run(s, { type: "setRowColor", rowId: "r1", color: "rosa" })).toBe(s);
    s = run(s, { type: "setRowColor", rowId: "r1", color: null });
    expect(s.doc.parts[0]!.content.rows[0]).not.toHaveProperty("color");

    s = run(s, { type: "setOpColor", rowId: "r3", path: [0], color: "rosa" });
    expect(s.doc.parts[0]!.content.rows[2]!.ops[0]).toEqual(sc(3, "rosa"));
    s = run(s, { type: "setOpColor", rowId: "o1", path: [0, 0], color: null });
    expect(s.doc.parts[1]!.content.rows[0]!.ops).toEqual([{ kind: "repeat", times: 2, ops: [sc(1)] }]);
    // A repeat itself has no colour.
    expect(run(s, { type: "setOpColor", rowId: "o1", path: [0], color: "rosa" })).toBe(s);
    expect(canUndo(s)).toBe(true);
    expect(s.past).toHaveLength(4);
  });

  it("setRowOps sets, keeps or clears the row colour with the text", () => {
    let s = initEditorState(doc());
    s = run(s, { type: "setRowOps", rowId: "r2", ops: [sc(7)] });
    expect(s.doc.parts[0]!.content.rows[1]!.color).toBe("rosa");
    s = run(s, { type: "setRowOps", rowId: "r2", ops: [sc(7)], color: null });
    expect(s.doc.parts[0]!.content.rows[1]).not.toHaveProperty("color");
    s = run(s, { type: "setRowOps", rowId: "r2", ops: [sc(8)], color: "weiss" });
    expect(s.doc.parts[0]!.content.rows[1]).toMatchObject({ color: "weiss", ops: [sc(8)] });
    // Refused ops (over the limits) leave the colour alone too.
    expect(run(s, { type: "setRowOps", rowId: "r2", ops: [sc(5000)], color: null })).toBe(s);
  });

  it("the edited document still exports as a valid format-2 document", () => {
    let s = initEditorState(doc());
    s = run(s, { type: "removeColor", id: "rosa", replacement: "weiss" }, { type: "setPartFinish", index: 0, finish: "flat" });
    const exp = prepareExport(s.doc);
    expect(BuilderExportSchema.safeParse(exp).success).toBe(true);
    expect(exp.rendered!.rows).toContain("Runde 2: [Farbe: Weiß] 6 fM (0)");
  });
});

describe("part finish and stuffing", () => {
  it("sets, changes and clears finish and stuffing, each one undo step on its part", () => {
    let s = initEditorState(doc(), [], 1);
    s = run(s, { type: "setPartFinish", index: 0, finish: "flat" });
    expect(s.doc.parts[0]!.content.finish).toBe("flat");
    expect(run(s, { type: "setPartFinish", index: 0, finish: "flat" })).toBe(s);
    s = run(s, { type: "setPartStuffing", index: 0, stuffing: "light" });
    expect(s.doc.parts[0]!.content.stuffing).toBe("light");
    s = run(s, { type: "setPartFinish", index: 0, finish: null });
    expect(s.doc.parts[0]!.content).not.toHaveProperty("finish");
    expect(s.past).toHaveLength(3);
    // Undo shows the part the step concerned.
    s = run(s, { type: "selectPart", index: 1 }, { type: "undo" });
    expect(s.part).toBe(0);
    expect(s.doc.parts[0]!.content.finish).toBe("flat");
    expect(run(s, { type: "setPartFinish", index: 9, finish: "open" })).toBe(s);
  });

  it("tells a closed piece from the rows exactly as the engine does from the graph", () => {
    const cases: PartContent[] = [
      ...(["sphere", "ball", "potholder", "bunny"] as const).flatMap((k) => demoDocument(undefined, k).parts.map((p) => p.content)),
      // A straight tube, an increase-only disc, a piece in rows.
      { schemaVersion: 2, rows: [row("a", [{ kind: "stitch", code: "MR", count: 1 }, sc(6)]), row("b", [sc(6)]), row("c", [sc(6)])] },
      { schemaVersion: 2, rows: [row("a", [{ kind: "stitch", code: "MR", count: 1 }, sc(6)]), row("b", [{ kind: "stitch", code: "INC", count: 6 }])] },
    ];
    for (const content of cases) {
      expect(isClosedPart(content), JSON.stringify(content.rows.map((r) => r.ops))).toBe(isClosedPiece(buildGraph(content)));
    }
    expect(cases.filter(isClosedPart).length).toBeGreaterThan(2);
  });
});

describe("colour changes on a run of identical rounds (E26)", () => {
  const ball = () => {
    const d = demoDocument((() => {
      let n = 0;
      return () => `b${++n}`;
    })(), "ball");
    d.overview.colors = structuredClone(PALETTE);
    return d;
  };

  it("a colour on the first row keeps the run together; a later row with its own colour starts a new card", () => {
    const d = ball();
    const rows = d.parts[0]!.content.rows;
    rows[4]!.color = "rosa"; // Runde 5 of "Runde 5–8"
    const runs = naturalRuns(rows).map((r) => r.rows.map((x) => x.id));
    expect(runs).toContainEqual(["b5", "b6", "b7", "b8"]);
    rows[6]!.color = "weiss";
    const split = naturalRuns(rows).map((r) => r.rows.map((x) => x.id));
    expect(split).toContainEqual(["b5", "b6"]);
    expect(split).toContainEqual(["b7", "b8"]);
  });

  it("keeps the colour objects of unchanged rows (memoised row cards see the same prop)", () => {
    const rows = ball().parts[0]!.content.rows;
    const first = rowStartColors(rows, PALETTE);
    rows[8] = { ...rows[8]!, color: "rosa" };
    const next = reuseRowColors(rowStartColors(rows, PALETTE), first);
    expect(next.slice(0, 8).every((c, i) => c === first[i])).toBe(true);
    expect(next[8]).not.toBe(first[8]);
    expect(next[8]).toMatchObject({ id: "rosa", changed: true });
    expect(reuseRowColors(first, null)).toBe(first);
  });

  it("Runde ×N copies the row without its colour change", () => {
    let s = initEditorState(emptyDocument("r1"));
    s = run(
      s,
      { type: "addColor", color: { id: "rosa", name: "Rosa" } },
      { type: "setRowOps", rowId: "r1", ops: [sc(24)], color: "rosa" },
      { type: "setRunLength", rowIds: ["r1"], length: 3, newIds: ["r2", "r3"] },
    );
    const rows = s.doc.parts[0]!.content.rows;
    expect(rows.map((r) => r.color)).toEqual(["rosa", undefined, undefined]);
    expect(naturalRuns(rows)).toHaveLength(1);
  });

  it("deleting the start colour with a replacement makes the replacement the start colour", () => {
    const d = doc();
    d.overview.colors = [...PALETTE, { id: "gelb", name: "Gelb" }];
    const s = run(initEditorState(d), { type: "removeColor", id: "weiss", replacement: "gelb" });
    expect(s.doc.overview.colors!.map((c) => c.id)).toEqual(["gelb", "rosa"]);
    // Round 1 of the head started in Weiß and starts in Gelb now; the stitch switch follows.
    expect(rowStartColors(s.doc.parts[0]!.content.rows, s.doc.overview.colors!)[0]!.id).toBe("gelb");
    expect(s.doc.parts[0]!.content.rows[2]!.ops[1]).toEqual(sc(3, "gelb"));
    // Without a replacement the next colour becomes the start colour.
    expect(run(initEditorState(d), { type: "removeColor", id: "weiss" }).doc.overview.colors!.map((c) => c.id)).toEqual(["rosa", "gelb"]);
  });

  it("refuses duplicate names and brackets when adding or renaming", () => {
    const s = initEditorState(doc());
    expect(run(s, { type: "addColor", color: { id: "x", name: "ROSA" } })).toBe(s);
    expect(run(s, { type: "addColor", color: { id: "x", name: "[x]" } })).toBe(s);
    expect(run(s, { type: "updateColor", id: "weiss", patch: { name: "rosa" } })).toBe(s);
    expect(run(s, { type: "updateColor", id: "weiss", patch: { name: "We]ß" } })).toBe(s);
    expect(run(s, { type: "updateColor", id: "rosa", patch: { name: "Rosa " } }).doc.overview.colors![1]!.name).toBe("Rosa ");
  });
});
