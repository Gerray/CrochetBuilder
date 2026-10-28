import { describe, expect, it } from "vitest";
import {
  MAX_DETAIL_SENTENCE,
  colorChangeOf,
  colorKey,
  eyeSizeOf,
  findPartByWord,
  finishOf,
  finishStatementOf,
  stuffingsOf,
  hexFromMaterials,
  hexOfColor,
  placementOf,
  roundOf,
  sentencesOf,
  slugOf,
  stuffingOf,
} from "./pattern-details.js";

describe("long text", () => {
  it("reads no sentence longer than the limit, and stays fast on long repetitive text", () => {
    const long = `Stuff the head firmly and close the hole between rounds 3 and 4 in white. ${"x".repeat(MAX_DETAIL_SENTENCE)}`;
    expect([colorChangeOf(long), stuffingOf(long), finishOf(long), placementOf(long)]).toEqual([null, null, null, null]);
    for (const word of ["fill ", "fold ", "sew to ", "stuff "]) {
      const text = word.repeat(20_000);
      const started = performance.now();
      colorChangeOf(text);
      stuffingsOf(text);
      finishOf(text);
      placementOf(text);
      expect(performance.now() - started, word).toBeLessThan(100);
    }
  });
});

describe("sentencesOf", () => {
  it("splits after sentence marks, but not before a lower-case word", () => {
    expect(sentencesOf("Stuff as you go. In grey.  Next:\n6 sc")).toEqual(["Stuff as you go.", "In grey.", "Next:", "6 sc"]);
    expect(sentencesOf("Insert eyes 8 sc between 13 and 14. rounds.")).toEqual(["Insert eyes 8 sc between 13 and 14. rounds."]);
    expect(sentencesOf("  ")).toEqual([]);
  });
});

describe("slugOf and findPartByWord", () => {
  it("makes ids from names", () => {
    expect(slugOf("Head and Body")).toBe("head-and-body");
    expect(slugOf("Weiß")).toBe("weiss");
    expect(slugOf("Füße (2×)")).toBe("fuesse-2");
    expect(slugOf("???")).toBe("x");
  });

  it("finds a part by a word of a sentence, preferring a whole-name match", () => {
    const parts = [{ name: "Head and Body" }, { name: "Ears" }, { name: "Body" }, { name: "Ohren" }, { name: "Right leg" }, { name: "Left leg" }];
    expect(findPartByWord("ear", parts)?.name).toBe("Ears");
    expect(findPartByWord("head", parts)?.name).toBe("Head and Body");
    expect(findPartByWord("body", parts)?.name).toBe("Body");
    expect(findPartByWord("Ohr", parts)?.name).toBe("Ohren");
    expect(findPartByWord("leg", parts)).toBeUndefined(); // two legs: not guessed
    expect(findPartByWord("the", parts)).toBeUndefined();
    expect(findPartByWord("and", [{ name: "Head and Body" }])).toBeUndefined();
  });
});

