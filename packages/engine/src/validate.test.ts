import { describe, it, expect } from "vitest";
import {
  validate,
  checkConsumes,
  anchorsOffered,
  anchorsConsumed,
  isRingRow,
  checkEmptyRepeats,
} from "./validate.js";
import { STITCH_PROPERTIES, StitchCodeSchema, consumesOf } from "./schema.js";
import type { Mod, Op, PartContent, Row, StitchCode } from "./schema.js";

function st(code: StitchCode, count = 1, modifiers?: Mod[]): Op {
  return modifiers ? { kind: "stitch", code, count, modifiers } : { kind: "stitch", code, count };
}
function rep(times: number, ops: Op[]): Op {
  return { kind: "repeat", times, ops };
}
function row(id: string, ops: Op[], stitchCountTarget: number, extra: Partial<Row> = {}): Row {
  return { id, type: "round", ops, stitchCountTarget, ...extra };
}
function part(rows: Row[]): PartContent {
  return { schemaVersion: 1, rows };
}

/** The amigurumi sphere from docs/FORMAT.md — every check passes. */
const SPHERE = part([
  row("r1", [st("MR"), st("SC", 6)], 6),
  row("r2", [st("INC", 6)], 12),
  row("r3", [rep(6, [st("SC"), st("INC")])], 18),
  row("r4", [rep(6, [st("SC", 2), st("INC")])], 24),
  row("r5", [st("SC", 24)], 24),
  row("r6", [rep(6, [st("SC", 2), st("DEC")])], 18),
  row("r7", [rep(6, [st("SC"), st("DEC")])], 12),
  row("r8", [st("DEC", 6)], 6),
]);

describe("STITCH_PROPERTIES.consumesStitches", () => {
  it("is defined for every code and mirrors crochet mechanics", () => {
    for (const code of StitchCodeSchema.options) {
      expect(typeof STITCH_PROPERTIES[code].consumesStitches).toBe("number");
    }
    expect(STITCH_PROPERTIES.INC).toEqual({ producesStitches: 2, consumesStitches: 1 });
    expect(STITCH_PROPERTIES.DEC).toEqual({ producesStitches: 1, consumesStitches: 2 });
    expect(STITCH_PROPERTIES.INVDEC.consumesStitches).toBe(2);
    expect(STITCH_PROPERTIES.CH.consumesStitches).toBe(0);
    expect(STITCH_PROPERTIES.MR.consumesStitches).toBe(0);
  });

  it("keeps producesStitches exactly as TellmeCrochet defines it", () => {
    const expected: Record<StitchCode, number> = {
      CH: 0, SL_ST: 1, SC: 1, HDC: 1, DC: 1, TR: 1, DTR: 1, MR: 0, INC: 2, DEC: 1, INVDEC: 1, ST: 1,
    };
    for (const code of StitchCodeSchema.options) {
      expect(STITCH_PROPERTIES[code].producesStitches).toBe(expected[code]);
    }
  });

  it("TOG raises a 1-consuming stitch to 2 (sc2tog) and leaves others alone", () => {
    expect(consumesOf({ kind: "stitch", code: "SC", count: 1, modifiers: ["TOG"] })).toBe(2);
    expect(consumesOf({ kind: "stitch", code: "SC", count: 1 })).toBe(1);
    expect(consumesOf({ kind: "stitch", code: "DEC", count: 1, modifiers: ["TOG"] })).toBe(2);
    expect(consumesOf({ kind: "stitch", code: "CH", count: 1, modifiers: ["TOG"] })).toBe(0);
  });
});

describe("anchors", () => {
  it("a foundation chain offers one anchor per chain, although it produces 0 fabric stitches", () => {
    const chain = row("f", [st("CH", 11)], 0, { type: "row" });
    expect(anchorsOffered(chain)).toBe(11);
    expect(anchorsConsumed(chain)).toBe(0);
  });

  it("a normal row offers its fabric stitches and consumes per code", () => {
    expect(anchorsOffered(SPHERE.rows[2]!)).toBe(18);
    expect(anchorsConsumed(SPHERE.rows[2]!)).toBe(12);
    expect(anchorsConsumed(SPHERE.rows[5]!)).toBe(24); // 6 × (2 SC + DEC) = 6 × (2 + 2)
  });

  it("recognises a ring row", () => {
    expect(isRingRow(SPHERE.rows[0]!)).toBe(true);
    expect(isRingRow(SPHERE.rows[1]!)).toBe(false);
  });
});

