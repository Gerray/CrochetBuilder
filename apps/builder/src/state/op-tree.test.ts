import { describe, expect, it } from "vitest";
import type { Op } from "@crochetbuilder/engine";
import { getOp, insertOp, moveOp, removeOp, unwrapRepeat, updateOp, wrapInRepeat } from "./op-tree.js";

const sc = (count: number): Op => ({ kind: "stitch", code: "SC", count });
const inc = (count: number): Op => ({ kind: "stitch", code: "INC", count });
const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });

describe("op-tree", () => {
  const ops: Op[] = [sc(2), rep(6, [sc(1), rep(2, [inc(1)])]), sc(3)];

  it("reads by path", () => {
    expect(getOp(ops, [0])).toEqual(sc(2));
    expect(getOp(ops, [1, 1, 0])).toEqual(inc(1));
    expect(getOp(ops, [0, 0])).toBeUndefined();
    expect(getOp(ops, [9])).toBeUndefined();
  });

  it("updates nested ops without touching the input", () => {
    const before = JSON.stringify(ops);
    const next = updateOp(ops, [1, 1, 0], () => sc(5));
    expect(getOp(next, [1, 1, 0])).toEqual(sc(5));
    expect(JSON.stringify(ops)).toBe(before);
    expect(next[0]).toBe(ops[0]); // untouched branches are shared
  });

  it("inserts at a position, appending at the list end", () => {
    expect(insertOp(ops, [1, 2], inc(2))).toEqual([sc(2), rep(6, [sc(1), rep(2, [inc(1)]), inc(2)]), sc(3)]);
    expect(insertOp(ops, [0], inc(1))[0]).toEqual(inc(1));
    expect(insertOp(ops, [7], inc(1))).toBe(ops);
  });

  it("removes ops and drops repeat groups left empty", () => {
    expect(removeOp(ops, [2])).toEqual([sc(2), rep(6, [sc(1), rep(2, [inc(1)])])]);
    expect(removeOp(ops, [1, 1, 0])).toEqual([sc(2), rep(6, [sc(1)]), sc(3)]);
    expect(removeOp([rep(2, [rep(3, [sc(1)])])], [0, 0, 0])).toEqual([]);
    expect(removeOp(ops, [5])).toBe(ops);
  });

  it("moves ops within their list", () => {
    expect(moveOp(ops, [0], 1)).toEqual([ops[1], sc(2), sc(3)]);
    expect(moveOp(ops, [0], -1)).toBe(ops);
    expect(moveOp(ops, [1, 0], 5)).toEqual([sc(2), rep(6, [rep(2, [inc(1)]), sc(1)]), sc(3)]);
  });

  it("wraps ops into a repeat group and unwraps it again", () => {
    const wrapped = wrapInRepeat([sc(1), inc(1), sc(2)], [0], 6, 2);
    expect(wrapped).toEqual([rep(6, [sc(1), inc(1)]), sc(2)]);
    expect(unwrapRepeat(wrapped, [0])).toEqual([sc(1), inc(1), sc(2)]);
    expect(wrapInRepeat([sc(1)], [0], 2, 3)).toEqual([sc(1)]);
    expect(unwrapRepeat([sc(1)], [0])).toEqual([sc(1)]);
    expect(wrapInRepeat(ops, [1, 1, 0], 3)).toEqual([sc(2), rep(6, [sc(1), rep(2, [rep(3, [inc(1)])])]), sc(3)]);
  });
});
