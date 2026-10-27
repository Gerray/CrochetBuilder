import { describe, it, expect } from "vitest";
import {
  PartContentSchema,
  RowSchema,
  StitchOpSchema,
  RepeatGroupSchema,
  StitchCodeSchema,
  STITCH_PROPERTIES,
  type PartContent,
  type StitchCode,
} from "./schema.js";

describe("PartContentSchema — valid input", () => {
  it("parses a minimal valid PartContent (magic ring round)", () => {
    const input: PartContent = {
      schemaVersion: 1,
      rows: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          type: "round",
          ops: [
            { kind: "stitch", code: "MR", count: 1 },
            { kind: "stitch", code: "SC", count: 6 },
          ],
          stitchCountTarget: 6,
        },
      ],
    };

    const result = PartContentSchema.parse(input);
    expect(result.schemaVersion).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.ops).toHaveLength(2);
  });

  it("preserves optional fields (label, note, modifiers, into)", () => {
    const result = PartContentSchema.parse({
      schemaVersion: 1,
      rows: [
        {
          id: "row-1",
          label: "Rnd 2",
          type: "round",
          note: "work into back loops",
          ops: [
            {
              kind: "stitch",
              code: "SC",
              count: 12,
              modifiers: ["BLO"],
              into: "next stitch",
            },
          ],
          stitchCountTarget: 12,
        },
      ],
    });

    const op = result.rows[0]?.ops[0];
    expect(op).toMatchObject({ code: "SC", count: 12, modifiers: ["BLO"], into: "next stitch" });
  });
});

describe("RepeatGroup — recursion via z.lazy", () => {
  it("parses a flat repeat group: 6× (1 SC, INC)", () => {
    const result = RepeatGroupSchema.parse({
      kind: "repeat",
      times: 6,
      ops: [
        { kind: "stitch", code: "SC", count: 1 },
        { kind: "stitch", code: "INC", count: 1 },
      ],
    });
    expect(result.kind).toBe("repeat");
    expect(result.times).toBe(6);
    expect(result.ops).toHaveLength(2);
  });

  it("parses a nested repeat group inside a row (recursive tree)", () => {
    const result = PartContentSchema.parse({
      schemaVersion: 1,
      rows: [
        {
          id: "row-nested",
          type: "round",
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
          stitchCountTarget: 18,
        },
      ],
    });

    const outer = result.rows[0]?.ops[0];
    expect(outer?.kind).toBe("repeat");
    // Narrow to the recursive branch and assert the nested group survived parsing.
    if (outer?.kind === "repeat") {
      const inner = outer.ops[1];
      expect(inner?.kind).toBe("repeat");
      if (inner?.kind === "repeat") {
        expect(inner.times).toBe(3);
        expect(inner.ops[0]).toMatchObject({ kind: "stitch", code: "INC" });
      }
    }
  });
});

describe("PartContentSchema — invalid input is rejected", () => {
  it("rejects a row missing stitchCountTarget", () => {
    const bad = {
      schemaVersion: 1,
      rows: [
        {
          id: "row-1",
          type: "round",
          ops: [{ kind: "stitch", code: "SC", count: 6 }],
          // stitchCountTarget intentionally omitted
        },
      ],
    };
    expect(() => PartContentSchema.parse(bad)).toThrow();
    expect(PartContentSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown stitch code", () => {
    const bad = {
      schemaVersion: 1,
      rows: [
        {
          id: "row-1",
          type: "round",
          ops: [{ kind: "stitch", code: "XYZ", count: 1 }],
          stitchCountTarget: 1,
        },
      ],
    };
    expect(() => PartContentSchema.parse(bad)).toThrow();
  });

  it("rejects a wrong schemaVersion", () => {
    expect(
      PartContentSchema.safeParse({ schemaVersion: 2, rows: [] }).success,
    ).toBe(false);
  });

  it("rejects a non-positive count", () => {
    expect(
      StitchOpSchema.safeParse({ kind: "stitch", code: "SC", count: 0 }).success,
    ).toBe(false);
  });

  it("rejects unknown extra keys (strict objects)", () => {
    const bad = {
      id: "row-1",
      type: "round",
      ops: [],
      stitchCountTarget: 0,
      bogus: true,
    };
    expect(RowSchema.safeParse(bad).success).toBe(false);
  });
});

describe("STITCH_PROPERTIES", () => {
  it("covers every StitchCode", () => {
    for (const code of StitchCodeSchema.options) {
      expect(STITCH_PROPERTIES).toHaveProperty(code);
      expect(typeof STITCH_PROPERTIES[code].producesStitches).toBe("number");
    }
  });

  it("has no entries for codes outside StitchCode", () => {
    const known = new Set<string>(StitchCodeSchema.options);
    for (const key of Object.keys(STITCH_PROPERTIES)) {
      expect(known.has(key)).toBe(true);
    }
    // Exact 1:1 coverage in both directions.
    expect(Object.keys(STITCH_PROPERTIES).length).toBe(StitchCodeSchema.options.length);
  });

  it("encodes the documented producesStitches values", () => {
    const expected: Record<StitchCode, number> = {
      CH: 0,
      SL_ST: 1,
      SC: 1,
      HDC: 1,
      DC: 1,
      TR: 1,
      DTR: 1,
      MR: 0,
      INC: 2,
      DEC: 1,
      INVDEC: 1,
      ST: 1,
    };
    for (const code of StitchCodeSchema.options) {
      expect(STITCH_PROPERTIES[code].producesStitches).toBe(expected[code]);
    }
  });
});