describe("checkConsumes", () => {
  it("passes the sphere", () => {
    expect(checkConsumes(SPHERE)).toEqual([]);
  });

  it("passes a flat piece on a foundation chain, with turning chains", () => {
    const flat = part([
      row("f", [st("CH", 7)], 0, { type: "row" }),
      row("1", [st("SC", 6)], 6, { type: "row" }),
      row("2", [st("CH"), st("SC", 6)], 6, { type: "row" }),
      row("3", [st("CH", 2), st("DC", 6)], 6, { type: "row" }),
    ]);
    // Row 1 works into 6 of 7 chains (the first chain is the turning chain): a warning, not an error.
    const findings = checkConsumes(flat);
    expect(findings.map((f) => [f.rowId, f.code])).toEqual([["1", "CONSUMES_UNDERFLOW"]]);
  });

  it("flags a round that works into more stitches than the previous one has", () => {
    const broken = part([
      row("r1", [st("MR"), st("SC", 6)], 6),
      row("r2", [st("INC", 6)], 12),
      row("r3", [rep(6, [st("SC", 2), st("INC")])], 24), // consumes 18, previous offers 12
    ]);
    const findings = checkConsumes(broken);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rowId: "r3",
      severity: "error",
      code: "CONSUMES_OVERFLOW",
      expected: 12,
      actual: 18,
    });
  });

  it("warns when stitches are left unworked", () => {
    const shaped = part([
      row("r1", [st("MR"), st("SC", 6)], 6),
      row("r2", [st("INC", 6)], 12),
      row("r3", [st("SC", 10)], 10),
    ]);
    expect(checkConsumes(shaped)[0]).toMatchObject({ rowId: "r3", severity: "warning", code: "CONSUMES_UNDERFLOW" });
  });

  it("errors when the first row has nothing to work into", () => {
    const orphan = part([row("r1", [st("SC", 6)], 6)]);
    expect(checkConsumes(orphan)[0]).toMatchObject({ rowId: "r1", code: "NO_ANCHOR_ROW", severity: "error" });
  });

  it("skips instruction rows without breaking the chain", () => {
    const withNote = part([
      row("r1", [st("MR"), st("SC", 6)], 6),
      row("eyes", [], 0, { note: "Insert safety eyes" }),
      row("r2", [st("INC", 6)], 12),
    ]);
    expect(checkConsumes(withNote)).toEqual([]);
  });
});

describe("validate", () => {
  it("returns nothing for a correct part", () => {
    expect(validate(SPHERE)).toEqual([]);
  });

  it("merges stitch-count and consumes findings in document order, count first within a row", () => {
    const broken = part([
      row("r1", [st("MR"), st("SC", 6)], 6),
      row("r2", [st("INC", 6)], 13), // produces 12, declares 13
      row("r3", [st("SC", 20)], 20), // consumes 20, previous offers 12
    ]);
    const codes = validate(broken).map((f) => [f.rowId, f.code]);
    expect(codes).toEqual([
      ["r2", "STITCH_COUNT_MISMATCH"],
      ["r3", "CONSUMES_OVERFLOW"],
    ]);
  });
});

describe("checkEmptyRepeats", () => {
  it("warns once per row with empty repeat groups", () => {
    const content: PartContent = {
      schemaVersion: 1,
      rows: [
        {
          id: "a",
          type: "round",
          ops: [
            { kind: "stitch", code: "MR", count: 1 },
            { kind: "stitch", code: "SC", count: 6 },
            { kind: "repeat", times: 6, ops: [] },
          ],
          stitchCountTarget: 6,
        },
        {
          id: "b",
          type: "round",
          ops: [
            {
              kind: "repeat",
              times: 2,
              ops: [
                { kind: "stitch", code: "INC", count: 3 },
                { kind: "repeat", times: 2, ops: [] },
              ],
            },
          ],
          stitchCountTarget: 12,
        },
      ],
    };
    expect(checkEmptyRepeats(content).map((f) => [f.rowId, f.code, f.severity, f.actual])).toEqual([
      ["a", "EMPTY_REPEAT", "warning", 1],
      ["b", "EMPTY_REPEAT", "warning", 1],
    ]);
    expect(validate(content).map((f) => f.code)).toEqual(["EMPTY_REPEAT", "EMPTY_REPEAT"]);
  });
});
