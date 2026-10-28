/** Colours of the model (format v2): palette per stitch, highlight on coloured pieces, worker side. */
import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { buildModel, type PartContent, type Row } from "@crochetbuilder/engine";
import { hexRgb, pdfInput, renderPdf, savePdf } from "../export/pdf.js";
import { layoutPdf, type PdfCommand } from "../export/pdfLayout.js";
import { prepareExport } from "../export/prepare.js";
import { geometryKey, PreviewComputer, transferablesOf, withColors } from "../preview/protocol.js";
import { demoDocument } from "../state/document.js";
import { backingColors, highlightOn, meshColors, meshPalette, shade, vertexColors, type Rgb, type ViewMesh } from "./mapping.js";

/** Four vertices on three nodes; nodes 0, 1 in row 0, node 2 in row 1; colours 0, 1, 1. */
const MESH: Pick<ViewMesh, "nodeIndex" | "nodeRow" | "nodeColor"> = {
  nodeIndex: new Uint32Array([0, 1, 2, 2]),
  nodeRow: new Uint32Array([0, 0, 1]),
  nodeColor: new Uint16Array([0, 1, 1]),
};
const WHITE: Rgb = [1, 1, 1];
const PINK: Rgb = [0.9, 0.4, 0.5];
const YARN: Rgb = [0.8, 0.5, 0.3];
const HI: Rgb = [0, 0.5, 0.5];
const triples = (a: Float32Array) => Array.from({ length: a.length / 3 }, (_, i) => Array.from(a.slice(3 * i, 3 * i + 3)));
const close = (a: number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 5));

describe("meshColors", () => {
  it("colours every stitch from the palette by its node's colour index", () => {
    const c = triples(meshColors(MESH, { base: YARN, palette: [WHITE, PINK], highlight: HI }));
    expect(c).toEqual([WHITE, PINK, PINK, PINK].map((x) => x.map(Math.fround)));
  });

  it("without palette or colour indices the piece is in one yarn colour (as before)", () => {
    expect(triples(meshColors(MESH, { base: YARN, highlight: HI }))).toEqual(Array(4).fill(YARN.map(Math.fround)));
    const plain = { nodeIndex: MESH.nodeIndex, nodeRow: MESH.nodeRow };
    expect(triples(meshColors(plain, { base: YARN, palette: [WHITE], highlight: HI }))).toEqual(Array(4).fill(YARN.map(Math.fround)));
    // vertexColors still replaces the colour of the highlighted row.
    expect(triples(vertexColors(MESH, 1, YARN, HI))[3]).toEqual(HI.map(Math.fround));
  });

  it("highlights a row of a coloured piece by blending, keeping a trace of its colour", () => {
    const c = triples(meshColors(MESH, { base: YARN, palette: [WHITE, PINK], rows: [1], highlight: HI }));
    close(c[0]!, WHITE); // row 0 untouched
    close(c[2]!, highlightOn(PINK, HI));
    expect(c[2]).not.toEqual(c[1]);
    // Unknown rows (-1) highlight nothing.
    expect(triples(meshColors(MESH, { base: YARN, palette: [WHITE, PINK], rows: [-1], highlight: HI }))[2]).toEqual(PINK.map(Math.fround));
  });

  it("a highlighted coloured row keeps reading as its own colour: a 40 % tint plus a lightness cue", () => {
    const lit = highlightOn(PINK, HI);
    const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    // Still pink in hue (red the strongest channel, as in the yarn — teal has none), but
    // clearly marked.
    expect(lit[0]).toBeGreaterThan(lit[1]);
    expect(lit[0]).toBeGreaterThan(lit[2]);
    expect(dist(lit, PINK)).toBeGreaterThanOrEqual(0.18);
    // Light yarn gets darker, dark yarn lighter.
    const lum = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(lum(highlightOn(WHITE, HI))).toBeLessThan(lum(WHITE));
    const navy: Rgb = [0.02, 0.03, 0.15];
    expect(lum(highlightOn(navy, HI))).toBeGreaterThan(lum(navy));
  });

  it("looks the display colours up by the model's palette ids", () => {
    const mesh = { nodeColor: new Uint16Array([0, 1]), paletteIds: ["rosa", "weiss"] };
    expect(meshPalette(mesh, { weiss: "#ffffff", rosa: "#ff0000" }, "#888888")).toEqual(["#ff0000", "#ffffff"]);
    // A colour deleted meanwhile falls back to the yarn; no inherited keys.
    expect(meshPalette({ nodeColor: new Uint16Array([0]), paletteIds: ["constructor"] }, {}, "#888888")).toEqual(["#888888"]);
    expect(meshPalette({ paletteIds: ["rosa"] }, { rosa: "#ff0000" }, "#888888")).toEqual([]);
  });

  it("shades the backing behind each stitch in its own colour", () => {
    const c = triples(backingColors(MESH, YARN, [WHITE, PINK]));
    close(c[0]!, shade(WHITE));
    close(c[2]!, shade(PINK));
    const plain = triples(backingColors({ nodeRow: MESH.nodeRow }, YARN));
    close(plain[1]!, shade(YARN));
  });

  it("the highlight stays visible on a yarn in the highlight colour itself", () => {
    const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    for (const yarn of [WHITE, PINK, [0, 0, 0] as Rgb, HI, [0.02, 0.45, 0.42] as Rgb, [0.1, 0.7, 0.65] as Rgb]) {
      expect(dist(highlightOn(yarn, HI), yarn), `${yarn}`).toBeGreaterThanOrEqual(0.18);
    }
  });
});

