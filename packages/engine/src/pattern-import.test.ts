import { describe, expect, it } from "vitest";
import { renderOps } from "./notation.js";
import { parsePatternText, type ImportedPart, type PatternImport } from "./pattern-import.js";
import { validate } from "./validate.js";

/** Compact view of a part: "ops (target)" per stitch row, "> note" per instruction row. */
function view(part: ImportedPart, locale: "en_us" | "de" = "en_us"): string[] {
  return part.rows.map((r) => (r.ops.length > 0 ? `${renderOps(r.ops, locale)} (${r.stitchCountTarget})` : `> ${r.note}`));
}

const codes = (res: PatternImport) => res.issues.map((i) => i.code);
const issuesOf = (res: PatternImport, code: string) => res.issues.filter((i) => i.code === code);

describe("parsePatternText — parts and labels (US terms)", () => {
  const text = [
    "Sleepy Fox",
    "Materials: 50 g cotton yarn, 3 mm hook, 8 mm safety eyes",
    "Abbreviations:",
    "sc - single crochet",
    "inc - increase",
    "",
    "HEAD",
    "Rnd 1: 6 sc in MR (6)",
    "Rnd 2: inc x 6 (12)",
    "Rnd 3: (1 sc, inc)*6 = 18",
    "Round 4: (2 sc, inc) repeat 6 times [24]",
    "Rounds 5-8: sc around (4 rounds)",
    "Insert the safety eyes between Rnd 6 and 7, 6 sts apart.",
    "Rnd 9 – 10: 24 sc",
    "R11: (2 sc, dec) x 6 = [18]. Stuff the head.",
    "R 12. (1 sc, dec)* (12)",
    "Rd. 13 6 dec (6)",
    "Fasten off and leave a long tail.",
    "",
    "Ears (make 2)",
    "R1: MR, 4 sc",
    "R2: (sc, inc) x 2 (6)",
    "R3-R4: 6 sc",
    "R5+R6: 6 sc",
    "Fold and sc through both layers.",
  ].join("\n");
  const res = parsePatternText(text);

  it("detects the locale and moves the title, materials and glossary to the preamble", () => {
    expect(res.locale).toBe("en_us");
    expect(res.preamble).toEqual([
      "Sleepy Fox",
      "Materials: 50 g cotton yarn, 3 mm hook, 8 mm safety eyes",
      "Abbreviations:",
      "sc - single crochet",
      "inc - increase",
    ]);
    expect(issuesOf(res, "PREAMBLE").map((i) => i.line)).toEqual([1, 2, 3, 4, 5]);
  });

  it("finds the parts with their quantities", () => {
    expect(res.parts.map((p) => [p.name, p.quantity])).toEqual([
      ["Head", 1],
      ["Ears", 2],
    ]);
  });

  it("reads every round, expands ranges and keeps instructions in place", () => {
    expect(view(res.parts[0]!)).toEqual([
      "1 MR, 6 sc (6)",
      "6 inc (12)",
      "6x (1 sc, 1 inc) (18)",
      "6x (2 sc, 1 inc) (24)",
      "24 sc (24)",
      "24 sc (24)",
      "24 sc (24)",
      "24 sc (24)",
      "> Insert the safety eyes between Rnd 6 and 7, 6 sts apart.",
      "24 sc (24)",
      "24 sc (24)",
      "6x (2 sc, 1 dec) (18)",
      "> Stuff the head.",
      "6x (1 sc, 1 dec) (12)",
      "6 dec (6)",
      "> Fasten off and leave a long tail.",
    ]);
    expect(view(res.parts[1]!)).toEqual([
      "1 MR, 4 sc (4)",
      "2x (1 sc, 1 inc) (6)",
      "6 sc (6)",
      "6 sc (6)",
      "6 sc (6)",
      "6 sc (6)",
      "> Fold and sc through both layers.",
    ]);
  });

  it("produces a valid part for a correct pattern", () => {
    for (const part of res.parts) {
      expect(validate({ schemaVersion: 1, rows: part.rows }).filter((f) => f.severity === "error")).toEqual([]);
    }
  });

  it("only reports the preamble", () => {
    expect(new Set(codes(res))).toEqual(new Set(["PREAMBLE"]));
  });

  it("gives deterministic ids by default and uses an injected generator", () => {
    const ids = res.parts.flatMap((p) => p.rows.map((r) => r.id));
    expect(ids[0]).toBe("import-1");
    expect(new Set(ids).size).toBe(ids.length);
    let n = 0;
    const custom = parsePatternText(text, { makeId: () => `x${n++}` });
    expect(custom.parts[0]!.rows[0]!.id).toBe("x0");
    expect(parsePatternText(text)).toEqual(res);
  });
});