describe("colours", () => {
  it("reads colour changes in English and German", () => {
    const cases: Array<[string, string]> = [
      ["In grey.", "Grey"],
      ["cc to white", "White"],
      ["Change color to main:", "Main color"],
      ["Change to MC.", "Main color"],
      ["Switch to the light pink yarn.", "Light pink"],
      ["With Color A:", "Color A"],
      ["Crocheted from front to back with colour B:", "Colour B"],
      ["Attach the khaki green yarn to the top.", "Khaki green"],
      ["Join yarn in blue.", "Blue"],
      ["Face color", "Face color"],
      ["The color of the paws", "Color of the paws"],
      ["Farbwechsel zu Rot.", "Rot"],
      ["In Weiß weiterhäkeln.", "Weiß"],
      ["Mit Farbe B:", "Farbe B"],
      ["Wechsle jetzt zu Hellgrau.", "Hellgrau"],
      ["Farbe A:", "Farbe A"],
    ];
    for (const [sentence, name] of cases) expect(colorChangeOf(sentence), sentence).toEqual({ name });
  });

  it("takes no colour from choices, stripes, 'same colour' lines or things that are not yarn", () => {
    for (const s of [
      "Same color",
      "Your colour",
      "Any color",
      "Next color",
      "Other colour:",
      "In the same colour, sc around.",
      "Use a colour of your choice.",
      "In red or pink.",
      "In white or cream, make 2.",
      "In black or brown.",
      "In white and pink stripes.",
      "In pink felt, cut two circles for the cheeks.",
      "With black yarn, make two French knots for the eyes.",
      "Use white safety eyes or a colour of your choice for the trim.",
      "In white buttons.",
      "In lilac you can make the flower.",
    ]) {
      expect(colorChangeOf(s), s).toBeNull();
    }
    expect(colorChangeOf("Body color")).toEqual({ name: "Body color" });
  });

  it("gives the main and contrast colour one key in every spelling", () => {
    expect(colorChangeOf("With the main colour.")).toEqual({ name: "Main color" });
    expect(colorChangeOf("With MC, ch 7.")).toEqual({ name: "Main color" });
    expect(new Set(["Main color", "main colour", "MC", "Hauptfarbe", "Grundfarbe"].map(colorKey))).toEqual(new Set(["main"]));
    expect(new Set(["Contrast color", "CC", "Kontrastfarbe"].map(colorKey))).toEqual(new Set(["contrast"]));
    expect(colorKey("Weiß")).toBe("weiß");
  });

  it("knows a colour change without a name, and ignores thread colours and other words", () => {
    expect(colorChangeOf("Change colour.")).toEqual({});
    expect(colorChangeOf("Farbwechsel.")).toEqual({});
    expect(colorChangeOf("Embroider the mouth with black yarn.")).toBeNull();
    expect(colorChangeOf("With black thread, sew on the nose.")).toBeNull();
    expect(colorChangeOf("In the next round work 6 sc.")).toBeNull();
    expect(colorChangeOf("Stuff the head.")).toBeNull();
  });

  it("gives common colour names a display colour", () => {
    expect(hexOfColor("Grey")).toBe("#808080");
    expect(hexOfColor("weiß")).toBe("#ffffff");
    expect(hexOfColor("light grey")).toBe("#c0c0c0");
    expect(hexOfColor("Khaki green")).toBe("#2e7d32");
    expect(hexOfColor("Main color")).toBeUndefined();
    expect(hexOfColor("Glitter")).toBeUndefined();
  });

  it("takes the colour of a role from the materials", () => {
    const materials = ["Yarn: 50 g Color A: Gray, Color B: cream", "MC – white"];
    expect(hexFromMaterials("Color A", materials)).toBe("#808080");
    expect(hexFromMaterials("Color B", materials)).toBe("#fffdd0");
    expect(hexFromMaterials("Main color", materials)).toBe("#ffffff");
    expect(hexFromMaterials("Color C", materials)).toBeUndefined();
  });
});

describe("stuffing", () => {
  it("reads how firmly to stuff", () => {
    expect(stuffingOf("Stuff the head firmly.")).toEqual({ value: "firm", specific: true, object: "head" });
    expect(stuffingOf("Stuff lightly.")).toEqual({ value: "light", specific: true });
    expect(stuffingOf("We fill only the legs, not much.")).toMatchObject({ value: "light", object: "legs" });
    expect(stuffingOf("Do not stuff the fins.")).toEqual({ value: "none", specific: true, object: "fins" });
    expect(stuffingOf("Stuff as you go.")).toEqual({ value: "firm", specific: false });
    expect(stuffingOf("Stuff it well.")).toEqual({ value: "firm", specific: true });
    expect(stuffingOf("Finish stuffing.")).toMatchObject({ value: "firm", specific: false });
    expect(stuffingOf("Stuff only the bottom of the legs.")).toMatchObject({ object: "legs" });
    expect(stuffingOf("The ears are not stuffed.")).toMatchObject({ value: "none", object: "ears" });
    expect(stuffingOf("Kopf fest füllen.")).toEqual({ value: "firm", specific: true, words: ["Kopf", "fest", "füllen"] });
    expect(stuffingOf("Ohren nicht füllen.")).toMatchObject({ value: "none" });
    expect(stuffingOf("Leicht füllen.")).toMatchObject({ value: "light" });
  });

  it("reads clause by clause: a negation only counts in its own clause", () => {
    expect(stuffingsOf("Stuff the body firmly but do not stuff the arms.")).toEqual([
      { value: "firm", specific: true, object: "body" },
      { value: "none", specific: true, object: "arms" },
    ]);
    expect(stuffingsOf("Stuff, but not too firmly.")).toEqual([{ value: "light", specific: true }]);
    expect(stuffingsOf("Stuff not too firmly.")).toEqual([{ value: "light", specific: true }]);
    expect(stuffingsOf("Stuff well, leave the neck unstuffed.")).toEqual([
      { value: "firm", specific: true },
      { value: "none", specific: true, object: "neck" },
    ]);
    expect(stuffingsOf("Stuff lightly, the legs should stay floppy.")).toEqual([{ value: "light", specific: true }]);
    expect(stuffingsOf("Den Kopf füllen, aber nicht zu fest.")).toMatchObject([{ value: "light" }]);
  });

  it("does not take filling in, filling with stitches or 'before stuffing' for stuffing", () => {
    expect(stuffingOf("Fill the teeth with stitches.")).toBeNull();
    expect(stuffingOf("Fill in the eyes with black yarn.")).toBeNull();
    expect(stuffingOf("Fill in the gaps with a few stitches.")).toBeNull();
    expect(stuffingOf("Insert the eyes before stuffing.")).toBeNull();
    expect(stuffingOf("Leave a gap for stuffing.")).toBeNull();
    expect(stuffingOf("Sew the ears to the head.")).toBeNull();
  });
});

