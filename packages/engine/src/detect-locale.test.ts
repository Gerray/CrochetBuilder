import { describe, expect, it } from "vitest";
import { detectNotationLocale } from "./detect-locale.js";

describe("detectNotationLocale", () => {
  it("lets an explicit mention win", () => {
    expect(detectNotationLocale("This pattern uses UK terms. Rnd 1: 6 sc in MR")).toEqual({
      locale: "en_uk",
      confidence: 1,
    });
    expect(detectNotationLocale("Written in US terminology. R1: 6 dc in MR")).toEqual({
      locale: "en_us",
      confidence: 1,
    });
    expect(detectNotationLocale("Anleitung in amerikanischen Begriffen? Nein: US terms")).toMatchObject({
      locale: "en_us",
    });
    // Both mentioned: the first one wins.
    expect(detectNotationLocale("US terms (UK terms on page 2)").locale).toBe("en_us");
  });

  it("recognises German patterns", () => {
    const text = "Kopf\nR1: 6 fM in den Fadenring\nR2: 6 Zun (12)\nR3: (1 fM, 1 Zun) x 6 (18)\nKopf füllen und schließen.";
    const result = detectNotationLocale(text);
    expect(result.locale).toBe("de");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("recognises US terms by sc/hdc", () => {
    const text = "Rnd 1: 6 sc in magic ring\nRnd 2: inc around (12)\nRnd 3: (sc, inc) x 6 (18)\nStuff the head.";
    const result = detectNotationLocale(text);
    expect(result.locale).toBe("en_us");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("recognises UK terms by dc without sc, htr and ss", () => {
    const text = "Round 1: 6 dc into the ring\nRound 2: 2 dc in each stitch (12)\nRound 3: (dc, 2 dc in next) x 6, ss to join";
    expect(detectNotationLocale(text).locale).toBe("en_uk");
    expect(detectNotationLocale("Row 1: 10 htr, turn. Row 2: ch 2, 10 htr").locale).toBe("en_uk");
  });

  it("treats dc next to sc as US double crochet", () => {
    expect(detectNotationLocale("Round 4: 3 sc, 2 dc, 3 sc, 2 dc").locale).toBe("en_us");
  });

  it("returns German with zero confidence when there is no signal", () => {
    expect(detectNotationLocale("")).toEqual({ locale: "de", confidence: 0 });
    expect(detectNotationLocale("12345 ---")).toEqual({ locale: "de", confidence: 0 });
  });

  it("gives lower confidence for mixed text", () => {
    const mixed = detectNotationLocale("Round 1: 6 sc. Runde 2: 6 Zun und fM");
    const clear = detectNotationLocale("Round 1: 6 sc in the ring. Round 2: inc in each stitch around");
    expect(mixed.confidence).toBeLessThan(clear.confidence);
  });
});