describe("parsePatternText — label forms", () => {
  const rounds = (text: string) => parsePatternText(text, { locale: "en_us" }).parts.flatMap((p) => view(p));

  it("reads numbered labels of every kind", () => {
    expect(rounds("1. 6 sc in MR\n2) inc x 6 (12)\n3: 12 sc\n4 rnd. 12 sc\nRunde 5: 12 sc\nRow 6: 12 sc")).toEqual([
      "1 MR, 6 sc (6)",
      "6 inc (12)",
      "12 sc (12)",
      "12 sc (12)",
      "12 sc (12)",
      "12 sc (12)",
    ]);
  });

  it("reads ranges of every kind", () => {
    const text = "1. 6 sc in MR\n2. inc around (12)\n3-4. 12 sc\nRnd 5 – 6: 12 sc\n7-8 rnd. 12 sc\nR9-R10: 12 sc\nR11+R12: 12 sc\nRounds 13-14: 12 sc";
    expect(rounds(text)).toHaveLength(14);
  });

  it("reads several rounds on one line, as PDF text often has them", () => {
    expect(rounds("1. 6 sc in MR 2. inc x 6 (12) 3. (sc, inc) x 6 (18) 4. 18 sc 5.6 sc, dec, 10 sc (17)")).toEqual([
      "1 MR, 6 sc (6)",
      "6 inc (12)",
      "6x (1 sc, 1 inc) (18)",
      "18 sc (18)",
      "6 sc, 1 dec, 10 sc (17)",
    ]);
  });

  it("does not take mentions of rounds or measurements for labels", () => {
    const res = parsePatternText(
      "Rnd 1: 6 sc in MR\nRnd 2: inc x 6 (12) Place the eyes between Rnd 1 and 2 with a 3.5 mm gap.\nRnd 3: 12 sc",
      { locale: "en_us" },
    );
    expect(view(res.parts[0]!)).toEqual([
      "1 MR, 6 sc (6)",
      "6 inc (12)",
      "> Place the eyes between Rnd 1 and 2 with a 3.5 mm gap.",
      "12 sc (12)",
    ]);
  });

  it("repairs a range whose dash got lost (2526.)", () => {
    const text = Array.from({ length: 24 }, (_, i) => `${i + 1}. ${i === 0 ? "6 sc in MR" : "6 sc"}`).join("\n");
    const res = parsePatternText(`${text}\n2526. 6 sc\n27. 6 sc`, { locale: "en_us" });
    expect(res.parts[0]!.rows).toHaveLength(27);
  });

  it("marks rows and turned work as type row", () => {
    const res = parsePatternText("Row 1: ch 11, sc in 2nd ch from hook, 9 sc (10)\nRow 2: ch 1, 10 sc, turn (10)", {
      locale: "en_us",
    });
    expect(res.parts[0]!.rows.map((r) => r.type)).toEqual(["row", "row", "row"]);
  });

  it("checks a rounds note against its range and expands a single label by it", () => {
    const res = parsePatternText("1. 6 sc in MR\n2-5. 6 sc (3 rounds)\n6. 6 sc (2 rounds)\n8. 6 sc", { locale: "en_us" });
    expect(res.parts[0]!.rows).toHaveLength(8);
    expect(issuesOf(res, "RANGE_MISMATCH")).toMatchObject([{ line: 2, partIndex: 0, rowIndex: 1 }]);
    expect(issuesOf(res, "LABEL_GAP")).toEqual([]);
  });

  it("reports skipped round numbers", () => {
    const res = parsePatternText("Rnd 1: 6 sc in MR\nRnd 2: 6 sc\nRnd 4: 6 sc", { locale: "en_us" });
    expect(issuesOf(res, "LABEL_GAP")).toMatchObject([{ line: 3, severity: "info" }]);
  });
});

