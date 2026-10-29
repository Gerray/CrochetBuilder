/**
 * "Als PDF speichern": the export as an A4 pattern sheet. jsPDF is loaded on demand (it is
 * only needed here); the model image is a snapshot of the 3D view at a fixed size, rendered
 * off screen, and simply left out when there is no model or no WebGL. With several parts the
 * image and the finished size show the assembled toy when parts are sewn together (B4), else
 * the first part. The assembly follows the rows as a "Montage" section in words.
 */

import { renderedRows, type BuilderExport, type MeshStyle } from "@crochetbuilder/engine";
import type { jsPDF as JsPdf } from "jspdf";
import { createPreviewClient } from "../preview/client.js";
import type { PreviewModel, PreviewResult } from "../preview/protocol.js";
import type { BuilderDoc } from "../state/document.js";
import { paletteColors } from "../state/palette.js";
import { partName, partStitches, partsTotal, totalText } from "../state/parts.js";
import { estimateNote, gaugeLine, materialLine, paletteEntries, partHeading, sizeLine } from "./labels.js";
import { layoutPdf, type PdfImage, type PdfInput, type PdfLayout, type TextMeasure } from "./pdfLayout.js";
import { exportFileName, downloadBlob, prepareExport } from "./prepare.js";
import { assemblyLines } from "../assembly/wording.js";
import type { ViewMesh } from "../three/mapping.js";
import type { ViewSphere } from "../three/modelView.js";
import type { AssemblyResult } from "../assembly/compute.js";

/**
 * Pixel size the model is rendered at (square, like the framing). The image is then cropped
 * to the model, which keeps well over 300 dpi at the ~70 mm it is printed at.
 */
export const SNAPSHOT_SIZE = { width: 1600, height: 1600 } as const;
/**
 * Mesh style of the PDF image, whatever the preview shows: the stitch lattice — at print
 * size it still reads as crocheted rows, where the closed surface is a featureless blob.
 */
export const SNAPSHOT_STYLE: MeshStyle = "stitches";
/** Opacity of the fabric behind the stitches in the PDF image (calms the see-through parts). */
export const SNAPSHOT_BACKING = 0.45;
/** Background of the PDF image (the page is white). */
export const SNAPSHOT_BACKGROUND = "#ffffff";
/** Space kept around the model when cropping, as a share of its larger side. */
const CROP_PADDING = 0.06;

export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Bounding box of everything in an RGBA image that differs from the background colour by more
 * than `tolerance` (per channel), grown by `padding` × its larger side and clamped to the
 * image. Null for an image that is only background.
 */
export function contentBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: [number, number, number],
  tolerance = 12,
  padding = CROP_PADDING,
): PixelBox | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 4 * (y * width + x);
      if (
        Math.abs(data[i]! - background[0]) > tolerance ||
        Math.abs(data[i + 1]! - background[1]) > tolerance ||
        Math.abs(data[i + 2]! - background[2]) > tolerance
      ) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = Math.round(Math.max(maxX - minX + 1, maxY - minY + 1) * padding);
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width, maxX + 1 + pad);
  const y1 = Math.min(height, maxY + 1 + pad);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Crop a rendered snapshot to the model (2D canvas); the original on any failure. */
async function cropToModel(dataUrl: string, size: { width: number; height: number }): Promise<PdfImage> {
  const original: PdfImage = { dataUrl, ...size };
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const box = contentBox(pixels.data, canvas.width, canvas.height, [255, 255, 255]);
    if (!box) return original;
    const out = document.createElement("canvas");
    out.width = box.width;
    out.height = box.height;
    const octx = out.getContext("2d");
    if (!octx) return original;
    octx.fillStyle = SNAPSHOT_BACKGROUND;
    octx.fillRect(0, 0, box.width, box.height);
    octx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    return { dataUrl: out.toDataURL("image/jpeg", 0.92), width: box.width, height: box.height };
  } catch {
    return original;
  }
}

/** What the PDF needs to know about the model (first part). */
export type PdfModel = Pick<PreviewModel, "size" | "maxDiameter">;

/** "Ohr ×2: 13 Runden, 138 Maschen je Teil" — one line of the parts overview. */
export function partOverviewLine(part: BuilderExport["parts"][number], index: number): string {
  const stitchRows = part.content.rows.filter((r) => r.ops.length > 0);
  const rounds = stitchRows.filter((r) => r.type === "round").length;
  const rows = stitchRows.length - rounds;
  const counts = [
    rounds > 0 && `${rounds} ${rounds === 1 ? "Runde" : "Runden"}`,
    rows > 0 && `${rows} ${rows === 1 ? "Reihe" : "Reihen"}`,
    `${partStitches(part.content).toLocaleString("de-DE")} Maschen${part.quantity > 1 ? " je Teil" : ""}`,
  ].filter(Boolean);
  return `${partHeading(part.name, part.quantity, index)}: ${counts.join(", ")}`;
}

