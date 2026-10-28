import { describe, expect, it } from "vitest";
import { BuilderExportSchema, MaterialSchema, renderedRows, type BuilderExport } from "./export.js";
import { parseRowText } from "./notation.js";
import type { PartContent } from "./schema.js";
import { validate } from "./validate.js";

/** The amigurumi sphere from docs/FORMAT.md, verbatim. */
const SPHERE: PartContent = {
  schemaVersion: 1,
  rows: [
    { id: "r1", type: "round", ops: [{ kind: "stitch", code: "MR", count: 1 }, { kind: "stitch", code: "SC", count: 6 }], stitchCountTarget: 6 },
    { id: "r2", type: "round", ops: [{ kind: "stitch", code: "INC", count: 6 }], stitchCountTarget: 12 },
    { id: "r3", type: "round", ops: [{ kind: "repeat", times: 6, ops: [{ kind: "stitch", code: "SC", count: 1 }, { kind: "stitch", code: "INC", count: 1 }] }], stitchCountTarget: 18 },
    { id: "r4", type: "round", ops: [{ kind: "repeat", times: 6, ops: [{ kind: "stitch", code: "SC", count: 2 }, { kind: "stitch", code: "INC", count: 1 }] }], stitchCountTarget: 24 },
    { id: "r5", type: "round", ops: [{ kind: "stitch", code: "SC", count: 24 }], stitchCountTarget: 24 },
    { id: "r6", type: "round", ops: [{ kind: "repeat", times: 6, ops: [{ kind: "stitch", code: "SC", count: 2 }, { kind: "stitch", code: "DEC", count: 1 }] }], stitchCountTarget: 18 },
    { id: "r7", type: "round", ops: [{ kind: "repeat", times: 6, ops: [{ kind: "stitch", code: "SC", count: 1 }, { kind: "stitch", code: "DEC", count: 1 }] }], stitchCountTarget: 12 },
    { id: "r8", type: "round", ops: [{ kind: "stitch", code: "DEC", count: 6 }], stitchCountTarget: 6 },
  ],
};

function sphereExport(): BuilderExport {
  return {
    schemaVersion: 1,
    title: "Amigurumi-Kugel",
    overview: {
      materials: [
        { kind: "yarn", label: "Baumwollgarn DK", colors: ["Weiß"], amount: "20 g" },
        { kind: "hook", label: "Häkelnadel 3 mm" },
        { kind: "accessory", label: "Füllwatte" },
      ],
      gauge: { yarnWeight: "dk", hookMm: 3 },
      notes: "In Spiralrunden häkeln.",
    },
    parts: [{ name: "Kugel", quantity: 1, content: structuredClone(SPHERE) }],
    rendered: { locale: "de", rows: renderedRows(SPHERE, "de") },
  };
}

describe("BuilderExportSchema", () => {
  it("accepts the FORMAT.md sphere as a builder export", () => {
    const doc = sphereExport();
    expect(BuilderExportSchema.parse(doc)).toEqual(doc);
    expect(validate(SPHERE)).toEqual([]);
  });

  it("accepts a minimal export without optional fields", () => {
    expect(
      BuilderExportSchema.safeParse({ schemaVersion: 1, title: "", overview: {}, parts: [] }).success,
    ).toBe(true);
  });

  it("is strict at every level", () => {
    const withExtra = (patch: (d: Record<string, unknown>) => void) => {
      const doc = JSON.parse(JSON.stringify(sphereExport())) as Record<string, unknown>;
      patch(doc);
      return BuilderExportSchema.safeParse(doc).success;
    };
    expect(withExtra((d) => (d.extra = 1))).toBe(false);
    expect(withExtra((d) => ((d.overview as Record<string, unknown>).extra = 1))).toBe(false);
    expect(withExtra((d) => ((d.parts as Record<string, unknown>[])[0]!.extra = 1))).toBe(false);
    expect(withExtra((d) => ((d.rendered as Record<string, unknown>).extra = 1))).toBe(false);
    expect(withExtra((d) => ((d.overview as { gauge: Record<string, unknown> }).gauge.extra = 1))).toBe(false);
  });

  it("rejects wrong versions, locales, quantities and row shapes", () => {
    const bad = (patch: (d: BuilderExport) => void) => {
      const doc = sphereExport();
      patch(doc);
      return BuilderExportSchema.safeParse(doc).success;
    };
    expect(bad((d) => ((d as { schemaVersion: number }).schemaVersion = 3))).toBe(false);
    expect(bad((d) => ((d.rendered as { locale: string }).locale = "fr"))).toBe(false);
    expect(bad((d) => (d.parts[0]!.quantity = 0))).toBe(false);
    expect(bad((d) => ((d.parts[0]!.content.rows[0] as { stitchCountTarget: number }).stitchCountTarget = -1))).toBe(
      false,
    );
  });
});

