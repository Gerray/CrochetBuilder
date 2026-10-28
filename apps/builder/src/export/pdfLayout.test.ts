import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { demoDocument } from "../state/document.js";
import { PreviewComputer } from "../preview/protocol.js";
import { contentBox, pdfInput, renderPdf, savePdf, SNAPSHOT_BACKING, SNAPSHOT_STYLE } from "./pdf.js";
import { FOOTER_TEXT, IMAGE_MAX, layoutPdf, PAGE, toWinAnsi, wrapText, type PdfCommand, type PdfInput } from "./pdfLayout.js";
import { prepareExport } from "./prepare.js";

/** Monospace stand-in: every character is half the font size wide (pt → mm). */
const mono = (text: string, size: number) => text.length * size * 0.3528 * 0.5;

const texts = (cmds: PdfCommand[]) => cmds.filter((c): c is Extract<PdfCommand, { kind: "text" }> => c.kind === "text");

function ids() {
  let n = 0;
  return () => `row-${++n}`;
}

function ballInput(overrides: Partial<PdfInput> = {}): PdfInput {
  const exp = prepareExport(demoDocument(ids(), "ball"));
  return {
    ...pdfInput(exp, { size: { width: 32, height: 27, depth: 32 }, maxDiameter: 30 }, null),
    ...overrides,
  };
}

describe("toWinAnsi", () => {
  it("keeps umlauts, ß, ×, – and German quotes (all in WinAnsi)", () => {
    const s = "Größe · Weiß · 6× (1 fM) – „Zun“ … € Ø ½";
    expect(toWinAnsi(s)).toBe(s);
  });

  it("replaces what the standard fonts cannot show", () => {
    expect(toWinAnsi("a → b ≈ c − d")).toBe("a -> b ~ c - d");
    expect(toWinAnsi("Garn 🧶 und 毛线")).toBe("Garn ? und ??");
    expect(toWinAnsi("ăčř")).toBe("acr");
    expect(toWinAnsi("Zeile 1\nZeile 2\tx")).toBe("Zeile 1 Zeile 2 x");
  });
});

describe("wrapText", () => {
  const m = (t: string) => t.length;
  it("wraps greedily at spaces", () => {
    expect(wrapText("aa bb cc dd", 5, m)).toEqual(["aa bb", "cc dd"]);
    expect(wrapText("", 5, m)).toEqual([""]);
  });
  it("breaks words wider than a line", () => {
    expect(wrapText("abcdefghij", 4, m)).toEqual(["abcd", "efgh", "ij"]);
  });
});