describe("parsePatternText — part headers", () => {
  const names = (text: string) => parsePatternText(text, { locale: "en_us" }).parts.map((p) => [p.name, p.quantity]);
  const body = "\n1. 6 sc in MR\n2. 6 sc\n";

  it("reads header lines with quantities", () => {
    expect(names(`HEAD${body}ARMS (x2)${body}Legs – make 2${body}Wings (2x)${body}Hands (Make two)${body}`)).toEqual([
      ["Head", 1],
      ["Arms", 2],
      ["Legs", 2],
      ["Wings", 2],
      ["Hands", 2],
    ]);
  });

  it("reads headers with a colon, unknown names and 'for the …' headers", () => {
    expect(names(`Head:${body}Sock Monkey${body}For the right leg${body}`)).toEqual([
      ["Head", 1],
      ["Sock Monkey", 1],
      ["Right leg", 1],
    ]);
  });

  it("reads a header at the start of a line and a numbering restart within a line", () => {
    const text = "HEAD In grey. 1. 6 sc in MR 2. inc x 6 (12) EARS (make 2) In white. 1. 6 sc in MR 2. 6 sc\nBody 1. 6 sc in MR";
    const res = parsePatternText(text, { locale: "en_us" });
    expect(res.parts.map((p) => [p.name, p.quantity])).toEqual([
      ["Head", 1],
      ["Ears", 2],
      ["Body", 1],
    ]);
    expect(view(res.parts[1]!)).toEqual(["> In white.", "1 MR, 6 sc (6)", "6 sc (6)"]);
    expect(issuesOf(res, "UNSUPPORTED_COLOR").map((i) => i.partIndex)).toEqual([0, 1]);
  });

  it("starts a new part when the numbering restarts without a header", () => {
    const res = parsePatternText("1. 6 sc in MR\n2. 6 sc\n1. 4 sc in MR\n2. 4 sc", { locale: "en_us" });
    expect(res.parts.map((p) => p.name)).toEqual(["Teil 1", "Teil 2"]);
  });

  it("names an implicit first part and reads unlabelled rounds", () => {
    const res = parsePatternText("6 sc in MR\ninc around (12)\n(sc, inc) x 6 (18)", { locale: "en_us" });
    expect(res.parts).toHaveLength(1);
    expect(res.parts[0]!.name).toBe("Teil 1");
    expect(view(res.parts[0]!)).toEqual(["1 MR, 6 sc (6)", "6 inc (12)", "6x (1 sc, 1 inc) (18)"]);
  });

  it("ignores a continuation heading and keeps the part", () => {
    const res = parsePatternText("Body\n1. 6 sc in MR\n2. 6 sc\nBody continued: 3. 6 sc\n4. 6 sc", { locale: "en_us" });
    expect(res.parts).toHaveLength(1);
    expect(res.parts[0]!.rows).toHaveLength(4);
    expect(issuesOf(res, "IGNORED")).toMatchObject([{ line: 4, text: "Body continued:" }]);
  });

  it("keeps an assembly section with the part before it", () => {
    const text = `Tail${body}Assembly\nSew the tail to the body.\nEars:\n1. Pin the ears between rounds 3 and 4.\n2. Sew them on.`;
    const res = parsePatternText(text, { locale: "en_us" });
    expect(res.parts.map((p) => p.name)).toEqual(["Tail"]);
    expect(view(res.parts[0]!)).toEqual([
      "1 MR, 6 sc (6)",
      "6 sc (6)",
      "> Assembly",
      "> Sew the tail to the body.",
      "> Ears:",
      "> 1. Pin the ears between rounds 3 and 4.",
      "> 2. Sew them on.",
    ]);
  });
});