/**
 * The PDF content for an export: labels, parts overview, rows per part, size from the model,
 * the assembly in words. `assembled`: the model (and image) is the assembled toy, not the
 * first part.
 */
export function pdfInput(exp: BuilderExport, model: PdfModel | null, image: PdfImage | null, assembled = false): PdfInput {
  const several = exp.parts.length > 1;
  const gauge = exp.overview.gauge;
  const size = model ? sizeLine({ ...model.size, maxDiameter: model.maxDiameter }) : null;
  const input: PdfInput = {
    title: exp.title,
    materials: (exp.overview.materials ?? []).map(materialLine).filter(Boolean),
    colors: paletteEntries(exp.overview.colors ?? []).map((c, i, all) => ({
      name: i === 0 && all.length > 1 ? `${c.name} (Anfangsfarbe)` : c.name,
      rgb: hexRgb(c.css),
    })),
    gauge: gaugeLine(gauge),
    // The model is the first part's (or the assembled toy); with several parts the line says so.
    size: size && several ? `${size} – ${assembled ? "zusammengesetzt" : partName(exp.parts[0]!.name, 0)}` : size,
    estimate: model ? estimateNote(gauge) : null,
    parts: exp.parts.map((part, i) => ({
      heading: several || part.quantity > 1 ? partHeading(part.name, part.quantity, i) : null,
      rows: renderedRows(part.content, "de", exp.overview.colors ?? []),
    })),
    image,
  };
  if (several) {
    input.overview = { lines: exp.parts.map(partOverviewLine), total: totalText(partsTotal(exp)) };
  }
  if (exp.overview.notes?.trim()) input.notes = exp.overview.notes;
  const assembly = assemblyLines(exp);
  if (assembly.length > 0) input.assembly = assembly;
  return input;
}

/** `#rrggbb` → [r, g, b] (0–255); grey for anything else. */
export function hexRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [136, 136, 136];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** Text widths from jsPDF's font metrics (mm). */
export function measureWith(pdf: JsPdf): TextMeasure {
  return (text, size, bold) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    return pdf.getTextWidth(text);
  };
}

/** Replay a layout into a fresh A4 document. */
export function renderPdf(JsPdfCtor: typeof JsPdf, input: PdfInput, opts: { compress?: boolean } = {}): { pdf: JsPdf; layout: PdfLayout } {
  const pdf = new JsPdfCtor({ unit: "mm", format: "a4", orientation: "portrait", compress: opts.compress ?? true });
  const layout = layoutPdf(input, measureWith(pdf));
  pdf.setProperties({ title: input.title || "Anleitung", creator: "CrochetBuilder", subject: "Häkelanleitung" });
  for (let p = 2; p <= layout.pages; p++) pdf.addPage("a4", "portrait");
  for (const cmd of layout.commands) {
    pdf.setPage(cmd.page);
    if (cmd.kind === "text") {
      const v = Math.round(cmd.gray * 255);
      pdf.setFont("helvetica", cmd.bold ? "bold" : "normal");
      pdf.setFontSize(cmd.size);
      pdf.setTextColor(v, v, v);
      pdf.text(cmd.text, cmd.x, cmd.y, { align: cmd.align });
    } else if (cmd.kind === "line") {
      const v = Math.round(cmd.gray * 255);
      pdf.setDrawColor(v, v, v);
      pdf.setLineWidth(0.2);
      pdf.line(cmd.x1, cmd.y1, cmd.x2, cmd.y2);
    } else if (cmd.kind === "swatch") {
      const v = Math.round(cmd.stroke * 255);
      pdf.setFillColor(...cmd.fill);
      pdf.setDrawColor(v, v, v);
      pdf.setLineWidth(0.2);
      pdf.roundedRect(cmd.x, cmd.y, cmd.w, cmd.h, 0.6, 0.6, "FD");
    } else {
      try {
        pdf.addImage(cmd.dataUrl, cmd.format, cmd.x, cmd.y, cmd.w, cmd.h);
      } catch (err) {
        console.warn("CrochetBuilder: Modellbild konnte nicht ins PDF übernommen werden.", err);
      }
    }
  }
  return { pdf, layout };
}

// ---------------------------------------------------------------------------
// Browser side: model, snapshot, download
// ---------------------------------------------------------------------------

/** Build the model of the first part once (Worker when available), with its colours. */
async function computeModel(exp: BuilderExport): Promise<PreviewModel | null> {
  const part = exp.parts[0];
  if (!part) return null;
  const client = createPreviewClient();
  const palette = (exp.overview.colors ?? []).map((c) => c.id);
  try {
    const result: PreviewResult | null = await client.compute({
      content: part.content,
      gauge: exp.overview.gauge,
      style: SNAPSHOT_STYLE,
      ...(palette.length > 0 ? { palette } : {}),
    });
    return result?.kind === "model" ? result.model : null;
  } finally {
    client.dispose();
  }
}

/** The assembled toy for the PDF image: one mesh, eyes and embroidery, its size. */
export interface AssembledModel {
  mesh: ViewMesh;
  spheres: ViewSphere[];
  size: { width: number; height: number; depth: number };
}

