/**
 * Colours (format v2) — which yarn colour every stitch is worked in.
 *
 * The palette lives in the builder export (`overview.colors`); a part only switches between
 * its ids: `Row.color` at the start of a row, `StitchOp.color` at an op. A switch holds until
 * the next one, across rows, as "change to white" does in a written pattern. Before the first
 * switch the work is in the palette's first colour.
 *
 * Pure functions, no UI or framework imports.
 */

import { expandRow } from "./expand.js";
import type { StitchGraph } from "./graph.js";
import type { PartContent } from "./schema.js";

/** What colour resolution needs of a palette entry. */
export interface PaletteEntry {
  id: string;
}

/**
 * The working colour of every atom of `expandPart(content)` (same order and length; a free
 * instruction gets the colour in effect there).
 *
 * With a `palette`, the result holds palette ids only: the work starts in the first colour and
 * switches to ids that are not in the palette are ignored (`validate` reports them as
 * `UNKNOWN_COLOR`); an empty palette gives `undefined` everywhere. Without a palette the ids
 * are taken as written and the work starts without a colour (`undefined`).
 */
export function colorsOfStitches(content: PartContent, palette?: readonly PaletteEntry[]): Array<string | undefined> {
  const known = palette ? new Set(palette.map((c) => c.id)) : null;
  const accept = (id: string | undefined): id is string => id !== undefined && (!known || known.has(id));
  let current: string | undefined = palette?.[0]?.id;
  const out: Array<string | undefined> = [];
  for (const row of content.rows) {
    if (accept(row.color)) current = row.color;
    for (const atom of expandRow(row)) {
      if (accept(atom.color)) current = atom.color;
      out.push(current);
    }
  }
  return out;
}

/**
 * Palette index of the working colour of every graph node (`graph` built from `content`), for
 * `toMesh({ nodeColors })`. 0 where no colour applies (an empty palette).
 */
export function nodeColorIndices(graph: StitchGraph, content: PartContent, palette: readonly PaletteEntry[]): Uint16Array {
  const index = new Map<string, number>();
  palette.forEach((c, i) => {
    if (!index.has(c.id)) index.set(c.id, i); // a duplicate id resolves to its first entry
  });
  const atoms = colorsOfStitches(content, palette);
  const out = new Uint16Array(graph.nodes.length);
  graph.nodes.forEach((node, i) => {
    const id = atoms[node.globalIndex];
    out[i] = id !== undefined ? (index.get(id) ?? 0) : 0;
  });
  return out;
}
