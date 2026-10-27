import { describe, it, expect } from "vitest";
import { computeRowStitches, checkPart } from "./stitch-count.js";
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

describe("computeRowStitches", () => {
  it("counts a single INC op ×6 as 12 (INC produces 2 stitches)", () => {
    const r = row({ ops: [{ kind: "stitch", code: "INC", count: 6 }] });
    expect(computeRowStitches(r)).toBe(12);
  });

  it("counts a pure SC row (6 SC → 6)", () => {
    const r = row({ ops: [{ kind: "stitch", code: "SC", count: 6 }] });
    expect(computeRowStitches(r)).toBe(6);
  });

  it("sums multiple ops in a row (1 SC + INC → 1 + 2 = 3)", () => {
    const r = row({
      ops: [
        { kind: "stitch", code: "SC", count: 1 },
        { kind: "stitch", code: "INC", count: 1 },
      ],
    });
    expect(computeRowStitches(r)).toBe(3);
  });

  it("counts DEC as 1 per worked instance (6 DEC → 6)", () => {
    const r = row({ ops: [{ kind: "stitch", code: "DEC", count: 6 }] });
    expect(computeRowStitches(r)).toBe(6);
  });

  it("treats INVDEC like DEC (produces 1)", () => {
    const r = row({ ops: [{ kind: "stitch", code: "INVDEC", count: 4 }] });
    expect(computeRowStitches(r)).toBe(4);
  });

  it("counts a leading CH as 0 (turning/standing chain adds no stitch)", () => {
    const r = row({
      ops: [
        { kind: "stitch", code: "CH", count: 1 },
        { kind: "stitch", code: "SC", count: 10 },
      ],
    });
    expect(computeRowStitches(r)).toBe(10);
  });

  it("counts a magic-ring opener as 0 (MR + 6 SC → 6)", () => {
    const r = row({
      ops: [
        { kind: "stitch", code: "MR", count: 1 },
        { kind: "stitch", code: "SC", count: 6 },
      ],
    });
    expect(computeRowStitches(r)).toBe(6);
  });

  it("ignores the display-only `into` note (does not change the count)", () => {
    const withInto = row({
      ops: [{ kind: "stitch", code: "SC", count: 8, into: "next chain space" }],
    });
    const without = row({ ops: [{ kind: "stitch", code: "SC", count: 8 }] });
    expect(computeRowStitches(withInto)).toBe(8);
    expect(computeRowStitches(withInto)).toBe(computeRowStitches(without));
  });

  it("ignores modifiers (BLO/FLO/TOG do not change the count)", () => {
    const r = row({
      ops: [{ kind: "stitch", code: "SC", count: 12, modifiers: ["BLO"] }],
    });
    expect(computeRowStitches(r)).toBe(12);
  });

  it("expands a flat repeat group: 6× (1 SC, INC) → 6×3 = 18", () => {
    const r = row({
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
    });
    expect(computeRowStitches(r)).toBe(18);
  });

  it("expands nested repeat groups recursively (2× (3 SC, 3× INC)) → 2×(3 + 6) = 18", () => {
    const r = row({
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
    });
    expect(computeRowStitches(r)).toBe(18);
  });

  it("returns 0 for a row with no stitch-producing ops (MR only)", () => {
    const r = row({ ops: [{ kind: "stitch", code: "MR", count: 1 }] });
    expect(computeRowStitches(r)).toBe(0);
  });
});

describe("checkPart", () => {
  it("flags ok=true when computed actual matches the declared target", () => {
    const content: PartContent = {
      schemaVersion: 1,
      rows: [
        row({
          id: "rnd-1",
          ops: [
            { kind: "stitch", code: "MR", count: 1 },
            { kind: "stitch", code: "SC", count: 6 },
          ],
          stitchCountTarget: 6,
        }),
      ],
    };
    expect(checkPart(content)).toEqual([
      { rowId: "rnd-1", expected: 6, actual: 6, ok: true },
    ]);
  });

  it("produces a finding (ok=false) at the right rowId when soll ≠ ist", () => {
    const content: PartContent = {
      schemaVersion: 1,
      rows: [
        row({
          id: "rnd-good",
          ops: [{ kind: "stitch", code: "SC", count: 6 }],
          stitchCountTarget: 6,
        }),
        row({
          id: "rnd-bad",
          // 6× (1 SC, INC) = 18, but the author declared 17.
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
          stitchCountTarget: 17,
        }),
      ],
    };

    const result = checkPart(content);
    expect(result).toEqual([
      { rowId: "rnd-good", expected: 6, actual: 6, ok: true },
      { rowId: "rnd-bad", expected: 17, actual: 18, ok: false },
    ]);

    // The failing finding carries the offending row's id, not its neighbour's.
    const failing = result.filter((r) => !r.ok);
    expect(failing).toHaveLength(1);
    expect(failing[0]?.rowId).toBe("rnd-bad");
  });

  it("returns one finding per row, in document order", () => {
    const content: PartContent = {
      schemaVersion: 1,
      rows: [
        row({ id: "a", ops: [{ kind: "stitch", code: "SC", count: 1 }], stitchCountTarget: 1 }),
        row({ id: "b", ops: [{ kind: "stitch", code: "SC", count: 2 }], stitchCountTarget: 2 }),
        row({ id: "c", ops: [{ kind: "stitch", code: "SC", count: 3 }], stitchCountTarget: 3 }),
      ],
    };
    expect(checkPart(content).map((r) => r.rowId)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for a part with no rows", () => {
    expect(checkPart({ schemaVersion: 1, rows: [] })).toEqual([]);
  });
});
