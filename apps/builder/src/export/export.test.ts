import { describe, expect, it } from "vitest";
import {
  BuilderExportSchema,
  decodeShare,
  readShareFragment,
  renderedRows,
  type BuilderExport,
  type PartContent,
} from "@crochetbuilder/engine";
import { demoDocument, emptyDocument, type BuilderDoc } from "../state/document.js";
import { documentFromExport, importFile, MAX_IMPORT_FILE_BYTES, parseImportText } from "./import.js";
import { exportFileName, ExportValidationError, isDocumentEmpty, prepareExport, renderedLines } from "./prepare.js";
import { builderBaseUrl, embedSnippet, shareLinks, viewerBaseUrl } from "./share.js";

function ids(prefix = "row") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const ball = (): BuilderDoc => demoDocument(ids(), "ball");

describe("prepareExport", () => {
  it("fills `rendered` with the German rows and validates against BuilderExportSchema", () => {
    const doc = ball();
    const exp = prepareExport(doc);
    expect(BuilderExportSchema.safeParse(exp).success).toBe(true);
    expect(exp.rendered).toEqual({ locale: "de", rows: renderedRows(doc.parts[0]!.content, "de") });
    expect(exp.rendered!.rows[2]).toBe("Runde 3: 6× (1 fM, 1 Zun) (18)");
    expect(exp.parts).toEqual(doc.parts);
    expect(exp.overview.gauge).toEqual({ yarnWeight: "dk", hookMm: 3 });
  });

  it("leaves out unnamed materials and trims the title", () => {
    const doc = ball();
    doc.title = "  Ball  ";
    doc.overview.materials = [...doc.overview.materials!, { kind: "accessory", label: "   " }];
    const exp = prepareExport(doc);
    expect(exp.title).toBe("Ball");
    expect(exp.overview.materials).toHaveLength(3);
  });

  it("refuses a document that does not match the schema", () => {
    const doc = ball();
    (doc.parts[0]!.content.rows[0] as { type: string }).type = "spiral";
    expect(() => prepareExport(doc)).toThrow(ExportValidationError);
  });

  it("renders several parts with a heading line each", () => {
    const doc = ball();
    doc.parts.push({ name: "Ohr", quantity: 2, content: structuredClone(doc.parts[0]!.content) });
    const lines = renderedLines(doc);
    expect(lines[0]).toBe("Ball:");
    expect(lines[12]).toBe("Ohr (2×):");
    expect(lines).toHaveLength(24);
  });
});

describe("isDocumentEmpty / exportFileName", () => {
  it("an empty document is empty; any content makes it non-empty", () => {
    expect(isDocumentEmpty(emptyDocument("r1"))).toBe(true);
    expect(isDocumentEmpty(ball())).toBe(false);
    const titled = emptyDocument("r1");
    titled.title = "x";
    expect(isDocumentEmpty(titled)).toBe(false);
    const noted = emptyDocument("r1");
    noted.parts[0]!.content.rows[0]!.note = "Augen einsetzen";
    expect(isDocumentEmpty(noted)).toBe(false);
    const unnamed = emptyDocument("r1");
    unnamed.overview.materials = [{ kind: "yarn", label: "" }];
    expect(isDocumentEmpty(unnamed)).toBe(true);
  });

  it("makes safe file names", () => {
    expect(exportFileName("Amigurumi-Kugel", "json")).toBe("amigurumi-kugel.json");
    expect(exportFileName("  Größe: Bär & Co.  ", "pdf")).toBe("groesse-baer-co.pdf");
    expect(exportFileName("", "pdf")).toBe("anleitung.pdf");
    expect(exportFileName("Crème brûlée", "json")).toBe("creme-brulee.json");
  });
});