describe("finish", () => {
  it("reads gather, flat and open", () => {
    expect(finishOf("Fasten off and close.")).toBe("gather");
    expect(finishOf("Close the hole with the tail.")).toBe("gather");
    expect(finishOf("Pull the hole to close.")).toBe("gather");
    expect(finishOf("Weave through the front loops and pull tight to close.")).toBe("gather");
    expect(finishOf("Sew the hole closed.")).toBe("gather");
    expect(finishOf("Faden abschneiden und Öffnung schließen.")).toBe("gather");
    expect(finishOf("Fold flat and sc through both layers.")).toBe("flat");
    expect(finishOf("Fold in half and crochet 4 sc.")).toBe("flat");
    expect(finishOf("Sc the opening closed.")).toBe("flat");
    expect(finishOf("Flach zusammenlegen und durch beide Lagen häkeln.")).toBe("flat");
    expect(finishOf("Leave open.")).toBe("open");
    expect(finishOf("Fasten off, leaving a long tail for sewing.")).toBeNull(); // "leaving" is not "leave …"
    expect(finishOf("F/O and leave a long tail for sewing.")).toBe("open");
    expect(finishOf("Offen lassen.")).toBe("open");
  });

  it("prefers the more specific finish and ignores the rest", () => {
    expect(finishOf("Sc the opening closed and leave a long tail for sewing.")).toBe("flat");
    expect(finishOf("Pull the strands through and pull tight.")).toBeNull();
    expect(finishOf("Join with a sl st.")).toBeNull();
  });

  it("reads a negated close first", () => {
    expect(finishOf("Do not close.")).toBe("open");
    expect(finishOf("Do not close the hole.")).toBe("open");
    expect(finishOf("Nicht schließen.")).toBe("open");
    expect(finishOf("Don't close the hole yet, stuff first.")).toBeNull();
    expect(finishOf("Note: do not close the rounds with a sl st.")).toBeNull();
    expect(finishOf("Work in a spiral, do not close the rounds.")).toBeNull();
  });

  it("does not take closing the magic ring or a round for a finish", () => {
    for (const s of [
      "Close the magic ring.",
      "Pull the tail to close the magic ring.",
      "Make a magic ring, pull to close.",
      "Close the hole in the magic ring.",
      "Pull tight to close the round.",
      "Rnd 1: 6 sc in MR, pull tight to close (6)",
      "Fadenring zusammenziehen.",
    ]) {
      expect(finishOf(s), s).toBeNull();
    }
  });

  it("reads a part sewn on as open, a brim folded up as no finish", () => {
    expect(finishOf("Close the opening later when you sew it to the head.")).toBe("open");
    expect(finishOf("Close the opening by sewing it to the body.")).toBe("open");
    expect(finishOf("Flatten and sew to the head.")).toBe("open");
    expect(finishOf("Fold flat and sew together to the head.")).toBe("open");
    expect(finishOf("Sew the arms to the body.")).toBeNull(); // about other parts
    expect(finishOf("Fold in half, crochet together, sew to the head.")).toBe("flat"); // shut first, then sewn on
    expect(finishOf("Fold the brim up and sew together.")).toBeNull();
    expect(finishOf("Fold the cuff and crochet through both layers.")).toBeNull();
  });

  it("marks 'leave a tail for sewing' as a weak open", () => {
    expect(finishStatementOf("F/O and leave a long tail for sewing.")).toEqual({ finish: "open", weak: true });
    expect(finishStatementOf("Leave open.")).toEqual({ finish: "open", weak: false });
    expect(finishStatementOf("Close the hole.")).toEqual({ finish: "gather", weak: false });
  });
});

