/**
 * The builder's document: exactly a `BuilderExport` (docs/FORMAT.md). In the MVP it holds
 * one part (`parts[0]`, quantity 1).
 */

import type { BuilderExport, Op, Row } from "@crochetbuilder/engine";

export type BuilderDoc = BuilderExport;

/** A fresh, stable row id. Ids are created once and never regenerated on edit or reorder. */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback for non-secure contexts: RFC 4122 v4 from getRandomValues / Math.random.
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** An empty stitch row (round by default). */
export function emptyRow(id: string, type: Row["type"] = "round"): Row {
  return { id, type, ops: [], stitchCountTarget: 0 };
}

/** A free instruction row ("Augen einsetzen"): no stitches, just a note. */
export function instructionRow(id: string, type: Row["type"] = "round"): Row {
  return { id, type, ops: [], stitchCountTarget: 0, note: "" };
}

/** A new document with one empty round. */
export function emptyDocument(firstRowId: string = newId()): BuilderDoc {
  return {
    schemaVersion: 1,
    title: "",
    overview: { materials: [] },
    parts: [
      {
        name: "Teil 1",
        quantity: 1,
        content: { schemaVersion: 1, rows: [emptyRow(firstRowId)] },
      },
    ],
  };
}

const sc = (count: number): Op => ({ kind: "stitch", code: "SC", count });
const inc = (count: number): Op => ({ kind: "stitch", code: "INC", count });
const dec = (count: number): Op => ({ kind: "stitch", code: "DEC", count });
const times6 = (ops: Op[]): Op => ({ kind: "repeat", times: 6, ops });

/** The amigurumi sphere of docs/FORMAT.md, with fresh row ids. */
export function demoDocument(makeId: () => string = newId): BuilderDoc {
  const rounds: Array<[Op[], number]> = [
    [[{ kind: "stitch", code: "MR", count: 1 }, sc(6)], 6],
    [[inc(6)], 12],
    [[times6([sc(1), inc(1)])], 18],
    [[times6([sc(2), inc(1)])], 24],
    [[sc(24)], 24],
    [[times6([sc(2), dec(1)])], 18],
    [[times6([sc(1), dec(1)])], 12],
    [[dec(6)], 6],
  ];
  return {
    schemaVersion: 1,
    title: "Amigurumi-Kugel",
    overview: {
      materials: [
        { kind: "yarn", label: "Baumwollgarn DK", colors: ["Weiß"], amount: "ca. 10 g" },
        { kind: "hook", label: "Häkelnadel 3 mm" },
        { kind: "accessory", label: "Füllwatte" },
      ],
      gauge: { yarnWeight: "dk", hookMm: 3 },
      notes: "In Spiralrunden häkeln. Vor Runde 8 füllen.",
    },
    parts: [
      {
        name: "Kugel",
        quantity: 1,
        content: {
          schemaVersion: 1,
          rows: rounds.map(([ops, target]) => ({
            id: makeId(),
            type: "round" as const,
            ops,
            stitchCountTarget: target,
          })),
        },
      },
    ],
  };
}