const row = (id: string, ops: Row["ops"], color?: string): Row => ({ id, type: "round", ops, stitchCountTarget: 0, ...(color ? { color } : {}) });
const STRIPES: PartContent = {
  schemaVersion: 2,
  rows: [
    row("r1", [{ kind: "stitch", code: "MR", count: 1 }, { kind: "stitch", code: "SC", count: 6 }]),
    row("r2", [{ kind: "stitch", code: "INC", count: 6 }], "rosa"),
    row("r3", [{ kind: "stitch", code: "SC", count: 6 }, { kind: "stitch", code: "SC", count: 6, color: "weiss" }]),
  ],
};

describe("preview model colours", () => {
  it("carries the palette index of every node when the request has a palette", () => {
    const computer = new PreviewComputer();
    const result = computer.compute({ id: 1, content: STRIPES, gauge: undefined, style: "surface", palette: ["weiss", "rosa"] });
    if (result.kind !== "model") throw new Error(result.kind);
    const { nodeColor, nodeRow } = result.model;
    expect(nodeColor).toBeInstanceOf(Uint16Array);
    const byRow = [0, 1, 2].map((r) => [...new Set(Array.from(nodeColor!).filter((_, n) => nodeRow[n] === r))]);
    expect(byRow).toEqual([[0], [1], [1, 0]]);
    expect(transferablesOf(result)).toContain(nodeColor!.buffer);
    // No palette: no colour indices.
    const plain = computer.compute({ id: 2, content: STRIPES, gauge: undefined, style: "surface" });
    expect(plain.kind === "model" && plain.model.nodeColor).toBe(undefined);
  });

  it("a colours-only request returns new colour indices for the cached model, no new mesh", () => {
    let builds = 0;
    const computer = new PreviewComputer((...args) => {
      builds++;
      return buildModel(...args);
    });
    const full = computer.compute({ id: 1, content: STRIPES, gauge: undefined, style: "stitches", palette: ["weiss", "rosa"] });
    if (full.kind !== "model") throw new Error(full.kind);
    const recoloured: PartContent = { ...STRIPES, rows: STRIPES.rows.map((r, i) => (i === 1 ? { ...r, color: "weiss" } : r)) };
    const colours = computer.compute({ id: 2, content: recoloured, gauge: undefined, style: "stitches", palette: ["rosa", "weiss"], colorsOnly: true });
    expect(colours.kind).toBe("colors");
    if (colours.kind !== "colors") return;
    expect(builds).toBe(1);
    expect(colours.colors.paletteIds).toEqual(["rosa", "weiss"]);
    expect(transferablesOf(colours)).toEqual([colours.colors.nodeColor!.buffer]);
    const merged = withColors(full.model, colours.colors);
    expect(merged.positions).toBe(full.model.positions);
    // Row 2 now in Weiß (index 1 of the new order).
    const row2 = Array.from(merged.nodeColor!).filter((_, n) => merged.nodeRow[n] === 1);
    expect(new Set(row2)).toEqual(new Set([1]));
    // Without a palette the colours go away; a colours-only request for another shape gets a model.
    expect(withColors(full.model, {})).not.toHaveProperty("nodeColor");
    const other = computer.compute({ id: 3, content: { ...STRIPES, rows: STRIPES.rows.slice(0, 2) }, gauge: undefined, style: "stitches", colorsOnly: true });
    expect(other.kind).toBe("model");
  });

  it("a colour change is no reason to relax again", () => {
    const recoloured: PartContent = { ...STRIPES, rows: STRIPES.rows.map((r) => ({ ...r, color: "weiss" })) };
    const opColour: PartContent = {
      ...STRIPES,
      rows: STRIPES.rows.map((r) => ({ ...r, ops: r.ops.map((op) => (op.kind === "stitch" ? { ...op, color: "x" } : op)) })),
    };
    expect(geometryKey(recoloured, undefined, 100)).toBe(geometryKey(STRIPES, undefined, 100));
    expect(geometryKey(opColour, undefined, 100)).toBe(geometryKey(STRIPES, undefined, 100));
  });
});

