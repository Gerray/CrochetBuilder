/**
 * Format v2 in the row notation: stitch groups, colour changes, relief and bobble-family
 * terms — rendered and read back in DE / US / UK.
 */
import { describe, it, expect } from "vitest";
import { renderedRows } from "./export.js";
import {
  modifierAllowed,
  normalizeModifiers,
  NOTATION_LOCALES,
  parseRowText,
  renderOps,
  renderRow,
  type NotationLocale,
} from "./notation.js";
import { POST_STITCH_CODES, StitchCodeSchema, type Mod, type Op, type PartContent, type StitchCode } from "./schema.js";
import { checkModifiers } from "./validate.js";

const st = (code: StitchCode, count = 1, extra: { modifiers?: Mod[]; color?: string } = {}): Op => ({
  kind: "stitch",
  code,
  count,
  ...extra,
});
const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });
const grp = (ops: Op[]): Op => ({ kind: "group", ops: ops as Extract<Op, { kind: "group" }>["ops"] });

const PALETTE = [
  { id: "c1", name: "Weiß" },
  { id: "c2", name: "Altrosa" },
];

describe("modifier rules match validation", () => {
  it("allows FP/BP exactly on post stitches and never both on one stitch", () => {
    for (const code of StitchCodeSchema.options) {
      const post = POST_STITCH_CODES.includes(code);
      expect(modifierAllowed(code, "FP"), code).toBe(post);
      expect(modifierAllowed(code, "BP"), code).toBe(post);
      const content: PartContent = { schemaVersion: 2, rows: [{ id: "r", type: "round", ops: [st(code, 1, { modifiers: ["FP"] })], stitchCountTarget: 0 }] };
      expect(checkModifiers(content).length === 0, code).toBe(post);
    }
    expect(normalizeModifiers("DC", ["FP", "BP"])).toBeNull();
    expect(normalizeModifiers("DC", ["FP", "BLO", "FP"])).toEqual(["FP", "BLO"]);
  });
});

describe("stitch groups in the notation", () => {
  const cases: Array<[Op[], Record<NotationLocale, string>]> = [
    [[rep(6, [grp([st("SC", 3)])])], { de: "6× ((3 fM) in dieselbe M)", en_us: "6x ((3 sc) in same st)", en_uk: "6x ((3 dc) in same st)" }],
    [
      [st("SC", 2), grp([st("DC", 2), st("CH"), st("DC", 2)]), st("SC", 2)],
      { de: "2 fM, (2 Stb, 1 Lm, 2 Stb) in dieselbe M, 2 fM", en_us: "2 sc, (2 dc, 1 ch, 2 dc) in same st, 2 sc", en_uk: "2 dc, (2 tr, 1 ch, 2 tr) in same st, 2 dc" },
    ],
    [[grp([rep(2, [st("HDC")]), st("PICOT")])], { de: "(2× (1 hStb), 1 Pikot) in dieselbe M", en_us: "(2x (1 hdc), 1 picot) in same st", en_uk: "(2x (1 htr), 1 picot) in same st" }],
  ];

  it.each(NOTATION_LOCALES)("renders and reads back groups (%s)", (locale) => {
    for (const [ops, text] of cases) {
      expect(renderOps(ops, locale)).toBe(text[locale]);
      expect(parseRowText(text[locale], locale)).toEqual({ ok: true, ops });
    }
  });

  it("reads other spellings of 'into the same stitch' and keeps the stitch count", () => {
    const three = { ok: true, ops: [grp([st("SC", 3)])] };
    expect(parseRowText("(3 sc) in the same stitch", "en_us")).toEqual(three);
    expect(parseRowText("(3 sc) into same st", "en_us")).toEqual(three);
    expect(parseRowText("(3 fM) in die gleiche Masche", "de")).toEqual(three);
    expect(parseRowText("6× ((3 fM) in dieselbe M) (18)", "de")).toEqual({ ok: true, ops: [rep(6, [grp([st("SC", 3)])])], stitchCountTarget: 18 });
  });

  it("refuses nested groups", () => {
    expect(parseRowText("((2 fM) in dieselbe M, 1 fM) in dieselbe M", "de").ok).toBe(false);
  });
});