describe("parsePatternText — German patterns", () => {
  const text = [
    "Kleiner Bär",
    "Material: Baumwollgarn, Nadel 2,5 mm",
    "",
    "Kopf",
    "R1: 6 fM in den Fadenring (6)",
    "R2: Zun in jede M (12)",
    "R3: (1 fM, 1 Zun) x 6 (18)",
    "R4-R6: fM rundherum (3 Runden)",
    "Sicherheitsaugen zwischen Runde 4 und 5 einsetzen, 5 M auseinander.",
    "R7: nur hinteres Maschenglied: 18 fM",
    "R8: (1 fM, 1 Abn) x 6 (12). Kopf füllen.",
    "R9: 6 Abn (6)",
    "Faden abschneiden und Öffnung schließen.",
    "",
    "Ohren (2×)",
    "Runde 1: 6 fM in einen Magic Ring",
    "Runde 2: in jede M 1 fM",
    "Farbwechsel zu Weiß.",
    "Runde 3: 6 fM",
    "",
    "2 Arme",
    "1. MR 6",
    "2.-5. 6 fM",
  ].join("\n");
  const res = parsePatternText(text);

  it("detects German and reads parts, quantities and rounds", () => {
    expect(res.locale).toBe("de");
    expect(res.parts.map((p) => [p.name, p.quantity])).toEqual([
      ["Kopf", 1],
      ["Ohren", 2],
      ["Arme", 2],
    ]);
    expect(view(res.parts[0]!, "de")).toEqual([
      "1 MR, 6 fM (6)",
      "6 Zun (12)",
      "6× (1 fM, 1 Zun) (18)",
      "18 fM (18)",
      "18 fM (18)",
      "18 fM (18)",
      "> Sicherheitsaugen zwischen Runde 4 und 5 einsetzen, 5 M auseinander.",
      "18 fM (hMG) (18)",
      "6× (1 fM, 1 Abn) (12)",
      "> Kopf füllen.",
      "6 Abn (6)",
      "> Faden abschneiden und Öffnung schließen.",
    ]);
    expect(view(res.parts[1]!, "de")).toEqual(["1 MR, 6 fM (6)", "6 fM (6)", "> Farbwechsel zu Weiß.", "6 fM (6)"]);
    expect(res.parts[2]!.rows).toHaveLength(5);
  });

  it("reports the colour change as information", () => {
    expect(issuesOf(res, "UNSUPPORTED_COLOR")).toMatchObject([{ line: 18, partIndex: 1, rowIndex: 2, severity: "info" }]);
  });
});