/**
 * The assembled toy from an assembly result: every drawn part (also parts sharing a mesh with
 * an earlier part, copies crocheted onto others), eyes and size; null when nothing is placed.
 */
export async function assembledFromResult(result: AssemblyResult | null): Promise<AssembledModel | null> {
  if (result?.kind !== "scene" || !result.scene.instances.some((i) => i.placement || i.joined)) return null;
  const [{ combineScene, sceneSize }, { sceneSpheres }, { meshesByPart, joinedMeshesOf }] = await Promise.all([
    import("../assembly/combine.js"),
    import("../assembly/spheres.js"),
    import("../assembly/compute.js"),
  ]);
  const combined = combineScene(result.scene, meshesByPart(result), joinedMeshesOf(result));
  const size = combined ? sceneSize(combined) : null;
  return combined && size ? { mesh: combined.mesh, spheres: sceneSpheres(combined), size } : null;
}

/**
 * Compute the assembled toy with the app's shared assembly client — the Montage view's
 * worker and its cache of relaxed parts; null when nothing is placed.
 */
async function computeAssembly(exp: BuilderExport): Promise<AssembledModel | null> {
  const { sharedAssemblyClient, computeAssembly: compute } = await import("../assembly/client.js");
  const result = await compute(sharedAssemblyClient(), { doc: exp, style: SNAPSHOT_STYLE, have: [] });
  return assembledFromResult(result);
}

/**
 * Render the model off screen at `SNAPSHOT_SIZE`, in the palette's colours (palette id → CSS,
 * see `paletteColors`), with the assembly's eyes and embroidery; null without WebGL or on any
 * failure.
 */
export async function snapshotModel(
  model: ViewMesh,
  colors: Readonly<Record<string, string>> = {},
  spheres: readonly ViewSphere[] = [],
): Promise<PdfImage | null> {
  try {
    const { createModelView } = await import("../three/modelView.js");
    const canvas = document.createElement("canvas");
    canvas.width = SNAPSHOT_SIZE.width;
    canvas.height = SNAPSHOT_SIZE.height;
    const view = createModelView(canvas, {
      style: { background: SNAPSHOT_BACKGROUND, showGrid: false, yarn: "#e7b48f", backing: SNAPSHOT_BACKING, colors },
      autoResize: false,
      maxPixelRatio: 1,
    });
    let dataUrl: string | null;
    try {
      view.setMesh(model);
      view.setSpheres(spheres);
      // Lossless first: the crop looks for the exact background colour.
      dataUrl = view.snapshot({ type: "image/png", ...SNAPSHOT_SIZE });
    } finally {
      view.dispose();
    }
    if (!dataUrl || !dataUrl.startsWith("data:image/")) return null;
    return await cropToModel(dataUrl, SNAPSHOT_SIZE);
  } catch (err) {
    console.warn("CrochetBuilder: PDF ohne Modellbild.", err);
    return null;
  }
}

export interface SavePdfDeps {
  loadJsPdf?: () => Promise<typeof JsPdf>;
  computeModel?: (exp: BuilderExport) => Promise<PreviewModel | null>;
  /** The assembled toy (patterns with placements); its image replaces the first part's. */
  computeAssembly?: (exp: BuilderExport) => Promise<AssembledModel | null>;
  snapshot?: (model: ViewMesh, colors: Readonly<Record<string, string>>, spheres?: readonly ViewSphere[]) => Promise<PdfImage | null>;
  save?: (blob: Blob, fileName: string) => void;
}

const loadJsPdf = async () => (await import("jspdf")).jsPDF;

/** Build the PDF of `doc` and offer it as a download. Resolves with the file name. */
export async function savePdf(doc: BuilderDoc, deps: SavePdfDeps = {}): Promise<string> {
  const exp = prepareExport(doc);
  const placed = (exp.assembly ?? []).some((p) => p.kind === "attach");
  const [JsPdfCtor, assembled] = await Promise.all([
    (deps.loadJsPdf ?? loadJsPdf)(),
    placed ? (deps.computeAssembly ?? computeAssembly)(exp).catch(() => null) : Promise.resolve(null),
  ]);
  const snapshot = deps.snapshot ?? snapshotModel;
  const colors = paletteColors(exp.overview.colors ?? []);
  let input: PdfInput;
  if (assembled) {
    const image = await snapshot(assembled.mesh, colors, assembled.spheres);
    input = pdfInput(exp, { size: assembled.size, maxDiameter: 0 }, image, true);
  } else {
    const model = await (deps.computeModel ?? computeModel)(exp).catch(() => null);
    const image = model ? await snapshot(model, colors) : null;
    input = pdfInput(exp, model, image);
  }
  const { pdf } = renderPdf(JsPdfCtor, input);
  const fileName = exportFileName(exp.title, "pdf");
  (deps.save ?? downloadBlob)(pdf.output("blob"), fileName);
  return fileName;
}
