import { describe, expect, it } from "vitest";
import { SAMPLE_LINES, SAMPLE_PATTERN } from "../test/samplePattern.js";
import { UNREAD_ROW_LABEL, UNSUPPORTED_ROW_LABEL, importIssueMessage } from "../state/import-messages.js";
import { buildPastePreview, summaryText, titleCandidate, type PastePreview } from "./preview.js";

const view = (preview: PastePreview, part: number) =>
  preview.parts[part]!.lines.map((l) => `${l.label}: ${l.text} [${l.status}${l.source ? ` @${l.source}` : ""}]`);

describe("buildPastePreview — the sample pattern", () => {
  const preview = buildPastePreview(SAMPLE_PATTERN);

  it("reads German notation with full confidence", () => {
    expect(preview.locale).toBe("de");
    expect(preview.choice).toBe("auto");
    expect(preview.localeUncertain).toBe(false);
    expect(preview.detected).toEqual({ locale: "de", confidence: 1 });
  });

  it("finds the parts with names and quantities", () => {
    expect(preview.parts.map((p) => [p.name, p.quantity, p.stitchRows])).toEqual([
      ["Kopf", 1, 11],
      ["Körper", 1, 6],
      ["Ohren", 2, 2],
    ]);
  });

  it("shows rows as they will appear, ranges collapsed, with their source lines", () => {
    expect(view(preview, 0)).toEqual([
      "Runde 1: 1 MR, 6 fM (6) [ok @6]",
      "Runde 2: 6 Zun (12) [ok @7]",
      "Runde 3: 6× (1 fM, 1 Zun) (18) [ok @8]",
      "Runde 4: 6× (2 fM, 1 Zun) (24) [ok @9]",
      "Runde 5–8: 24 fM (24) [ok @10]",
      "Hinweis: Sicherheitsaugen zwischen Runde 6 und 7 einsetzen. [ok @11]",
      "Runde 9: 6× (2 fM, 1 Abn) (18) [ok @12]",
      "Runde 10: 6× (1 fM, 1 Abn) (12) [ok @13]",
      `Hinweis: Kopf füllen. [ok @${SAMPLE_LINES.kopfFill}]`,
      "Runde 11: 6 Abn (6) [ok @15]",
    ]);
    // The range stands for four rows.
    const range = preview.parts[0]!.lines[4]!;
    expect([range.first, range.last]).toEqual([4, 7]);
  });

  it("reports a wrong stitch count as Soll/Ist", () => {
    const line = preview.parts[1]!.lines[2]!;
    expect(line).toMatchObject({ label: "Runde 3", status: "mismatch", source: SAMPLE_LINES.koerperMismatch });
    expect(line.messages).toEqual([{ severity: "error", text: "Maschenzahl stimmt nicht: Soll 20, Ist 18." }]);
    expect(view(preview, 1)[3]).toBe("Runde 4–6: 18 fM (18) [ok @21]");
  });

  it("keeps unread text as labelled instruction rows with the original text", () => {
    expect(view(preview, 2)).toEqual([
      "Runde 1: 1 MR, 5 fM (5) [ok @24]",
      "Runde 2: 5 Zun (10) [ok @25]",
      `${UNSUPPORTED_ROW_LABEL}: Runde 3: 3 Noppen, 7 fM (10) [unread @${SAMPLE_LINES.ohrenUnsupported}]`,
      `${UNREAD_ROW_LABEL}: Runde 4: 10 fM, dann xq kringeln (10) [unread @${SAMPLE_LINES.ohrenUnreadable}]`,
    ]);
    const rows = preview.parts[2]!.rows;
    expect(rows[2]).toMatchObject({ ops: [], label: UNSUPPORTED_ROW_LABEL, note: "Runde 3: 3 Noppen, 7 fM (10)" });
    expect(rows[3]).toMatchObject({ ops: [], label: UNREAD_ROW_LABEL, note: "Runde 4: 10 fM, dann xq kringeln (10)" });
    expect(preview.parts[2]!.lines[2]!.messages[0]!.text).toMatch(/^Spezialmaschen/);
    expect(preview.parts[2]!.lines[3]!.messages[0]!.text).toBe(importIssueMessage({ code: "UNREADABLE" }));
  });

  it("counts and summarises", () => {
    expect(preview.counts).toEqual({ parts: 3, stitchRows: 19, onlyRows: false, notices: 1, unread: 2 });
    expect(summaryText(preview.counts)).toBe("3 Teile, 19 Runden, 1 Hinweis – 2 Stellen konnten nicht gelesen werden");
  });

  it("keeps the preamble and offers the first line as title", () => {
    expect(preview.preamble).toEqual(SAMPLE_PATTERN.split("\n").slice(0, 3));
    expect(preview.title).toBe("Kleiner Igel");
    expect(preview.general).toEqual([]);
  });
});