describe("colour changes in the notation", () => {
  const ops: Op[] = [st("SC", 3, { color: "c2" }), rep(3, [st("SC"), st("INC", 1, { color: "c1" })])];

  it("renders colour changes only when asked, with palette names", () => {
    expect(renderOps(ops, "de")).toBe("3 fM, 3× (1 fM, 1 Zun)");
    expect(renderOps(ops, "de", { colors: PALETTE })).toBe("[Farbe: Altrosa] 3 fM, 3× (1 fM, [Farbe: Weiß] 1 Zun)");
    expect(renderOps(ops, "en_us", { colors: PALETTE })).toBe("[Color: Altrosa] 3 sc, 3x (1 sc, [Color: Weiß] 1 inc)");
    expect(renderOps(ops, "en_uk", { colors: [] })).toBe("[Colour: c2] 3 dc, 3x (1 dc, [Colour: c1] 1 inc)");
  });

  it("renders a row colour at the start of the row", () => {
    const row = { id: "r", type: "round" as const, color: "c1", ops: [st("SC", 6)], stitchCountTarget: 6 };
    expect(renderRow(row, "de", { colors: PALETTE })).toBe("[Farbe: Weiß] 6 fM");
    expect(renderRow(row, "de")).toBe("6 fM");
    expect(renderRow({ ...row, ops: [] }, "de", { colors: PALETTE })).toBe("[Farbe: Weiß]");
  });

  it("reads colour changes back as palette ids (names or ids), else as written", () => {
    for (const locale of NOTATION_LOCALES) {
      const text = renderOps(ops, locale, { colors: PALETTE });
      expect(parseRowText(text, locale, { colors: PALETTE }), text).toEqual({ ok: true, ops });
    }
    expect(parseRowText("[Farbe: altrosa] 6 fM", "de", { colors: PALETTE })).toEqual({ ok: true, ops: [st("SC", 6, { color: "c2" })] });
    expect(parseRowText("[Farbwechsel zu Grün] 6 fM", "de")).toEqual({ ok: true, ops: [st("SC", 6, { color: "Grün" })] });
    expect(parseRowText("[Farbe: Weiß]", "de").ok).toBe(false); // a colour change needs a stitch
  });

  it("reads a leading colour change as the row colour with rowColor", () => {
    const row = { id: "r", type: "round" as const, color: "c2", ops, stitchCountTarget: 12 };
    for (const locale of NOTATION_LOCALES) {
      const text = renderRow(row, locale, { colors: PALETTE });
      expect(parseRowText(text, locale, { colors: PALETTE, rowColor: true }), text).toEqual({ ok: true, ops, color: "c2" });
    }
    const ctx = { colors: PALETTE, rowColor: true };
    // Only the mark: a row colour without stitches; leading spaces are fine.
    expect(parseRowText("  [Farbe: weiß]", "de", ctx)).toEqual({ ok: true, ops: [], color: "c1" });
    // Unknown names stay as written; without a leading mark there is no row colour.
    expect(parseRowText("[Farbe: Mint] 6 fM (6)", "de", ctx)).toEqual({ ok: true, ops: [st("SC", 6)], stitchCountTarget: 6, color: "Mint" });
    expect(parseRowText("6 fM, [Farbe: Weiß] 1 fM", "de", ctx)).toEqual({ ok: true, ops: [st("SC", 6), st("SC", 1, { color: "c1" })] });
    // Lenient forms and context still apply after the mark; error positions count from the start.
    expect(parseRowText("[Farbe: Weiß] fM rundherum", "de", { ...ctx, previousCount: 12 })).toMatchObject({ ok: true, color: "c1", ops: [st("SC", 12)] });
    expect(parseRowText("[Farbe: Weiß] 6 xyz", "de", ctx)).toMatchObject({ ok: false, code: "unknown-term", position: 16 });
  });

  it("reads names before ids (a colour renamed away from its id, another took the name)", () => {
    const palette = [
      { id: "rosa", name: "Pink" },
      { id: "rosa-2", name: "Rosa" },
      { id: "weiss", name: "Weiß" },
    ];
    const ctx = { colors: palette, rowColor: true };
    expect(parseRowText("[Farbe: Rosa] 6 fM", "de", ctx)).toMatchObject({ color: "rosa-2" });
    expect(parseRowText("[Farbe: rosa] 6 fM", "de", ctx)).toMatchObject({ color: "rosa-2" });
    expect(parseRowText("[Farbe: Pink] 6 fM", "de", ctx)).toMatchObject({ color: "rosa" });
    // An id that is no name still resolves.
    expect(parseRowText("[Farbe: weiss] 6 fM", "de", ctx)).toMatchObject({ color: "weiss" });
    // Round trip of rendered text.
    const row = { id: "r", type: "round" as const, color: "rosa", ops: [st("SC", 6, { color: "rosa-2" })], stitchCountTarget: 6 };
    const text = renderRow(row, "de", { colors: palette });
    expect(text).toBe("[Farbe: Pink] [Farbe: Rosa] 6 fM");
    expect(parseRowText(text, "de", ctx)).toEqual({ ok: true, ops: row.ops, color: "rosa" });
  });

  it("shows colour changes in the rendered rows of an export", () => {
    const content: PartContent = {
      schemaVersion: 2,
      rows: [
        { id: "a", type: "round", color: "c1", ops: [st("MR"), st("SC", 6)], stitchCountTarget: 6 },
        { id: "b", type: "round", ops: [st("SC", 3, { color: "c2" }), st("SC", 3)], stitchCountTarget: 6 },
      ],
    };
    expect(renderedRows(content, "de", PALETTE)).toEqual(["Runde 1: [Farbe: Weiß] 1 MR, 6 fM (6)", "Runde 2: [Farbe: Altrosa] 3 fM, 3 fM (6)"]);
    expect(renderedRows(content, "de")).toEqual(["Runde 1: 1 MR, 6 fM (6)", "Runde 2: 3 fM, 3 fM (6)"]);
  });
});

