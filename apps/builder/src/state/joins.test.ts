/** Joining while crocheting in the editor: ids on demand, the picker's defaults, findings, snippet. */
import { describe, expect, it } from "vitest";
import { parseRowText, type Op, type Row } from "@crochetbuilder/engine";
import type { BuilderDoc } from "./document.js";
import { currentPart, editorReducer, initEditorState, type EditorAction, type EditorState } from "./editor.js";
import {
  joinedPartNames,
  joinFindingsByRow,
  joinFindingMessage,
  joinPartsFor,
  nextFreeStitch,
  withJoinFindings,
  withJoinIds,
} from "./joins.js";
import { findingMessage } from "./messages.js";
import { defaultLegs, joinLegs, legChoices, snippetRounds, type SnippetParams } from "./snippets.js";

const sc = (count: number, extra: Partial<Extract<Op, { kind: "stitch" }>> = {}): Op => ({ kind: "stitch", code: "SC", count, ...extra });
const rnd = (id: string, ops: Op[], t: number, extra: Partial<Row> = {}): Row => ({ id, type: "round", ops, stitchCountTarget: t, ...extra });

/** Two parts without ids: "Bein" ×2 (12 stitches at the end) and "Körper" (not started). */
function doc(): BuilderDoc {
  return {
    schemaVersion: 2,
    title: "Test",
    overview: {},
    parts: [
      {
        name: "Bein",
        quantity: 2,
        content: { schemaVersion: 2, rows: [rnd("l1", [{ kind: "stitch", code: "MR", count: 1 }, sc(6)], 6), rnd("l2", [{ kind: "stitch", code: "INC", count: 6 }], 12), rnd("l3", [sc(12)], 12)] },
      },
      { name: "Körper", quantity: 1, content: { schemaVersion: 2, rows: [rnd("b1", [], 0)] } },
    ],
  };
}
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s);

describe("parts in the row text", () => {
  it("lists the other parts with the ids they will get, and gives the ids when a join is stored", () => {
    const d = doc();
    expect(joinPartsFor(d, 1).map((p) => [p.id, p.name, p.quantity])).toEqual([["bein", "Bein", 2]]);
    const parsed = parseRowText("12 fM um Bein 1, 2 fM, 12 fM um das zweite Bein, 2 fM", "de", { parts: joinPartsFor(d, 1) });
    expect(parsed.ok).toBe(true);
    const ops = parsed.ok ? parsed.ops : [];
    expect(ops[2]).toEqual(sc(12, { from: { part: "bein", copy: 2 } }));
    // Storing the row gives every part its id, as promised.
    let s = initEditorState(d, [], 1);
    s = run(s, { type: "setRowOps", rowId: "b1", ops });
    expect(s.doc.parts.map((p) => p.id)).toEqual(["bein", "koerper"]);
    expect(currentPart(s.doc, 1).rows[0]!.stitchCountTarget).toBe(28);
    expect(withJoinIds(d, [sc(3)])).toBe(d);
  });

  it("sets and removes a join of a stitch in one step, never into the own part", () => {
    let s = initEditorState(doc(), [], 1);
    s = run(s, { type: "setRowOps", rowId: "b1", ops: [sc(12), sc(4)] });
    const before = s;
    s = run(s, { type: "setOpJoin", rowId: "b1", path: [0], join: { kind: "from", part: 0, copy: 2 } });
    expect(currentPart(s.doc, 1).rows[0]!.ops[0]).toEqual(sc(12, { from: { part: "bein", copy: 2 } }));
    expect(s.doc.parts[0]!.id).toBe("bein");
    s = run(s, { type: "setOpJoin", rowId: "b1", path: [0], join: { kind: "through", part: 0 } });
    expect(currentPart(s.doc, 1).rows[0]!.ops[0]).toEqual(sc(12, { through: { part: "bein" } }));
    s = run(s, { type: "setOpJoin", rowId: "b1", path: [0], join: null });
    expect(currentPart(s.doc, 1).rows[0]!.ops[0]).toEqual(sc(12));
    // Into the own part, or without change: no undo step.
    expect(run(before, { type: "setOpJoin", rowId: "b1", path: [0], join: { kind: "from", part: 1 } })).toBe(before);
    expect(run(before, { type: "setOpJoin", rowId: "b1", path: [0], join: null })).toBe(before);
  });
});

