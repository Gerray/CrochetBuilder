import { describe, expect, it } from "vitest";
import {
  MAX_COUNT,
  MAX_ROW_STITCHES,
  MAX_TIMES,
  NOTATION_LOCALES,
  countWorkedStitches,
  modifierAllowed,
  normalizeModifiers,
  opsWithinLimits,
  stitchVocabulary,
  STITCH_ABBREVIATIONS,
  STITCH_NAMES,
  parseRowText,
  renderOps,
  renderRow,
  resolveStitchTerm,
  rowLabel,
  type NotationLocale,
} from "./notation.js";
import { ModSchema, StitchCodeSchema, type Mod, type Op, type Row, type StitchCode } from "./schema.js";

const st = (code: StitchCode, count: number, modifiers?: Mod[]): Op =>
  modifiers ? { kind: "stitch", code, count, modifiers } : { kind: "stitch", code, count };
const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });
const rowOf = (ops: Op[], extra: Partial<Row> = {}): Row => ({
  id: "r",
  type: "round",
  ops,
  stitchCountTarget: 0,
  ...extra,
});

function expectOps(text: string, ops: Op[], locale: NotationLocale = "de") {
  expect(parseRowText(text, locale)).toEqual({ ok: true, ops });
}

describe("renderOps", () => {
  it("renders German notation", () => {
    expect(renderOps([st("MR", 1), st("SC", 6)], "de")).toBe("1 MR, 6 fM");
    expect(renderOps([rep(6, [st("SC", 1), st("INC", 1)])], "de")).toBe("6× (1 fM, 1 Zun)");
    expect(renderOps([st("SC", 2, ["BLO"])], "de")).toBe("2 fM (hMG)");
    expect(renderOps([st("SC", 2, ["FLO", "TOG"])], "de")).toBe("2 fM (vMG, zus)");
  });

  it("renders US and UK notation (UK dc = US sc)", () => {
    expect(renderOps([st("SC", 6)], "en_us")).toBe("6 sc");
    expect(renderOps([st("SC", 6)], "en_uk")).toBe("6 dc");
    expect(renderOps([st("DC", 3)], "en_uk")).toBe("3 tr");
    expect(renderOps([rep(6, [st("SC", 1), st("INC", 1)])], "en_us")).toBe("6x (1 sc, 1 inc)");
    expect(renderOps([st("SC", 2, ["BLO"])], "en_us")).toBe("2 sc (BLO)");
    expect(renderOps([st("SL_ST", 1)], "en_us")).toBe("1 sl st");
    expect(renderOps([st("SL_ST", 1)], "en_uk")).toBe("1 ss");
  });

  it("renders nested repeat groups", () => {
    expect(renderOps([rep(2, [st("SC", 1), rep(3, [st("INC", 1)])])], "de")).toBe(
      "2× (1 fM, 3× (1 Zun))",
    );
  });

  it("renders an empty row as an empty string and never shows `into`", () => {
    expect(renderRow(rowOf([]), "de")).toBe("");
    expect(renderRow(rowOf([{ kind: "stitch", code: "DC", count: 3, into: "chain space" }]), "en_us")).toBe(
      "3 dc",
    );
  });

  it("covers every stitch code in every locale", () => {
    for (const code of StitchCodeSchema.options) {
      for (const locale of NOTATION_LOCALES) {
        expect(STITCH_ABBREVIATIONS[code][locale]).toBeTruthy();
        expect(STITCH_NAMES[code][locale]).toBeTruthy();
        expect(resolveStitchTerm(STITCH_ABBREVIATIONS[code][locale], locale)).toBe(code);
        expect(resolveStitchTerm(STITCH_NAMES[code][locale], locale)).toBe(code);
      }
    }
  });
});

describe("rowLabel", () => {
  it("uses the row's own label, else an automatic one", () => {
    expect(rowLabel(rowOf([st("SC", 6)]), 3, "de")).toBe("Runde 3");
    expect(rowLabel(rowOf([st("SC", 6)], { type: "row" }), 2, "de")).toBe("Reihe 2");
    expect(rowLabel(rowOf([st("SC", 6)]), 3, "en_us")).toBe("Round 3");
    expect(rowLabel(rowOf([st("SC", 6)], { label: "Kopf" }), 3, "de")).toBe("Kopf");
    expect(rowLabel(rowOf([], { note: "Augen einsetzen" }), 3, "de")).toBe("Hinweis");
  });
});