describe("buildPastePreview — notation", () => {
  const us = "HEAD\nRnd 1: 6 sc in MR (6)\nRnd 2: inc x 6 (12)\nRnd 3: (1 sc, inc)*6 (18)";
  const doubtful = "Body\n1. 6 dc in a magic ring (6)\n2. 6 inc (12)\n3. (1 dc, inc) x 6 (18)\n4. 18 dc (18)";

  it("renders US terms in German", () => {
    const preview = buildPastePreview(us);
    expect(preview.locale).toBe("en_us");
    expect(preview.parts[0]!.name).toBe("Head");
    expect(preview.parts[0]!.lines.map((l) => l.text)).toEqual([
      "1 MR, 6 fM (6)",
      "6 Zun (12)",
      "6× (1 fM, 1 Zun) (18)",
    ]);
  });

  it("asks for confirmation when the detection is doubtful", () => {
    const preview = buildPastePreview(doubtful);
    expect(preview.localeUncertain).toBe(true);
    expect(preview.locale).toBe("en_uk");
    expect(preview.detected.confidence).toBeLessThan(0.5);
    // The doubtful notation is not listed as a line of its own (it has its own box).
    expect(preview.general.map((g) => g.code)).toEqual(["LOCALE_UNCERTAIN"]);
    expect(preview.counts.notices).toBe(1);
  });

  it("reads with the chosen notation and keeps showing the detection", () => {
    const uk = buildPastePreview(doubtful, "en_uk");
    expect(uk.localeUncertain).toBe(false);
    expect(uk.choice).toBe("en_uk");
    expect(uk.parts[0]!.lines.at(-1)!.text).toBe("18 fM (18)");

    const usTerms = buildPastePreview(doubtful, "en_us");
    expect(usTerms.locale).toBe("en_us");
    expect(usTerms.localeUncertain).toBe(false);
    expect(usTerms.detected.locale).toBe("en_uk");
    // In US terms "dc" is a treble (Stäbchen).
    expect(usTerms.parts[0]!.lines.at(-1)!.text).toBe("18 Stb (18)");
  });
});

describe("buildPastePreview — remarks without a row", () => {
  it("lists numbering gaps and skipped page numbers with their lines", () => {
    const text = "Kopf\nRunde 1: 6 fM in den Fadenring (6)\nRunde 2: 6 Zun (12)\n12\nRunde 5: 12 fM (12)";
    const preview = buildPastePreview(text);
    expect(preview.general.map((g) => [g.code, g.line])).toEqual([
      ["IGNORED", 4],
      ["LABEL_GAP", 5],
    ]);
    expect(preview.general[1]!.message).toBe("Die Rundennummern springen – fehlt hier eine Runde?");
    // Skipped lines are no notice.
    expect(preview.counts.notices).toBe(1);
  });

  it("returns an empty preview for text without rounds", () => {
    const preview = buildPastePreview("Material: Garn\nNadel 3 mm");
    expect(preview.parts).toEqual([]);
    expect(preview.counts).toMatchObject({ parts: 0, stitchRows: 0, unread: 0 });
  });
});

describe("source lines", () => {
  it("finds several rounds on one line (PDF text)", () => {
    const preview = buildPastePreview(
      "Kopf\n1. 6 sc in MR 2. inc x 6 (12) 3. (sc, inc) x 6 (18)\n4. 18 sc (18)",
      "en_us",
    );
    expect(preview.parts[0]!.lines.map((l) => l.source)).toEqual([2, 2, 2, 3]);
  });

  it("leaves a line without source when the label cannot be found", () => {
    const preview = buildPastePreview("Kopf\n6 sc in MR (6)\ninc x 6 (12)", "en_us");
    expect(preview.parts[0]!.lines.map((l) => l.source)).toEqual([undefined, undefined]);
  });
});

describe("summaryText", () => {
  it("uses singular forms and says when everything was read", () => {
    expect(summaryText({ parts: 1, stitchRows: 1, onlyRows: false, notices: 0, unread: 0 })).toBe(
      "1 Teil, 1 Runde, 0 Hinweise – alles gelesen",
    );
    expect(summaryText({ parts: 2, stitchRows: 21, onlyRows: true, notices: 1, unread: 1 })).toBe(
      "2 Teile, 21 Reihen, 1 Hinweis – 1 Stelle konnte nicht gelesen werden",
    );
  });
});

describe("titleCandidate", () => {
  it("takes a short first line that went to the preamble", () => {
    expect(titleCandidate("\n  Kleiner Igel \nMaterial: Garn", ["Kleiner Igel", "Material: Garn"])).toBe(
      "Kleiner Igel",
    );
  });

  it("refuses materials, long lines, sentences and lines that are pattern content", () => {
    expect(titleCandidate("Material: Garn", ["Material: Garn"])).toBeUndefined();
    expect(
      titleCandidate("Dieses Muster ist für Anfänger gedacht.", ["Dieses Muster ist für Anfänger gedacht."]),
    ).toBeUndefined();
    expect(titleCandidate("x".repeat(61), ["x".repeat(61)])).toBeUndefined();
    expect(titleCandidate("Kopf\nRunde 1: 6 fM", [])).toBeUndefined();
  });

  it("never takes a section heading", () => {
    const headings = [
      "Material",
      "Materialien",
      "Materials",
      "Abkürzungen",
      "Abbreviations",
      "Notes",
      "Hinweise",
      "Anleitung",
      "Pattern",
      "Gauge",
      "Maschenprobe",
      "Größe",
      "Size",
      "You will need",
      "Supplies",
      "Garn",
      "Copyright 2026",
      "Designed by Anna",
      "MATERIAL",
    ];
    for (const heading of headings) {
      expect(titleCandidate(`${heading}\nKopf\nRunde 1: 6 fM (6)`, [heading]), heading).toBeUndefined();
    }
    // A title that merely contains such a word is fine.
    expect(titleCandidate("Igel mit Muster", ["Igel mit Muster"])).toBe("Igel mit Muster");
  });

  it("is not offered when the text starts with a heading", () => {
    const preview = buildPastePreview(`Material\n50 g Garn\n\n${SAMPLE_PATTERN.split("\n").slice(4).join("\n")}`);
    expect(preview.preamble[0]).toBe("Material");
    expect(preview.title).toBeUndefined();
  });
});
