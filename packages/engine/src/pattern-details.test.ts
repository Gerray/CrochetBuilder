import { describe, expect, it } from "vitest";
import {
  colorChangeOf,
  eyeSizeOf,
  findPartByWord,
  finishOf,
  hexFromMaterials,
  hexOfColor,
  placementOf,
  roundOf,
  sentencesOf,
  slugOf,
  stuffingOf,
} from "./pattern-details.js";

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
    expect(stuffingOf("Stuff the head firmly.")).toEqual({ value: "firm", specific: true, objectWords: ["head"] });
    expect(stuffingOf("Stuff lightly.")).toMatchObject({ value: "light", specific: true });
    expect(stuffingOf("We fill only the legs, not much.")).toMatchObject({ value: "light", objectWords: ["legs"] });
    expect(stuffingOf("Do not stuff the fins.")).toEqual({ value: "none", specific: true, objectWords: ["fins"] });
    expect(stuffingOf("Stuff as you go.")).toMatchObject({ value: "firm", specific: false });
    expect(stuffingOf("Finish stuffing.")).toMatchObject({ value: "firm", specific: false });
    expect(stuffingOf("Kopf fest füllen.")).toMatchObject({ value: "firm", specific: true, objectWords: ["Kopf", "fest", "füllen"] });
    expect(stuffingOf("Ohren nicht füllen.")).toMatchObject({ value: "none" });
    expect(stuffingOf("Leicht füllen.")).toMatchObject({ value: "light" });
  });

  it("does not take filling with stitches for stuffing", () => {
    expect(stuffingOf("Fill the teeth with stitches.")).toBeNull();
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
    expect(placementOf("Crochet 6 sc between rounds 3 and 4.")).toBeNull();
  });

  it("reads the eye size from the materials", () => {
    expect(eyeSizeOf(["Hook 3 mm, 8 mm safety eyes"])).toBe(8);
    expect(eyeSizeOf(["Sicherheitsaugen 10 mm"])).toBe(10);
    expect(eyeSizeOf(["eyes 12 mm – thread"])).toBe(12);
    expect(eyeSizeOf(["Hook 3 mm"])).toBeUndefined();
  });
});
