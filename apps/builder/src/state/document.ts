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
const ch = (count: number): Op => ({ kind: "stitch", code: "CH", count });
const times6 = (ops: Op[]): Op => ({ kind: "repeat", times: 6, ops });

/** The demo patterns of the "Demo laden" menu. */
export type DemoKind = "sphere" | "ball" | "potholder";

export const DEMOS: ReadonlyArray<{ kind: DemoKind; label: string; description: string }> = [
  { kind: "sphere", label: "Kugel", description: "Amigurumi-Kugel aus docs/FORMAT.md, 8 Runden" },
  { kind: "ball", label: "Ball", description: "Klassischer Ball mit vier glatten Runden, 11 Runden" },
  { kind: "potholder", label: "Topflappen", description: "Flaches Rechteck in Reihen, 20 × 20 Maschen" },
];

type Rows = Array<[Op[], number]>;

const INCREASES: Rows = [
  [[{ kind: "stitch", code: "MR", count: 1 }, sc(6)], 6],
  [[inc(6)], 12],
  [[times6([sc(1), inc(1)])], 18],
  [[times6([sc(2), inc(1)])], 24],
];
const DECREASES: Rows = [
  [[times6([sc(2), dec(1)])], 18],
  [[times6([sc(1), dec(1)])], 12],
  [[dec(6)], 6],
];

interface DemoSpec {
  title: string;
  partName: string;
  type: Row["type"];
  rows: Rows;
  overview: BuilderDoc["overview"];
}

const AMIGURUMI_MATERIALS: BuilderDoc["overview"]["materials"] = [
  { kind: "yarn", label: "Baumwollgarn DK", colors: ["Weiß"], amount: "ca. 10 g" },
  { kind: "hook", label: "Häkelnadel 3 mm" },
  { kind: "accessory", label: "Füllwatte" },
];

const DEMO_SPECS: Record<DemoKind, DemoSpec> = {
  sphere: {
    title: "Amigurumi-Kugel",
    partName: "Kugel",
    type: "round",
    rows: [...INCREASES, [[sc(24)], 24], ...DECREASES],
    overview: {
      materials: AMIGURUMI_MATERIALS,
      gauge: { yarnWeight: "dk", hookMm: 3 },
      notes: "In Spiralrunden häkeln. Vor Runde 8 füllen.",
    },
  },
  ball: {
    title: "Amigurumi-Ball",
    partName: "Ball",
    type: "round",
    rows: [...INCREASES, ...Array.from({ length: 4 }, (): [Op[], number] => [[sc(24)], 24]), ...DECREASES],
    overview: {
      materials: AMIGURUMI_MATERIALS,
      gauge: { yarnWeight: "dk", hookMm: 3 },
      notes: "In Spiralrunden häkeln. Vor Runde 11 fest füllen.",
    },
  },
  potholder: {
    title: "Topflappen",
    partName: "Topflappen",
    type: "row",
    rows: [
      // A foundation chain produces no stitches of its own (target 0); every row starts
      // with its turning chain.
      [[ch(20)], 0],
      ...Array.from({ length: 20 }, (): [Op[], number] => [[ch(1), sc(20)], 20]),
    ],
    overview: {
      materials: [
        { kind: "yarn", label: "Baumwollgarn Worsted", colors: ["Natur"], amount: "ca. 40 g" },
        { kind: "hook", label: "Häkelnadel 5 mm" },
      ],
      gauge: { yarnWeight: "worsted", hookMm: 5 },
      notes: "Luftmaschenkette, dann in Reihen häkeln; jede Reihe mit 1 Wende-Luftmasche beginnen.",
    },
  },
};

/** A demo pattern (default: the amigurumi sphere of docs/FORMAT.md), with fresh row ids. */
export function demoDocument(makeId: () => string = newId, kind: DemoKind = "sphere"): BuilderDoc {
  const spec = DEMO_SPECS[kind];
  return {
    schemaVersion: 1,
    title: spec.title,
    overview: structuredClone(spec.overview),
    parts: [
      {
        name: spec.partName,
        quantity: 1,
        content: {
          schemaVersion: 1,
          rows: spec.rows.map(([ops, target]) => ({
            id: makeId(),
            type: spec.type,
            ops: structuredClone(ops),
            stitchCountTarget: target,
          })),
        },
      },
    ],
  };
}
