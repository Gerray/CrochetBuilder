import { describe, expect, it } from "vitest";
import { computeRowStitches, parseRowText, type Op, type Row } from "@crochetbuilder/engine";
import {
  decreaseRound,
  increaseRound,
  isStitchRow,
  plainRound,
  previousCountAt,
  previousCounts,
  previousStitchRow,
  ringStart,
} from "./rounds.js";
import { suggestNextRow } from "./suggest.js";

/** Rows from German row texts ("" = empty row being written, "!…" = instruction). */
function rowsOf(...texts: string[]): Row[] {
  return texts.map((text, i) => {
    if (text === "") return { id: `r${i}`, type: "round", ops: [], stitchCountTarget: 0 };
    if (text.startsWith("!")) return { id: `r${i}`, type: "round", ops: [], stitchCountTarget: 0, note: text.slice(1) };
    const parsed = parseRowText(text, "de");
    if (!parsed.ok) throw new Error(`unreadable: ${text}`);
    const row: Row = { id: `r${i}`, type: "round", ops: parsed.ops, stitchCountTarget: 0 };
    return { ...row, stitchCountTarget: computeRowStitches(row) };
  });
}

/** The suggested text after `texts` (for a new row at the end). */
const next = (...texts: string[]) => suggestNextRow(rowsOf(...texts), texts.length);

describe("round building blocks", () => {
  it("builds ring starts, plain, increase and decrease rounds", () => {
    expect(ringStart()).toEqual({
      ops: [
        { kind: "stitch", code: "MR", count: 1 },
        { kind: "stitch", code: "SC", count: 6 },
      ],
      count: 6,
    });
    expect(plainRound(24)).toEqual({ ops: [{ kind: "stitch", code: "SC", count: 24 }], count: 24 });
    expect(increaseRound(6)).toEqual({ ops: [{ kind: "stitch", code: "INC", count: 6 }], count: 12 });
    const inc18: Op = {
      kind: "repeat",
      times: 6,
      ops: [
        { kind: "stitch", code: "SC", count: 2 },
        { kind: "stitch", code: "INC", count: 1 },
      ],
    };
    expect(increaseRound(18)).toEqual({ ops: [inc18], count: 24 });
    expect(increaseRound(16, 8)?.count).toBe(24);
    expect(decreaseRound(12)).toEqual({ ops: [{ kind: "stitch", code: "DEC", count: 6 }], count: 6 });
    expect(decreaseRound(24)?.count).toBe(18);
  });

  it("refuses rounds that do not divide evenly", () => {
    expect(increaseRound(20)).toBeNull();
    expect(increaseRound(3)).toBeNull();
    expect(decreaseRound(6)).toBeNull(); // one stitch per section cannot be decreased
    expect(decreaseRound(20)).toBeNull();
  });

  it("finds the previous stitch row and its count, skipping instructions and empty rows", () => {
    const rows = rowsOf("1 MR, 6 fM", "6 Zun", "!Augen einsetzen", "", "20 Lm", "");
    expect(rows.map(isStitchRow)).toEqual([true, true, false, false, true, false]);
    expect(previousStitchRow(rows, 0)).toBeUndefined();
    expect(previousStitchRow(rows, 3)?.id).toBe("r1");
    expect(previousCountAt(rows, 0)).toBeUndefined();
    expect(previousCountAt(rows, 1)).toBe(6);
    expect(previousCountAt(rows, 4)).toBe(12);
    // A foundation chain offers one stitch per chain.
    expect(previousCountAt(rows, 5)).toBe(20);
    expect(previousCounts(rows)).toEqual([undefined, 6, 12, 12, 12, 20]);
  });
});

describe("next-round suggestion", () => {
  it("starts with a magic ring", () => {
    expect(next()).toMatchObject({ text: "1 MR, 6 fM", count: 6, kind: "start" });
    expect(next("!Garn bereitlegen")).toMatchObject({ text: "1 MR, 6 fM", count: 6 });
  });

  it("continues an increase progression", () => {
    expect(next("1 MR, 6 fM")).toMatchObject({ text: "6 Zun", count: 12, kind: "increase" });
    expect(next("1 MR, 6 fM", "6 Zun")).toMatchObject({ text: "6× (1 fM, 1 Zun)", count: 18 });
    expect(next("1 MR, 6 fM", "6 Zun", "6× (1 fM, 1 Zun)")).toMatchObject({ text: "6× (2 fM, 1 Zun)", count: 24 });
    expect(next("1 MR, 6 fM", "6 Zun", "6× (1 fM, 1 Zun)", "6× (2 fM, 1 Zun)")).toMatchObject({
      text: "6× (3 fM, 1 Zun)",
      count: 30,
    });
    // Eight sections work the same way.
    expect(next("1 MR, 8 fM", "8 Zun")).toMatchObject({ text: "8× (1 fM, 1 Zun)", count: 24 });
  });

  it("does not guess an increase from a single one after even rounds", () => {
    expect(next("24 fM", "24 fM", "6× (3 fM, 1 Zun)")).toMatchObject({ text: "30 fM", count: 30, kind: "even" });
  });

  it("continues decreases with the mirror pattern", () => {
    expect(next("24 fM", "6× (2 fM, 1 Abn)")).toMatchObject({ text: "6× (1 fM, 1 Abn)", count: 12, kind: "decrease" });
    expect(next("24 fM", "6× (2 fM, 1 Abn)", "6× (1 fM, 1 Abn)")).toMatchObject({ text: "6 Abn", count: 6 });
    expect(next("36 fM", "6× (4 fM, 1 Abn)")).toMatchObject({ text: "6× (3 fM, 1 Abn)", count: 24 });
  });

  it("suggests an even round otherwise", () => {
    expect(next("1 MR, 6 fM", "6 Zun", "6× (1 fM, 1 Zun)", "18 fM")).toMatchObject({ text: "18 fM", count: 18, kind: "even" });
    // After the last decrease to 6 nothing smaller can be decreased evenly.
    expect(next("12 fM", "6 Abn")).toMatchObject({ text: "6 fM", count: 6 });
    // A plain round of another stitch is copied, as is a flat row with its turning chain.
    expect(next("24 hStb")).toMatchObject({ text: "24 hStb", count: 24 });
    expect(next("20 Lm", "1 Lm, 20 fM")).toMatchObject({ text: "1 Lm, 20 fM", count: 20 });
    // After a foundation chain: one stitch into each chain.
    expect(next("20 Lm")).toMatchObject({ text: "20 fM", count: 20 });
  });

  it("looks only at the rows before the given index and skips instructions", () => {
    const rows = rowsOf("1 MR, 6 fM", "6 Zun", "!Füllen", "6× (1 fM, 1 Zun)");
    expect(suggestNextRow(rows, 2)).toMatchObject({ text: "6× (1 fM, 1 Zun)" });
    expect(suggestNextRow(rows, 3)).toMatchObject({ text: "6× (1 fM, 1 Zun)" });
    expect(suggestNextRow(rows, 4)).toMatchObject({ text: "6× (2 fM, 1 Zun)" });
  });

  it("every suggestion parses back to its own ops", () => {
    const cases = [next(), next("1 MR, 6 fM"), next("24 fM", "6× (2 fM, 1 Abn)"), next("20 Lm", "1 Lm, 20 fM")];
    for (const s of cases) {
      const parsed = parseRowText(s.text, "de");
      expect(parsed.ok && parsed.ops).toEqual(s.ops);
    }
  });
});