describe("parseRowText — basics", () => {
  it("parses counts, terms and lists", () => {
    expectOps("6 fM", [st("SC", 6)]);
    expectOps("1 MR, 6 fM", [st("MR", 1), st("SC", 6)]);
    expectOps("fM", [st("SC", 1)]);
    expectOps("2 Lm; 3 Stb", [st("CH", 2), st("DC", 3)]);
  });

  it("is case-insensitive and treats NBSP and extra spaces as spaces", () => {
    expectOps("6 FM,  2  stb", [st("SC", 6), st("DC", 2)]);
    expectOps("6 fm", [st("SC", 6)]);
  });

  it("understands long names and plurals", () => {
    expectOps("2 Luftmaschen, 6 feste Maschen", [st("CH", 2), st("SC", 6)]);
    expectOps("1 Magischer Ring, 6 fM", [st("MR", 1), st("SC", 6)]);
    expectOps("6 single crochet", [st("SC", 6)], "en_us");
    expectOps("1 magic ring, 6 sc", [st("MR", 1), st("SC", 6)], "en_us");
    expectOps("2 sl. st.", [st("SL_ST", 2)], "en_us");
  });

  it("parses English notation in both dialects", () => {
    expectOps("6 sc", [st("SC", 6)], "en_us");
    expectOps("6x (1 sc, 1 inc)", [rep(6, [st("SC", 1), st("INC", 1)])], "en_us");
    expectOps("2 sc (BLO)", [st("SC", 2, ["BLO"])], "en_us");
    expectOps("1 ch, 6 htr", [st("CH", 1), st("HDC", 6)], "en_uk");
  });
});

describe("parseRowText — US/UK false friends", () => {
  it("reads dc by the chosen locale", () => {
    expectOps("6 dc", [st("SC", 6)], "en_uk");
    expectOps("6 dc", [st("DC", 6)], "en_us");
    expectOps("2 tr", [st("DC", 2)], "en_uk");
    expectOps("2 tr", [st("TR", 2)], "en_us");
  });

  it("does not guess an ambiguous English term in German", () => {
    expect(parseRowText("6 dc", "de")).toEqual({ ok: false, code: "unknown-term", term: "dc", position: 2 });
  });

  it("accepts unambiguous terms of other locales", () => {
    expectOps("6 sc", [st("SC", 6)], "de");
    expectOps("6 fM", [st("SC", 6)], "en_uk");
  });
});

describe("parseRowText — repeats", () => {
  it("parses a simple group with any times sign", () => {
    for (const sign of ["×", "x", "X", "*", " x ", " mal "]) {
      expectOps(`6${sign}(1 fM, 1 Zun)`, [rep(6, [st("SC", 1), st("INC", 1)])]);
    }
    expectOps("6 (1 fM, 1 Zun)", [rep(6, [st("SC", 1), st("INC", 1)])]);
  });

  it("parses postfix repeats", () => {
    expectOps("(1 sc, 1 inc) x6", [rep(6, [st("SC", 1), st("INC", 1)])], "en_us");
    expectOps("(1 sc, 1 inc) * 6", [rep(6, [st("SC", 1), st("INC", 1)])], "en_us");
    expectOps("(1 fM, 1 Zun) 6 mal", [rep(6, [st("SC", 1), st("INC", 1)])]);
    expectOps("[2 fM, 1 Abn] x 6", [rep(6, [st("SC", 2), st("DEC", 1)])]);
  });

  it("parses nested groups and groups followed by more ops", () => {
    expectOps("2× (1 fM, 3× (1 Zun))", [rep(2, [st("SC", 1), rep(3, [st("INC", 1)])])]);
    expectOps("6× (1 fM, 1 Zun), 2 fM", [rep(6, [st("SC", 1), st("INC", 1)]), st("SC", 2)]);
  });
});

describe("parseRowText — modifiers", () => {
  it("parses single and multiple modifiers in any locale", () => {
    expectOps("2 fM (hMG)", [st("SC", 2, ["BLO"])]);
    expectOps("2 fM (hMG, zus)", [st("SC", 2, ["BLO", "TOG"])]);
    expectOps("2 sc (blo, TOG)", [st("SC", 2, ["BLO", "TOG"])], "en_us");
    expectOps("2 fM (nur hinteres Maschenglied)", [st("SC", 2, ["BLO"])]);
    expectOps("3 sc (front loop only)", [st("SC", 3, ["FLO"])], "en_us");
  });
});

describe("parseRowText — trailing stitch count", () => {
  it("returns the stitch count written at the end", () => {
    expect(parseRowText("6 Zun (12)")).toEqual({ ok: true, ops: [st("INC", 6)], stitchCountTarget: 12 });
    expect(parseRowText("6× (1 fM, 1 Zun) (18)")).toEqual({
      ok: true,
      ops: [rep(6, [st("SC", 1), st("INC", 1)])],
      stitchCountTarget: 18,
    });
    expect(parseRowText("6 fM (hMG) [6 M]")).toEqual({
      ok: true,
      ops: [st("SC", 6, ["BLO"])],
      stitchCountTarget: 6,
    });
    expect(parseRowText("6 inc (12 sts)", "en_us")).toEqual({
      ok: true,
      ops: [st("INC", 6)],
      stitchCountTarget: 12,
    });
  });

  it("only treats a final parenthesised number as a count", () => {
    expect(parseRowText("6 Zun (12), 2 fM").ok).toBe(false);
  });
});