describe("MaterialSchema", () => {
  it("accepts the three kinds and rejects others", () => {
    expect(MaterialSchema.safeParse({ kind: "yarn", label: "Garn" }).success).toBe(true);
    expect(MaterialSchema.safeParse({ kind: "hook", label: "3 mm" }).success).toBe(true);
    expect(MaterialSchema.safeParse({ kind: "accessory", label: "Augen", amount: "2 Stück" }).success).toBe(true);
    expect(MaterialSchema.safeParse({ kind: "needle", label: "x" }).success).toBe(false);
    expect(MaterialSchema.safeParse({ kind: "yarn" }).success).toBe(false);
    expect(MaterialSchema.safeParse({ kind: "yarn", label: "x", price: 3 }).success).toBe(false);
  });
});

describe("renderedRows", () => {
  it("renders the sphere in German", () => {
    expect(renderedRows(SPHERE, "de")).toEqual([
      "Runde 1: 1 MR, 6 fM (6)",
      "Runde 2: 6 Zun (12)",
      "Runde 3: 6× (1 fM, 1 Zun) (18)",
      "Runde 4: 6× (2 fM, 1 Zun) (24)",
      "Runde 5: 24 fM (24)",
      "Runde 6: 6× (2 fM, 1 Abn) (18)",
      "Runde 7: 6× (1 fM, 1 Abn) (12)",
      "Runde 8: 6 Abn (6)",
    ]);
  });

  it("renders US and UK terms", () => {
    expect(renderedRows(SPHERE, "en_us")[2]).toBe("Round 3: 6x (1 sc, 1 inc) (18)");
    expect(renderedRows(SPHERE, "en_uk")[0]).toBe("Round 1: 1 MR, 6 dc (6)");
  });

  it("handles labels, notes, rows and free instructions", () => {
    const content: PartContent = {
      schemaVersion: 1,
      rows: [
        { id: "a", type: "row", ops: [{ kind: "stitch", code: "CH", count: 11 }], stitchCountTarget: 0, label: "Anschlag" },
        { id: "b", type: "row", ops: [{ kind: "stitch", code: "SC", count: 10 }], stitchCountTarget: 10, note: "wenden" },
        { id: "c", type: "row", ops: [], stitchCountTarget: 0, note: "Faden wechseln" },
        { id: "d", type: "row", ops: [], stitchCountTarget: 0, label: "Pause", note: "Teil feststecken" },
        { id: "e", type: "row", ops: [], stitchCountTarget: 0 },
        { id: "f", type: "row", ops: [{ kind: "stitch", code: "SC", count: 10 }], stitchCountTarget: 10 },
      ],
    };
    expect(renderedRows(content, "de")).toEqual([
      "Anschlag: 11 Lm (0)",
      "Reihe 2: 10 fM (10) – wenden",
      "Faden wechseln",
      "Pause: Teil feststecken",
      "Reihe 3: 10 fM (10)",
    ]);
  });

  it("produces lines that parse back to the row's ops and target", () => {
    for (const [i, line] of renderedRows(SPHERE, "de").entries()) {
      const text = line.slice(line.indexOf(": ") + 2);
      const row = SPHERE.rows[i]!;
      expect(parseRowText(text, "de")).toEqual({ ok: true, ops: row.ops, stitchCountTarget: row.stitchCountTarget });
    }
  });
});