describe("placements", () => {
  it("reads the round of a placement", () => {
    expect(roundOf("between rounds 8 and 9")).toBe(8);
    expect(roundOf("between Rnd 10 and 11")).toBe(10);
    expect(roundOf("between 11 and 12 rows")).toBe(11);
    expect(roundOf("between 13 and 14. rounds")).toBe(13);
    expect(roundOf("zwischen Runde 4 und 5")).toBe(4);
    expect(roundOf("at round 12")).toBe(12);
    expect(roundOf("in Runde 7")).toBe(7);
    expect(roundOf("between them")).toBeUndefined();
    expect(roundOf("between 3 and 4 cm")).toBeUndefined();
  });

  it("reads safety eyes with spacing and size", () => {
    expect(placementOf("Insert safety eyes between rounds 8 and 9, 6 st apart (12 mm).")).toEqual({
      kind: "eyes",
      round: 8,
      objectWords: [],
      targetWords: [],
      spacing: 6,
      size: 12,
    });
    expect(placementOf("Place eyes between rounds 9 and 10, leaving 10 holes between them.")).toMatchObject({ kind: "eyes", round: 9, spacing: 10 });
    expect(placementOf("Insert eyes 8 sc between 13 and 14. rounds.")).toMatchObject({ kind: "eyes", round: 13, spacing: 8 });
    expect(placementOf("Sicherheitsaugen zwischen Runde 4 und 5 einsetzen, 5 M auseinander.")).toMatchObject({
      kind: "eyes",
      round: 4,
      spacing: 5,
    });
    expect(placementOf("Insert the eyes.")).toBeNull(); // no round
  });

  it("reads sewn-on parts with the words naming part and target", () => {
    expect(placementOf("Sew the ears to the head between rounds 3 and 5.")).toEqual({
      kind: "attach",
      round: 3,
      objectWords: ["the", "ears"],
      targetWords: ["head"],
    });
    expect(placementOf("fold in half, sew to the head between 11 and 12 rows")).toMatchObject({ kind: "attach", round: 11, targetWords: ["head"] });
    expect(placementOf("Turn the body over and pin the fins onto the body between rounds 16 and 20.")).toMatchObject({
      objectWords: ["the", "fins", "Turn", "the", "body", "over", "and"],
      targetWords: ["body"],
    });
    expect(placementOf("Sew arms between rnd 8 and 9.")).toMatchObject({ kind: "attach", round: 8, targetWords: [] });
    expect(placementOf("Ohren zwischen Runde 3 und 5 an den Kopf nähen.")).toMatchObject({
      kind: "attach",
      round: 3,
      targetWords: ["Kopf"],
      objectWords: ["Ohren", "zwischen", "Runde", "und"],
    });
    expect(placementOf("Embroider the nose between rounds 10 and 11.")).toMatchObject({ kind: "embroidery", round: 10 });
    // "Sew on the tail": the tail is sewn on, it is not where it goes.
    expect(placementOf("Sew on the tail between rows 8 and 9.")).toEqual({
      kind: "attach",
      round: 8,
      objectWords: ["the", "tail", "between", "rows", "and"],
      targetWords: [],
    });
    expect(placementOf("Crochet 6 sc between rounds 3 and 4.")).toBeNull();
  });

  it("reads the eye size from the materials", () => {
    expect(eyeSizeOf(["Hook 3 mm, 8 mm safety eyes"])).toBe(8);
    expect(eyeSizeOf(["Sicherheitsaugen 10 mm"])).toBe(10);
    expect(eyeSizeOf(["eyes 12 mm – thread"])).toBe(12);
    expect(eyeSizeOf(["Hook 3 mm"])).toBeUndefined();
  });
});
