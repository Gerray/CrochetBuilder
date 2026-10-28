import { describe, it, expect } from "vitest";
import { colorsOfStitches, nodeColorIndices } from "./color.js";
import { expandPart } from "./expand.js";
import { buildGraph } from "./graph.js";
import type { Op, PartContent, Row, StitchCode } from "./schema.js";

const st = (code: StitchCode, count = 1, color?: string): Op =>
  color ? { kind: "stitch", code, count, color } : { kind: "stitch", code, count };
const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });
const row = (id: string, ops: Op[], t: number, extra: Partial<Row> = {}): Row => ({ id, type: "round", ops, stitchCountTarget: t, ...extra });
const part = (rows: Row[]): PartContent => ({ schemaVersion: 2, rows });

const PALETTE = [{ id: "white" }, { id: "pink" }, { id: "black" }];

describe("colorsOfStitches", () => {
  it("starts in the palette's first colour", () => {
    const content = part([row("r1", [st("MR"), st("SC", 6)], 6)]);
    expect(colorsOfStitches(content, PALETTE)).toEqual(Array(7).fill("white"));
  });

  it("switches at a row and keeps the colour in the following rows", () => {
    const content = part([
      row("r1", [st("MR"), st("SC", 2)], 2),
      row("r2", [st("SC", 2)], 2, { color: "pink" }),
      row("r3", [st("SC", 2)], 2),
    ]);
    expect(colorsOfStitches(content, PALETTE)).toEqual(["white", "white", "white", "pink", "pink", "pink", "pink"]);
  });

  it("switches mid-row at an op and carries the switch into the next row", () => {
    const content = part([
      row("r1", [st("SC", 2), st("SC", 2, "black")], 4),
      row("r2", [st("SC", 2)], 2),
    ]);
    expect(colorsOfStitches(content, PALETTE)).toEqual(["white", "white", "black", "black", "black", "black"]);
  });

  it("lets an op's colour win over its row's colour, from that op on", () => {
    const content = part([row("r1", [st("SC"), st("SC", 1, "black"), st("SC")], 3, { color: "pink" })]);
    expect(colorsOfStitches(content, PALETTE)).toEqual(["pink", "black", "black"]);
  });

  it("alternates colours inside a repeat", () => {
    const content = part([row("r1", [rep(3, [st("SC", 1, "white"), st("SC", 1, "pink")])], 6)]);
    expect(colorsOfStitches(content, PALETTE)).toEqual(["white", "pink", "white", "pink", "white", "pink"]);
  });

  it("covers free instructions, staying aligned with expandPart", () => {
    const content = part([
      row("r1", [st("SC", 2)], 2),
      row("n", [], 0, { note: "Augen einsetzen", color: "pink" }),
      row("r2", [st("SC", 2)], 2),
    ]);
    const colors = colorsOfStitches(content, PALETTE);
    expect(colors).toHaveLength(expandPart(content).length);
    expect(colors).toEqual(["white", "white", "pink", "pink", "pink"]);
  });

  it("ignores ids that are not in the palette", () => {
    const content = part([row("r1", [st("SC"), st("SC", 1, "green"), st("SC", 1, "pink")], 3, { color: "blue" })]);
    expect(colorsOfStitches(content, PALETTE)).toEqual(["white", "white", "pink"]);
  });

  it("without a palette takes ids as written and starts without a colour", () => {
    const content = part([row("r1", [st("SC"), st("SC", 1, "green")], 2)]);
    expect(colorsOfStitches(content)).toEqual([undefined, "green"]);
    expect(colorsOfStitches(content, [])).toEqual([undefined, undefined]);
  });
});

describe("nodeColorIndices", () => {
  it("gives every graph node the palette index of its working colour", () => {
    const content = part([
      row("r1", [st("MR"), st("SC", 6)], 6),
      row("n", [], 0, { note: "Farbwechsel" }),
      row("r2", [st("SC", 3, "pink"), st("SC", 3, "black")], 6),
    ]);
    const g = buildGraph(content);
    expect(Array.from(nodeColorIndices(g, content, PALETTE))).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2]);
  });

  it("is all zeros for an empty palette, and resolves duplicate ids to their first entry", () => {
    const content = part([row("r1", [st("SC", 2, "pink")], 2)]);
    const g = buildGraph(content);
    expect(Array.from(nodeColorIndices(g, content, []))).toEqual([0, 0]);
    expect(Array.from(nodeColorIndices(g, content, [{ id: "white" }, { id: "pink" }, { id: "pink" }]))).toEqual([1, 1]);
  });
});
