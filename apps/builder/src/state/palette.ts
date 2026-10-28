/**
 * Colours of the pattern (format v2) as the app handles them: the palette lives in
 * `overview.colors`, rows switch colour with `Row.color`, stitches with `StitchOp.color`; a
 * switch holds until the next one, the work starts in the first palette colour (E21).
 *
 * Pure helpers — no React, no Three — shared by the editor, the 3D view, the PDF and the
 * viewer: display colours, new ids, where a colour is used, the colour at the start of every
 * row and the edits that remove a colour.
 */

import { expandRow, type Op, type PaletteColor, type Row } from "@crochetbuilder/engine";
import type { BuilderDoc } from "./document.js";

/** Built-in colour names offered when adding a colour (German, with a display colour). */
export const COLOR_SUGGESTIONS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Weiß", hex: "#f7f5f0" },
  { name: "Schwarz", hex: "#262626" },
  { name: "Grau", hex: "#9a9a9e" },
  { name: "Braun", hex: "#7b5034" },
  { name: "Beige", hex: "#d8c3a0" },
  { name: "Creme", hex: "#f1e6c8" },
  { name: "Rosa", hex: "#f2aec3" },
  { name: "Rot", hex: "#d43d3d" },
  { name: "Orange", hex: "#ee8a2e" },
  { name: "Gelb", hex: "#f3cf45" },
  { name: "Grün", hex: "#4f9a4a" },
  { name: "Mint", hex: "#a6dec6" },
  { name: "Blau", hex: "#3b6fc4" },
  { name: "Hellblau", hex: "#9cc8ee" },
  { name: "Lila", hex: "#8d5fb8" },
];

/** More names that map to a display colour when a palette entry has no `hex`. */
const NAME_ALIASES: Record<string, string> = {
  natur: "Creme",
  ecru: "Creme",
  hellgrau: "Grau",
  dunkelgrau: "Schwarz",
  pink: "Rosa",
  altrosa: "Rosa",
  violett: "Lila",
  türkis: "Mint",
  hellgrün: "Mint",
  dunkelblau: "Blau",
  white: "Weiß",
  black: "Schwarz",
  grey: "Grau",
  gray: "Grau",
  brown: "Braun",
  cream: "Creme",
  red: "Rot",
  yellow: "Gelb",
  green: "Grün",
  blue: "Blau",
  purple: "Lila",
};

/** Display colours for palette entries without `hex` and an unknown name, by position. */
const FALLBACK_COLORS = ["#e7b48f", "#7aa6c2", "#b9d58c", "#d99ab8", "#c9b27c", "#9b8cc9", "#e3cf7a", "#8fc7b5"];

const key = (s: string) => s.trim().toLowerCase();

/** The built-in suggestion for a colour name ("weiß", "Natur" …), if any. */
export function suggestionFor(name: string): { name: string; hex: string } | undefined {
  const k = key(name);
  if (!k) return undefined;
  const direct = COLOR_SUGGESTIONS.find((s) => key(s.name) === k);
  if (direct) return direct;
  const alias = NAME_ALIASES[k];
  return alias ? COLOR_SUGGESTIONS.find((s) => s.name === alias) : undefined;
}

/** The display colour (`#rrggbb`) of a palette entry: its `hex`, else from its name, else by position. */
export function colorCss(color: Pick<PaletteColor, "name" | "hex">, index: number): string {
  if (color.hex && /^#[0-9a-f]{6}$/i.test(color.hex)) return color.hex.toLowerCase();
  return suggestionFor(color.name)?.hex ?? FALLBACK_COLORS[((index % FALLBACK_COLORS.length) + FALLBACK_COLORS.length) % FALLBACK_COLORS.length]!;
}

/** Display colour of every palette entry, in palette order. */
export function paletteCss(palette: readonly Pick<PaletteColor, "name" | "hex">[]): string[] {
  return palette.map((c, i) => colorCss(c, i));
}

/**
 * Display colour by palette id (what the 3D view looks colours up by); the first entry wins
 * for a duplicate id, as in the engine's colouring.
 */
export function paletteColors(palette: readonly PaletteColor[]): Record<string, string> {
  const out = Object.create(null) as Record<string, string>; // ids like "__proto__" stay plain keys
  palette.forEach((c, i) => {
    if (!Object.prototype.hasOwnProperty.call(out, c.id)) out[c.id] = colorCss(c, i);
  });
  return out;
}

/** Shown name of a palette entry ("Farbe 2" while it has none). */
export function colorName(color: Pick<PaletteColor, "name"> | undefined, index: number): string {
  return color?.name.trim() || `Farbe ${index + 1}`;
}

/** Every colour id the parts refer to (rows and stitches), in or outside the palette. */
export function usedColorIds(doc: BuilderDoc): Set<string> {
  const ids = new Set<string>();
  const visit = (ops: readonly Op[]) => {
    for (const op of ops) {
      if (op.kind === "stitch") {
        if (op.color !== undefined) ids.add(op.color);
      } else visit(op.ops);
    }
  };
  for (const part of doc.parts) {
    for (const row of part.content.rows) {
      if (row.color !== undefined) ids.add(row.color);
      visit(row.ops);
    }
  }
  return ids;
}

/**
 * A readable, unused id for a new colour: the name as a slug ("Weiß" → "weiss", "Hell Blau"
 * → "hell-blau"), "farbe" without a usable name; "-2", "-3" … when taken by the palette or by
 * a reference in the parts (an id that is not in the palette must not be adopted by accident).
 */
export function newColorId(name: string, doc: BuilderDoc): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24)
      .replace(/-+$/g, "") || "farbe";
  const taken = usedColorIds(doc);
  for (const c of doc.overview.colors ?? []) taken.add(c.id);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** A name for a new colour: the first built-in name not in the palette yet. */