describe("parseRowText — errors", () => {
  it("reports empty text", () => {
    expect(parseRowText("")).toEqual({ ok: false, code: "empty" });
    expect(parseRowText("   ")).toEqual({ ok: false, code: "empty" });
  });

  it("names unknown terms with their position", () => {
    expect(parseRowText("6 Quatsch")).toEqual({ ok: false, code: "unknown-term", term: "Quatsch", position: 2 });
    expect(parseRowText("1 MR, 6 Quatsch Masche")).toEqual({
      ok: false,
      code: "unknown-term",
      term: "Quatsch Masche",
      position: 8,
    });
    expect(parseRowText("2 fM (blub)")).toEqual({ ok: false, code: "unknown-term", term: "blub", position: 6 });
  });

  it("reports structural problems as syntax errors with a position", () => {
    expect(parseRowText("6× (1 fM")).toEqual({ ok: false, code: "syntax", position: 8 });
    expect(parseRowText("0 fM")).toEqual({ ok: false, code: "syntax", position: 0 });
    expect(parseRowText("6 fM)")).toEqual({ ok: false, code: "syntax", position: 4 });
    expect(parseRowText("1 MR 6 fM")).toEqual({ ok: false, code: "syntax", position: 5 });
    expect(parseRowText("6 fM, ")).toEqual({ ok: false, code: "syntax", position: 6 });
    expect(parseRowText("6 fM!")).toEqual({ ok: false, code: "syntax", position: 4 });
    expect(parseRowText("(1 fM) fM").ok).toBe(false);
    expect(parseRowText("2 fM (hMG").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round-trip property on generated op trees (seeded, deterministic)
// ---------------------------------------------------------------------------

/** mulberry32 — tiny deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateOps(rand: () => number, depth: number): Op[] {
  const codes = StitchCodeSchema.options;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const length = 1 + Math.floor(rand() * 4);
  const ops: Op[] = [];
  for (let i = 0; i < length; i++) {
    const roll = rand();
    if (depth < 3 && roll < 0.03) {
      ops.push(rep(1 + Math.floor(rand() * 12), [])); // empty group, rendered as "N× ()"
    } else if (depth < 3 && roll < 0.3) {
      ops.push(rep(1 + Math.floor(rand() * 12), generateOps(rand, depth + 1)));
    } else {
      const code = pick(codes);
      const count = 1 + Math.floor(rand() * 30);
      const allowed = ModSchema.options.filter((m) => modifierAllowed(code, m));
      const wanted = allowed.filter(() => rand() < 0.3);
      const modifiers = normalizeModifiers(code, wanted) ?? wanted.filter((m) => m !== "FLO");
      ops.push(st(code, count, modifiers.length > 0 ? modifiers : undefined));
    }
  }
  return ops;
}

function generateTrees(seed: number, n: number): Op[][] {
  const rand = prng(seed);
  const trees: Op[][] = [];
  while (trees.length < n) {
    const ops = generateOps(rand, 0);
    if (opsWithinLimits(ops)) trees.push(ops);
  }
  return trees;
}

describe("parseRowText ∘ renderOps — round trip", () => {
  const trees = generateTrees(20261027, 400);

  it.each(NOTATION_LOCALES)("gives back the same ops for 400 generated trees (%s)", (locale) => {
    for (const ops of trees) {
      const text = renderOps(ops, locale);
      expect(parseRowText(text, locale), text).toEqual({ ok: true, ops });
    }
  });

  it("survives casing, NBSP and times-sign variations", () => {
    const signs = ["×", "x", "X", "*"];
    trees.slice(0, 100).forEach((ops, i) => {
      const text = renderOps(ops, "de")
        .replace(/×/g, () => signs[i % signs.length]!)
        .replace(/ /g, i % 2 === 0 ? " " : "  ");
      const variant = i % 3 === 0 ? text.toUpperCase() : i % 3 === 1 ? text.toLowerCase() : text;
      expect(parseRowText(variant, "de"), variant).toEqual({ ok: true, ops });
    });
  });
});

// ---------------------------------------------------------------------------
// Review fixes: vocabulary, limits, modifiers, empty repeats
// ---------------------------------------------------------------------------

describe("vocabulary — all spellings of all names", () => {
  /** Expected spellings per locale: abbreviation, full name, plural, short form + plural. */
  function expectedForms(code: StitchCode, locale: NotationLocale): string[] {
    const name = STITCH_NAMES[code][locale].toLowerCase();
    const forms = [STITCH_ABBREVIATIONS[code][locale].toLowerCase(), name];
    if (locale === "de") return forms;
    const plural = (p: string) => p.replace(/(ch)$/, "$1e") + "s";
    forms.push(plural(name));
    const short = name.replace(/ crochet$/, "");
    if (short !== name) forms.push(short, plural(short));
    return forms;
  }

  it.each(NOTATION_LOCALES)("every singular/plural/short form resolves to its code (%s)", (locale) => {
    for (const code of StitchCodeSchema.options) {
      for (const form of expectedForms(code, locale)) {
        expect(resolveStitchTerm(form, locale), `${locale} "${form}"`).toBe(code);
        expect(resolveStitchTerm(form.toUpperCase(), locale), `${locale} "${form}" upper`).toBe(code);
      }
    }
  });

  it("knows German plurals", () => {
    const plurals: Array<[string, StitchCode]> = [
      ["Luftmaschen", "CH"],
      ["Kettmaschen", "SL_ST"],
      ["Feste Maschen", "SC"],
      ["Halbe Stäbchen", "HDC"],
      ["Zunahmen", "INC"],
      ["Abnahmen", "DEC"],
      ["Unsichtbare Abnahmen", "INVDEC"],
      ["Maschen", "ST"],
    ];
    for (const [term, code] of plurals) expect(resolveStitchTerm(term, "de"), term).toBe(code);
  });

  it("resolves the reported US/UK cases by locale", () => {
    expectOps("6 double", [st("SC", 6)], "en_uk");
    expectOps("6 doubles", [st("SC", 6)], "en_uk");
    expectOps("6 double", [st("DC", 6)], "en_us");
    expectOps("6 treble crochets", [st("TR", 6)], "en_us");
    expectOps("6 treble crochets", [st("DC", 6)], "en_uk");
    expectOps("2 half trebles", [st("HDC", 2)], "en_uk");
    expectOps("3 magic rings", [st("MR", 3)], "en_us");
  });

  it("never falls back between US and UK terms", () => {
    // "htr" exists only in UK terms, "sc" only in US terms: not guessed across dialects.
    expect(parseRowText("6 htr", "en_us")).toMatchObject({ ok: false, code: "unknown-term", term: "htr" });
    expect(parseRowText("6 sc", "en_uk")).toMatchObject({ ok: false, code: "unknown-term", term: "sc" });
    // German terms remain understood in both dialects, and unambiguous English in German.
    expectOps("6 fM", [st("SC", 6)], "en_us");
    expectOps("6 htr", [st("HDC", 6)], "de");
    expect(parseRowText("6 double", "de")).toMatchObject({ ok: false, code: "unknown-term" });
  });

  it("exposes a vocabulary per locale", () => {
    for (const locale of NOTATION_LOCALES) {
      expect(stitchVocabulary(locale).size).toBeGreaterThan(StitchCodeSchema.options.length);
    }
  });
});

describe("limits", () => {
  it("counts worked stitches without expanding", () => {
    expect(countWorkedStitches([st("SC", 6)])).toBe(6);
    expect(countWorkedStitches([rep(6, [st("SC", 2), rep(3, [st("INC", 1)])])])).toBe(30);
    expect(opsWithinLimits([rep(10, [st("SC", 999)])])).toBe(true);
    expect(opsWithinLimits([rep(11, [st("SC", 999)])])).toBe(false);
    expect(opsWithinLimits([st("SC", MAX_COUNT + 1)])).toBe(false);
    expect(opsWithinLimits([rep(MAX_TIMES + 1, [st("SC", 1)])])).toBe(false);
  });

  it("rejects too large counts, repeats and rows quickly", () => {
    expect(parseRowText("1000 fM")).toEqual({ ok: false, code: "too-large", position: 0, limit: MAX_COUNT });
    expect(parseRowText("99999999999999999999 fM")).toMatchObject({ ok: false, code: "too-large" });
    expect(parseRowText("1000× (1 fM)")).toEqual({ ok: false, code: "too-large", position: 0, limit: MAX_TIMES });
    expect(parseRowText("(1 fM) x 1000")).toMatchObject({ ok: false, code: "too-large", limit: MAX_TIMES });
    expect(parseRowText("6 fM (20001)")).toMatchObject({ ok: false, code: "too-large" });
    const started = performance.now();
    expect(parseRowText("999× (999× (999 fM))")).toEqual({
      ok: false,
      code: "too-large",
      position: 0,
      limit: MAX_ROW_STITCHES,
    });
    // Guards against expanding the repeats (that would take many seconds); the bound is
    // loose so a busy CI machine cannot make it flaky.
    expect(performance.now() - started).toBeLessThan(1000);
    expectOps("10× (999 fM)", [rep(10, [st("SC", 999)])]);
  });
});

describe("modifiers", () => {
  it("collapses duplicates", () => {
    expectOps("2 fM (hMG, hMG)", [st("SC", 2, ["BLO"])]);
    expectOps("2 sc (tog, TOG, blo)", [st("SC", 2, ["TOG", "BLO"])], "en_us");
  });

  it("rejects contradictory or meaningless modifiers", () => {
    expect(parseRowText("2 fM (hMG, vMG)")).toEqual({
      ok: false,
      code: "invalid-modifier",
      term: "vMG",
      position: 11,
    });
    expect(parseRowText("6 Zun (zus)")).toMatchObject({ ok: false, code: "invalid-modifier", term: "zus" });
    expect(parseRowText("1 MR (zus)")).toMatchObject({ ok: false, code: "invalid-modifier" });
    expect(parseRowText("1 MR (hMG)")).toMatchObject({ ok: false, code: "invalid-modifier" });
    expect(parseRowText("3 Lm (vMG)")).toMatchObject({ ok: false, code: "invalid-modifier" });
    expect(parseRowText("2 Abn (zus)")).toMatchObject({ ok: false, code: "invalid-modifier" });
    expectOps("2 Abn (hMG)", [st("DEC", 2, ["BLO"])]);
  });

  it("modifierAllowed / normalizeModifiers", () => {
    expect(modifierAllowed("SC", "TOG")).toBe(true);
    expect(modifierAllowed("INC", "TOG")).toBe(false);
    expect(modifierAllowed("CH", "BLO")).toBe(false);
    expect(normalizeModifiers("SC", ["BLO", "TOG", "BLO"])).toEqual(["BLO", "TOG"]);
    expect(normalizeModifiers("SC", ["BLO", "FLO"])).toBeNull();
    expect(normalizeModifiers("MR", ["TOG"])).toBeNull();
  });
});

describe("empty repeat groups", () => {
  it("render and parse back consistently", () => {
    const ops = [st("SC", 2), rep(6, [])];
    expect(renderOps(ops, "de")).toBe("2 fM, 6× ()");
    expectOps("2 fM, 6× ()", ops);
    expectOps("6 ()", [rep(6, [])]);
    expectOps("() x 3", [rep(3, [])]);
  });
});

// ---------------------------------------------------------------------------
// Real-world notation (lenient pass): what pasted patterns actually write
// ---------------------------------------------------------------------------

function expectRow(
  text: string,
  ops: Op[],
  target?: number,
  locale: NotationLocale = "en_us",
  previousCount?: number,
) {
  const result = parseRowText(text, locale, previousCount === undefined ? {} : { previousCount });
  expect(result, text).toEqual(target === undefined ? { ok: true, ops } : { ok: true, ops, stitchCountTarget: target });
}

describe("parseRowText — counts glued to or after the stitch", () => {
  it("reads counts glued to the stitch", () => {
    expectRow("21sc", [st("SC", 21)]);
    expectRow("6dec", [st("DEC", 6)]);
    expectRow("1sc,inc", [st("SC", 1), st("INC", 1)]);
    expectRow("3hdc", [st("HDC", 3)]);
    expectRow("Ch32", [st("CH", 32)]);
  });

  it("reads counts after the stitch", () => {
    expectRow("sc 2", [st("SC", 2)]);
    expectRow("inc x 6", [st("INC", 6)]);
    expectRow("Dec x 9", [st("DEC", 9)]);
    expectRow("Dec × 9 [9]", [st("DEC", 9)], 9);
    expectRow("6 inc", [st("INC", 6)]);
    expectRow("sc 2, inc", [st("SC", 2), st("INC", 1)]);
    expectRow("Inc × 2, 4 Sc, Inc × 3 (14)", [st("INC", 2), st("SC", 4), st("INC", 3)], 14);
    expectRow("ch 1", [st("CH", 1)]);
  });

  it("reads a postfix count on a counted stitch as a repeat", () => {
    expectRow("2 sc x 3", [rep(3, [st("SC", 2)])]);
  });
});

describe("parseRowText — repeat spellings", () => {
  const body = [st("SC", 1), st("INC", 1)];
  it("reads star, times and word forms", () => {
    for (const text of [
      "(1 sc, inc)*6",
      "(1 sc, inc) * 6",
      "(1 sc, inc) × 6",
      "(1 sc, inc) repeat 6 times",
      "(1sc,inc) rep 6 times",
      "[1 sc, inc] 6 times",
      "*1 sc, inc* repeat 6 times",
      "*1 sc, inc* 6 times",
      "*1 sc, inc; rep from * 5 more times",
    ]) {
      expectRow(text, [rep(6, body)]);
    }
  });

  it("reads German repeat words", () => {
    expectRow("(1 fM, 1 Zun) 6x wiederholen", [rep(6, body)], undefined, "de");
    expectRow("(1 fM, 1 Zun) 6 mal wdh.", [rep(6, body)], undefined, "de");
  });

  it("keeps ops after a repeat", () => {
    expectRow("1sc, inc, (2sc,inc) repeat 5 times, 1 sc", [
      st("SC", 1),
      st("INC", 1),
      rep(5, [st("SC", 2), st("INC", 1)]),
      st("SC", 1),
    ]);
  });
});

describe("parseRowText — to the end of the round", () => {
  it("resolves (…)* and (…) around from the previous count", () => {
    expectRow("(1 sc, inc)*", [rep(6, [st("SC", 1), st("INC", 1)])], undefined, "en_us", 12);
    expectRow("(inc)* [12]", [rep(6, [st("INC", 1)])], 12, "en_us", 6);
    expectRow("(2 sc, inc) around", [rep(4, [st("SC", 2), st("INC", 1)])], undefined, "en_us", 12);
    expectRow("2 sc, inc, rep around", [rep(4, [st("SC", 2), st("INC", 1)])], undefined, "en_us", 12);
    expectRow("*2 sc, inc; rep from * around", [rep(4, [st("SC", 2), st("INC", 1)])], undefined, "en_us", 12);
    expectRow("3 sc, (1 sc, dec) around", [st("SC", 3), rep(3, [st("SC", 1), st("DEC", 1)])], undefined, "en_us", 12);
  });

  it("resolves whole-round phrases", () => {
    expectRow("sc around", [st("SC", 18)], undefined, "en_us", 18);
    expectRow("sc in each st", [st("SC", 18)], undefined, "en_us", 18);
    expectRow("sc in each st around", [st("SC", 18)], undefined, "en_us", 18);
    expectRow("Sc in each stitch around.", [st("SC", 18)], undefined, "en_us", 18);
    expectRow("inc in each st around", [st("INC", 6)], undefined, "en_us", 6);
    expectRow("Increase in each st around= 12", [st("INC", 6)], 12, "en_us", 6);
    expectRow("inc around (12)", [st("INC", 6)], 12, "en_us", 6);
    expectRow("dec around", [st("DEC", 6)], undefined, "en_us", 12);
    expectRow("2 sc in each st", [st("INC", 6)], undefined, "en_us", 6);
  });

  it("resolves German whole-round phrases", () => {
    expectRow("fM rundherum", [st("SC", 24)], undefined, "de", 24);
    expectRow("in jede M 1 fM", [st("SC", 24)], undefined, "de", 24);
    expectRow("1 fM in jede M", [st("SC", 24)], undefined, "de", 24);
    expectRow("Zun in jede M", [st("INC", 6)], undefined, "de", 6);
    expectRow("(1 fM, 1 Zun) bis zum Rundenende", [rep(6, [st("SC", 1), st("INC", 1)])], undefined, "de", 12);
  });

  it("asks for the previous count when it is unknown", () => {
    expect(parseRowText("sc around", "en_us")).toEqual({ ok: false, code: "needs-context" });
    expect(parseRowText("(1 sc, inc)*", "en_us")).toEqual({ ok: false, code: "needs-context" });
  });

  it("reports a previous count that does not divide", () => {
    expect(parseRowText("(1 sc, inc)*", "en_us", { previousCount: 13 })).toEqual({
      ok: false,
      code: "fill-mismatch",
      limit: 13,
    });
    expect(parseRowText("dec around", "en_us", { previousCount: 7 })).toMatchObject({ ok: false, code: "fill-mismatch" });
  });

  it("does not resolve more than one fill or 3+ stitches into one", () => {
    expect(parseRowText("sc around, (sc, inc)*", "en_us", { previousCount: 12 }).ok).toBe(false);
    expect(parseRowText("3 sc in each st", "en_us", { previousCount: 12 }).ok).toBe(false);
  });
});

describe("parseRowText — magic ring starts", () => {
  const ring = [st("MR", 1), st("SC", 6)];
  it("reads English forms", () => {
    for (const text of ["6 sc in MR", "6 sc in magic ring", "6 sc into a magic ring", "MR, 6 sc", "MR 6", "MR: 6 sc", "MR 6 sc"]) {
      expectRow(text, ring);
    }
    expectRow("Make 6 sc into a magic ring= 6", ring, 6);
    expectRow("Make a magic ring, 6 sc", ring);
    expectRow("6 sc in Magic Ring (6)", ring, 6);
  });

  it("reads German forms", () => {
    for (const text of ["6 fM in einen Fadenring", "6 fM in einen Magic Ring", "6 fM in den MR", "MR 6", "MR mit 6 fM"]) {
      expectRow(text, ring, undefined, "de");
    }
  });

  it("uses the locale's single crochet for `MR 6`", () => {
    expectRow("MR 6", ring, undefined, "en_uk");
  });
});

describe("parseRowText — stitch counts at the end", () => {
  it("reads every common form", () => {
    const ops = [rep(6, [st("SC", 2), st("INC", 1)])];
    for (const text of [
      "(2 sc, inc) x 6 (24)",
      "(2 sc, inc) x 6 [24]",
      "(2 sc, inc) x 6 = 24",
      "(2 sc, inc) x 6= 24",
      "(2 sc, inc) x 6 = [24]",
      "(2 sc, inc) x 6 (24 sts)",
      "(2 sc, inc) x 6 – 24",
      "(2 sc, inc) x 6 — 24",
      "(2 sc, inc) × 6 = 24.",
    ]) {
      expectRow(text, ops, 24);
    }
  });

  it("returns a rounds annotation separately", () => {
    expect(parseRowText("42 sc (7 rounds)", "en_us")).toEqual({ ok: true, ops: [st("SC", 42)], rounds: 7 });
    expect(parseRowText("48sc (5 rows)", "en_us")).toEqual({ ok: true, ops: [st("SC", 48)], rounds: 5 });
    expect(parseRowText("12 sc (12) (3 rounds)", "en_us")).toEqual({
      ok: true,
      ops: [st("SC", 12)],
      stitchCountTarget: 12,
      rounds: 3,
    });
    expect(parseRowText("12 fM (4 Runden)")).toEqual({ ok: true, ops: [st("SC", 12)], rounds: 4 });
  });
});

describe("parseRowText — row-level loops", () => {
  it("adds BLO/FLO to every stitch it applies to", () => {
    expectRow("BLO: 36 sc", [st("SC", 36, ["BLO"])]);
    expectRow("in BLO 36 sc", [st("SC", 36, ["BLO"])]);
    expectRow("work in BLO: 36 sc", [st("SC", 36, ["BLO"])]);
    expectRow("Through back loops only, (5sc, dec) x 6 [36]", [rep(6, [st("SC", 5, ["BLO"]), st("DEC", 1, ["BLO"])])], 36);
    expectRow("FLO 6 sc, 2 ch", [st("SC", 6, ["FLO"]), st("CH", 2)]);
    expectRow("36 sc in BLO", [st("SC", 36, ["BLO"])]);
    expectRow("(5 sc, inc) x 6 (BLO)", [rep(6, [st("SC", 5, ["BLO"]), st("INC", 1, ["BLO"])])]);
    expectRow("nur hinteres Maschenglied: 36 fM", [st("SC", 36, ["BLO"])], undefined, "de");
    expectRow("36 fM nur in das vordere Maschenglied", [st("SC", 36, ["FLO"])], undefined, "de");
  });

  it("combines with whole-round phrases", () => {
    expectRow("BLO: sc around", [st("SC", 36, ["BLO"])], undefined, "en_us", 36);
  });
});

describe("parseRowText — spelling tolerances", () => {
  it("reads slip stitch spellings", () => {
    for (const text of ["2 sl-st", "2 slst", "2 sl st", "2 sl. st."]) expectRow(text, [st("SL_ST", 2)]);
    expectRow("2 ss", [st("SL_ST", 2)], undefined, "en_uk");
    expectRow("2 ss", [st("SL_ST", 2)]);
    expectRow("2 Kettm", [st("SL_ST", 2)], undefined, "de");
  });

  it("tolerates NBSP, dashes, a trailing period and a trailing turn", () => {
    expectRow("6 sc, inc (8).", [st("SC", 6), st("INC", 1)], 8);
    expectRow("6 sc, inc x 2 – 10", [st("SC", 6), st("INC", 2)], 10);
    expectRow("6 sc, ch 1, turn", [st("SC", 6), st("CH", 1)]);
    expectRow("6 fM, 1 Lm, wenden", [st("SC", 6), st("CH", 1)], undefined, "de");
  });

  it("reads next-stitch phrases and sc2tog", () => {
    expectRow("2 sc in next st", [st("INC", 1)]);
    expectRow("sc in next 5 sts, 2 sc in next st", [st("SC", 5), st("INC", 1)]);
    expectRow("6 sc2tog", [st("SC", 6, ["TOG"])]);
    expectRow("sc in 2nd ch from hook, 4 sc", [st("SC", 1), st("SC", 4)]);
  });

  it("still fails on what it cannot read", () => {
    expect(parseRowText("3 sc in one st", "en_us").ok).toBe(false);
    expect(parseRowText("6 sc with left leg", "en_us").ok).toBe(false);
    expect(parseRowText("Stuff the head", "en_us").ok).toBe(false);
  });

  it("keeps strict-pass errors for text neither pass reads", () => {
    expect(parseRowText("1 MR 6 fM")).toEqual({ ok: false, code: "syntax", position: 5 });
    expect(parseRowText("1 MR (hMG)")).toMatchObject({ ok: false, code: "invalid-modifier" });
  });
});

// ---------------------------------------------------------------------------
// Review fixes A3: a silent misreading is worse than an error
// ---------------------------------------------------------------------------

describe("parseRowText — no silent misreadings", () => {
  it("does not read a bare number after a counted stitch", () => {
    for (const text of ["6 inc 12", "18 sc 18", "6 sc in MR 6"]) {
      expect(parseRowText(text, "en_us").ok, text).toBe(false);
    }
    expect(parseRowText("6 fM 12")).toEqual({ ok: false, code: "syntax", position: 5 });
    expect(parseRowText("6 Zun 12").ok).toBe(false);
    expect(parseRowText("6 fM in den Fadenring 6").ok).toBe(false);
    // A times sign still makes a repeat, and an uncounted stitch still takes a count.
    expectRow("2 sc x 3", [rep(3, [st("SC", 2)])]);
    expectRow("sc 5 (18)", [st("SC", 5)], 18);
  });

  it("keeps 'in next st' only for a single stitch", () => {
    expect(parseRowText("2 hdc in next st", "en_us").ok).toBe(false);
    expect(parseRowText("3 sc in next st", "en_us").ok).toBe(false);
    expect(parseRowText("2 tr in next st", "en_uk").ok).toBe(false);
    expectRow("sc in next st, inc", [st("SC", 1), st("INC", 1)]);
    expectRow("1 hdc in next st, 5 sc", [st("HDC", 1), st("SC", 5)]);
    expectRow("2 dc in next st", [st("INC", 1)], undefined, "en_uk");
  });

  it("settles 'x N' after a list with the written count", () => {
    // Only the whole-row reading gives 18.
    expect(parseRowText("sc, inc x6 (18)", "en_us")).toEqual({
      ok: true,
      ops: [rep(6, [st("SC", 1), st("INC", 1)])],
      stitchCountTarget: 18,
      warnings: ["repeat-scope-guessed"],
    });
    // The last-stitch reading gives 13: no warning.
    expect(parseRowText("sc, inc x6 (13)", "en_us")).toEqual({
      ok: true,
      ops: [st("SC", 1), st("INC", 6)],
      stitchCountTarget: 13,
    });
    // Neither reading fits, or no count: read as written and flagged.
    expect(parseRowText("sc, inc x6 (20)", "en_us")).toMatchObject({
      ok: true,
      ops: [st("SC", 1), st("INC", 6)],
      warnings: ["repeat-scope-ambiguous"],
    });
    expect(parseRowText("sc, inc x6", "en_us")).toMatchObject({ warnings: ["repeat-scope-ambiguous"] });
  });

  it("settles 'rep from * N times' with the written count", () => {
    const body = [st("SC", 1), st("INC", 1)];
    expect(parseRowText("*sc, inc; rep from * 5 times (18)", "en_us")).toEqual({
      ok: true,
      ops: [rep(6, body)],
      stitchCountTarget: 18,
      warnings: ["repeat-count-guessed"],
    });
    expect(parseRowText("*sc, inc; rep from * 5 times (15)", "en_us")).toEqual({
      ok: true,
      ops: [rep(5, body)],
      stitchCountTarget: 15,
    });
    expect(parseRowText("*sc, inc; rep from * 5 times", "en_us")).toEqual({
      ok: true,
      ops: [rep(5, body)],
      warnings: ["repeat-count-ambiguous"],
    });
    expect(parseRowText("*sc, inc; rep from * 5 more times", "en_us")).toEqual({ ok: true, ops: [rep(6, body)] });
    expect(parseRowText("*sc, inc; rep from * 5 more times (15)", "en_us")).toMatchObject({
      ops: [rep(5, body)],
      warnings: ["repeat-count-guessed"],
    });
    expect(parseRowText("*sc, inc; rep from * 5 times (40)", "en_us")).toMatchObject({
      ops: [rep(5, body)],
      warnings: ["repeat-count-ambiguous"],
    });
  });

  it("reports a too-large lenient reading instead of the strict error", () => {
    expect(parseRowText("inc x 1000", "en_us")).toMatchObject({ ok: false, code: "too-large", limit: MAX_COUNT });
    expect(parseRowText("(sc, inc) repeat 1000 times", "en_us")).toMatchObject({
      ok: false,
      code: "too-large",
      limit: MAX_TIMES,
    });
  });

  it("does not let a literal @ act as the internal fill marker", () => {
    expect(parseRowText("sc @", "en_us", { previousCount: 12 }).ok).toBe(false);
    expect(parseRowText("@ 1 fM", "de", { previousCount: 12 }).ok).toBe(false);
  });

  it("fails deep nesting with a syntax error instead of overflowing the stack", () => {
    const deep = `${"(".repeat(5000)}1 fM${")".repeat(5000)} x 2`;
    expect(parseRowText(deep)).toMatchObject({ ok: false, code: "syntax" });
    const fifty = `${"1×(".repeat(50)}1 fM${")".repeat(50)}`;
    expect(parseRowText(fifty).ok).toBe(true);
    expect(parseRowText(`2×(${fifty})`).ok).toBe(false);
  });

  it("reads long text quickly (strict pass only above 1500 characters)", () => {
    const words = "sc in each st around ".repeat(1000); // ~21 KB
    const started = performance.now();
    expect(parseRowText(words, "en_us", { previousCount: 12 }).ok).toBe(false);
    expect(parseRowText(`${"sc, ".repeat(5000)}sc`, "en_us").ok).toBe(true);
    // Just under the cap, the lenient pass must stay fast too.
    expect(parseRowText("sc in each st around ".repeat(70), "en_us", { previousCount: 12 }).ok).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