describe("layoutPdf", () => {
  it("lays out title, materials, size, notes and every row in order on one A4 page", () => {
    const input = ballInput();
    const layout = layoutPdf(input, mono);
    expect(layout.pages).toBe(1);
    const lines = texts(layout.commands).map((c) => c.text);
    expect(lines[0]).toBe("Amigurumi-Ball");
    for (const heading of ["Material", "Größe", "Hinweise", "Anleitung"]) expect(lines).toContain(heading);
    expect(lines).toContain("• Garn: Baumwollgarn DK (Weiß), ca. 10 g");
    expect(lines).toContain("Garn: DK (leicht) · Nadel: 3 mm");
    expect(lines).toContain("Fertige Größe: 3,2 × 2,7 × 3,2 cm (B × H × T), max. Ø 3,0 cm");
    expect(lines.some((l) => l.startsWith("Maße geschätzt aus Garn und Nadel"))).toBe(true);
    const rows = lines.filter((l) => /^Runde \d+:/.test(l));
    expect(rows).toHaveLength(11);
    expect(rows[2]).toBe("Runde 3: 6× (1 fM, 1 Zun) (18)");
    expect(rows[10]).toBe("Runde 11: 6 Abn (6)");
    expect(lines).toContain(FOOTER_TEXT);
    expect(lines).toContain("Seite 1 von 1");
  });

  it("breaks pages, numbers them and puts a footer on each; content stays above the footer", () => {
    const rows = Array.from({ length: 140 }, (_, i) => `Runde ${i + 1}: 24 fM (24)`);
    const layout = layoutPdf(ballInput({ parts: [{ heading: null, rows }] }), mono);
    expect(layout.pages).toBeGreaterThanOrEqual(3);
    const all = texts(layout.commands);
    for (let p = 1; p <= layout.pages; p++) {
      const onPage = all.filter((c) => c.page === p);
      expect(onPage.filter((c) => c.text === FOOTER_TEXT)).toHaveLength(1);
      expect(onPage.some((c) => c.text === `Seite ${p} von ${layout.pages}`)).toBe(true);
      for (const c of onPage) {
        if (c.text === FOOTER_TEXT || c.text.startsWith("Seite ")) continue;
        expect(c.y).toBeLessThanOrEqual(PAGE.bottom);
        expect(c.y).toBeGreaterThanOrEqual(PAGE.margin);
      }
    }
    // Rows keep their order across pages.
    const rowLines = all.filter((c) => /^Runde \d+:/.test(c.text));
    expect(rowLines.map((c) => c.text)).toEqual(rows);
    const order = rowLines.map((c) => c.page * 1000 + c.y);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("wraps long rows with a hanging indent and keeps them on one page", () => {
    const long = `Runde 1: ${"6× (1 fM, 1 Zun) ".repeat(12).trim()} (18) – Hinweis`;
    const layout = layoutPdf(ballInput({ parts: [{ heading: "Kopf (2×)", rows: [long] }] }), mono);
    const lines = texts(layout.commands);
    const start = lines.findIndex((c) => c.text.startsWith("Runde 1:"));
    const cont = lines[start + 1]!;
    expect(cont.x).toBeGreaterThan(lines[start]!.x);
    expect(cont.page).toBe(lines[start]!.page);
    expect(lines.some((c) => c.text === "Kopf (2×)" && c.bold)).toBe(true);
    for (const c of lines.filter((l) => l.align === "left")) {
      expect(c.x + mono(c.text, c.size)).toBeLessThanOrEqual(PAGE.width - PAGE.margin + 0.01);
    }
  });

  it("places the model image centred within the maximum size, keeping its aspect", () => {
    const layout = layoutPdf(ballInput({ image: { dataUrl: "data:image/jpeg;base64,AAAA", width: 1000, height: 800 } }), mono);
    const image = layout.commands.find((c) => c.kind === "image");
    expect(image).toMatchObject({ kind: "image", page: 1, format: "JPEG" });
    if (image?.kind !== "image") throw new Error("no image");
    expect(image.w).toBeCloseTo(IMAGE_MAX.w);
    expect(image.h).toBeCloseTo(IMAGE_MAX.w * 0.8);
    expect(image.x + image.w / 2).toBeCloseTo(PAGE.width / 2);
    // The text after the image starts below it.
    const material = texts(layout.commands).find((c) => c.text === "Material")!;
    expect(material.y).toBeGreaterThan(image.y + image.h);
  });

  it("leaves image and size out gracefully when there is no model", () => {
    const exp = prepareExport(demoDocument(ids(), "ball"));
    const layout = layoutPdf(pdfInput(exp, null, null), mono);
    expect(layout.commands.some((c) => c.kind === "image")).toBe(false);
    expect(texts(layout.commands).some((c) => c.text.startsWith("Fertige Größe"))).toBe(false);
  });

  it("an empty pattern still gives a valid page", () => {
    const layout = layoutPdf({ title: "", materials: [], gauge: "x", size: null, estimate: null, parts: [{ heading: null, rows: [] }], image: null }, mono);
    const lines = texts(layout.commands).map((c) => c.text);
    expect(lines[0]).toBe("Anleitung");
    expect(lines).toContain("Noch keine Reihen.");
    expect(layout.pages).toBe(1);
  });

  it("is deterministic", () => {
    expect(layoutPdf(ballInput(), mono)).toEqual(layoutPdf(ballInput(), mono));
  });
});

describe("renderPdf with jsPDF (Node)", () => {
  it("writes the rows as WinAnsi text with umlauts, × and – intact", () => {
    const input = ballInput();
    input.notes = "Vor Runde 11 füllen – Größe beachten.";
    const { pdf, layout } = renderPdf(jsPDF, input, { compress: false });
    const out = pdf.output();
    expect(pdf.getNumberOfPages()).toBe(layout.pages);
    // WinAnsi bytes: × = D7, – = 96, ö = F6, ü = FC, ß = DF.
    expect(out).toContain("(Runde 3: 6× \\(1 fM, 1 Zun\\) \\(18\\)) Tj");
    expect(out).toContain("(Vor Runde 11 füllen \u0096 Größe beachten.) Tj");
    expect(out).toContain(`(${FOOTER_TEXT}) Tj`);
    expect(out).toContain("(Seite 1 von 1) Tj");
    expect(out).toContain("/Encoding /WinAnsiEncoding");
    expect(out).toMatch(/\/Title \(Amigurumi-Ball\)/);
  });
});

describe("contentBox (crop of the model snapshot)", () => {
  function image(width: number, height: number, fill: (x: number, y: number) => boolean) {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (fill(x, y)) data.set([200, 150, 120, 255], 4 * (y * width + x));
      }
    }
    return data;
  }

  it("finds the model and pads it", () => {
    const data = image(100, 80, (x, y) => x >= 30 && x < 70 && y >= 20 && y < 40);
    expect(contentBox(data, 100, 80, [255, 255, 255], 12, 0)).toEqual({ x: 30, y: 20, width: 40, height: 20 });
    expect(contentBox(data, 100, 80, [255, 255, 255], 12, 0.1)).toEqual({ x: 26, y: 16, width: 48, height: 28 });
  });

  it("clamps to the image and ignores near-background noise", () => {
    const data = image(50, 50, (x, y) => x < 10 && y < 10);
    data.set([250, 250, 250, 255], 4 * (49 * 50 + 49)); // within tolerance
    expect(contentBox(data, 50, 50, [255, 255, 255], 12, 0.5)).toEqual({ x: 0, y: 0, width: 15, height: 15 });
  });

  it("is null for an empty snapshot", () => {
    expect(contentBox(image(10, 10, () => false), 10, 10, [255, 255, 255])).toBeNull();
  });
});

