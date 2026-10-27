import { describe, expect, it } from "vitest";
import { YarnWeightSchema } from "@crochetbuilder/engine";
import { estimateNote, gaugeLine, sizeBasisText, yarnWeightOption } from "./labels.js";

describe("yarn thickness labels", () => {
  it("shows the typical thickness with every weight option", () => {
    expect(yarnWeightOption("dk")).toBe("DK (leicht) · ca. 2,5 mm");
    expect(yarnWeightOption("jumbo")).toBe("Jumbo (sehr dick) · ca. 8 mm");
    for (const weight of YarnWeightSchema.options) expect(yarnWeightOption(weight)).toMatch(/ · ca\. [\d,]+ mm$/);
  });

  it("adds the thickness to the gauge line used by PDF and viewer", () => {
    expect(gaugeLine({ yarnWeight: "dk", hookMm: 3 })).toBe("Garn: DK (leicht) · Nadel: 3 mm");
    expect(gaugeLine({ yarnWeight: "dk", yarnDiameterMm: 2.25, hookMm: 3 })).toBe(
      "Garn: DK (leicht) · Garndicke: 2,25 mm · Nadel: 3 mm",
    );
    expect(gaugeLine({ yarnDiameterMm: 2.5 })).toBe("Garndicke: 2,5 mm");
  });

  it("names the inputs that drive the size", () => {
    expect(sizeBasisText({ yarnDiameterMm: 2.5, hookMm: 3 })).toBe("Größe aus Garndicke 2,5 mm und Nadel 3 mm geschätzt");
    expect(sizeBasisText({ yarnWeight: "dk", hookMm: 3 })).toBe("Größe aus Garn DK (leicht) und Nadel 3 mm geschätzt");
    expect(sizeBasisText({ yarnWeight: "dk", yarnDiameterMm: 2, hookMm: 3 })).toBe(
      "Größe aus Garndicke 2 mm und Nadel 3 mm geschätzt – die Garndicke hat Vorrang vor der Garnstärke",
    );
    expect(sizeBasisText({ yarnDiameterMm: 1.5 })).toBe("Größe aus Garndicke 1,5 mm geschätzt");
    expect(sizeBasisText({ hookMm: 3.5 })).toBe("Größe aus Standardgarn (DK) und Nadel 3,5 mm geschätzt");
    expect(sizeBasisText(undefined)).toBe("Größe aus Standardwerten (DK, 4 mm) geschätzt");
    expect(sizeBasisText({ stitchesPer10cm: 20, yarnDiameterMm: 2 })).toBe("Größe aus der Maschenprobe");
  });

  it("treats a thickness-only gauge as an estimate", () => {
    expect(estimateNote({ yarnDiameterMm: 2.5 })).toMatch(/^Maße geschätzt aus Garn und Nadel/);
  });
});
