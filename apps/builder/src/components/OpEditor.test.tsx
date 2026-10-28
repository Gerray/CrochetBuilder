// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { useReducer } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Op, Row } from "@crochetbuilder/engine";
import { emptyDocument } from "../state/document.js";
import { editorReducer, initEditorState } from "../state/editor.js";
import { getOp, insertOp, removeOp, unwrapRepeat, wrapInGroup, wrapInRepeat } from "../state/op-tree.js";
import { OpEditor } from "./OpEditor.js";

const st = (code: string, count = 1, modifiers?: string[]): Op =>
  (modifiers ? { kind: "stitch", code, count, modifiers } : { kind: "stitch", code, count }) as Op;
const grp = (ops: Op[]): Op => ({ kind: "group", ops: ops as Extract<Op, { kind: "group" }>["ops"] });
const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });

let latest: Row | undefined;

function Harness({ ops }: { ops: Op[] }) {
  const doc = emptyDocument("r1");
  doc.parts[0]!.content.rows[0]!.ops = ops;
  const [state, dispatch] = useReducer(editorReducer, initEditorState(doc));
  const row = state.doc.parts[0]!.content.rows[0]!;
  latest = row;
  return <OpEditor rowId={row.id} rowTitle="Runde 1" ops={row.ops} dispatch={dispatch} />;
}

afterEach(cleanup);

describe("op-tree — stitch groups", () => {
  it("wraps ops into a group, edits inside it and dissolves it", () => {
    const ops: Op[] = [st("SC", 3), st("DC", 2)];
    const grouped = wrapInGroup(ops, [0], 2);
    expect(grouped).toEqual([grp([st("SC", 3), st("DC", 2)])]);
    expect(getOp(grouped, [0, 1])).toEqual(st("DC", 2));
    expect(insertOp(grouped, [0, 2], st("CH"))).toEqual([grp([st("SC", 3), st("DC", 2), st("CH")])]);
    expect(wrapInRepeat(grouped, [0, 0], 2)).toEqual([grp([rep(2, [st("SC", 3)]), st("DC", 2)])]);
    expect(unwrapRepeat(grouped, [0])).toEqual(ops);
    // A group emptied by removing its last op disappears.
    expect(removeOp([grp([st("SC")]), st("SC")], [0, 0])).toEqual([st("SC")]);
  });

  it("never nests groups", () => {
    const grouped: Op[] = [grp([st("SC", 3)])];
    expect(wrapInGroup(grouped, [0, 0])).toBe(grouped);
    expect(insertOp(grouped, [0, 1], grp([st("SC")]))).toBe(grouped);
    const inRepeat: Op[] = [grp([rep(2, [st("SC")])])];
    expect(wrapInGroup(inRepeat, [0, 0, 0])).toBe(inRepeat);
    const containing: Op[] = [rep(2, [grp([st("SC")])])];
    expect(wrapInGroup(containing, [0])).toBe(containing);
  });
});

describe("OpEditor — format v2", () => {
  it("offers bobble, puff, popcorn and picot with German names", () => {
    render(<Harness ops={[st("SC")]} />);
    const picker = screen.getByRole("combobox", { name: "Maschenart, Masche 1 von Runde 1" });
    const labels = within(picker).getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Noppe", "Büschel – Büschelmasche", "Popcorn – Popcornmasche", "Pikot"]));
    fireEvent.change(picker, { target: { value: "BOBBLE" } });
    expect(latest!.ops).toEqual([st("BOBBLE")]);
  });

  it("shows relief (FP/BP) only on post stitches, one direction at a time", () => {
    render(<Harness ops={[st("DC"), st("BOBBLE")]} />);
    const front = screen.getByRole("button", { name: "Relief v, Masche 1 von Runde 1" });
    const back = screen.getByRole("button", { name: "Relief h, Masche 1 von Runde 1" });
    expect(screen.queryByRole("button", { name: "Relief v, Masche 2 von Runde 1" })).toBeNull();
    fireEvent.click(front);
    expect(latest!.ops[0]).toEqual(st("DC", 1, ["FP"]));
    fireEvent.click(back);
    expect(latest!.ops[0]).toEqual(st("DC", 1, ["BP"]));
  });

  it("shows a group as an editable card 'in dieselbe Masche' that can be dissolved", () => {
    render(<Harness ops={[grp([st("SC", 3)]), st("SC")]} />);
    const card = screen.getByRole("group", { name: "Gruppe 1 von Runde 1, in dieselbe Masche" });
    const count = within(card).getByRole("textbox", { name: "Anzahl, Masche 1.1 von Runde 1" });
    fireEvent.change(count, { target: { value: "4" } });
    fireEvent.blur(count);
    expect(latest!.ops[0]).toEqual(grp([st("SC", 4)]));
    // No group inside a group.
    expect(within(card).queryByRole("button", { name: "Masche 1.1 von Runde 1 in dieselbe Masche" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Gruppe 1 von Runde 1 auflösen" }));
    expect(latest!.ops).toEqual([st("SC", 4), st("SC")]);
  });

  it("puts a stitch into a group with 'in 1 M'", () => {
    render(<Harness ops={[st("SC", 3)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Masche 1 von Runde 1 in dieselbe Masche" }));
    expect(latest!.ops).toEqual([grp([st("SC", 3)])]);
  });
});
