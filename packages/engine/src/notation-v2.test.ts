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

describe("groups and special stitches as patterns write them", () => {
  const read = (text: string, locale: NotationLocale, previousCount?: number) =>
    parseRowText(text, locale, previousCount === undefined ? {} : { previousCount });

  it("reads several stitches into one stitch in every notation", () => {
    const cases: Array<[string, NotationLocale, Op[]]> = [
      ["3 sc in next st, 11 sc (14)", "en_us", [grp([st("SC", 3)]), st("SC", 11)]],
      ["3 sc in one st", "en_us", [grp([st("SC", 3)])]],
      ["three sc into the same stitch", "en_us", [grp([st("SC", 3)])]],
      ["2 hdc in next st, 10 sc", "en_us", [grp([st("HDC", 2)]), st("SC", 10)]],
      ["5 dc in same st", "en_us", [grp([st("DC", 5)])]],
      ["4 sc, 3 sc in last ch", "en_us", [st("SC", 4), grp([st("SC", 3)])]],
      ["(3 dc, ch 2, 3 dc) in next st", "en_us", [grp([st("DC", 3), st("CH", 2), st("DC", 3)])]],
      ["3 dc in next st", "en_uk", [grp([st("SC", 3)])]], // UK dc = single crochet
      ["3 fM in 1 M", "de", [grp([st("SC", 3)])]],
      ["3 fM in eine Masche", "de", [grp([st("SC", 3)])]],
      ["2 hStb in 1 M, 4 fM", "de", [grp([st("HDC", 2)]), st("SC", 4)]],
      ["drei Stb in die nächste M", "de", [grp([st("DC", 3)])]],
    ];
    for (const [text, locale, ops] of cases) {
      expect(read(text, locale), text).toMatchObject({ ok: true, ops });
    }
    expect(read("3 sc in next st, 11 sc (14)", "en_us")).toMatchObject({ stitchCountTarget: 14 });
    // Two single crochets into one stitch stay an increase; one stitch stays one stitch.
    expect(read("2 sc in next st", "en_us")).toEqual({ ok: true, ops: [st("INC")] });
    expect(read("2 fM in 1 M", "de")).toEqual({ ok: true, ops: [st("INC")] });
    expect(read("hdc in next st, 5 sc", "en_us")).toEqual({ ok: true, ops: [st("HDC"), st("SC", 5)] });
  });

  it("fills a round with groups into every stitch", () => {
    expect(read("3 sc in each st around (18)", "en_us", 6)).toEqual({
      ok: true,
      ops: [rep(6, [grp([st("SC", 3)])])],
      stitchCountTarget: 18,
    });
    expect(read("2 hStb in jede M", "de", 6)).toEqual({ ok: true, ops: [rep(6, [grp([st("HDC", 2)])])] });
    expect(read("2 sc in each st", "en_us", 6)).toEqual({ ok: true, ops: [st("INC", 6)] });
  });

  it("reads taller-stitch increases as groups of two", () => {
    const hdcInc = grp([st("HDC", 2)]);
    expect(read("(hdc, hdc inc) x 3, 3 sc = [24]", "en_us")).toEqual({
      ok: true,
      ops: [rep(3, [st("HDC"), hdcInc]), st("SC", 3)],
      stitchCountTarget: 24,
    });
    expect(read("(3hdc inc, 3sc) x 2 = [18]", "en_us")).toEqual({
      ok: true,
      ops: [rep(2, [rep(3, [hdcInc]), st("SC", 3)])],
      stitchCountTarget: 18,
    });
    expect(read("3 hdc-inc", "en_us")).toEqual({ ok: true, ops: [rep(3, [hdcInc])] });
    expect(read("2 hStb-Zun, 4 fM", "de")).toEqual({ ok: true, ops: [rep(2, [hdcInc]), st("SC", 4)] });
    expect(read("dc inc", "en_us")).toEqual({ ok: true, ops: [grp([st("DC", 2)])] });
    // UK "dc" is a single crochet: a "dc inc" is a plain increase.
    expect(read("dc inc, 2 dc", "en_uk")).toEqual({ ok: true, ops: [st("INC"), st("SC", 2)] });
  });

  it("flags '3 hdc inc' without a written count, as it may mean '3 hdc, inc'", () => {
    expect(read("3hdc inc, 3 sc", "en_us")).toMatchObject({ ok: true, warnings: ["increase-ambiguous"] });
    expect(read("3 hdc-inc, 3 sc", "en_us")).not.toHaveProperty("warnings");
    expect(read("3hdc inc, 3 sc (9)", "en_us")).not.toHaveProperty("warnings");
  });

  it("lets the written count choose between the two readings of '3 hdc inc'", () => {
    const hdcInc = grp([st("HDC", 2)]);
    // Only "3 hdc, inc" makes 8.
    expect(read("3 hdc inc, 3 sc (8)", "en_us")).toEqual({ ok: true, ops: [st("HDC", 3), st("INC"), st("SC", 3)], stitchCountTarget: 8 });
    // Only three increases make 9.
    expect(read("3 hdc inc, 3 sc (9)", "en_us")).toEqual({ ok: true, ops: [rep(3, [hdcInc]), st("SC", 3)], stitchCountTarget: 9 });
    // "2 hdc inc" makes 4 either way; 20 fits neither: flagged, read as increases.
    expect(read("2 hdc inc, 4 sc (8)", "en_us")).toMatchObject({ ops: [rep(2, [hdcInc]), st("SC", 4)], warnings: ["increase-ambiguous"] });
    expect(read("3 hdc inc, 3 sc (20)", "en_us")).toMatchObject({ warnings: ["increase-ambiguous"] });
  });

  it("reads bobbles, puffs, popcorns and picots with their loop count in the name", () => {
    const cases: Array<[string, NotationLocale, Op[]]> = [
      ["2 sc, 5-dc bobble, 2 sc", "en_us", [st("SC", 2), st("BOBBLE"), st("SC", 2)]],
      ["bobble of 5 dc, 3 sc", "en_us", [st("BOBBLE"), st("SC", 3)]],
      ["3 sc, popcorn (5 dc)", "en_us", [st("SC", 3), st("POPCORN")]],
      ["4-hdc puff, sc", "en_us", [st("PUFF"), st("SC")]],
      ["sc, ch-3 picot, sc", "en_us", [st("SC"), st("PICOT"), st("SC")]],
      ["2 fM, Noppe aus 5 Stb, 2 fM", "de", [st("SC", 2), st("BOBBLE"), st("SC", 2)]],
      ["1 Büschelmasche, 1 Pikot aus 3 Lm", "de", [st("PUFF"), st("PICOT")]],
      ["1 Popcorn, 3 fM", "de", [st("POPCORN"), st("SC", 3)]],
    ];
    for (const [text, locale, ops] of cases) {
      expect(read(text, locale), text).toEqual({ ok: true, ops });
    }
    // "3 dc bobble" may be "3 dc, bobble": not guessed.
    expect(read("3 dc bobble", "en_us").ok).toBe(false);
    // Clusters, bullions and the like have no code.
    expect(read("2 sc, cluster, 2 sc", "en_us").ok).toBe(false);
  });

  it("reads relief stitches in all spellings", () => {
    const fp = [st("DC", 4, { modifiers: ["FP"] })];
    const bp = [st("DC", 4, { modifiers: ["BP"] })];
    expect(read("4 FPdc", "en_us")).toEqual({ ok: true, ops: fp });
    expect(read("4 front post double crochet", "en_us")).toEqual({ ok: true, ops: fp });
    expect(read("4 BPdc", "en_us")).toEqual({ ok: true, ops: bp });
    expect(read("4 Reliefstäbchen vorne", "de")).toEqual({ ok: true, ops: fp });
    expect(read("4 Reliefstäbchen von hinten", "de")).toEqual({ ok: true, ops: bp });
    expect(read("4 Relief-Stb v", "de")).toEqual({ ok: true, ops: fp });
    expect(read("4 hintere Reliefstäbchen", "de")).toEqual({ ok: true, ops: bp });
  });
});