describe("defaults, findings and the hint", () => {
  const joined = (): BuilderDoc => {
    const d = doc();
    d.parts[0]!.id = "bein";
    d.parts[1]!.content.rows = [
      { id: "br", type: "round", ops: [{ kind: "stitch", code: "CH", count: 2 }], stitchCountTarget: 0 },
      rnd("b1", [sc(12, { from: { part: "bein", copy: 1 } }), sc(2), sc(10, { from: { part: "bein", copy: 2 } }), sc(2)], 26, { around: true }),
    ];
    return d;
  };

  it("finds the next free stitch of a row and reports what is left free on the joining row", () => {
    const d = joined();
    expect(nextFreeStitch(d, 0, 2, "l3", "from")).toBe(10);
    expect(nextFreeStitch(d, 0, 1, "l3", "through")).toBe(0);
    const byRow = joinFindingsByRow(d);
    const f = byRow.get("b1")!;
    expect(f.map((x) => x.code)).toEqual(["JOIN_UNDERFLOW"]);
    expect(joinFindingMessage(f[0]!)).toBe("Von 12 Maschen des anderen Teils werden nur 10 verbunden – 2 bleiben frei.");
    const shown = withJoinFindings([], d.parts[1]!.content.rows, byRow);
    expect(shown).toHaveLength(1);
    expect(findingMessage(shown[0]!, d.parts[1]!.content.rows[1])).toContain("2 bleiben frei");
    expect(joinedPartNames(d, 0)).toEqual(["Körper"]);
    expect(joinedPartNames(d, 1)).toEqual(["Bein"]);
    expect(joinedPartNames(doc(), 0)).toEqual([]);
  });
});

describe("snippet “Beine verbinden”", () => {
  const params = (p: Partial<SnippetParams> = {}): SnippetParams => ({ max: 36, rounds: 4, min: 6, chain: 7, increases: 2, bridge: 3, legA: "", legB: "", ...p });

  it("joins copy 1 and copy 2 of a part ×2 across a bridge, with the right count", () => {
    const parts = joinPartsFor(doc(), 1);
    const legs = legChoices(parts);
    expect(legs.map((l) => [l.key, l.label, l.count])).toEqual([
      ["bein:1", "Bein 1", 12],
      ["bein:2", "Bein 2", 12],
    ]);
    expect(defaultLegs(legs)).toEqual(["bein:1", "bein:2"]);
    const result = snippetRounds("joinLegs", params(), undefined, "round", parts);
    expect(result).toEqual({ ok: true, rounds: joinLegs(legs[0]!, legs[1]!, 3) });
    if (!result.ok) return;
    expect(result.rounds[0]).toEqual({ ops: [{ kind: "stitch", code: "CH", count: 3 }], count: 0 });
    expect(result.rounds[1]).toEqual({
      ops: [sc(12, { from: { part: "bein", copy: 1 } }), sc(3), sc(12, { from: { part: "bein", copy: 2 } }), sc(3)],
      count: 30,
      around: true,
    });
    // Inserted, the round is valid and the leg part gets its id.
    let s = initEditorState(doc(), [], 1);
    s = run(s, {
      type: "insertRows",
      afterId: "b1",
      rows: result.rounds.map((r, i) => ({ id: `n${i}`, type: "round", ops: r.ops, stitchCountTarget: r.count, ...(r.around ? { around: true as const } : {}) })),
    });
    expect(s.doc.parts[0]!.id).toBe("bein");
    expect(joinFindingsByRow(s.doc).size).toBe(0);
  });

  it("says why it does not fit", () => {
    expect(snippetRounds("joinLegs", params(), undefined, "round", [])).toMatchObject({ ok: false });
    const parts = joinPartsFor(doc(), 1);
    expect(snippetRounds("joinLegs", params({ legA: "bein:1", legB: "bein:1" }), undefined, "round", parts)).toEqual({ ok: false, message: "Zwei verschiedene Beine wählen." });
    expect(snippetRounds("joinLegs", params({ bridge: 0 }), undefined, "round", parts)).toMatchObject({ ok: false });
    expect(snippetRounds("joinLegs", params(), undefined, "row", parts)).toMatchObject({ ok: false });
  });
});
