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
