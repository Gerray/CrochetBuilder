import { describe, expect, it } from "vitest";
import { renderOps, renderRow, resolveStitchTerm } from "./notation.js";
import { parsePatternText, type ImportedPart, type PatternImport } from "./pattern-import.js";
import type { PartContent, Row } from "./schema.js";
import { renderedRows } from "./export.js";
import { validate } from "./validate.js";
import { planJoins } from "./join.js";

/** Compact view of a part: "ops (target)" per stitch row, "> note" per instruction row. */
function view(part: Pick<ImportedPart, "rows">, locale: "en_us" | "de" = "en_us"): string[] {
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

  it("keeps every word of the input", () => {
    expectEveryWordKept(text, res);
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
    expect(res.colors.map((c) => c.id)).toEqual(["grey", "white"]);
    expect(res.parts.map((p) => p.rows.find((r) => r.ops.length > 0)?.color)).toEqual(["grey", "white", undefined]);
    expect(res.parts.map((p) => p.id)).toEqual(["head", "ears", "body"]);
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

  it("keeps every word of the input", () => {
    expectEveryWordKept(text, res);
  });

  it("reads the colour change into the palette and the next round", () => {
    expect(res.colors).toEqual([{ id: "weiss", name: "Weiß", hex: "#ffffff" }]);
    expect(res.parts[1]!.rows.map((r) => r.color)).toEqual([undefined, undefined, undefined, "weiss"]);
    expect(issuesOf(res, "COLOR_UNNAMED")).toEqual([]);
  });

  it("reads finish, stuffing and the safety eyes of the head", () => {
    const head = res.parts[0]!;
    expect(head).toMatchObject({ id: "kopf", finish: "gather", stuffing: "firm" });
    expect(res.parts[1]).not.toHaveProperty("finish");
    expect(res.assembly).toEqual([
      {
        id: "placement-1",
        kind: "eyes",
        target: "kopf",
        row: head.rows[3]!.id, // round 4 (R4-R6 is rows 3–5)
        angle: 0,
        spacing: 5,
      },
    ]);
  });
});

describe("parsePatternText — colours, finish, stuffing and assembly (format v2)", () => {
  const text = [
    "Little Owl",
    "Materials: brown and cream yarn, 8 mm safety eyes",
    "Head",
    "In brown.",
    "Rnd 1: 6 sc in MR (6)",
    "Rnd 2: inc around (12)",
    "Rnd 3: (sc, inc) x 6 (18)",
    "Rnd 4-6: 18 sc",
    "Insert the safety eyes between rounds 4 and 5, 5 sts apart.",
    "Rnd 7: (sc, dec) x 6 (12)",
    "Stuff the head firmly.",
    "Rnd 8: 6 dec (6)",
    "Fasten off and close the hole.",
    "Wings (make 2)",
    "With cream yarn:",
    "Rnd 1: 4 sc in MR",
    "Rnd 2: (sc, inc) x 2 (6)",
    "Rnd 3-5: 6 sc",
    "Change color to brown.",
    "Rnd 6: 6 sc",
    "Do not stuff. Fold flat and sc through both layers. Leave a long tail for sewing.",
    "Assembly",
    "Sew the wings to the head between rounds 5 and 7.",
    "Tail",
    "Rnd 1: 4 sc in MR",
    "Rnd 2: 4 sc",
    "Leave open.",
  ].join("\n");
  const res = parsePatternText(text, { locale: "en_us" });
  const [head, wings, tail] = res.parts;

  it("gives every part a stable id", () => {
    expect(res.parts.map((p) => p.id)).toEqual(["head", "wings", "tail"]);
    expect(parsePatternText("Arm\n1. 6 sc in MR\nArm\n1. 6 sc in MR", { locale: "en_us" }).parts.map((p) => p.id)).toEqual(["arm", "arm-2"]);
  });

  it("builds the palette and switches the colour on the next stitch row, until the next change", () => {
    expect(res.colors).toEqual([
      { id: "brown", name: "Brown", hex: "#8b5a2b" },
      { id: "cream", name: "Cream", hex: "#fffdd0" },
    ]);
    const colorOf = (rows: Row[]) => rows.filter((r) => r.ops.length > 0).map((r) => r.color ?? "-");
    expect(colorOf(head!.rows)).toEqual(["brown", "-", "-", "-", "-", "-", "-", "-"]);
    expect(colorOf(wings!.rows)).toEqual(["cream", "-", "-", "-", "-", "brown"]);
    // The colour lines stay as instructions.
    expect(view(wings!)[0]).toBe("> With cream yarn:");
  });

  it("reads finish and stuffing per part", () => {
    expect([head!.finish, head!.stuffing]).toEqual(["gather", "firm"]);
    expect([wings!.finish, wings!.stuffing]).toEqual(["flat", "none"]);
    expect([tail!.finish, tail!.stuffing]).toEqual(["open", undefined]);
  });

  it("reads the eyes and the sewn-on wings, with the angle reported as guessed", () => {
    const roundRow = (n: number) => head!.rows.filter((r) => r.ops.length > 0)[n - 1]!.id;
    expect(res.assembly).toEqual([
      {
        id: "placement-1",
        kind: "eyes",
        target: "head",
        row: roundRow(4),
        angle: 0,
        spacing: 5,
        size: 8,
      },
      {
        id: "placement-2",
        kind: "attach",
        part: "wings",
        target: "head",
        row: roundRow(5),
        angle: 0,
      },
    ]);
    const sewRow = wings!.rows.findIndex((r) => r.note === "Sew the wings to the head between rounds 5 and 7.");
    expect(issuesOf(res, "ASSEMBLY_ANGLE_GUESSED")).toMatchObject([{ line: 23, partIndex: 1, rowIndex: sewRow, severity: "info" }]);
  });

  it("keeps every word of the input", () => {
    expectEveryWordKept(text, res);
  });

  it("places nothing it cannot resolve to a part and a round", () => {
    const base = "Head\n1. 6 sc in MR\n2. inc around (12)\n3. 12 sc\nArms (make 2)\n1. 4 sc in MR\n2. 4 sc\n";
    const assemblyOf = (line: string) => parsePatternText(base + line, { locale: "en_us" }).assembly;
    expect(assemblyOf("Sew the arms between rounds 2 and 3.")).toEqual([]); // no target named
    expect(assemblyOf("Sew the arms to the body between rounds 2 and 3.")).toEqual([]); // no part "Body"
    expect(assemblyOf("Sew the arms to the head between rounds 9 and 10.")).toEqual([]); // no round 9
    expect(assemblyOf("Sew the arms to the head between rounds 2 and 3.")).toMatchObject([{ part: "arms", target: "head" }]);
  });

  it("reads one pair of eyes per part and German assembly sentences", () => {
    const res2 = parsePatternText(
      [
        "Kopf",
        "R1: 6 fM in den Fadenring (6)",
        "R2: Zun in jede M (12)",
        "R3-R5: 12 fM",
        "Augen zwischen Runde 3 und 4 einsetzen, 4 M Abstand.",
        "Die Augen zwischen Runde 4 und 5 befestigen.",
        "Ohren (2x)",
        "R1: 5 fM in den Fadenring",
        "R2: 5 fM",
        "Ohren zwischen Runde 2 und 3 an den Kopf nähen.",
      ].join("\n"),
    );
    expect(res2.assembly.map((p) => [p.kind, p.part, p.target, p.spacing])).toEqual([
      ["eyes", undefined, "kopf", 4],
      ["attach", "ohren", "kopf", undefined],
    ]);
    // "4 M Abstand" after a comma is not a row "4 M": German nouns do not start rows.
    expect(view(res2.parts[0]!, "de")).toContain("> Augen zwischen Runde 3 und 4 einsetzen, 4 M Abstand.");
  });
});

// ---------------------------------------------------------------------------
// Review fixes, importer v2: an issue rather than a silent misreading
// ---------------------------------------------------------------------------

describe("parsePatternText — format v2 details: no silent misreadings", () => {
  const en = (text: string) => parsePatternText(text, { locale: "en_us" });
  const byName = (res: PatternImport, name: string) => res.parts.find((p) => p.name === name)!;

  it("applies assembly-section sentences only to a part they name", () => {
    const res = en(
      [
        "Head",
        "Rnd 1: 6 sc in MR (6)",
        "Rnd 2-6: 6 sc (6)",
        "Tail",
        "Rnd 1: 4 sc in MR (4)",
        "Rnd 2: 4 sc (4)",
        "Finishing",
        "Sew the tail to the head between rounds 3 and 4.",
        "Insert the eyes between rounds 5 and 6.",
        "Stuff firmly.",
        "Close the hole.",
      ].join("\n"),
    );
    expect(res.assembly.map((p) => [p.kind, p.part, p.target])).toEqual([["attach", "tail", "head"]]);
    const tail = byName(res, "Tail");
    expect([tail.finish, tail.stuffing]).toEqual([undefined, undefined]);
    expect(issuesOf(res, "DETAIL_UNASSIGNED").map((i) => [i.line, i.partIndex])).toEqual([
      [9, 1],
      [10, 1],
      [11, 1],
    ]);
    // The sentences stay as text.
    expect(view(tail).slice(-3)).toEqual(["> Insert the eyes between rounds 5 and 6.", "> Stuff firmly.", "> Close the hole."]);
    // German heading, and a sub-section that names a part still works.
    const de = parsePatternText("Kopf\nR1: 6 fM in den Fadenring (6)\nR2: 6 fM (6)\nZusammensetzen\nFest füllen.");
    expect(de.parts[0]!.stuffing).toBeUndefined();
    expect(issuesOf(de, "DETAIL_UNASSIGNED")).toHaveLength(1);
    const sub = en("Head\nRnd 1: 6 sc in MR (6)\nRnd 2: 6 sc (6)\nTail\nRnd 1: 4 sc in MR (4)\nAssembly\nHead:\nStuff firmly.");
    expect(byName(sub, "Head").stuffing).toBe("firm");
  });

  it("takes the finish from the last finishing sentence after the last stitch row", () => {
    const res = en(
      [
        "Ball",
        "Rnd 1: 6 sc in MR, pull tight to close (6)",
        "Pull the tail to close the magic ring.",
        "Rnd 2: inc x 6 (12)",
        "Do not close the rounds with a sl st.",
        "Close the gap between the halves with 2 sc.",
        "Rnd 3: 12 sc (12)",
        "Close the hole. Leave open.",
        "Snout",
        "Rnd 1: 6 sc in MR (6)",
        "Close the opening when you sew it on to the face.",
        "Cap",
        "Row 1: ch 7, 6 sc (6)",
        "Fold the cuff up and sew it together.",
        "Ear",
        "Rnd 1: 6 sc in MR (6)",
        "Sc the opening closed. Leave a long tail for sewing.",
      ].join("\n"),
    );
    // The ring's "pull tight to close" is no note of its own: the first round is read.
    expect(view(byName(res, "Ball"))[0]).toBe("1 MR, 6 sc (6)");
    expect(res.parts.map((p) => [p.name, p.finish])).toEqual([
      ["Ball", "open"],
      ["Snout", "open"],
      ["Cap", undefined],
      ["Ear", "flat"],
    ]);
    expect(en("Ball\nRnd 1: 6 sc in MR (6)\nDo not close the hole yet.\nRnd 2: 6 sc (6)\nClose the hole.").parts[0]!.finish).toBe("gather");
  });

  it("assigns stuffing per clause and per named part, else reports it", () => {
    const res = en(
      [
        "Body",
        "Rnd 1: 6 sc in MR (6)",
        "Stuff the body firmly, but do not stuff the arms.",
        "Arms (make 2)",
        "Rnd 1: 4 sc in MR (4)",
        "Fill in the hands with white yarn.",
        "Tail",
        "Rnd 1: 4 sc in MR (4)",
        "Stuff the tip a little.",
      ].join("\n"),
    );
    expect(res.parts.map((p) => [p.name, p.stuffing])).toEqual([
      ["Body", "firm"],
      ["Arms", "none"],
      ["Tail", undefined],
    ]);
    expect(issuesOf(res, "DETAIL_UNASSIGNED")).toMatchObject([{ line: 9, partIndex: 2 }]);
  });

  it("places by round label only, also in parts numbered on from earlier parts", () => {
    const res = en(
      [
        "Head",
        "Rnd 1: 6 sc in MR (6)",
        "Rnd 2: 6 sc, xq knot (6)",
        "Rnd 3: 6 sc (6)",
        "Insert the eyes between rounds 2 and 3.",
        "Body",
        "Rnd 10: 6 sc in MR (6)",
        "Rnd 11-14: 6 sc (6)",
        "Embroider the mouth between rounds 2 and 3.",
        "Embroider the belly between rounds 12 and 13.",
      ].join("\n"),
    );
    const body = byName(res, "Body");
    expect(res.assembly.map((p) => [p.kind, p.target, p.row])).toEqual([["embroidery", "body", body.rows[2]!.id]]);
    expect(issuesOf(res, "PLACEMENT_ROUND_UNKNOWN").map((i) => i.line)).toEqual([5, 9]);
  });

  it("does not take choices, stripes, felt or 'same colour' for colour changes, and keeps one main colour", () => {
    const res = en(
      [
        "Head",
        "Same colour",
        "Rnd 1: 6 sc in MR (6)",
        "In blue or green.",
        "Rnd 2: 6 sc (6)",
        "In yellow and red stripes.",
        "Rnd 3: 6 sc (6)",
        "With brown felt, cut two ovals.",
        "Rnd 4: 6 sc (6)",
        "With MC:",
        "Rnd 5: 6 sc (6)",
        "Change to the main colour.",
        "Rnd 6: 6 sc (6)",
      ].join("\n"),
    );
    expect(res.colors).toEqual([{ id: "main-color", name: "Main color" }]);
    expect(res.parts[0]!.rows.filter((r) => r.ops.length > 0).map((r) => r.color ?? "-")).toEqual(["-", "-", "-", "-", "main-color", "main-color"]);
  });

  it("carries a colour change right before a part header over to the new part", () => {
    const res = en("Body\nRnd 1: 6 sc in MR (6)\nChange to pink.\nLeg\nRnd 1: 4 sc in MR (4)\nRnd 2: 4 sc (4)");
    expect(res.parts.map((p) => p.rows.filter((r) => r.ops.length > 0).map((r) => r.color ?? "-"))).toEqual([["-"], ["pink", "-"]]);
  });

  it("lets the written count decide '3 hdc inc'", () => {
    const res = en("Body\nRnd 1: 6 sc in MR (6)\nRnd 2: 3 hdc inc, 3 sc (8)\nRnd 3: 3 hdc inc, 5 sc (11)\nRnd 4: 2 hdc inc, 7 sc (11)");
    expect(view(res.parts[0]!).slice(1)).toEqual([
      "3 hdc, 1 inc, 3 sc (8)", // only "3 hdc, inc" makes 8
      "3x ((2 hdc) in same st), 5 sc (11)", // only three increases make 11
      "2x ((2 hdc) in same st), 7 sc (11)", // both readings make 11: flagged
    ]);
    expect(issuesOf(res, "AMBIGUOUS_INCREASE").map((i) => i.line)).toEqual([5]);
  });

  it("stays fast on a 100 KB line of prose or of one repeated word", () => {
    for (const filler of ["fill ", "fold the fill and stuff the fill with the yarn, pull it ", "sew to the head between rounds 3 and 4 "]) {
      const line = filler.repeat(Math.ceil(100_000 / filler.length));
      const started = performance.now();
      const res = en(`Head\nRnd 1: 6 sc in MR (6)\n${line}`);
      expect(performance.now() - started, filler).toBeLessThan(300);
      expect(res.parts[0]!.rows).toHaveLength(2);
    }
  });
});

describe("parsePatternText — what the format cannot represent", () => {
  const text = [
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
    ].join("\n");
  const res = parsePatternText(text, { locale: "en_us" });
  const at = (part: number, row: number) =>
    res.issues.filter((i) => i.partIndex === part && i.rowIndex === row).map((i) => i.code);

  it("reads groups and special stitches (format v2) and keeps the rest as text with a distinct issue", () => {
    const rows = view(res.parts[0]!);
    expect(rows.slice(2, 5)).toEqual([
      "(3 sc) in same st, 11 sc (14)",
      "7x ((2 hdc) in same st, 1 sc) (21)",
      "5 sc, 1 bobble, 15 sc (21)",
    ]);
    expect([at(0, 2), at(0, 3), at(0, 4)]).toEqual([[], [], []]);
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

  it("reads a round worked around a foundation chain (oval start)", () => {
    const muzzle = res.parts[1]!;
    expect(view(muzzle)).toEqual(["7 ch (0)", "5 sc, (3 sc) in same st, 4 sc, 1 inc (14)", "7x (1 sc, 1 inc) (21)"]);
    expect(muzzle.rows[1]!.around).toBe(true);
    expect([at(1, 0), at(1, 1)]).toEqual([[], []]);
    expect(validate({ schemaVersion: 2, rows: muzzle.rows })).toEqual([]);
  });

  it("reads the v2 special stitches and names the others, shells and joining legs", () => {
    const row = (stitch: string) => parsePatternText(`1. 6 sc in MR\n2. 2 sc, ${stitch}, 3 sc (6)`, { locale: "en_us" });
    for (const stitch of ["puff st", "popcorn", "FPdc", "bobble", "5-dc bobble"]) {
      const r = row(stitch);
      expect(codes(r), stitch).toEqual([]);
      expect(r.parts[0]!.rows[1]!.ops, stitch).toHaveLength(3);
    }
    expect(codes(row("picot"))).toEqual([]);
    for (const stitch of ["cluster", "bullion st", "spike sc", "V-st"]) {
      expect(codes(row(stitch)), stitch).toEqual(["UNSUPPORTED_SPECIAL_STITCH"]);
    }
    expect(codes(parsePatternText("1. 6 sc in MR\n2. (sc, shell) x 3", { locale: "en_us" }))).toEqual([
      "UNSUPPORTED_SPECIAL_STITCH",
    ]);
    expect(codes(parsePatternText("1. 6 sc in MR\n2. join the legs with 3 ch, 6 sc", { locale: "en_us" }))).toEqual([
      "UNSUPPORTED_JOIN",
    ]);
  });

  it("never drops text: every input word is in a row, the preamble or an issue", () => {
    expectEveryWordKept(text, res);
  });
});

describe("parsePatternText — joining parts while crocheting (B5b)", () => {
  /** A made-up pattern: two legs joined into the body, arms worked through, a stem, a split tail. */
  const text = [
    "Leg (make 2)",
    "1. 6 sc in MR (6)",
    "2. inc x 6 (12)",
    "3-6. 12 sc (4 rounds)",
    "Fasten off the first leg only.",
    "",
    "Arm (make 2)",
    "1. 6 sc in MR (6)",
    "2. (2 sc, inc) x 2 (8)",
    "3-8. 8 sc (6 rounds)",
    "",
    "Body",
    "1. 4 ch, 12 sc around the first leg, 4 sc in ch, join to the second leg, 12 sc around it, 4 sc on the other side of the chain (32)",
    "2. 32 sc (32)",
    "3. 6 sc, 4 sc with the arm, 12 sc, 4 sc with the arm, 6 sc (32)",
    "4. 5 sc, 4 sc through both layers of the arm and the body, 23 sc (32)",
    "5. (2 sc, dec) x 8 (24)",
    "",
    "Stem",
    "1. 24 sc around the body (24)",
    "2. (2 sc, dec) x 6 (18)",
    "",
    "Tail",
    "1. 6 sc with the head (6)",
  ].join("\n");
  const res = parsePatternText(text, { locale: "en_us" });
  const [leg, arm, body, stem, tail] = res.parts;
  const docOf = () => ({ parts: res.parts.map((p) => ({ id: p.id, name: p.name, quantity: p.quantity, content: { schemaVersion: 2 as const, rows: p.rows } })) });

  it("reads joins to parts of the pattern: around both legs across a chain bridge", () => {
    expect(res.parts.map((p) => [p.id, p.quantity])).toEqual([
      ["leg", 2],
      ["arm", 2],
      ["body", 1],
      ["stem", 1],
      ["tail", 1],
    ]);
    const b = view(body!);
    expect(b[0]).toBe("4 ch (0)");
    expect(body!.rows[1]!.around).toBe(true);
    expect(body!.rows[1]!.ops).toEqual([
      { kind: "stitch", code: "SC", count: 12, from: { part: "leg", copy: 1 } },
      { kind: "stitch", code: "SC", count: 4 },
      { kind: "stitch", code: "SC", count: 12, from: { part: "leg", copy: 2 } },
      { kind: "stitch", code: "SC", count: 4 },
    ]);
    expect(validate({ schemaVersion: 2, rows: body!.rows })).toEqual([]);
    expect(leg!.rows.length).toBeGreaterThan(0);
  });

  it("reads “N sc with the arm” on fewer stitches than the arm has as worked through it, copies in turn", () => {
    expect(body!.rows[3]!.ops[1]).toEqual({ kind: "stitch", code: "SC", count: 4, through: { part: "arm", copy: 1 } });
    expect(body!.rows[3]!.ops[3]).toEqual({ kind: "stitch", code: "SC", count: 4, through: { part: "arm", copy: 2 } });
    expect(body!.rows[4]!.ops[1]).toEqual({ kind: "stitch", code: "SC", count: 4, through: { part: "arm" } });
    expect(arm!.quantity).toBe(2);
  });

  it("reads a part started on another part's last round, and keeps unknown parts as unsupported joins", () => {
    expect(stem!.rows[0]!.ops).toEqual([{ kind: "stitch", code: "SC", count: 24, from: { part: "body" } }]);
    expect(view(tail!)).toEqual(["> 1. 6 sc with the head (6)"]);
    expect(res.issues.filter((i) => i.code === "UNSUPPORTED_JOIN").map((i) => i.text)).toEqual(["1. 6 sc with the head (6)"]);
  });

  it("gives joins that resolve; working through an arm a second time is reported", () => {
    const findings = planJoinsOf(docOf());
    // Round 4 works through arm 1 again: it continues after round 3 and runs past its edge.
    expect(findings.filter((f) => f.severity === "error").map((f) => [f.code, f.rowId])).toEqual([["JOIN_OVERFLOW", body!.rows[4]!.id]]);
  });

  it("raises a part's quantity when a join names its second copy", () => {
    const r = parsePatternText(["Foot", "1. 6 sc in MR (6)", "2. inc x 6 (12)", "Body", "1. 6 sc with the left foot, 6 sc with the right foot (12)"].join("\n"), { locale: "en_us" });
    expect(r.parts[0]!.quantity).toBe(2);
    expect(r.issues.map((i) => i.code)).toEqual(["JOIN_QUANTITY_RAISED"]);
    expect(r.parts[1]!.rows[0]!.ops.map((op) => (op.kind === "stitch" ? op.through : undefined))).toEqual([
      { part: "foot", copy: 1 },
      { part: "foot", copy: 2 },
    ]);
  });

  it("keeps a join in the middle of a part that would leave the own previous round unworked as a hint", () => {
    const r = parsePatternText(
      ["Head", "1. 6 sc in MR (6)", "2. inc x 6 (12)", "3. 12 sc (12)", "", "Body", "1. 6 sc in MR (6)", "2. inc x 6 (12)", "3. 12 sc (12)", "4. 12 sc on the head (12)", "5. 12 sc (12)"].join("\n"),
      { locale: "en_us" },
    );
    const body = r.parts[1]!;
    expect(body.rows.some((row) => JSON.stringify(row.ops).includes('"from"'))).toBe(false);
    expect(r.issues.filter((i) => i.code === "UNSUPPORTED_JOIN").map((i) => i.text)).toEqual(["4. 12 sc on the head (12)"]);
    // As the first round of a part it is read: the pot starts on the base.
    const pot = parsePatternText(["Base", "1. 6 sc in MR (6)", "2. inc x 6 (12)", "", "Pot", "1. 12 sc at the base (12)", "2. 12 sc (12)"].join("\n"), { locale: "en_us" });
    expect(pot.parts[1]!.rows[0]!.ops).toEqual([{ kind: "stitch", code: "SC", count: 12, from: { part: "base" } }]);
  });

  it("does not take “in ring” for a join to a part called Ring", () => {
    const r = parsePatternText(["Ring", "1. ch 12, sl st to join (12)", "", "Ball", "1. 6 sc in ring (6)", "2. inc x 6 (12)"].join("\n"), { locale: "en_us" });
    expect(JSON.stringify(r.parts[1]!.rows)).not.toContain('"from"');
  });

  it("reports a round split into branches as a join it cannot read, but not folding in half", () => {
    const split = parsePatternText(
      [
        "Body",
        "1. 6 sc in MR (6)",
        "2. inc x 6 (12)",
        "3. 12 sc (12)",
        "Now sc the round in half: one sc across to the other side, you get two openings of 6.",
        "Repeat the last two rounds once more.",
        "Arm",
        "1. 6 sc in MR (6)",
        "2. 6 sc (6)",
        "Fold in half and crochet 3 sc through both layers.",
      ].join("\n"),
      { locale: "en_us" },
    );
    expect(split.issues.filter((i) => i.code === "UNSUPPORTED_JOIN").map((i) => i.text)).toEqual([
      "Now sc the round in half: one sc across to the other side, you get two openings of 6.",
    ]);
    const de = parsePatternText(["Körper", "1. 6 fM in einen Fadenring (6)", "2. 6 Zun (12)", "Die Runde in zwei Hälften teilen und jede Hälfte einzeln weiterhäkeln."].join("\n"), {
      locale: "de",
    });
    expect(de.issues.map((i) => i.code)).toContain("UNSUPPORTED_JOIN");
  });

  it("reads German joins too", () => {
    const r = parsePatternText(["Bein (2x)", "1. 6 fM in einen Fadenring (6)", "2. 6 Zun (12)", "Körper", "1. 12 fM um das erste Bein, 12 fM um das zweite Bein (24)"].join("\n"), { locale: "de" });
    expect(r.parts[1]!.rows[0]!.ops).toEqual([
      { kind: "stitch", code: "SC", count: 12, from: { part: "bein", copy: 1 } },
      { kind: "stitch", code: "SC", count: 12, from: { part: "bein", copy: 2 } },
    ]);
    expect(r.issues.filter((i) => i.severity !== "info")).toEqual([]);
  });
});

function planJoinsOf(doc: Parameters<typeof planJoins>[0]) {
  return planJoins(doc).findings;
}

/** Words a stitch row may consume without repeating them (notation, not content). */
const NOTATION_WORDS = new Set(
  (
    "rnd rnds round rounds row rows repeat rep times around each every into next one same magic ring make from more " +
    "the and with runde runden reihe reihen jede rundherum einen den fadenring mal wiederholen " +
    "back front loop loops only blo flo nur hinteres vorderes maschenglied " +
    // Oval starts: the round says "around the chain" in its own words.
    "start starting hook last work working other opposite side"
  ).split(" "),
);

/**
 * Every word of the input (3+ letters) appears in a row (note or rendered ops), a part name,
 * the preamble or an issue — or is notation a stitch row stands for.
 */
function expectEveryWordKept(text: string, res: PatternImport) {
  const kept = [
    ...res.parts.flatMap((p) => [p.name, ...p.rows.map((r) => r.note ?? `${renderRow(r, "en_us")} ${renderRow(r, "de")}`)]),
    ...res.preamble,
    ...res.issues.map((i) => i.text),
  ]
    .join(" ")
    .toLowerCase();
  for (const word of text.match(/[\p{L}][\p{L}\-]{2,}/gu) ?? []) {
    const w = word.toLowerCase();
    if (NOTATION_WORDS.has(w) || resolveStitchTerm(w, res.locale)) continue;
    expect(kept, `"${word}" was dropped`).toContain(w);
  }
}

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
    // The colour change stays as text and switches the next round; the embroidery thread is no colour change.
    expect(res.parts[0]!.rows[1]).toMatchObject({ ops: [], stitchCountTarget: 0, note: "cc to white" });
    expect(res.colors).toEqual([{ id: "white", name: "White", hex: "#ffffff" }]);
    expect(res.parts[0]!.rows.map((r) => r.color)).toEqual([undefined, undefined, "white", undefined, undefined, undefined]);
    expect(issuesOf(res, "COLOR_UNNAMED")).toEqual([]);
  });

  it("reports a colour change it cannot name", () => {
    const res = parsePatternText("Head\n1. 6 sc in MR\nChange colour.\n2. inc around (12)", { locale: "en_us" });
    expect(res.colors).toEqual([]);
    expect(issuesOf(res, "COLOR_UNNAMED")).toMatchObject([{ line: 3, partIndex: 0, rowIndex: 1, severity: "info" }]);
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
    expect(parsePatternText("")).toEqual({
      locale: "de",
      localeConfidence: 0,
      parts: [],
      issues: [],
      preamble: [],
      colors: [],
      assembly: [],
    });
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

// ---------------------------------------------------------------------------
// Review fixes A3: a silent misreading is worse than an issue
// ---------------------------------------------------------------------------

describe("parsePatternText — no silent misreadings", () => {
  const start = "Body\nRnd 1: 6 sc in MR\nRnd 2: inc around (12)\n";
  const third = (round: string) => {
    const res = parsePatternText(start + round, { locale: "en_us" });
    const rows = res.parts[0]!.rows.slice(2);
    const found = res.issues.filter((i) => i.rowIndex !== undefined && i.rowIndex >= 2).map((i) => i.code);
    return { res, rows, codes: found, view: view({ rows }) };
  };

  it("reads several stitches into one stitch as a group, never as a plain run", () => {
    expect(third("Rnd 3: 2 hdc in next st, 10 sc (13)").view).toEqual(["(2 hdc) in same st, 10 sc (13)"]);
    expect(third("Rnd 3: 3 sc in next st, 11 sc (14)").view).toEqual(["(3 sc) in same st, 11 sc (14)"]);
    expect(third("Rnd 3: 11 sc, 3 sc in next st").view).toEqual(["11 sc, (3 sc) in same st (14)"]);
    for (const round of ["Rnd 3: 2 hdc in next st, 10 sc (13)", "Rnd 3: 11 sc, 3 sc in next st"]) {
      expect(third(round).codes, round).toEqual([]);
    }
    // Two single crochets into one stitch are an increase.
    expect(third("Rnd 3: 2 sc in next st, 10 sc (13)").view).toEqual(["1 inc, 10 sc (13)"]);
    // Into the next three stitches is not one stitch: unread.
    expect(third("Rnd 3: 3 sc in next 3 sts, 9 sc (12)").codes).toEqual(["UNREADABLE"]);
  });

  it("flags '3 hdc inc' without a count instead of trusting one reading", () => {
    const result = third("Rnd 3: (3hdc inc, 3sc) x 2");
    expect(result.view).toEqual(["2x (3x ((2 hdc) in same st), 3 sc) (18)"]);
    expect(issuesOf(result.res, "AMBIGUOUS_INCREASE")).toMatchObject([{ severity: "warning", rowIndex: 2 }]);
    expect(third("Rnd 3: (3hdc inc, 3sc) x 2 = [18]").codes).toEqual([]);
  });

  it("never splits a labelled round into an instruction and a row, or into two rows", () => {
    for (const round of [
      "Rnd 3: ch 1, hdc in same st, sc around",
      "Rnd 3: skip 2 sts, sc around",
      "Rnd 3: sc 6, skip 2 sts, sc 4 (10)",
      "Rnd 3: sc 6. Ch 3, skip 2 sts, sc 4 (12)",
    ]) {
      const result = third(round);
      expect(result.rows, round).toHaveLength(1);
      expect(result.rows[0]!.ops, round).toEqual([]);
      expect(result.rows[0]!.note, round).toBe(round);
      expect(result.codes, round).toEqual(["UNREADABLE"]);
    }
  });

  it("does not read stitches before a row in free text as an instruction", () => {
    const res = parsePatternText(`${start}skip 2 sts, sc 10 (10)`, { locale: "en_us" });
    expect(view(res.parts[0]!).slice(2)).toEqual(["> skip 2 sts, sc 10 (10)"]);
    expect(issuesOf(res, "UNREADABLE")).toMatchObject([{ line: 4, rowIndex: 2 }]);
  });

  it("still reads an unlabelled round on the line after a labelled one", () => {
    expect(third("(sc, inc) x 6 (18)").view).toEqual(["6x (1 sc, 1 inc) (18)"]);
  });

  it("asks for the locale when it rests on dc alone", () => {
    const res = parsePatternText("Round 1: 6 dc into the ring\nRound 2: 2 dc in each stitch around (12)\nRound 3: 12 dc");
    expect(res.locale).toBe("en_uk");
    expect(issuesOf(res, "LOCALE_UNCERTAIN")).toMatchObject([{ severity: "warning", text: "en_uk" }]);
    const us = parsePatternText("Rnd 1: ch 3, 11 dc in ring, sl st to top of ch 3 (12)\nRnd 2: ch 3, 2 dc in each st (24)");
    expect(us.locale).toBe("en_us");
    expect(issuesOf(parsePatternText("Round 1: 6 dc into the ring", { locale: "en_uk" }), "LOCALE_UNCERTAIN")).toEqual([]);
  });

  it("settles 'x N' after a list by the count, and flags it", () => {
    const guessed = third("Rnd 3: sc, inc x6 (18)");
    expect(guessed.view).toEqual(["6x (1 sc, 1 inc) (18)"]);
    expect(issuesOf(guessed.res, "REPEAT_GUESSED")).toMatchObject([{ severity: "info", rowIndex: 2 }]);
    const ambiguous = third("Rnd 3: sc, inc x6 (20)");
    expect(issuesOf(ambiguous.res, "AMBIGUOUS_REPEAT")).toMatchObject([{ severity: "warning", rowIndex: 2 }]);
  });

  it("settles 'rep from * N times' by the count, and flags it", () => {
    const guessed = third("Rnd 3: *sc, inc; rep from * 5 times (18)");
    expect(guessed.view).toEqual(["6x (1 sc, 1 inc) (18)"]);
    expect(codes(guessed.res)).toContain("REPEAT_GUESSED");
    expect(codes(third("Rnd 3: *sc, inc; rep from * 5 times").res)).toContain("AMBIGUOUS_REPEAT");
  });

  it("reports a removed 'does not count as a stitch' note", () => {
    const result = third("Rnd 3: ch 1 (does not count as a st), 12 sc (12)");
    expect(result.view).toEqual(["1 ch, 12 sc (12)"]);
    expect(issuesOf(result.res, "IGNORED")).toMatchObject([{ line: 4, text: "(does not count as a st)", severity: "info" }]);
  });
});

describe("parsePatternText — oval starts (rounds around a foundation chain)", () => {
  /** The part's rows as "around? ops (target)", and the issue codes. */
  const read = (text: string, locale: "en_us" | "de" = "en_us") => {
    const res = parsePatternText(text, { locale });
    const part = res.parts[0]!;
    return {
      rows: part.rows.map((r) => `${r.around ? "@ " : ""}${view({ rows: [r] }, locale)[0]}`),
      codes: codes(res),
      findings: validate({ schemaVersion: 2, rows: part.rows }).map((f) => f.code),
    };
  };
  const OVAL_14 = "@ 1 sc, 4 sc, (3 sc) in same st, 4 sc, 1 inc (14)";

  it("reads the round on one line after the chain, in the usual English wordings", () => {
    for (const second of [
      "working on the other side of the chain: 4 sc, 2 sc in last ch (14)",
      "on the opposite side: 4 sc, inc (14)",
      "then work on the back of the chain: 4 sc, inc (14)",
      "continue along the other side of the foundation chain, 4 sc, inc (14)",
    ]) {
      const r = read(`Foot\nCh 7.\nRnd 1: sc in 2nd ch from hook, 4 sc, 3 sc in last ch, ${second}\nRnd 2: inc, 4 sc, 3 inc, 4 sc, 2 inc (20)`);
      expect(r.rows, second).toEqual(["7 ch (0)", OVAL_14, "1 inc, 4 sc, 3 inc, 4 sc, 2 inc (20)"]);
      expect(r.codes, second).toEqual([]);
      expect(r.findings, second).toEqual([]);
    }
  });

  it("merges the two halves of a round split over two lines", () => {
    const labelled = read("Foot\nCh 7\nRnd 1: sc in 2nd ch from hook, 4 sc, 3 sc in last ch.\nWorking on the other side of the chain: 4 sc, inc (14)\nRnd 2: 20 sc (20)");
    expect(labelled.rows.slice(0, 2)).toEqual(["7 ch (0)", OVAL_14]);
    expect(labelled.codes).toEqual([]);
    // Without labels: the first half is a row of its own until the second half arrives.
    const free = read("Foot\nCh 7\nSc in 2nd ch from hook, 4 sc, 3 sc in last ch.\nOn the other side of the chain: 4 sc, inc. (14)\nInc, 4 sc, 3 inc, 4 sc, 2 inc (20)");
    expect(free.rows).toEqual(["7 ch (0)", OVAL_14, "1 inc, 4 sc, 3 inc, 4 sc, 2 inc (20)"]);
    expect(free.findings).toEqual([]);
  });

  it("splits a chain written in the round itself, and reads 'crochet around the chain'", () => {
    const r = read("Snout\nRnd 1: Make ch 6. Crochet around the chain. Start in second ch from hook. 4 sc, 3 sc in last ch, 3 sc on the other side, inc [12]\nRnd 2: 12 sc [12]");
    expect(r.rows).toEqual(["6 ch (0)", "@ 4 sc, (3 sc) in same st, 3 sc, 1 inc (12)", "12 sc (12)"]);
    expect(r.codes).toEqual([]);
    expect(r.findings).toEqual([]);
  });

  it("reads 'unroll' as the turn to the other side only right after a chain", () => {
    const oval = read("Paw\n1. 6 ch\n2. from 2nd loop 4 sc, 3 sc into one loop, unroll the crochet, 4 sc, 3 sc into one loop (14)");
    expect(oval.rows).toEqual(["6 ch (0)", "@ 4 sc, (3 sc) in same st, 4 sc, (3 sc) in same st (14)"]);
    expect(oval.codes).toEqual([]);
    expect(oval.findings).toEqual([]);
    // Elsewhere it turns the work: a row.
    const heel = parsePatternText("Paw\n1. 6 sc in MR (6)\n2. 6 sc, ch, unroll crocheting\n3. 6 sc (6)", { locale: "en_us" });
    expect(heel.parts[0]!.rows[1]).toMatchObject({ type: "row", ops: [{ code: "SC", count: 6 }, { code: "CH", count: 1 }] });
    expect(heel.parts[0]!.rows[1]!.around).toBeUndefined();
    expect(codes(heel)).toEqual([]);
  });

  it("reads German oval starts", () => {
    const r = read(
      "Fuß\nR1: 8 Lm\nR2: in der 2. Lm ab Nadel beginnen: 6 fM, 3 fM in die letzte Lm, auf der anderen Seite der Luftmaschenkette weiter: 5 fM, 2 fM in die letzte Lm (16)\nR3: 16 fM (16)",
      "de",
    );
    expect(r.rows).toEqual(["8 Lm (0)", "@ 6 fM, (3 fM) in dieselbe M, 5 fM, 1 Zun (16)", "16 fM (16)"]);
    expect(r.codes).toEqual([]);
    expect(r.findings).toEqual([]);
    const herum = read("Ohr\nR1: 6 Lm, um die Kette herum häkeln: 4 fM, 3 fM in die letzte Lm, 3 fM, Zun (12)", "de");
    expect(herum.rows).toEqual(["6 Lm (0)", "@ 4 fM, (3 fM) in dieselbe M, 3 fM, 1 Zun (12)"]);
    expect(herum.codes).toEqual([]);
  });

  it("keeps an oval it cannot read as text with UNSUPPORTED_FOUNDATION_OVAL", () => {
    // No chain to work around: no oval, the text stays unread.
    const noChain = read("Body\nRnd 1: 6 sc in MR (6)\nRnd 2: 3 sc, working on the other side of the chain: 3 sc (6)");
    expect(noChain.rows[1]).toBe("> Rnd 2: 3 sc, working on the other side of the chain: 3 sc (6)");
    expect(noChain.codes).toEqual(["UNREADABLE"]);
    // After a chain, but with stitches the format cannot hold.
    const bullion = read("Foot\nCh 7\nRnd 1: sc in 2nd ch from hook, 4 sc, 3 sc in last ch, on the other side: 4 bullion st, inc (14)");
    expect(bullion.rows[1]).toMatch(/^> Rnd 1: /);
    expect(bullion.codes).toEqual(["UNSUPPORTED_FOUNDATION_OVAL"]);
  });

  it("reads its own export back as an oval in every locale", () => {
    const content: PartContent = {
      schemaVersion: 2,
      rows: [
        { id: "c", type: "round", ops: [{ kind: "stitch", code: "CH", count: 7 }], stitchCountTarget: 0 },
        {
          id: "o",
          type: "round",
          around: true,
          ops: [
            { kind: "stitch", code: "SC", count: 5 },
            { kind: "group", ops: [{ kind: "stitch", code: "SC", count: 3 }] },
            { kind: "stitch", code: "SC", count: 4 },
            { kind: "stitch", code: "INC", count: 1 },
          ],
          stitchCountTarget: 14,
        },
        { id: "p", type: "round", ops: [{ kind: "stitch", code: "SC", count: 14 }], stitchCountTarget: 14 },
      ],
    };
    for (const locale of ["de", "en_us", "en_uk"] as const) {
      const text = ["Foot", ...renderedRows(content, locale)].join("\n");
      const res = parsePatternText(text, { locale });
      const rows = res.parts[0]!.rows;
      expect(rows.map((r) => [r.ops, r.stitchCountTarget, r.around ?? false]), locale).toEqual(
        content.rows.map((r) => [r.ops, r.stitchCountTarget, r.around ?? false]),
      );
      expect(codes(res), locale).toEqual([]);
      expect(validate({ schemaVersion: 2, rows }), locale).toEqual([]);
    }
  });

  it("reads a dc oval (two chains skipped at the hook)", () => {
    const r = read("Sole\nCh 10\nRnd 1: dc in 3rd ch from hook, 6 dc, 5 dc in last ch, working on the other side of the chain: 6 dc, 4 dc in last ch (22)\nRnd 2: 22 dc (22)");
    expect(r.rows).toEqual(["10 ch (0)", "@ 1 dc, 6 dc, (5 dc) in same st, 6 dc, (4 dc) in same st (22)", "22 dc (22)"]);
    expect(r.codes).toEqual([]);
    expect(r.findings).toEqual([]);
  });

  it("reads 'unroll' after a chain as a turn when the row works only one side of it", () => {
    const bag = parsePatternText("Bag\nCh 9\nRow 1: hdc in 3rd ch from hook, 6 hdc, unroll the work (7)\nRow 2: ch 2, 7 hdc (7)", { locale: "en_us" });
    const rows = bag.parts[0]!.rows;
    expect(rows[1]).toMatchObject({ type: "row", ops: [{ code: "HDC", count: 1 }, { code: "HDC", count: 6 }], stitchCountTarget: 7 });
    expect(rows[1]!.around).toBeUndefined();
    expect(codes(bag)).toEqual([]);
    // A round label that works only one side: a turn too, never an oval.
    const flap = parsePatternText("Flap\nCh 11\nRnd 1: sc in 2nd ch from hook, 9 sc, unroll (10)", { locale: "en_us" });
    expect(flap.parts[0]!.rows[1]).toMatchObject({ type: "row", ops: [{ code: "SC", count: 1 }, { code: "SC", count: 9 }] });
    expect(flap.parts[0]!.rows[1]!.around).toBeUndefined();
  });

  it("does not take the back of the chain (back bumps) for an oval, and never hides stitch text in a plain note", () => {
    const back = parsePatternText(
      "Scarf\nCh 21.\nRow 1: working in the back of the chain, sc in 2nd ch from hook and in each ch across (20), turn.\nRow 2: ch 1, 20 sc (20), turn",
      { locale: "en_us" },
    );
    expect(back.parts[0]!.rows.some((r) => r.around)).toBe(false);
    expect(codes(back)).toContain("UNREADABLE");
    expect(codes(back)).not.toContain("UNSUPPORTED_FOUNDATION_OVAL");
    const bumps = parsePatternText(
      "Scarf\nCh 21.\nRow 1: sc into the back side of the chain, starting in 2nd ch from hook, 20 sc (20). Turn.\nRow 2: ch 1, 20 sc (20), turn",
      { locale: "en_us" },
    );
    expect(bumps.parts[0]!.rows.some((r) => r.around)).toBe(false);
    expect(codes(bumps)).not.toContain("UNSUPPORTED_FOUNDATION_OVAL");
    // The 20 sc are read as the row into the chain; the where-to stays as a note.
    expect(view(bumps.parts[0]!).slice(0, 3)).toEqual(["21 ch (0)", "> Row 1: sc into the back side of the chain,", "20 sc (20)"]);
  });

  it("names the other side only as an oval where there is a chain", () => {
    for (const [text, locale] of [
      ["Ear\nRnd 1: 6 sc in MR (6)\nRnd 2: 6 inc (12)\nRnd 3: 6 sc on the second side (12)", "en_us"],
      ["Mütze\nR1: 6 fM in MR (6)\nR2: 6 Zun (12)\nR3: auf der anderen Seite 12 fM (12)", "de"],
    ] as const) {
      const res = parsePatternText(text, { locale });
      expect(codes(res), text).not.toContain("UNSUPPORTED_FOUNDATION_OVAL");
      expect(res.parts[0]!.rows.some((r) => r.around), text).toBe(false);
    }
  });

  it("does not take a German ordinal ('ab der 2. Lm') for a round label", () => {
    const oval = read("Fuß\n8 Lm\nR1: ab der 2. Lm von der Nadel aus 6 fM, 3 fM in die letzte Lm, auf der anderen Seite 5 fM, 2 fM in die letzte M (16)\nR2: 16 fM (16)", "de");
    expect(oval.rows).toEqual(["8 Lm (0)", "@ 6 fM, (3 fM) in dieselbe M, 5 fM, 1 Zun (16)", "16 fM (16)"]);
    expect(oval.codes).toEqual([]);
    const flat = read("Schal\n8 Lm\nR1: ab der 2. Lm von der Nadel aus 7 fM (7)\nR2: 7 fM (7)", "de");
    expect(flat.rows).toEqual(["8 Lm (0)", "7 fM (7)", "7 fM (7)"]);
    expect(flat.codes).toEqual([]);
  });

  it("keeps a mere mention of the other side of the chain as a plain note", () => {
    const r = read("Fin\nCh 7\n1. sc in 2nd ch from hook, 4 sc, 3 sc in last ch, on the other side: 4 sc, inc (14)\n2. (See the photos for working on the other side of the chain.)\n3. 14 sc (14)");
    expect(r.rows).toEqual(["7 ch (0)", OVAL_14, "> 2. (See the photos for working on the other side of the chain.)", "14 sc (14)"]);
    expect(r.codes).toEqual([]);
  });
});