describe("savePdf", () => {
  it("builds the PDF from the validated export, with the snapshot when there is a model", async () => {
    const doc = demoDocument(ids(), "ball");
    const saved: Array<{ blob: Blob; name: string }> = [];
    const snapshots: unknown[] = [];
    const model = { size: { width: 32, height: 27, depth: 32 }, maxDiameter: 30 } as never;
    const name = await savePdf(doc, {
      loadJsPdf: async () => jsPDF,
      computeModel: async () => model,
      snapshot: async (m) => {
        snapshots.push(m);
        return null; // no WebGL: the PDF is made without the image
      },
      save: (blob, fileName) => saved.push({ blob, name: fileName }),
    });
    expect(name).toBe("amigurumi-ball.pdf");
    expect(snapshots).toEqual([model]);
    expect(saved).toHaveLength(1);
    const head = new TextDecoder("latin1").decode(new Uint8Array(await saved[0]!.blob.arrayBuffer()).slice(0, 8));
    expect(head).toBe("%PDF-1.3");
  });

  it("works without a model (and does not try a snapshot)", async () => {
    let snapshotCalled = false;
    let size = 0;
    await savePdf(demoDocument(ids(), "potholder"), {
      loadJsPdf: async () => jsPDF,
      computeModel: async () => {
        throw new Error("no worker");
      },
      snapshot: async () => {
        snapshotCalled = true;
        return null;
      },
      save: (blob) => {
        size = blob.size;
      },
    });
    expect(snapshotCalled).toBe(false);
    expect(size).toBeGreaterThan(1000);
  });
});

