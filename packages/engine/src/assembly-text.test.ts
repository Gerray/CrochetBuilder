import { describe, it, expect } from "vitest";
import type { Placement } from "./assembly.js";
import { angleText, assemblyLines, isMirroredPair, placementText, rowPositionText, rowWord, type PlacementTextDoc } from "./assembly-text.js";
import type { Row } from "./schema.js";

const round = (id: string, type: Row["type"] = "round", label?: string): Row => ({
  id,
  type,
  ops: [{ kind: "stitch", code: "SC", count: 6 }],
  stitchCountTarget: 6,
  ...(label ? { label } : {}),
});
const rows = (prefix: string, n: number, type: Row["type"] = "round") => Array.from({ length: n }, (_, i) => round(`${prefix}${i + 1}`, type));

const doc = (assembly: Placement[]): PlacementTextDoc => ({
  parts: [
    { id: "kopf", name: "Kopf", quantity: 1, content: { rows: rows("k", 10) } },
    { id: "ohr", name: "Ohr", quantity: 2, content: { rows: rows("o", 5) } },
    { id: "flap", name: "", quantity: 1, content: { rows: rows("f", 4, "row") } },
  ],
  assembly,
});
const attach = (p: Partial<Placement>): Placement => ({ id: "a", kind: "attach", part: "ohr", target: "kopf", row: "k4", angle: 30, ...p });

describe("placement wording", () => {
  it("names rows between this and the next, the end, and missing rows by the target's kind", () => {
    const d = doc([]);
    expect(rowPositionText(d, "kopf", "k4")).toBe("zwischen Runde 4 und 5");
    expect(rowPositionText(d, "kopf", "k10")).toBe("auf Runde 10 (Ende)");
    expect(rowPositionText(d, "flap", "f2")).toBe("zwischen Reihe 2 und 3");
    expect(rowPositionText(d, "kopf", "zz")).toBe("Runde fehlt");
    expect(rowPositionText(d, "flap", "zz")).toBe("Reihe fehlt");
    expect(rowPositionText(d, "nobody", "k4")).toBe("Runde fehlt");
    expect([rowWord(d, 0), rowWord(d, 2)]).toEqual(["Runde", "Reihe"]);
  });

  it("says ×2 and ± only for a mirrored pair the engine places", () => {
    expect(placementText(doc([attach({})]), attach({}))).toBe("Ohr ×2 an Kopf, zwischen Runde 4 und 5, ±30°");
    // A second placement of the ear: no automatic mirror.
    const two = doc([attach({}), attach({ id: "b", angle: -30 })]);
    expect(isMirroredPair(two, two.assembly![0]!)).toBe(false);
    // ... unless the second one cannot be used (unknown row): then the first is mirrored.
    const broken = doc([attach({}), attach({ id: "b", row: "nope" })]);
    expect(isMirroredPair(broken, broken.assembly![0]!)).toBe(true);
    expect(placementText(broken, broken.assembly![1]!)).toBe("Ohr an Kopf, Runde fehlt, 30°");
  });

  it("words eyes, embroidery and angles", () => {
    const d = doc([
      { id: "e", kind: "eyes", target: "kopf", row: "k8", angle: 0, spacing: 6, size: 12 },
      { id: "n", kind: "embroidery", target: "flap", row: "f2", angle: -45.5, note: "Nase" },
    ]);
    expect(assemblyLines(d)).toEqual([
      "Augen 12 mm an Kopf, zwischen Runde 8 und 9, 6 M Abstand",
      "Stickerei an Teil 3, zwischen Reihe 2 und 3, −45,5° – Nase",
    ]);
    expect([angleText(0, true), angleText(180, false), angleText(-180, true), angleText(20, true)]).toEqual(["vorne", "hinten", "hinten", "±20°"]);
  });
});
