import { describe, expect, it } from "vitest";
import { demoDocument } from "../state/document.js";
import { angleText, assemblyLines, placementText, rowPositionText } from "./wording.js";

let n = 0;
const doc = demoDocument(() => `w${++n}`, "bunny");
const head = doc.parts[0]!;

describe("placement wording", () => {
  it("describes the bunny's assembly", () => {
    expect(assemblyLines(doc)).toEqual([
      "Kopf an Körper, auf Runde 14 (Ende)",
      "Ohr ×2 an Kopf, zwischen Runde 4 und 5, ±45° – flach annähen",
      "Arm ×2 an Körper, zwischen Runde 11 und 12, ±80°",
      "Bein ×2 an Körper, zwischen Runde 3 und 4, ±35°",
      "Augen 8 mm an Kopf, zwischen Runde 8 und 9, 6 M Abstand",
      "Stickerei 4 mm an Kopf, zwischen Runde 10 und 11, vorne – mit rosa Garn sticken",
    ]);
  });

  it("names single eyes, angles and missing pieces", () => {
    const row = head.content.rows[7]!.id;
    expect(placementText(doc, { id: "e", kind: "eyes", target: "kopf", row, angle: -20, size: 12 })).toBe(
      "Auge 12 mm an Kopf, zwischen Runde 8 und 9, −20°",
    );
    expect(placementText(doc, { id: "x", kind: "attach", part: "nix", target: "kopf", row: "zz", angle: 30 })).toBe(
      "? an Kopf, Zeile fehlt, 30°",
    );
    expect(angleText(180, false)).toBe("hinten");
    expect(angleText(-45.5, false)).toBe("−45,5°");
  });

  it("uses the editor's labels for rows with a label of their own", () => {
    const labelled = structuredClone(doc);
    labelled.parts[0]!.content.rows[3]!.label = "Ohrenrunde";
    expect(rowPositionText(labelled, "kopf", head.content.rows[3]!.id)).toBe("zwischen Ohrenrunde und Runde 5");
  });
});
