/**
 * PDF layout as a pure function: pattern data in, a list of drawing commands (per page, in
 * millimetres) out. `pdf.ts` replays the commands with jsPDF; tests inspect them directly.
 *
 * A4 portrait: title, model image, materials, size basis and finished size, notes, then every
 * row as text with page breaks; a footer "Erstellt mit CrochetBuilder" and "Seite n von N"
 * on every page.
 */

/** jsPDF's standard fonts encode text as WinAnsi (cp1252). */
const CP1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

const REPLACEMENTS: Record<string, string> = {
  "‐": "-", // hyphen
  "‑": "-", // non-breaking hyphen
  "‒": "–",
  "―": "—",
  "−": "-", // minus
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "⇒": "=>",
  "≈": "~",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  " ": " ",
  " ": " ",
  "′": "'",
  "″": '"',
  "‟": "“",
  "‛": "‘",
  "✓": "x",
  "✗": "x",
  "✕": "x",
};

/**
 * Text that jsPDF's standard fonts can show: Latin-1 and the cp1252 extras (umlauts, ß, ×,
 * –, „ “, €, …) pass unchanged; a few symbols get ASCII stand-ins, accented letters lose
 * their accent, anything else (emoji, CJK) becomes "?". Control characters become spaces.
 */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 0x09 || code === 0x0a || code === 0x0d) out += " ";
    else if (code < 0x20 || (code >= 0x7f && code < 0xa0)) out += " ";
    else if (code < 0x100 || CP1252_EXTRA.includes(ch)) out += ch;
    else if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
    else {
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += base.length > 0 && [...base].every((c) => c.codePointAt(0)! < 0x100) ? base : "?";
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

export interface PdfImage {
  /** `data:image/jpeg;base64,…` or PNG. */
  dataUrl: string;
  /** Pixel size (for the aspect ratio). */
  width: number;
  height: number;
}

export interface PdfInput {
  title: string;
  /** Material lines, already formatted ("Garn: …"). */
  materials: string[];
  /** Size basis ("Garn: DK (leicht) · Nadel: 3 mm"). */
  gauge: string;
  /** Finished size line, or null without a model. */
  size: string | null;
  /** Why the size is an estimate, or null. */
  estimate: string | null;
  notes?: string;
  parts: Array<{ heading: string | null; rows: string[] }>;
  image: PdfImage | null;
}

export type PdfCommand =
  | { kind: "text"; page: number; x: number; y: number; text: string; size: number; bold: boolean; gray: number; align: "left" | "right" }
  | { kind: "image"; page: number; x: number; y: number; w: number; h: number; dataUrl: string; format: "JPEG" | "PNG" }
  | { kind: "line"; page: number; x1: number; y1: number; x2: number; y2: number; gray: number };

export interface PdfLayout {
  pages: number;
  commands: PdfCommand[];
}

/** Width of `text` in mm at `size` pt (bold or regular Helvetica). */
export type TextMeasure = (text: string, size: number, bold: boolean) => number;

export const PAGE = { width: 210, height: 297, margin: 18, footerY: 286, bottom: 276 } as const;
const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin;
/** The model image (cropped to the model) is printed at most this large, centred. */
export const IMAGE_MAX = { w: 70, h: 70 } as const;
const PT = 0.3528; // mm per point

/** Baseline-to-baseline distance in mm for a font size in pt. */
const lineHeight = (size: number) => size * PT * 1.4;

export const FOOTER_TEXT = "Erstellt mit CrochetBuilder";

/**
 * Greedy word wrap. Words longer than the width are broken by characters. Returns at least
 * one (possibly empty) line.
 */
export function wrapText(text: string, width: number, measure: (t: string) => number): string[] {
  const words = text.split(/ +/).filter((w, i, all) => w !== "" || all.length === 1);
  const lines: string[] = [];
  let line = "";
  const pushWord = (word: string) => {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= width) {
      line = candidate;
      return;
    }
    if (line) lines.push(line);
    line = "";
    // A word wider than a line: break it.
    let rest = word;
    while (measure(rest) > width && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut)) > width) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  };
  for (const word of words) pushWord(word);
  lines.push(line);
  return lines;
}