export function nextSuggestion(palette: readonly PaletteColor[]): { name: string; hex: string } {
  const used = new Set(palette.map((c) => key(c.name)));
  return COLOR_SUGGESTIONS.find((s) => !used.has(key(s.name))) ?? { name: `Farbe ${palette.length + 1}`, hex: FALLBACK_COLORS[0]! };
}

/**
 * Why a palette name cannot be used, or null: square brackets would break the colour marks of
 * the row text (`[Farbe: …]`), and a name another colour has (case-insensitive) would read back
 * ambiguously. `exceptId`: the colour being renamed. An empty name is allowed ("Farbe n").
 */
export function colorNameProblem(name: string, palette: readonly PaletteColor[], exceptId?: string): string | null {
  if (/[[\]]/.test(name)) return "Ohne eckige Klammern, bitte.";
  const k = key(name);
  if (k && palette.some((c) => c.id !== exceptId && key(c.name) === k)) return "Diesen Namen hat schon eine andere Farbe.";
  return null;
}

/** How many rows use a colour, and what they are: "Runden", "Reihen" or both. */
export interface ColorUsage {
  count: number;
  /** "2 Runden", "1 Reihe", "3 Runden/Reihen". */
  text: string;
}

/**
 * The rows of the document (all parts) that use colour `id`: rows that switch to it, at the row
 * or at a stitch — and for the start colour (palette index 0) also the stitch rows each part
 * works in it before its first colour change.
 */
export function colorUsage(doc: BuilderDoc, id: string): ColorUsage {
  const usesOps = (ops: readonly Op[]): boolean =>
    ops.some((op) => (op.kind === "stitch" ? op.color === id : usesOps(op.ops)));
  const start = doc.overview.colors?.[0]?.id === id;
  let rounds = 0;
  let rows = 0;
  for (const part of doc.parts) {
    let implicit = start;
    for (const row of part.content.rows) {
      if (row.color !== undefined) implicit = false;
      const uses = row.color === id || usesOps(row.ops) || (implicit && row.ops.length > 0);
      if (opsChangeColor(row.ops)) implicit = false;
      if (!uses) continue;
      if (row.type === "row") rows++;
      else rounds++;
    }
  }
  const count = rounds + rows;
  const word = rows === 0 ? (count === 1 ? "Runde" : "Runden") : rounds === 0 ? (count === 1 ? "Reihe" : "Reihen") : "Runden/Reihen";
  return { count, text: `${count} ${word}` };
}

/** `ops` with every switch to `from` changed to `to`, or removed (`to` undefined). Same array when unchanged. */
export function replaceColorInOps(ops: Op[], from: string, to: string | undefined): Op[] {
  let changed = false;
  const next = ops.map((op): Op => {
    if (op.kind === "stitch") {
      if (op.color !== from) return op;
      changed = true;
      const copy = { ...op };
      if (to === undefined) delete copy.color;
      else copy.color = to;
      return copy;
    }
    const inner = replaceColorInOps(op.ops, from, to);
    if (inner === op.ops) return op;
    changed = true;
    return { ...op, ops: inner } as Op;
  });
  return changed ? next : ops;
}

/** `row` with its switches to `from` changed to `to` or removed; the same object when unchanged. */
export function replaceColorInRow(row: Row, from: string, to: string | undefined): Row {
  const ops = replaceColorInOps(row.ops, from, to);
  const rowHit = row.color === from;
  if (ops === row.ops && !rowHit) return row;
  const next: Row = { ...row, ops };
  if (rowHit) {
    if (to === undefined) delete next.color;
    else next.color = to;
  }
  return next;
}

/** The colour at the start of a row as the row card's chip shows it. */
export interface RowColor {
  /** Palette id in effect at the start of the row (after its own change); undefined without a palette. */
  id: string | undefined;
  /** The row changes colour itself (`Row.color` is set). */
  changed: boolean;
  /** The row's own colour is not in the palette (shown as such, ignored for colouring, E22). */
  unknown: boolean;
  /** The colour the work is in just before the row (what "no change" continues with). */
  before: string | undefined;
}

