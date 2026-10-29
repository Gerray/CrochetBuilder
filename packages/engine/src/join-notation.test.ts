/** Join phrases in the row notation: rendering, reading back, and what people write. */
import { describe, expect, it } from "vitest";
import { extractJoins, renderJoin, type JoinNotationPart } from "./join-notation.js";
import { parseRowText, renderOps, renderRow, type NotationLocale } from "./notation.js";
import type { Op } from "./schema.js";
import { content, rnd, st, tube } from "./test/join-fixtures.js";

const legRows = tube("l", 18, 4);
const PARTS: JoinNotationPart[] = [
  { id: "leg", name: "Bein", quantity: 2, rows: legRows },
  { id: "body", name: "Körper", quantity: 1 },
  { id: "arm", name: "Arm", quantity: 2 },
  { id: "pumpkin", name: "Kürbis", quantity: 1, rows: content([...tube("p", 24, 2)]).rows },
];
const EN_PARTS: JoinNotationPart[] = [
  { id: "leg", name: "Leg", quantity: 2, rows: legRows },
  { id: "body", name: "Body", quantity: 1 },
  { id: "arm", name: "Arm", quantity: 1 },
];

const parse = (text: string, locale: NotationLocale = "de", parts = PARTS) => parseRowText(text, locale, { parts });
const opsOf = (text: string, locale: NotationLocale = "de", parts = PARTS): Op[] => {
  const r = parse(text, locale, parts);
  if (!r.ok) throw new Error(`${text}: ${r.code} ${r.term ?? ""}`);
  return r.ops;
};

describe("rendering joins", () => {
  it("names the part, its copy, row and start", () => {
    expect(renderJoin("from", { part: "leg", copy: 2 }, "de", PARTS)).toBe(" aus Teil Bein 2");
    expect(renderJoin("from", { part: "leg" }, "de", PARTS)).toBe(" aus Teil Bein 1");
    expect(renderJoin("from", { part: "pumpkin", row: "pe2" }, "de", PARTS)).toBe(" aus Teil Kürbis (Runde 6)");
    expect(renderJoin("from", { part: "pumpkin", start: 6 }, "en_us", PARTS)).toBe(" from part Kürbis (from st 7)");
    expect(renderJoin("through", { part: "body" }, "de", PARTS)).toBe(" zusammen mit Teil Körper");
    expect(renderJoin("through", { part: "body" }, "en_uk", PARTS)).toBe(" together with part Körper");
    expect(renderJoin("from", { part: "gone" }, "de", PARTS)).toBe(" aus Teil gone");
    const row = rnd("b1", [st("SC", 18, { from: { part: "leg", copy: 1 } }), st("SC", 3), st("SC", 18, { from: { part: "leg", copy: 2 } }), st("SC", 3)], 42, { around: true });
    expect(renderRow(row, "de", { parts: PARTS })).toBe("um die Lm-Kette: 18 fM aus Teil Bein 1, 3 fM, 18 fM aus Teil Bein 2, 3 fM");
    expect(renderRow(row, "en_us", { parts: EN_PARTS })).toBe("around the chain: 18 sc from part Leg 1, 3 sc, 18 sc from part Leg 2, 3 sc");
  });

  it("reads its own rendering back in every locale", () => {
    const ops: Op[] = [
      st("SC", 18, { from: { part: "leg", copy: 1 } }),
      { kind: "stitch", code: "SC", count: 3, modifiers: ["BLO"] },
      st("DEC", 3, { from: { part: "leg", copy: 2, row: "le2", start: 4 } }),
      { kind: "repeat", times: 2, ops: [st("SC", 2, { through: { part: "arm", copy: 2 } })] },
      st("SC", 5, { from: { part: "pumpkin" } }),
    ];
    for (const locale of ["de", "en_us", "en_uk"] as const) {
      expect(opsOf(renderOps(ops, locale, { parts: PARTS }), locale)).toEqual(ops);
    }
  });
});

describe("reading what people write", () => {
  it("reads “around leg 1”, “um das erste Bein”, “mit dem Arm”, “through the arm and body”", () => {
    expect(opsOf("18 fM um Bein 1, 3 fM, 18 fM um Bein 2, 3 fM (42)")).toEqual([
      st("SC", 18, { from: { part: "leg", copy: 1 } }),
      st("SC", 3),
      st("SC", 18, { from: { part: "leg", copy: 2 } }),
      st("SC", 3),
    ]);
    expect(opsOf("18 fM um das erste Bein")).toEqual([st("SC", 18, { from: { part: "leg", copy: 1 } })]);
    expect(opsOf("18 fM um das zweite Bein")).toEqual([st("SC", 18, { from: { part: "leg", copy: 2 } })]);
    expect(opsOf("18 sc around leg 1, 3 sc, 18 sc around the second leg, 3 sc", "en_us", EN_PARTS)).toEqual([
      st("SC", 18, { from: { part: "leg", copy: 1 } }),
      st("SC", 3),
      st("SC", 18, { from: { part: "leg", copy: 2 } }),
      st("SC", 3),
    ]);
    expect(opsOf("4 fM, 5 fM mit dem Arm, 4 fM")).toEqual([st("SC", 4), st("SC", 5, { through: { part: "arm" } }), st("SC", 4)]);
    expect(opsOf("5 sc through the arm and body", "en_us", EN_PARTS)).toEqual([st("SC", 5, { through: { part: "arm" } })]);
    expect(opsOf("5 sc through both layers of the arm and the body, 7 sc", "en_us", EN_PARTS)).toEqual([
      st("SC", 5, { through: { part: "arm" } }),
      st("SC", 7),
    ]);
    expect(opsOf("4 sc on the arm", "en_us", EN_PARTS)).toEqual([st("SC", 4, { through: { part: "arm" } })]);
    expect(opsOf("18 sc around the legs", "en_us", EN_PARTS)).toEqual([st("SC", 18, { from: { part: "leg" } })]);
    // A join after a written count and in the lenient pass ("sc around" is not "to the end").
    expect(parse("sc 18 around leg 1 (18)", "en_us", EN_PARTS)).toMatchObject({ ok: true, stitchCountTarget: 18 });
  });

  it("leaves text alone that does not name a part", () => {
    expect(extractJoins("6 fM in MR", PARTS).joins).toEqual([]);
    expect(extractJoins("18 fM um Bein 1", undefined).joins).toEqual([]);
    expect(parseRowText("18 fM um Bein 1", "de")).toMatchObject({ ok: false, code: "unknown-term" });
    expect(parse("6 sc around", "en_us")).toMatchObject({ ok: false, code: "needs-context" });
    expect(parseRowText("sc around", "en_us", { previousCount: 6, parts: EN_PARTS })).toEqual(parseRowText("sc around", "en_us", { previousCount: 6 }));
  });
});
