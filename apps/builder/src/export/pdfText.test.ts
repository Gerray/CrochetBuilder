import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { measureWith } from "./pdf.js";
import { layoutPdf, PAGE, toWinAnsi, wrapText, type PdfInput } from "./pdfLayout.js";

const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin;

describe("toWinAnsi: Unicode normalisation", () => {
  it("composes decomposed umlauts (NFD input, e.g. from macOS file names)", () => {
    expect(toWinAnsi("Gro\u0308ße Ma\u0308use")).toBe("Größe Mäuse");
    expect(toWinAnsi("Gro\u0308ße".normalize("NFD"))).toBe("Größe");
  });

  it("decomposes compatibility characters and strips accents WinAnsi lacks", () => {
    expect(toWinAnsi("Schlaufe ﬁxieren, ﬂach")).toBe("Schlaufe fixieren, flach");
    expect(toWinAnsi("İ ǅ")).toBe("I Dz");
    expect(toWinAnsi("a\u0301")).toBe("á");
    expect(toWinAnsi("ẞ")).toBe("SS");
  });

  it("drops invisible formatting characters instead of printing „?“", () => {
    expect(toWinAnsi("Herz ❤\ufe0f")).toBe("Herz ?");
    expect(toWinAnsi("Mag\u200bic \u200dx\u2060y\ufeff")).toBe("Magic xy");
    expect(toWinAnsi("Topf\u00adlappen")).toBe("Topflappen");
    expect(toWinAnsi("\u200e\u202bRTL\u202c")).toBe("RTL");
    // A combining mark without a base letter disappears.
    expect(toWinAnsi("\u0301x")).toBe("x");
  });

  it("still marks what cannot be shown", () => {
    expect(toWinAnsi("🧶 \ud800 毛")).toBe("? ? ?");
    expect(toWinAnsi("½ ² € Ø")).toBe("½ ² € Ø");
  });
});

describe("wrapText: long words without spaces", () => {
  it("breaks a 20,000-character word quickly with real jsPDF metrics", () => {
    const measure = measureWith(new jsPDF({ unit: "mm", format: "a4" }));
    let calls = 0;
    const m = (t: string) => {
      calls++;
      return measure(t, 10.5, false);
    };
    const word = "x".repeat(20_000);
    const started = performance.now();
    const lines = wrapText(word, CONTENT_WIDTH, m);
    const ms = performance.now() - started;
    expect(ms).toBeLessThan(1500);
    expect(lines.join("")).toBe(word);
    // Every line fits, and every line but the last is as full as possible.
    for (const line of lines) expect(m(line)).toBeLessThanOrEqual(CONTENT_WIDTH);
    for (const line of lines.slice(0, -1)) expect(m(line + "x")).toBeGreaterThan(CONTENT_WIDTH);
    // O(log n) measurements per line, not O(n).
    expect(calls).toBeLessThan(lines.length * 40);
  });

  it("matches the previous greedy result for mixed text", () => {
    const m = (t: string) => t.length;
    expect(wrapText("ab " + "c".repeat(11) + " d", 4, m)).toEqual(["ab", "cccc", "cccc", "ccc", "d"]);
    expect(wrapText("abcdefghij", 4, m)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("abcd", 4, m)).toEqual(["abcd"]);
    expect(wrapText("abcde", 1, m)).toEqual(["a", "b", "c", "d", "e"]);
    // Narrower than one character: still one character per line.
    expect(wrapText("abc", 0.5, m)).toEqual(["a", "b", "c"]);
  });

  it("a whole PDF layout with a huge unbroken note stays fast", () => {
    const measure = measureWith(new jsPDF({ unit: "mm", format: "a4" }));
    const input: PdfInput = {
      title: "Lang",
      materials: [],
      gauge: "Garn: DK",
      size: null,
      estimate: null,
      notes: "y".repeat(20_000),
      parts: [{ heading: null, rows: ["Runde 1: " + "z".repeat(6_000)] }],
      image: null,
    };
    const started = performance.now();
    const layout = layoutPdf(input, measure);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(layout.pages).toBeGreaterThan(1);
  });
});
