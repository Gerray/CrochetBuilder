import { describe, expect, it } from "vitest";
import { BuilderExportSchema, validateExport } from "@crochetbuilder/engine";
import { demoDocument } from "./document.js";
import { editorReducer, initEditorState, type EditorAction, type EditorState } from "./editor.js";
import { nextPlacementId, normalizeAngle, slug, withPartId } from "./assembly.js";

let n = 0;
const ids = () => `id${++n}`;
/** The bunny demo without its own placements, to build them up in the tests. */
function bare() {
  const doc = demoDocument(ids, "bunny");
  const { assembly: _a, ...rest } = doc;
  return { ...rest, parts: rest.parts.map(({ id: _id, ...p }) => p) };
}
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s);
const rowOf = (s: EditorState, part: number, round: number) => s.doc.parts[part]!.content.rows[round - 1]!.id;

describe("assembly actions", () => {
  const start = initEditorState(bare());
  const [HEAD, BODY, EAR] = [0, 1, 2];

  it("adds a placement, gives the parts readable ids and is one undo step", () => {
    const s = run(start, {
      type: "addPlacement",
      placement: { id: "ohren", kind: "attach", part: EAR, target: HEAD, row: rowOf(start, HEAD, 4), angle: 30 },
    });
    expect(s.doc.parts.map((p) => p.id)).toEqual(["kopf", undefined, "ohr", undefined, undefined]);
    expect(s.doc.assembly).toEqual([{ id: "ohren", kind: "attach", part: "ohr", target: "kopf", row: rowOf(start, HEAD, 4), angle: 30 }]);
    expect(validateExport(s.doc)).toEqual([]);
    expect(BuilderExportSchema.safeParse(s.doc).success).toBe(true);
    const undone = run(s, { type: "undo" });
    expect(undone.doc).toBe(start.doc);
    expect(run(undone, { type: "redo" }).doc).toEqual(s.doc);
  });

  it("refuses placements that cannot exist", () => {
    const row = rowOf(start, HEAD, 4);
    const bad: EditorAction[] = [
      { type: "addPlacement", placement: { id: "x", kind: "attach", target: HEAD, row, angle: 0 } }, // no part
      { type: "addPlacement", placement: { id: "x", kind: "attach", part: HEAD, target: HEAD, row, angle: 0 } }, // itself
      { type: "addPlacement", placement: { id: "x", kind: "eyes", target: BODY, row, angle: 0 } }, // row of another part
      { type: "addPlacement", placement: { id: "x", kind: "eyes", target: 9, row, angle: 0 } },
      { type: "addPlacement", placement: { id: "x", kind: "eyes", target: HEAD, row, angle: Number.NaN } },
      { type: "addPlacement", placement: { id: "", kind: "eyes", target: HEAD, row, angle: 0 } },
    ];
    for (const action of bad) expect(run(start, action)).toBe(start);
  });

  it("edits fields, coalescing typing into one field, and removes placements", () => {
    const row4 = rowOf(start, HEAD, 4);
    const row5 = rowOf(start, HEAD, 5);
    let s = run(start, { type: "addPlacement", placement: { id: "augen", kind: "eyes", target: HEAD, row: row4, angle: 0, spacing: 6, size: 10 } });
    s = run(s, { type: "updatePlacement", id: "augen", patch: { size: 1 } }, { type: "updatePlacement", id: "augen", patch: { size: 12 } });
    expect(s.doc.assembly![0]!.size).toBe(12);
    expect(s.past).toHaveLength(2); // add + one coalesced size edit
    s = run(s, { type: "updatePlacement", id: "augen", patch: { row: row5, angle: 190 } });
    expect(s.doc.assembly![0]).toMatchObject({ row: row5, angle: -170 });
    s = run(s, { type: "updatePlacement", id: "augen", patch: { spacing: null } });
    expect(s.doc.assembly![0]!.spacing).toBeUndefined();
    // A row of another part is refused; moving to another part needs one of its rows.
    expect(run(s, { type: "updatePlacement", id: "augen", patch: { row: rowOf(s, BODY, 3) } })).toBe(s);
    expect(run(s, { type: "updatePlacement", id: "augen", patch: { target: BODY } })).toBe(s);
    const moved = run(s, { type: "updatePlacement", id: "augen", patch: { target: BODY, row: rowOf(s, BODY, 3) } });
    expect(moved.doc.assembly![0]!.target).toBe("koerper");
    // An unchanged value is no step.
    expect(run(s, { type: "updatePlacement", id: "augen", patch: { angle: -170 } })).toBe(s);
    const removed = run(s, { type: "removePlacement", id: "augen" });
    expect(removed.doc.assembly).toBeUndefined();
    expect(run(removed, { type: "undo" }).doc.assembly).toHaveLength(1);
  });

  it("removes a deleted part's placements with it, and undo brings both back", () => {
    let s = run(start, {
      type: "addPlacement",
      placement: { id: "ohren", kind: "attach", part: EAR, target: HEAD, row: rowOf(start, HEAD, 4), angle: 30 },
    });
    s = run(s, { type: "addPlacement", placement: { id: "augen", kind: "eyes", target: HEAD, row: rowOf(start, HEAD, 8), angle: 0 } });
    const deleted = run(s, { type: "deletePart", index: EAR });
    expect(deleted.doc.assembly!.map((p) => p.id)).toEqual(["augen"]);
    expect(run(deleted, { type: "undo" }).doc).toBe(s.doc);
    expect(run(s, { type: "deletePart", index: HEAD }).doc.assembly).toBeUndefined();
  });
});

describe("assembly helpers", () => {
  it("makes ids from names", () => {
    expect(slug("Körper")).toBe("koerper");
    expect(slug("  Ohr (links) ")).toBe("ohr-links");
    expect(slug("??")).toBe("");
    const doc = bare();
    const named = { ...doc, parts: [{ ...doc.parts[0]!, id: "kopf" }, { ...doc.parts[1]!, name: "Kopf" }, { ...doc.parts[2]!, name: "" }] };
    expect(withPartId(named, 1).parts[1]!.id).toBe("kopf-2");
    expect(withPartId(named, 2).parts[2]!.id).toBe("teil-3");
    expect(withPartId(named, 0)).toBe(named);
    expect(nextPlacementId({ ...doc, assembly: [{ id: "ohr", kind: "eyes", target: "a", row: "r", angle: 0 }] }, "Ohr")).toBe("ohr-2");
  });

  it("keeps angles in (−180, 180]", () => {
    expect([0, 180, -180, 190, -190, 360, -0].map(normalizeAngle)).toEqual([0, 180, 180, -170, 170, 0, 0]);
  });
});

describe("bunny demo assembly", () => {
  const doc = demoDocument(ids, "bunny");
  it("has ids, a flat ear and placements that resolve", () => {
    expect(doc.parts.map((p) => p.id)).toEqual(["kopf", "koerper", "ohr", "arm", "bein"]);
    expect(doc.parts[2]!.content.finish).toBe("flat");
    expect(doc.assembly!.map((p) => p.id)).toEqual(["kopf", "ohren", "arme", "beine", "augen", "nase"]);
    expect(validateExport(doc)).toEqual([]);
    expect(BuilderExportSchema.safeParse(doc).success).toBe(true);
  });

  it("leaves the other demos without an assembly", () => {
    for (const kind of ["sphere", "ball", "potholder"] as const) expect(demoDocument(ids, kind).assembly).toBeUndefined();
  });
});