/**
 * The working colour at the start of every row (`rows` of one part, in order): the first
 * palette colour until a row or a stitch switches, as `colorsOfStitches` resolves it.
 */
export function rowStartColors(rows: readonly Row[], palette: readonly Pick<PaletteColor, "id">[]): RowColor[] {
  const known = new Set(palette.map((c) => c.id));
  let current = palette[0]?.id;
  return rows.map((row) => {
    const before = current;
    const own = row.color;
    const unknown = own !== undefined && !known.has(own);
    if (own !== undefined && !unknown) current = own;
    const start: RowColor = { id: current, changed: own !== undefined, unknown, before };
    for (const atom of expandRow(row)) {
      if (atom.color !== undefined && known.has(atom.color)) current = atom.color;
    }
    return start;
  });
}

/**
 * `next` with every entry that equals the one at the same place in `prev` replaced by that
 * old object, so memoised row cards whose colour did not change see the same prop.
 */
export function reuseRowColors(next: RowColor[], prev: readonly RowColor[] | null): RowColor[] {
  if (!prev) return next;
  return next.map((c, i) => {
    const old = prev[i];
    return old && old.id === c.id && old.changed === c.changed && old.unknown === c.unknown && old.before === c.before ? old : c;
  });
}

/** Whether `ops` switch colour anywhere (a stitch with `color`). */
export function opsChangeColor(ops: readonly Op[]): boolean {
  return ops.some((op) => (op.kind === "stitch" ? op.color !== undefined : opsChangeColor(op.ops)));
}

/**
 * Colours written in a row's text that are not in the palette yet ("[Farbe: Mint]") become
 * palette entries: returns the new entries (name as written, built-in display colour if the
 * name is known) and the ops / row colour with the written names replaced by the new ids.
 * Names that match a palette entry were already resolved by the parser.
 *
 * The first palette colour is the one every part starts in. With an empty palette, a colour
 * written anywhere but as the row colour of a part's first stitch row would become that start
 * colour and colour the rows before it too; so unless `startsPart` (the row is the part's first
 * stitch row and its own colour comes first), a start colour is added before it: "Weiß", or
 * "Grundfarbe" when "Weiß" is among the colours written.
 */
export function adoptWrittenColors(
  ops: Op[],
  rowColor: string | undefined,
  doc: BuilderDoc,
  startsPart = false,
): { ops: Op[]; color: string | undefined; added: PaletteColor[] } {
  const palette = doc.overview.colors ?? [];
  const known = new Set(palette.map((c) => c.id));
  const added: PaletteColor[] = [];
  const idFor = new Map<string, string>();
  // Ids taken so far: the document's plus the ones handed out here.
  let scratch: BuilderDoc = doc;
  const push = (entry: PaletteColor) => {
    added.push(entry);
    scratch = { ...scratch, overview: { ...scratch.overview, colors: [...(scratch.overview.colors ?? []), entry] } };
  };
  const needsStart = palette.length === 0 && !(startsPart && rowColor !== undefined);
  const adopt = (written: string): string => {
    if (known.has(written)) return written;
    const k = key(written);
    const existing = idFor.get(k);
    if (existing) return existing;
    if (needsStart && added.length === 0) {
      const writesWhite = [rowColor, ...writtenColors(ops)].some((w) => w !== undefined && key(w) === key("Weiß"));
      const name = writesWhite ? "Grundfarbe" : "Weiß";
      push({ id: newColorId(name, scratch), name, hex: writesWhite ? FALLBACK_COLORS[0]! : suggestionFor("Weiß")!.hex });
    }
    const id = newColorId(written, scratch);
    const hint = suggestionFor(written);
    push(hint ? { id, name: written.trim(), hex: hint.hex } : { id, name: written.trim() });
    idFor.set(k, id);
    return id;
  };
  const walk = (list: Op[]): Op[] =>
    list.map((op): Op => {
      if (op.kind === "stitch") return op.color === undefined || known.has(op.color) ? op : { ...op, color: adopt(op.color) };
      return { ...op, ops: walk(op.ops) } as Op;
    });
  const color = rowColor === undefined ? undefined : adopt(rowColor);
  const unknown = (list: readonly Op[]): boolean =>
    list.some((op) => (op.kind === "stitch" ? op.color !== undefined && !known.has(op.color) : unknown(op.ops)));
  return { ops: unknown(ops) ? walk(ops) : ops, color, added };
}

/** Colour ids / names written on the stitches of `ops`, in order. */
function writtenColors(ops: readonly Op[]): string[] {
  return ops.flatMap((op) => (op.kind === "stitch" ? (op.color === undefined ? [] : [op.color]) : writtenColors(op.ops)));
}