describe("relief and bobble-family terms", () => {
  const read = (text: string, locale: NotationLocale) => parseRowText(text, locale);

  it("reads FP/BP written in every notation", () => {
    const fpdc = { ok: true, ops: [st("DC", 6, { modifiers: ["FP"] })] };
    const bpdc = { ok: true, ops: [st("DC", 6, { modifiers: ["BP"] })] };
    expect(read("6 Stb (Relief v)", "de")).toEqual(fpdc);
    expect(read("6 Stb (Relief h)", "de")).toEqual(bpdc);
    expect(read("6 RStbv", "de")).toEqual(fpdc);
    expect(read("6 Reliefstäbchen von hinten", "de")).toEqual(bpdc);
    expect(read("6 FPdc", "en_us")).toEqual(fpdc);
    expect(read("6 BPdc", "en_us")).toEqual(bpdc);
    expect(read("6 front post dc", "en_us")).toEqual(fpdc);
    expect(read("6 dc (FP)", "en_us")).toEqual(fpdc);
    expect(read("6 FPtr", "en_uk")).toEqual(fpdc); // UK treble = US double
    expect(read("6 back post treble", "en_uk")).toEqual(bpdc);
    expect(read("6 FPsc", "en_us")).toEqual({ ok: true, ops: [st("SC", 6, { modifiers: ["FP"] })] });
    // Relief on a stitch without a post is refused, as in validation.
    expect(read("6 Noppe (Relief v)", "de")).toMatchObject({ ok: false, code: "invalid-modifier" });
  });

  it("reads bobble, puff, popcorn and picot in every notation", () => {
    const expectations: Array<[string, NotationLocale, StitchCode, number]> = [
      ["3 Noppen", "de", "BOBBLE", 3],
      ["1 Noppe", "de", "BOBBLE", 1],
      ["2 Büschelmaschen", "de", "PUFF", 2],
      ["1 Büschel", "de", "PUFF", 1],
      ["1 Popcornmasche", "de", "POPCORN", 1],
      ["4 Pikots", "de", "PICOT", 4],
      ["1 Picot", "de", "PICOT", 1],
      ["3 bobbles", "en_us", "BOBBLE", 3],
      ["1 bobble stitch", "en_us", "BOBBLE", 1],
      ["2 puff sts", "en_us", "PUFF", 2],
      ["1 popcorn", "en_uk", "POPCORN", 1],
      ["5 picots", "en_uk", "PICOT", 5],
    ];
    for (const [text, locale, code, count] of expectations) {
      expect(read(text, locale), text).toEqual({ ok: true, ops: [st(code, count)] });
    }
  });
});
