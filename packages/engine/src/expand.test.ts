import { describe, it, expect } from "vitest";
import {
  expandPart,
  expandRow,
  isInstructionRow,
  instructionText,
  rowOrdinals,
} from "./expand.js";
import type { PartContent, Row } from "./schema.js";

/** Build a Row with sensible defaults so each test only states what it cares about. */
function row(partial: Partial<Row> & Pick<Row, "ops">): Row {
  return {
    id: "row-1",
    type: "round",
    stitchCountTarget: 0,
    ...partial,
  };
}

/** Build a PartContent from a list of rows. */
function part(rows: Row[]): PartContent {
  return { schemaVersion: 1, rows };
}

describe("expandPart", () => {
  it("expands a plain stitch op count into that many atomic stitches", () => {
    const content = part([
      row({ id: "r", ops: [{ kind: "stitch", code: "SC", count: 6 }] }),
    ]);
    const atoms = expandPart(content);
    expect(atoms).toHaveLength(6);
    expect(atoms.every((a) => a.code === "SC")).toBe(true);
  });

  it("counts INC ×6 as 6 atomic taps (NOT 12 — that is the fabric count, not the tap-basis)", () => {
    // The %-basis is taps, not fabric stitches: INC ×6 = 6 taps but stitchCountTarget 12.
    const content = part([
      row({ id: "r", ops: [{ kind: "stitch", code: "INC", count: 6 }], stitchCountTarget: 12 }),
    ]);
    expect(expandPart(content)).toHaveLength(6);
  });

  it("stamps a contiguous, gap-free globalIndex across rows", () => {
    const content = part([
      row({ id: "a", ops: [{ kind: "stitch", code: "SC", count: 3 }] }),
      row({ id: "b", ops: [{ kind: "stitch", code: "SC", count: 2 }] }),
    ]);
    const atoms = expandPart(content);
    expect(atoms.map((a) => a.globalIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it("stamps the right rowId and rowIndex per atom (in document order)", () => {
    const content = part([
      row({ id: "a", ops: [{ kind: "stitch", code: "SC", count: 2 }] }),
      row({ id: "b", ops: [{ kind: "stitch", code: "DC", count: 1 }] }),
    ]);
    const atoms = expandPart(content);
    expect(atoms.map((a) => [a.rowId, a.rowIndex, a.code])).toEqual([
      ["a", 0, "SC"],
      ["a", 0, "SC"],
      ["b", 1, "DC"],
    ]);
  });

  it("multiplies out a flat repeat group: 6× (1 SC, 1 INC) → 12 atomic taps", () => {
    const content = part([
      row({
        id: "r",
        ops: [
          {
            kind: "repeat",
            times: 6,
            ops: [
              { kind: "stitch", code: "SC", count: 1 },
              { kind: "stitch", code: "INC", count: 1 },
            ],
          },
        ],
      }),
    ]);
    const atoms = expandPart(content);
    expect(atoms).toHaveLength(12);
    // Pattern repeats SC, INC six times.
    expect(atoms.map((a) => a.code)).toEqual([
      "SC", "INC", "SC", "INC", "SC", "INC",
      "SC", "INC", "SC", "INC", "SC", "INC",
    ]);
  });

  it("multiplies out nested repeat groups: 2× (3 SC, 3× (1 INC)) → 2×(3+3) = 12", () => {
    const content = part([
      row({
        id: "r",
        ops: [
          {
            kind: "repeat",
            times: 2,
            ops: [
              { kind: "stitch", code: "SC", count: 3 },
              {
                kind: "repeat",
                times: 3,
                ops: [{ kind: "stitch", code: "INC", count: 1 }],
              },
            ],
          },
        ],
      }),
    ]);
    expect(expandPart(content)).toHaveLength(12);
  });

  it("treats MR and leading CH as atomic taps (they are individual taps, fabric-count 0)", () => {
    const content = part([
      row({
        id: "r",
        ops: [
          { kind: "stitch", code: "MR", count: 1 },
          { kind: "stitch", code: "SC", count: 6 },
        ],
      }),
    ]);
    // 1 MR + 6 SC = 7 taps (MR adds 0 fabric stitches but is still one tap).
    const atoms = expandPart(content);
    expect(atoms).toHaveLength(7);
    expect(atoms[0]?.code).toBe("MR");
  });

  it("does not let the display-only `into` note or modifiers add extra atoms", () => {
    const withExtras = part([
      row({
        id: "r",
        ops: [{ kind: "stitch", code: "SC", count: 8, into: "next ch space", modifiers: ["BLO"] }],
      }),
    ]);
    const plain = part([row({ id: "r", ops: [{ kind: "stitch", code: "SC", count: 8 }] })]);
    expect(expandPart(withExtras)).toHaveLength(8);
    expect(expandPart(withExtras).length).toBe(expandPart(plain).length);
  });

  it("skips null-op rows entirely (they produce no atomic stitches)", () => {
    const content = part([
      row({ id: "a", ops: [{ kind: "stitch", code: "SC", count: 4 }] }),
      row({ id: "turn", ops: [] }),
      row({ id: "b", ops: [{ kind: "stitch", code: "SC", count: 2 }] }),
    ]);
    const atoms = expandPart(content);
    expect(atoms).toHaveLength(6);
    expect(atoms.some((a) => a.rowId === "turn")).toBe(false);
    // globalIndex stays contiguous across the skipped row.
    expect(atoms.map((a) => a.globalIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("returns an empty list for a part with no rows", () => {
    expect(expandPart(part([]))).toEqual([]);
  });

  it("expandRow gives a row's atomic stitches independent of the part", () => {
    const r = row({
      id: "r",
      ops: [
        { kind: "stitch", code: "SC", count: 2 },
        { kind: "stitch", code: "INC", count: 1 },
      ],
    });
    expect(expandRow(r).map((a) => a.code)).toEqual(["SC", "SC", "INC"]);
  });

  it("expandRow carries an op's modifiers onto each atom, only when present", () => {
    const r = row({
      id: "r",
      ops: [
        { kind: "stitch", code: "SC", count: 2, modifiers: ["BLO"] },
        { kind: "stitch", code: "INC", count: 1, modifiers: [] },
        {
          kind: "repeat",
          times: 2,
          ops: [{ kind: "stitch", code: "DEC", count: 1, modifiers: ["FLO", "TOG"] }],
        },
      ],
    });
    expect(expandRow(r)).toEqual([
      { code: "SC", modifiers: ["BLO"] },
      { code: "SC", modifiers: ["BLO"] },
      { code: "INC" },
      { code: "DEC", modifiers: ["FLO", "TOG"] },
      { code: "DEC", modifiers: ["FLO", "TOG"] },
    ]);
    // Empty modifier lists never produce the key (strict shape for plain stitches).
    expect(Object.keys(expandRow(r)[2]!)).toEqual(["code"]);
  });
});

describe("free instruction rows", () => {
  it("yield exactly one NOTE atom; empty rows none", () => {
    const content = part([
      row({ id: "a", ops: [{ kind: "stitch", code: "SC", count: 2 }] }),
      row({ id: "eyes", ops: [], note: "Insert safety eyes between rounds 4 and 5" }),
      row({ id: "blank", ops: [] }),
      row({ id: "sew", ops: [], label: "Sew head to body" }),
    ]);
    expect(expandPart(content).map((a) => a.code)).toEqual(["SC", "SC", "NOTE", "NOTE"]);
    expect(isInstructionRow(content.rows[1]!)).toBe(true);
    expect(isInstructionRow(content.rows[2]!)).toBe(false);
    expect(instructionText(content.rows[3]!)).toBe("Sew head to body");
  });
});

describe("rowOrdinals", () => {
  it("nummeriert nur Zeilen mit Maschen — Anweisungen verschieben die Runden nicht", () => {
    const sc = (id: string): Row => ({
      id,
      type: "round",
      ops: [{ kind: "stitch", code: "SC", count: 1 }],
      stitchCountTarget: 1,
    });
    const note = (id: string): Row => ({ id, type: "round", ops: [], stitchCountTarget: 0, note: "Augen" });
    expect(rowOrdinals([note("a"), sc("1"), sc("2"), note("b"), sc("3")])).toEqual([0, 1, 2, 2, 3]);
  });
});