describe("JSON import", () => {
  it("opens a builder export (round trip of the JSON download)", () => {
    const doc = ball();
    const text = JSON.stringify(prepareExport(doc), null, 2);
    const result = parseImportText(text, "ball.json");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { rendered: _rendered, ...withoutRendered } = prepareExport(doc);
    expect(result.doc).toEqual(withoutRendered);
    expect("rendered" in result.doc).toBe(false);
    expect(result.pinned).toEqual(doc.parts[0]!.content.rows.map((r) => r.id));
  });

  it("opens a bare PartContent; the title comes from the file name", () => {
    const content: PartContent = ball().parts[0]!.content;
    const result = parseImportText(JSON.stringify(content), "mein-ball.json");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.title).toBe("mein-ball");
    expect(result.doc.parts).toEqual([{ name: "Teil 1", quantity: 1, content }]);
    expect(BuilderExportSchema.safeParse(result.doc).success).toBe(true);
  });

  it("tolerates a byte order mark", () => {
    expect(parseImportText("﻿" + JSON.stringify(prepareExport(ball()))).ok).toBe(true);
  });

  it("refuses broken files with German messages", () => {
    const cases: Array<[string, RegExp]> = [
      ["{ kaputt", /kein lesbares JSON/],
      ["[1, 2]", /keine CrochetBuilder-Anleitung/],
      ['{"hello": 1}', /keine CrochetBuilder-Anleitung/],
      [JSON.stringify({ ...prepareExport(ball()), schemaVersion: 2 }), /unbekanntes Format \(schemaVersion 2\)/],
      [JSON.stringify({ ...prepareExport(ball()), title: 7 }), /Anleitung in der Datei ist fehlerhaft \(bei „title“\)/],
      [JSON.stringify({ schemaVersion: 1, rows: [{ id: "a", type: "round", ops: [{ kind: "stitch", code: "XX", count: 1 }], stitchCountTarget: 1 }] }), /Reihen in der Datei sind fehlerhaft \(bei „rows\.0\.ops\.0/],
      [JSON.stringify({ ...prepareExport(ball()), parts: [] }), /keine Teile/],
    ];
    for (const [text, message] of cases) {
      const result = parseImportText(text);
      expect(result.ok, text.slice(0, 40)).toBe(false);
      if (!result.ok) expect(result.message).toMatch(message);
    }
  });

  it("refuses patterns beyond the editor limits", () => {
    const exp = prepareExport(ball());
    exp.parts[0]!.content.rows[0]!.ops = [{ kind: "stitch", code: "SC", count: 5000 }];
    const result = parseImportText(JSON.stringify(exp));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/zu groß für den Builder/);
  });

  it("gives duplicate row ids fresh ones and keeps unique ids", () => {
    const exp = prepareExport(ball());
    const rows = exp.parts[0]!.content.rows;
    rows[3]!.id = rows[2]!.id;
    const result = documentFromExport(exp, ids("fresh"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.doc.parts[0]!.content.rows.map((r) => r.id);
    expect(new Set(out).size).toBe(out.length);
    expect(out[2]).toBe(rows[2]!.id);
    expect(out[3]).toBe("fresh-1");
    expect(out[4]).toBe(rows[4]!.id);
  });

  it("reads files; too large files are not read", async () => {
    const good = new File([JSON.stringify(prepareExport(ball()))], "ball.json", { type: "application/json" });
    expect((await importFile(good)).ok).toBe(true);
    const big = { size: MAX_IMPORT_FILE_BYTES + 1, name: "big.json", text: () => Promise.reject(new Error("read")) } as unknown as File;
    const result = await importFile(big);
    expect(result).toEqual({ ok: false, message: "Die Datei ist zu groß (höchstens 5 MB)." });
  });
});

describe("share links", () => {
  it("point to the viewer next to the builder and carry the validated export", async () => {
    const doc = ball();
    const links = await shareLinks(doc, "https://gerray.github.io/CrochetBuilder/?x=1#data=old");
    expect(links.viewer).toMatch(/^https:\/\/gerray\.github\.io\/CrochetBuilder\/viewer\/#data=v1\.[\w-]+$/);
    expect(links.embed).toMatch(/^https:\/\/gerray\.github\.io\/CrochetBuilder\/viewer\/\?embed=1#data=v1\./);
    expect(links.tmc).toBe(`https://tellmecrochet.de/import#data=${links.payload}`);
    const decoded: BuilderExport = await decodeShare(readShareFragment(new URL(links.viewer).hash)!);
    expect(decoded).toEqual(prepareExport(doc));
  });

  it("the ball demo's link stays far below the length warning", async () => {
    const links = await shareLinks(ball(), "http://localhost:5190/");
    expect(links.viewer.length).toBeLessThan(2000);
  });

  it("viewer and builder find each other relative to their own URL", () => {
    expect(viewerBaseUrl("https://gerray.github.io/CrochetBuilder/")).toBe("https://gerray.github.io/CrochetBuilder/viewer/");
    expect(viewerBaseUrl("https://gerray.github.io/CrochetBuilder/index.html")).toBe("https://gerray.github.io/CrochetBuilder/viewer/");
    expect(builderBaseUrl("https://gerray.github.io/CrochetBuilder/viewer/?embed=1#data=v1.x")).toBe(
      "https://gerray.github.io/CrochetBuilder/",
    );
  });

  it("the embed snippet is an escaped iframe", () => {
    const html = embedSnippet("https://x.test/viewer/?embed=1#data=v1.a", 'Bär "Bruno" <3');
    expect(html).toBe(
      '<iframe src="https://x.test/viewer/?embed=1#data=v1.a" title="Bär &quot;Bruno&quot; &lt;3 – 3D-Modell" width="480" height="420" style="border:0;max-width:100%" loading="lazy" allowfullscreen></iframe>',
    );
  });
});