describe("parsePatternText — what the format cannot represent yet", () => {
  const res = parsePatternText(
    [
      "Body",
      "1. 6 sc in MR",
      "2. inc around (12)",
      "3. 3 sc in one st, 11 sc (14)",
      "4. (hdc inc, sc) x 7 (21)",
      "5. 5 sc, bobble, 15 sc (21)",
      "6. 5 sc with the left leg, 16 sc (21)",
      "7. (ch 3, skip 2, sc in next ch-sp) around",
      "8. 21 sx (21) Stuff a little.",
      "9. 21 sc, join with sl st to first sc (21)",
      "",
      "Muzzle",
      "Ch 7, start in 2nd ch from hook: 5 sc, 3 sc in last ch, work on the other side of the chain: 4 sc, inc (14)",
      "Rnd 2: (sc, inc) x 7 (21)",
    ].join("\n"),
    { locale: "en_us" },
  );
  const at = (part: number, row: number) =>
    res.issues.filter((i) => i.partIndex === part && i.rowIndex === row).map((i) => i.code);

  it("keeps the raw text as an instruction row with a distinct issue", () => {
    const rows = view(res.parts[0]!);
    expect(rows[2]).toBe("> 3. 3 sc in one st, 11 sc (14)");
    expect(at(0, 2)).toEqual(["UNSUPPORTED_GROUP"]);
    expect(at(0, 3)).toEqual(["UNSUPPORTED_GROUP"]);
    expect(at(0, 4)).toEqual(["UNSUPPORTED_SPECIAL_STITCH"]);
    expect(at(0, 5)).toEqual(["UNSUPPORTED_JOIN"]);
    expect(at(0, 6)).toEqual(["UNSUPPORTED_CHAIN_SPACE"]);
    expect(rows[7]).toBe("> 8. 21 sx (21)");
    expect(at(0, 7)).toEqual(["UNREADABLE"]);
    expect(rows[8]).toBe("> Stuff a little.");
  });

  it("imports a slip-stitch-joined round as a spiral round", () => {
    expect(view(res.parts[0]!)[9]).toBe("21 sc (21)");
    expect(at(0, 9)).toEqual(["UNSUPPORTED_ROUND_JOIN"]);
  });

  it("reports rounds worked around a foundation chain", () => {
    const muzzle = res.parts[1]!;
    expect(muzzle.rows[0]!.ops).toEqual([]);
    expect(at(1, 0)).toEqual(["UNSUPPORTED_FOUNDATION_OVAL"]);
    // The declared count of the oval round still serves as context for later rounds.
    expect(view(muzzle)[1]).toBe("7x (1 sc, 1 inc) (21)");
  });

  it("names every special stitch, shells and joining legs", () => {
    for (const stitch of ["puff st", "popcorn", "cluster", "FPdc", "picot", "bobble"]) {
      const r = parsePatternText(`1. 6 sc in MR\n2. 2 sc, ${stitch}, 3 sc (6)`, { locale: "en_us" });
      expect(codes(r), stitch).toEqual(["UNSUPPORTED_SPECIAL_STITCH"]);
    }
    expect(codes(parsePatternText("1. 6 sc in MR\n2. (sc, shell) x 3", { locale: "en_us" }))).toEqual(["UNSUPPORTED_GROUP"]);
    expect(codes(parsePatternText("1. 6 sc in MR\n2. join the legs with 3 ch, 6 sc", { locale: "en_us" }))).toEqual([
      "UNSUPPORTED_JOIN",
    ]);
  });

  it("never drops text: every input character is in a row, the preamble or an issue", () => {
    const kept = [
      ...res.parts.flatMap((p) => p.rows.map((r) => r.note ?? renderOps(r.ops, "en_us"))),
      ...res.preamble,
    ].join(" ");
    for (const word of ["bobble", "sx", "ch-sp", "left", "other", "Stuff"]) expect(kept).toContain(word);
  });
});

describe("parsePatternText — instruction lines", () => {
  it("keeps instructions between rounds as instruction rows", () => {
    const res = parsePatternText(
      [
        "Head",
        "1. 6 sc in MR",
        "cc to white",
        "2. inc around (12)",
        "Embroider the mouth with black yarn.",
        "Continue on next page",
        "3. 12 sc",
      ].join("\n"),
      { locale: "en_us" },
    );
    expect(view(res.parts[0]!)).toEqual([
      "1 MR, 6 sc (6)",
      "> cc to white",
      "6 inc (12)",
      "> Embroider the mouth with black yarn.",
      "> Continue on next page",
      "12 sc (12)",
    ]);
    expect(issuesOf(res, "UNSUPPORTED_COLOR")).toMatchObject([{ line: 3, partIndex: 0, rowIndex: 1 }]);
    expect(res.parts[0]!.rows[1]).toMatchObject({ ops: [], stitchCountTarget: 0, note: "cc to white" });
  });
});