describe("PDF model image", () => {
  it("shows the stitch lattice with its faint backing, not the closed surface", () => {
    expect(SNAPSHOT_STYLE).toBe("stitches");
    expect(SNAPSHOT_BACKING).toBeGreaterThan(0);
    expect(SNAPSHOT_BACKING).toBeLessThan(1);
    const exp = prepareExport(demoDocument(undefined, "ball"));
    const r = new PreviewComputer().compute({ id: 1, content: exp.parts[0]!.content, gauge: exp.overview.gauge, style: SNAPSHOT_STYLE });
    expect(r.kind).toBe("model");
    if (r.kind === "model") expect(r.model.backing?.indices.length).toBeGreaterThan(0);
  });
});

describe("PDF with several parts", () => {
  const bunny = () => prepareExport(demoDocument(ids(), "bunny"));
  const model = { size: { width: 40, height: 40, depth: 40 }, maxDiameter: 37 };

  it("starts with an overview of the parts and the total", () => {
    const input = pdfInput(bunny(), model, null);
    expect(input.overview).toEqual({
      lines: [
        "Kopf: 14 Runden, 300 Maschen",
        "Körper: 14 Runden, 264 Maschen",
        "Ohr ×2: 13 Runden, 138 Maschen je Teil",
        "Arm ×2: 8 Runden, 69 Maschen je Teil",
        "Bein ×2: 8 Runden, 81 Maschen je Teil",
      ],
      total: "Gesamt: 1.140 Maschen, 8 Teile zu häkeln",
    });
    // The image and the finished size are the first part's — the line says which.
    expect(input.size).toBe("4,0 × 4,0 × 4,0 cm (B × H × T), max. Ø 3,7 cm – Kopf");
    const lines = texts(layoutPdf(input, mono).commands).map((c) => c.text);
    const at = (text: string) => lines.indexOf(text);
    expect(at("Teile")).toBeGreaterThan(at("Hase (einfach)"));
    expect(at("Teile")).toBeLessThan(at("Material"));
    expect(at("• Ohr ×2: 13 Runden, 138 Maschen je Teil")).toBeGreaterThan(at("Teile"));
    expect(at("Gesamt: 1.140 Maschen, 8 Teile zu häkeln")).toBeLessThan(at("Material"));
  });

  it("gives every part its own section with name and ×n, rows numbered per part", () => {
    const exp = bunny();
    const layout = layoutPdf(pdfInput(exp, model, null), mono);
    const lines = texts(layout.commands).map((c) => c.text);
    const sections = ["Kopf", "Körper", "Ohr ×2", "Arm ×2", "Bein ×2"].map((h) => lines.lastIndexOf(h));
    expect(sections.every((i) => i > lines.indexOf("Anleitung"))).toBe(true);
    expect([...sections].sort((a, b) => a - b)).toEqual(sections);
    // Each section starts again at "Runde 1"; every row of every part is there.
    for (const [k, start] of sections.entries()) {
      expect(lines[start + 1]).toMatch(/^Runde 1: 1 MR, 6 fM \(6\)$/);
      const end = sections[k + 1] ?? lines.indexOf(FOOTER_TEXT);
      const rows = lines.slice(start + 1, end).filter((l) => /^Runde \d+:/.test(l));
      expect(rows).toHaveLength(exp.parts[k]!.content.rows.length);
    }
    expect(layout.pages).toBeGreaterThan(1);
    for (const c of texts(layout.commands)) {
      if (c.text !== FOOTER_TEXT && !c.text.startsWith("Seite ")) expect(c.y).toBeLessThanOrEqual(PAGE.bottom);
    }
  });

  it("a single part has no overview and no part heading; a single part made twice is headed '×2'", () => {
    const one = prepareExport(demoDocument(ids(), "ball"));
    const input = pdfInput(one, model, null);
    expect(input.overview).toBeUndefined();
    expect(input.parts[0]!.heading).toBeNull();
    expect(input.size).not.toContain(" – ");
    one.parts[0]!.quantity = 2;
    expect(pdfInput(one, model, null).parts[0]!.heading).toBe("Ball ×2");
  });
});