describe("PDF colours", () => {
  const coloured = () => {
    const doc = demoDocument(undefined, "ball");
    doc.overview.colors = [
      { id: "weiss", name: "Weiß", hex: "#ffffff" },
      { id: "rosa", name: "Rosa" },
    ];
    doc.parts[0]!.content.rows[4]!.color = "rosa";
    return doc;
  };
  const mono = (text: string, size: number) => text.length * size * 0.3528 * 0.5;

  it("lists the palette with swatches under the material, and the colour changes in the rows", () => {
    const exp = prepareExport(coloured());
    const input = pdfInput(exp, null, null);
    expect(input.colors).toEqual([
      { name: "Weiß (Anfangsfarbe)", rgb: [255, 255, 255] },
      { name: "Rosa", rgb: hexRgb("#f2aec3") },
    ]);
    expect(input.parts[0]!.rows[4]).toBe("Runde 5: [Farbe: Rosa] 24 fM (24)");
    const layout = layoutPdf(input, mono);
    const swatches = layout.commands.filter((c): c is Extract<PdfCommand, { kind: "swatch" }> => c.kind === "swatch");
    expect(swatches.map((s) => s.fill)).toEqual([[255, 255, 255], hexRgb("#f2aec3")]);
    const texts = layout.commands.filter((c) => c.kind === "text").map((c) => (c as { text: string }).text);
    expect(texts).toContain("Farben:");
    expect(texts).toContain("Rosa");
    // jsPDF draws them.
    expect(() => renderPdf(jsPDF, input)).not.toThrow();
    // Without a palette nothing changes.
    expect(layoutPdf(pdfInput(prepareExport(demoDocument(undefined, "ball")), null, null), mono).commands.some((c) => c.kind === "swatch")).toBe(false);
  });

  it("renders the model image in the palette colours", async () => {
    const palettes: Array<Readonly<Record<string, string>>> = [];
    await savePdf(coloured(), {
      loadJsPdf: async () => jsPDF,
      computeModel: async () => ({ size: { width: 1, height: 1, depth: 1 }, maxDiameter: 0 }) as never,
      snapshot: async (_m, palette) => {
        palettes.push(palette);
        return null;
      },
      save: () => {},
    });
    expect(palettes).toEqual([{ weiss: "#ffffff", rosa: "#f2aec3" }]);
    expect(hexRgb("nope")).toEqual([136, 136, 136]);
  });
});