describe("parsePatternText — context, counts and chains", () => {
  it("needs a previous count for 'around' at the start of a part", () => {
    const res = parsePatternText("Head\nRnd 1: sc around", { locale: "en_us" });
    expect(res.parts[0]!.rows[0]!.ops).toEqual([]);
    expect(codes(res)).toEqual(["NEEDS_PREVIOUS_COUNT"]);
  });

  it("reports an 'around' that does not fit the previous count", () => {
    const res = parsePatternText("1. 7 sc in MR\n2. (sc, inc) around", { locale: "en_us" });
    expect(codes(res)).toEqual(["FILL_MISMATCH"]);
  });

  it("keeps a wrong declared count so validate reports it", () => {
    const res = parsePatternText("1. 6 sc in MR\n2. inc x 6 (13)", { locale: "en_us" });
    expect(res.parts[0]!.rows[1]!.stitchCountTarget).toBe(13);
    const findings = validate({ schemaVersion: 1, rows: res.parts[0]!.rows });
    expect(findings.map((f) => f.code)).toContain("STITCH_COUNT_MISMATCH");
  });

  it("uses the computed count when none is declared", () => {
    const res = parsePatternText("1. 6 sc in MR\n2. (sc, inc) x 6", { locale: "en_us" });
    expect(res.parts[0]!.rows[1]!.stitchCountTarget).toBe(18);
  });

  it("splits a first row into the foundation chain and the row worked into it", () => {
    const res = parsePatternText("Scarf\nRow 1: ch 11, sc in 2nd ch from hook, 9 sc (10)\nRow 2: ch 1, 10 sc, turn (10)", {
      locale: "en_us",
    });
    expect(view(res.parts[0]!)).toEqual(["11 ch (0)", "1 sc, 9 sc (10)", "1 ch, 10 sc (10)"]);
    expect(validate({ schemaVersion: 1, rows: res.parts[0]!.rows }).filter((f) => f.severity === "error")).toEqual([]);
  });

  it("reads an instruction followed by a row and rows after a count", () => {
    const res = parsePatternText("Stem\nWith colour B: ch 7\nAttach the yarn to the top, crochet 12 sc. 2-3 rnd. 12 sc", {
      locale: "en_us",
    });
    expect(view(res.parts[0]!)).toEqual([
      "> With colour B:",
      "7 ch (0)",
      "> Attach the yarn to the top,",
      "12 sc (12)",
      "12 sc (12)",
      "12 sc (12)",
    ]);
  });
});

describe("parsePatternText — preamble, pages and robustness", () => {
  it("ignores page numbers and keeps copyright and notes out of the parts", () => {
    const text = [
      "A tiny whale for the bathtub. This pattern is for personal use.",
      "Notes: work in a continuous spiral.",
      "© 2026 Somebody. All rights reserved.",
      "Body",
      "1. 6 sc in MR",
      "Page 2 of 5",
      "2. inc around (12)",
      "3",
      "3. 12 sc",
    ].join("\n");
    const res = parsePatternText(text, { locale: "en_us" });
    expect(res.preamble).toEqual([
      "A tiny whale for the bathtub. This pattern is for personal use.",
      "Notes: work in a continuous spiral.",
      "© 2026 Somebody. All rights reserved.",
    ]);
    expect(view(res.parts[0]!)).toEqual(["1 MR, 6 sc (6)", "6 inc (12)", "12 sc (12)"]);
    expect(issuesOf(res, "IGNORED").map((i) => i.line)).toEqual([6, 8]);
  });

  it("returns an empty import for empty text", () => {
    expect(parsePatternText("")).toEqual({ locale: "de", localeConfidence: 0, parts: [], issues: [], preamble: [] });
  });

  it("never throws on garbage and is deterministic", () => {
    let seed = 20261028;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const alphabet = "Rnd 1234567890 .,:;()[]*×x=–-sc inc dec MR fM Zun HEAD Ears (make 2) around \n\t ÄÖÜ!?@#";
    for (let t = 0; t < 60; t++) {
      const length = 20 + Math.floor(rand() * 400);
      let text = "";
      for (let i = 0; i < length; i++) text += alphabet[Math.floor(rand() * alphabet.length)];
      const a = parsePatternText(text);
      const b = parsePatternText(text);
      expect(a).toEqual(b);
      for (const part of a.parts) {
        for (const row of part.rows) expect(row.ops.length > 0 || (row.note ?? "") !== "").toBe(true);
      }
    }
  });

  it("handles a long single-line paste quickly", () => {
    const line = Array.from({ length: 200 }, (_, i) => `${i + 1}. ${i === 0 ? "6 sc in MR" : "6 sc"} (6)`).join(" ");
    const started = performance.now();
    const res = parsePatternText(line, { locale: "en_us" });
    expect(res.parts[0]!.rows).toHaveLength(200);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
