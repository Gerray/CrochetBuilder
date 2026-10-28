import { describe, expect, it } from "vitest";
import { SAMPLE_PATTERN } from "../test/samplePattern.js";
import { looksLikePattern } from "./detect.js";

describe("looksLikePattern", () => {
  it("accepts patterns in German, US and UK terms", () => {
    expect(looksLikePattern(SAMPLE_PATTERN)).toBe(true);
    expect(looksLikePattern("Rnd 1: 6 sc in MR\r\nRnd 2: inc x 6\r\nRnd 3: (sc, inc) x 6")).toBe(true);
    expect(looksLikePattern("1. 6 dc into ring\n2. 2 dc in each st\n3. (1 dc, 2 dc in next) x 6")).toBe(true);
  });

  it("needs three lines with labels or stitch terms", () => {
    expect(looksLikePattern("Runde 1: 6 fM\nRunde 2: 6 Zun")).toBe(false);
    expect(looksLikePattern("6 fM")).toBe(false);
    expect(looksLikePattern("https://example.org/anleitung")).toBe(false);
    expect(looksLikePattern("Liebe Grüße\nund bis bald\nAnna\nPS: schöne Woche")).toBe(false);
  });

  it("does not read words that only contain stitch letters", () => {
    expect(looksLikePattern("describe\nchapter\nincoming\ndecade")).toBe(false);
  });
});