/** Lay out the pattern; deterministic for a given input and measure. */
export function layoutPdf(input: PdfInput, measure: TextMeasure): PdfLayout {
  const commands: PdfCommand[] = [];
  let page = 1;
  let y = PAGE.margin;

  const newPage = () => {
    page++;
    y = PAGE.margin;
  };
  const ensure = (height: number) => {
    if (y + height > PAGE.bottom && y > PAGE.margin) newPage();
  };

  /** A wrapped paragraph; continuation lines are indented by `hang` mm. Kept on one page. */
  const paragraph = (raw: string, size: number, opts: { bold?: boolean; gray?: number; hang?: number; after?: number } = {}) => {
    const bold = opts.bold ?? false;
    const hang = opts.hang ?? 0;
    const text = toWinAnsi(raw);
    const m = (t: string) => measure(t, size, bold);
    const first = wrapText(text, CONTENT_WIDTH, m);
    // Re-wrap the continuation with the hanging indent.
    const lines = hang > 0 && first.length > 1 ? [first[0]!, ...wrapText(first.slice(1).join(" "), CONTENT_WIDTH - hang, m)] : first;
    const lh = lineHeight(size);
    ensure(lines.length * lh);
    lines.forEach((line, i) => {
      ensure(lh); // only for a paragraph taller than a page
      y += lh;
      commands.push({
        kind: "text",
        page,
        x: PAGE.margin + (i > 0 ? hang : 0),
        y: y - lh * 0.25,
        text: line,
        size,
        bold,
        gray: opts.gray ?? 0,
        align: "left",
      });
    });
    y += opts.after ?? 0;
  };

  /** Section heading; kept together with at least two lines of what follows. */
  const heading = (text: string) => {
    y += 4;
    ensure(lineHeight(12) + 2 * lineHeight(10.5));
    paragraph(text, 12, { bold: true, after: 1.5 });
  };

  // Title
  paragraph(input.title.trim() || "Anleitung", 20, { bold: true, after: 4 });

  // Model image, centred.
  if (input.image && input.image.width > 0 && input.image.height > 0) {
    const scale = Math.min(IMAGE_MAX.w / input.image.width, IMAGE_MAX.h / input.image.height);
    const w = input.image.width * scale;
    const h = input.image.height * scale;
    ensure(h);
    commands.push({
      kind: "image",
      page,
      x: PAGE.margin + (CONTENT_WIDTH - w) / 2,
      y,
      w,
      h,
      dataUrl: input.image.dataUrl,
      format: /^data:image\/png/i.test(input.image.dataUrl) ? "PNG" : "JPEG",
    });
    y += h + 4;
  }

  const materials = input.materials.filter((m) => m.trim() !== "");
  if (materials.length > 0) {
    heading("Material");
    for (const m of materials) paragraph(`• ${m}`, 10.5, { hang: 3 });
  }

  heading("Größe");
  paragraph(input.gauge, 10.5, { hang: 4 });
  if (input.size) paragraph(`Fertige Größe: ${input.size}`, 10.5, { hang: 4 });
  if (input.estimate) paragraph(input.estimate, 9, { gray: 0.4 });

  const notes = input.notes?.trim();
  if (notes) {
    heading("Hinweise");
    for (const line of notes.split(/\r?\n/)) {
      if (line.trim() === "") y += lineHeight(10.5) * 0.5;
      else paragraph(line, 10.5);
    }
  }

  heading("Anleitung");
  const rowCount = input.parts.reduce((n, p) => n + p.rows.length, 0);
  if (rowCount === 0) paragraph("Noch keine Reihen.", 10.5, { gray: 0.4 });
  for (const part of input.parts) {
    if (part.heading) {
      y += 2;
      ensure(lineHeight(11) + lineHeight(10.5));
      paragraph(part.heading, 11, { bold: true, after: 1 });
    }
    for (const row of part.rows) paragraph(row, 10.5, { hang: 6, after: 0.8 });
  }

  // Footer on every page.
  const pages = page;
  for (let p = 1; p <= pages; p++) {
    commands.push({ kind: "line", page: p, x1: PAGE.margin, y1: PAGE.footerY - 5, x2: PAGE.width - PAGE.margin, y2: PAGE.footerY - 5, gray: 0.8 });
    commands.push({ kind: "text", page: p, x: PAGE.margin, y: PAGE.footerY, text: FOOTER_TEXT, size: 8, bold: false, gray: 0.45, align: "left" });
    commands.push({
      kind: "text",
      page: p,
      x: PAGE.width - PAGE.margin,
      y: PAGE.footerY,
      text: `Seite ${p} von ${pages}`,
      size: 8,
      bold: false,
      gray: 0.45,
      align: "right",
    });
  }
  return { pages, commands };
}
