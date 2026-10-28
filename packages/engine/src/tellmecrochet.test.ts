import { describe, expect, it } from "vitest";
import type { Placement } from "./assembly.js";
import { BuilderExportSchema, type BuilderExport, type BuilderPart, type Material, type PaletteColor } from "./export.js";
import type { Gauge } from "./gauge.js";
import { renderRow } from "./notation.js";
import { createRandom } from "./random.js";
import type { GroupOp, Op, Row, StitchCode } from "./schema.js";
import { encodeShare, MAX_SHARE_CHARS, ShareDecodeError } from "./share.js";
import {
  buildTmcImportUrl,
  decodeTmcPayload,
  describePlacement,
  encodeTmcPayload,
  gaugeText,
  summarizeTmcLosses,
  TMC_IMPORT_URL,
  TmcDraftSchema,
  TmcEnvelopeSchema,
  toTellmeCrochetDraft,
  toTmcEnvelope,
  type TmcDraft,
  type TmcRow,
} from "./tellmecrochet.js";

const st = (code: StitchCode, count: number, extra: Partial<Extract<Op, { kind: "stitch" }>> = {}): Extract<Op, { kind: "stitch" }> => ({
  kind: "stitch",
  code,
  count,
  ...extra,
});
const sc = (n: number) => st("SC", n);
const inc = (n: number) => st("INC", n);
const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });
const round = (id: string, ops: Op[], target: number, extra: Partial<Row> = {}): Row => ({
  id,
  type: "round",
  ops,
  stitchCountTarget: target,
  ...extra,
});

function doc(parts: BuilderPart[], extra: Partial<BuilderExport> = {}): BuilderExport {
  return BuilderExportSchema.parse({ schemaVersion: 2, title: "Test", overview: {}, parts, ...extra });
}
const part = (rows: Row[], extra: Partial<BuilderPart> & Partial<{ finish: "open" | "gather" | "flat"; stuffing: "none" | "light" | "firm" }> = {}): BuilderPart => {
  const { finish, stuffing, ...rest } = extra;
  return {
    name: "Kugel",
    quantity: 1,
    content: { schemaVersion: 2, rows, ...(finish ? { finish } : {}), ...(stuffing ? { stuffing } : {}) },
    ...rest,
  };
};

const SPHERE: Row[] = [
  round("r1", [st("MR", 1), sc(6)], 6),
  round("r2", [inc(6)], 12),
  round("r3", [rep(6, [sc(1), inc(1)])], 18),
  round("r4", [sc(18)], 18),
];

const rowsOf = (draft: TmcDraft, part = 0): TmcRow[] => draft.parts[part]!.content.rows;
const notes = (draft: TmcDraft, part = 0) => rowsOf(draft, part).map((r) => r.note ?? "");

// ---------------------------------------------------------------------------

describe("TmcDraftSchema", () => {
  const valid: TmcDraft = {
    schemaVersion: 1,
    parts: [
      {
        name: "Kopf",
        quantity: 1,
        content: { schemaVersion: 1, rows: [{ id: "a", type: "round", ops: [{ kind: "stitch", code: "SC", count: 6 }], stitchCountTarget: 6 }] },
        stitchCheck: [{ rowId: "a", expected: 6, actual: 6, ok: true }],
      },
    ],
  };

  it("accepts the documented shape", () => {
    expect(TmcDraftSchema.safeParse(valid).success).toBe(true);
  });

  it("is strict about version 1: no new codes, modifiers, groups, colours or extra fields", () => {
    const withRow = (row: unknown) => ({ ...valid, parts: [{ ...valid.parts[0]!, content: { schemaVersion: 1, rows: [row] } }] });
    const base = rowsOf(valid)[0]!;
    expect(TmcDraftSchema.safeParse(withRow({ ...base, ops: [{ kind: "stitch", code: "BOBBLE", count: 1 }] })).success).toBe(false);
    expect(TmcDraftSchema.safeParse(withRow({ ...base, ops: [{ kind: "stitch", code: "DC", count: 1, modifiers: ["FP"] }] })).success).toBe(false);
    expect(TmcDraftSchema.safeParse(withRow({ ...base, ops: [{ kind: "group", ops: [] }] })).success).toBe(false);
    expect(TmcDraftSchema.safeParse(withRow({ ...base, color: "c1" })).success).toBe(false);
    expect(TmcDraftSchema.safeParse(withRow({ ...base, ops: [{ kind: "stitch", code: "SC", count: 1, color: "c1" }] })).success).toBe(false);
    expect(TmcDraftSchema.safeParse({ ...valid, schemaVersion: 2 }).success).toBe(false);
    expect(TmcDraftSchema.safeParse({ ...valid, overview: {} }).success).toBe(false);
    expect(TmcDraftSchema.safeParse({ ...valid, parts: [] }).success).toBe(false);
    expect(TmcDraftSchema.safeParse({ ...valid, parts: [{ ...valid.parts[0]!, name: "" }] }).success).toBe(false);
    expect(TmcDraftSchema.safeParse({ ...valid, parts: [{ ...valid.parts[0]!, content: { schemaVersion: 1, rows: [{ ...base, id: "" }] } }] }).success).toBe(false);
    expect(TmcDraftSchema.safeParse({ ...valid, materials: [{ kind: "yarn", label: "" }] }).success).toBe(false);
    expect(TmcDraftSchema.safeParse({ ...valid, materials: [{ kind: "yarn", label: "x", colors: [""] }] }).success).toBe(false);
    expect(TmcDraftSchema.safeParse({ ...valid, materials: [{ kind: "yarn", label: "x", amount: "" }] }).success).toBe(false);
  });

  it("envelope: format, version, notation and origin hint are fixed vocabularies", () => {
    const env = toTmcEnvelope(valid, "self_created");
    expect(env).toEqual({ format: "tmc-draft", version: 1, sourceNotation: "de", originHint: "self_created", draft: valid });
    expect(toTmcEnvelope(valid, "imported").originHint).toBe("imported");
    expect(TmcEnvelopeSchema.safeParse({ ...env, originHint: "bought" }).success).toBe(false);
    expect(TmcEnvelopeSchema.safeParse({ ...env, originHint: undefined }).success).toBe(false);
    const { originHint: _hint, ...withoutHint } = env;
    expect(TmcEnvelopeSchema.safeParse({ ...withoutHint, origin: "self_created" }).success).toBe(false);
    expect(TmcEnvelopeSchema.safeParse(env).success).toBe(true);
    expect(TmcEnvelopeSchema.safeParse({ ...env, version: 2 }).success).toBe(false);
    expect(TmcEnvelopeSchema.safeParse({ ...env, format: "builder" }).success).toBe(false);
    expect(TmcEnvelopeSchema.safeParse({ ...env, sourceNotation: "fr" }).success).toBe(false);
    expect(TmcEnvelopeSchema.safeParse({ ...env, extra: 1 }).success).toBe(false);
  });
});

describe("toTellmeCrochetDraft — structure that carries over", () => {
  it("a plain sphere stays structured, version 1, with green stitch checks and no losses", () => {
    const { draft, losses } = toTellmeCrochetDraft(doc([part(SPHERE)]));
    expect(losses).toEqual([]);
    expect(draft.schemaVersion).toBe(1);
    expect(draft.title).toBe("Test");
    expect(draft.materials).toEqual([]);
    expect(draft.parts).toHaveLength(1);
    const p = draft.parts[0]!;
    expect(p.name).toBe("Kugel");
    expect(p.content.schemaVersion).toBe(1);
    expect(p.content.rows).toEqual(SPHERE);
    expect(p.stitchCheck.map((c) => c.ok)).toEqual([true, true, true, true]);
  });

  it("keeps quantity, labels, notes, modifiers and `into`", () => {
    const rows = [
      round("a", [st("MR", 1), sc(6)], 6, { label: "Rnd 1", note: "fest anziehen" }),
      round("b", [st("SC", 6, { modifiers: ["BLO"], into: "hinteres Glied" })], 6),
    ];
    const { draft } = toTellmeCrochetDraft(doc([part(rows, { name: "Ohr", quantity: 2 })]));
    expect(draft.parts[0]!.quantity).toBe(2);
    expect(rowsOf(draft)).toEqual(rows);
  });

  it("a target of 0 on a row with stitches (no number given) becomes the counted stitches", () => {
    const { draft } = toTellmeCrochetDraft(doc([part([round("a", [st("MR", 1), sc(6)], 0), round("b", [inc(6)], 0)])]));
    expect(rowsOf(draft).map((r) => r.stitchCountTarget)).toEqual([6, 12]);
    expect(draft.parts[0]!.stitchCheck.every((c) => c.ok)).toBe(true);
  });

  it("a wrong target stays wrong (TellmeCrochet shows it red)", () => {
    const { draft } = toTellmeCrochetDraft(doc([part([round("a", [sc(6)], 7)])]));
    expect(draft.parts[0]!.stitchCheck).toEqual([{ rowId: "a", expected: 7, actual: 6, ok: false }]);
  });

  it("free instructions carry over; empty rows are left out", () => {
    const rows: Row[] = [
      round("a", [sc(6)], 6),
      round("b", [], 0, { note: "Augen einsetzen" }),
      round("c", [], 0),
      round("d", [], 0, { label: "Füllen" }),
    ];
    const { draft } = toTellmeCrochetDraft(doc([part(rows)]));
    expect(rowsOf(draft).map((r) => r.id)).toEqual(["a", "b", "d"]);
    expect(rowsOf(draft)[1]).toEqual({ id: "b", type: "round", ops: [], stitchCountTarget: 0, note: "Augen einsetzen" });
  });

  it("a free instruction with label and note shows both (TellmeCrochet shows note, else label)", () => {
    const rows: Row[] = [
      round("a", [sc(6)], 6),
      round("b", [], 0, { label: " Augen ", note: " zwischen Runde 8 und 9 einsetzen " }),
      round("c", [], 0, { label: "Füllen" }),
    ];
    const shown = (r: TmcRow) => (r.note?.trim() || r.label?.trim() || "");
    const out = rowsOf(toTellmeCrochetDraft(doc([part(rows)])).draft);
    expect(out.map(shown)).toEqual(["", "Augen: zwischen Runde 8 und 9 einsetzen", "Füllen"]);
    expect(out[1]!.label).toBe(" Augen ");
  });
});

describe("toTellmeCrochetDraft — what becomes text", () => {
  it("a row with a stitch group becomes one instruction with the full German text", () => {
    const shell: Op = { kind: "group", ops: [st("SC", 3)] };
    const rows = [round("a", [st("MR", 1), sc(6)], 6), round("b", [rep(6, [shell])], 18), round("c", [sc(18)], 18)];
    const { draft, losses } = toTellmeCrochetDraft(doc([part(rows)]));
    const out = rowsOf(draft);
    expect(out[1]).toEqual({
      id: "b",
      type: "round",
      ops: [],
      stitchCountTarget: 0,
      label: "Runde 2",
      note: `Runde 2: ${renderRow(rows[1]!, "de")} (18)`,
    });
    expect(out[1]!.note).toBe("Runde 2: 6× ((3 fM) in dieselbe M) (18)");
    // TellmeCrochet numbers only rows with stitches: the next round keeps its number as a label.
    expect(out[2]).toMatchObject({ id: "c", label: "Runde 3", ops: [sc(18)] });
    expect(out[0]!.label).toBeUndefined();
    expect(losses).toEqual([
      expect.objectContaining({ code: "row-as-text", partIndex: 0, rowId: "b", rowType: "round", features: ["group"] }),
    ]);
  });

  it("bobbles, puffs, popcorns, picots and relief stitches make a row text; the note and own label stay in the text", () => {
    const rows = [
      round("a", [sc(6)], 6),
      round("b", [st("BOBBLE", 1), st("PUFF", 1), st("POPCORN", 1), st("PICOT", 1), st("DC", 3, { modifiers: ["FP"] })], 0, {
        label: "Zierrunde",
        note: "locker",
      }),
    ];
    const { draft, losses } = toTellmeCrochetDraft(doc([part(rows)]));
    expect(rowsOf(draft)[1]!.note).toBe(`Zierrunde: ${renderRow(rows[1]!, "de")} (6) – locker`);
    expect(rowsOf(draft)[1]!.note).toBe("Zierrunde: 1 Noppe, 1 Büschel, 1 Popcorn, 1 Pikot, 3 Stb (Relief v) (6) – locker");
    expect(losses[0]!.features).toEqual(["bobble", "puff", "popcorn", "picot", "relief"]);
  });

  it("rows after a text row keep their numbers; own labels stay; other parts are not shifted", () => {
    const bobbles = round("b", [st("BOBBLE", 6)], 6);
    const rows = [round("a", [st("MR", 1), sc(6)], 6), bobbles, round("c", [sc(6)], 6), round("d", [sc(6)], 6, { label: "Rnd 4–5" }), round("e", [sc(6)], 6)];
    const { draft } = toTellmeCrochetDraft(doc([part(rows), part(SPHERE, { name: "Zweite" })]));
    expect(rowsOf(draft).map((r) => r.label)).toEqual([undefined, "Runde 2", "Runde 3", "Rnd 4–5", "Runde 5"]);
    expect(rowsOf(draft, 1).map((r) => r.label)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("colours: first colour, changes at the start as instructions, changes inside a row as a note", () => {
    const palette: PaletteColor[] = [
      { id: "w", name: "Weiß" },
      { id: "r", name: "Rot" },
    ];
    const rows = [
      round("a", [st("MR", 1), sc(6)], 6),
      round("b", [inc(6)], 12, { color: "r" }),
      round("c", [sc(6), st("SC", 6, { color: "w" })], 12, { note: "eng" }),
      round("d", [sc(12)], 12, { color: "w" }), // already white: no change
      round("e", [st("SC", 12, { color: "r" })], 12),
    ];
    const { draft, losses } = toTellmeCrochetDraft(doc([part(rows)], { overview: { colors: palette } }));
    const out = rowsOf(draft);
    expect(out.map((r) => r.id)).toEqual(["a-farbe", "a", "b-farbe", "b", "c", "d", "e-farbe", "e"]);
    expect(out[0]!.note).toBe("Farbe: Weiß");
    expect(out[2]!.note).toBe("Farbwechsel: Rot");
    expect(out[4]!.note).toBe("eng – Farbwechsel in dieser Runde: 6 fM, [Farbe: Weiß] 6 fM");
    expect(out[6]!.note).toBe("Farbwechsel: Rot");
    expect(out[7]!.ops).toEqual([sc(12)]);
    for (const row of out) expect(row).not.toHaveProperty("color");
    expect(losses.map((l) => l.code)).toEqual(["color-start", "color-change", "color-in-row", "color-change", "palette"]);
    expect(draft.materials).toEqual([{ kind: "yarn", label: "Garn", colors: ["Weiß", "Rot"] }]);
    expect(summarizeTmcLosses(losses).slice(0, 3)).toEqual([
      "Die Anfangsfarbe jedes Teils steht als eigener Schritt am Anfang.",
      "Farbwechsel stehen als eigener Schritt vor der Runde.",
      "Farbwechsel mitten in einer Runde stehen als Notiz an der Runde.",
    ]);
  });

  it("colour marks that repeat the working colour are left out, at the start and inside a row", () => {
    const palette: PaletteColor[] = [
      { id: "w", name: "Weiß" },
      { id: "r", name: "Rot" },
    ];
    const rows = [
      round("a", [st("SC", 6, { color: "w" })], 6), // the start colour: only "Farbe: Weiß"
      round("b", [st("SC", 3, { color: "w" }), st("SC", 3, { color: "r" }), st("SC", 6, { color: "r" })], 12),
      round("c", [st("SC", 6, { color: "r" }), st("BOBBLE", 6, { color: "r" })], 12), // all red already
      round("d", [st("SC", 6), st("BOBBLE", 6, { color: "w" })], 12),
    ];
    const { draft, losses } = toTellmeCrochetDraft(doc([part(rows)], { overview: { colors: palette } }));
    expect(rowsOf(draft).map((r) => r.note)).toEqual([
      "Farbe: Weiß",
      undefined,
      "Farbwechsel in dieser Runde: 3 fM, [Farbe: Rot] 3 fM, 6 fM",
      "Runde 3: 6 fM, 6 Noppe (12)",
      "Runde 4: 6 fM, [Farbe: Weiß] 6 Noppe (12)",
    ]);
    expect(losses.filter((l) => l.code === "color-in-row").map((l) => l.rowId)).toEqual(["b"]);
  });

  it("rows worked in rows say „Reihe“ in the notice", () => {
    const palette: PaletteColor[] = [
      { id: "w", name: "Weiß" },
      { id: "r", name: "Rot" },
    ];
    const flat = (id: string, ops: Op[], extra: Partial<Row> = {}): Row => ({ id, type: "row", ops, stitchCountTarget: 6, ...extra });
    const rows = [flat("a", [st("CH", 7)]), flat("b", [sc(6)], { color: "r" }), flat("c", [sc(3), st("SC", 3, { color: "w" })])];
    const { draft, losses } = toTellmeCrochetDraft(doc([part(rows)], { overview: { colors: palette } }));
    expect(rowsOf(draft).find((r) => r.id === "c")!.note).toBe("Farbwechsel in dieser Reihe: 3 fM, [Farbe: Weiß] 3 fM");
    expect(summarizeTmcLosses(losses)).toContain("Farbwechsel stehen als eigener Schritt vor der Reihe.");
    expect(summarizeTmcLosses(losses)).toContain("Farbwechsel mitten in einer Reihe stehen als Notiz an der Reihe.");
  });

  it("a single palette colour and unknown colour ids give no colour steps", () => {
    const rows = [round("a", [sc(6)], 6, { color: "w" }), round("b", [sc(6)], 6, { color: "nope" })];
    const { draft } = toTellmeCrochetDraft(doc([part(rows)], { overview: { colors: [{ id: "w", name: "Weiß" }] } }));
    expect(rowsOf(draft).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("stuffing and finish become instructions at the end of the part", () => {
    const { draft, losses } = toTellmeCrochetDraft(doc([part(SPHERE, { finish: "gather", stuffing: "firm" })]));
    expect(notes(draft).slice(-2)).toEqual([
      "Füllung: fest mit Füllwatte füllen.",
      "Abschluss: die restlichen Maschen zusammenziehen und den Faden vernähen.",
    ]);
    expect(losses.map((l) => l.code)).toEqual(["stuffing", "finish"]);
  });

  it("notes and gauge become instructions at the start of the first part only", () => {
    const d = doc([part(SPHERE), part(SPHERE, { name: "Zweite" })], {
      overview: { notes: "  In Spiralrunden häkeln.  ", gauge: { stitchesPer10cm: 20, rowsPer10cm: 22.5, hookMm: 3.5, yarnWeight: "dk" } },
    });
    const { draft, losses } = toTellmeCrochetDraft(d);
    expect(notes(draft).slice(0, 2)).toEqual([
      "Hinweise: In Spiralrunden häkeln.",
      "Maschenprobe: 20 M × 22,5 R = 10 × 10 cm · Garn: DK · Nadel: 3,5 mm",
    ]);
    expect(rowsOf(draft, 1)).toEqual(SPHERE);
    expect(losses.map((l) => l.code)).toEqual(["notes", "gauge"]);
  });

  it("the assembly becomes a last part „Zusammensetzen“ with one instruction per placement", () => {
    const head = part(SPHERE, { id: "kopf", name: "Kopf" });
    const ear = part(SPHERE, { id: "ohr", name: "Ohr", quantity: 2 });
    const assembly: Placement[] = [
      { id: "p1", kind: "eyes", target: "kopf", row: "r2", angle: 0, spacing: 6, size: 12 },
      { id: "p2", kind: "attach", part: "ohr", target: "kopf", row: "r4", angle: -90 },
    ];
    const { draft, losses } = toTellmeCrochetDraft(doc([head, ear], { assembly }));
    expect(draft.parts.map((p) => p.name)).toEqual(["Kopf", "Ohr", "Zusammensetzen"]);
    const last = draft.parts[2]!;
    expect(last.quantity).toBe(1);
    expect(last.content.rows.map((r) => r.note)).toEqual([
      "Kopf: Sicherheitsaugen 12 mm vorne zwischen Runde 2 und 3 einsetzen, 6 Maschen Abstand.",
      "Kopf: Ohr links in Runde 4 annähen.",
    ]);
    expect(last.content.rows.map((r) => r.id)).toEqual(["montage-p1", "montage-p2"]);
    expect(losses.filter((l) => l.code === "assembly").map((l) => l.placementId)).toEqual(["p1", "p2"]);
    expect(losses.find((l) => l.code === "assembly")!.message).toBe("Die Platzierung steht im Teil „Zusammensetzen“.");
  });

  it("a renamed assembly part is named so in the draft, the losses and the notice", () => {
    const head = part(SPHERE, { id: "kopf", name: "Kopf" });
    const assembly: Placement[] = [{ id: "p1", kind: "eyes", target: "kopf", row: "r2", angle: 0 }];
    const { draft, losses } = toTellmeCrochetDraft(doc([head], { assembly }), { assemblyPartName: "Montage" });
    expect(draft.parts.at(-1)!.name).toBe("Montage");
    expect(losses.find((l) => l.code === "assembly")!.message).toBe("Die Platzierung steht im Teil „Montage“.");
    expect(summarizeTmcLosses(losses)).toContain("Die Montage wird zum Teil „Montage“.");
  });
});

describe("toTellmeCrochetDraft — names, materials, ids", () => {
  it("unnamed parts are „Teil n“; parts without rows get a placeholder", () => {
    const { draft, losses } = toTellmeCrochetDraft(doc([part(SPHERE), part([round("x", [], 0)], { name: "  " })]));
    expect(draft.parts[1]!.name).toBe("Teil 2");
    expect(rowsOf(draft, 1)).toEqual([
      { id: "tmc-leer", type: "round", ops: [], stitchCountTarget: 0, note: "Für dieses Teil sind noch keine Reihen angegeben." },
    ]);
    expect(losses.map((l) => l.code)).toEqual(["part-empty", "part-unnamed"]);
  });

  it("materials: trimmed, empty labels, colours and amounts left out; palette joins the only yarn", () => {
    const materials: Material[] = [
      { kind: "yarn", label: " Catania ", colors: ["Weiß", " ", ""], amount: " " },
      { kind: "accessory", label: "   " },
      { kind: "hook", label: "3 mm", amount: "1" },
    ];
    const palette: PaletteColor[] = [
      { id: "a", name: "Weiß" },
      { id: "b", name: "Rosa" },
      { id: "c", name: "" },
    ];
    const { draft, losses } = toTellmeCrochetDraft(doc([part(SPHERE)], { overview: { materials, colors: palette } }));
    expect(draft.materials).toEqual([
      { kind: "yarn", label: "Catania", colors: ["Weiß", "Rosa"] },
      { kind: "hook", label: "3 mm", amount: "1" },
    ]);
    // Two named colours: the part says which colour it starts with.
    expect(losses.map((l) => l.code)).toEqual(["color-start", "material-dropped", "palette"]);
  });

  it("with several yarns the palette becomes its own yarn line", () => {
    const materials: Material[] = [
      { kind: "yarn", label: "A" },
      { kind: "yarn", label: "B", colors: ["Rot"] },
    ];
    const palette: PaletteColor[] = [
      { id: "r", name: "Rot" },
      { id: "g", name: "Grün" },
    ];
    const { draft } = toTellmeCrochetDraft(doc([part(SPHERE)], { overview: { materials, colors: palette } }));
    expect(draft.materials).toEqual([...materials, { kind: "yarn", label: "Garnfarben", colors: ["Grün"] }]);
  });

  it("row ids stay unique per part; real rows keep theirs, a repeated id gets a free one", () => {
    const rows = [round("a", [sc(6)], 6), round("a", [sc(6)], 6), round("a-2", [sc(6)], 6)];
    const { draft, losses } = toTellmeCrochetDraft(doc([part(rows), part(rows)]));
    for (const p of draft.parts) expect(new Set(p.content.rows.map((r) => r.id)).size).toBe(p.content.rows.length);
    expect(rowsOf(draft).map((r) => r.id)).toEqual(["a", "a-3", "a-2"]);
    expect(losses.filter((l) => l.code === "row-id-changed")).toHaveLength(2);
  });

  it("added steps never take the id of a real row", () => {
    const palette: PaletteColor[] = [
      { id: "w", name: "Weiß" },
      { id: "r", name: "Rot" },
    ];
    const rows = [
      round("tmc-hinweise", [], 0, { note: "eigener Hinweis" }),
      round("a", [sc(6)], 6),
      round("a-farbe", [sc(6)], 6),
      round("tmc-fuellung", [sc(6)], 6),
    ];
    const { draft, losses } = toTellmeCrochetDraft(doc([part(rows, { stuffing: "firm" })], { overview: { colors: palette, notes: "x" } }));
    const out = rowsOf(draft);
    expect(out.map((r) => [r.id, r.note])).toEqual([
      ["tmc-hinweise-2", "Hinweise: x"],
      ["tmc-hinweise", "eigener Hinweis"],
      ["a-farbe-2", "Farbe: Weiß"],
      ["a", undefined],
      ["a-farbe", undefined],
      ["tmc-fuellung", undefined],
      ["tmc-fuellung-2", "Füllung: fest mit Füllwatte füllen."],
    ]);
    expect(losses.some((l) => l.code === "row-id-changed")).toBe(false);
  });

  it("an empty title is left out", () => {
    expect(toTellmeCrochetDraft(doc([part(SPHERE)], { title: "  " })).draft).not.toHaveProperty("title");
  });
});

describe("German wording", () => {
  const parts = [part(SPHERE, { id: "k", name: "Kopf" }), { ...part([{ ...SPHERE[0]!, type: "row" as const }, { ...SPHERE[1]!, type: "row" as const }]), id: "f", name: "" }];

  it("describePlacement: sides around a round and along a row, labels, unknown references", () => {
    const pl = (p: Partial<Placement>): Placement => ({ id: "p", kind: "eyes", target: "k", row: "r1", angle: 0, ...p });
    expect(describePlacement(pl({ spacing: 1 }), parts)).toBe("Kopf: Sicherheitsaugen vorne zwischen Runde 1 und 2 einsetzen, 1 Masche Abstand.");
    expect(describePlacement(pl({ angle: 45 }), parts)).toBe("Kopf: Sicherheitsaugen vorne rechts zwischen Runde 1 und 2 einsetzen.");
    expect(describePlacement(pl({ angle: 270 }), parts)).toContain(" links ");
    expect(describePlacement(pl({ angle: -135 }), parts)).toContain(" hinten links ");
    expect(describePlacement(pl({ angle: 180, kind: "embroidery", note: "Nase", size: 7.5 }), parts)).toBe(
      "Kopf: Nase (7,5 mm) hinten zwischen Runde 1 und 2 aufsticken.",
    );
    expect(describePlacement(pl({ target: "f", angle: -170, kind: "attach" }), parts)).toBe(
      "Teil 2: Teil am linken Rand zwischen Reihe 1 und 2 annähen.",
    );
    expect(describePlacement(pl({ target: "f", angle: 10, kind: "attach", part: "k", note: "gut feststecken" }), parts)).toBe(
      "Teil 2: Kopf in der Mitte zwischen Reihe 1 und 2 annähen – gut feststecken.",
    );
    expect(describePlacement(pl({ target: "weg", kind: "attach", part: "auch-weg" }), parts)).toBe("weg: auch-weg vorne annähen.");
    // A note that is a whole sentence (as the text import writes it) ends with one full stop.
    expect(describePlacement(pl({ note: "Augen einsetzen, 4 M auseinander. " }), parts)).toBe(
      "Kopf: Sicherheitsaugen vorne zwischen Runde 1 und 2 einsetzen – Augen einsetzen, 4 M auseinander.",
    );
    expect(describePlacement(pl({ kind: "embroidery", note: "Nase sticken!" }), parts)).toBe(
      "Kopf: Nase sticken vorne zwischen Runde 1 und 2 aufsticken.",
    );
    expect(describePlacement(pl({ row: "nope" }), parts)).toBe("Kopf: Sicherheitsaugen vorne einsetzen.");
    const labelled = [part([round("x", [sc(6)], 6, { label: "Rnd 1–3" }), round("y", [], 0, { note: "Augen" }), round("z", [sc(6)], 6)], { id: "k", name: "Kopf" })];
    expect(describePlacement(pl({ row: "x" }), labelled)).toBe("Kopf: Sicherheitsaugen vorne zwischen Rnd 1–3 und Runde 2 einsetzen.");
    expect(describePlacement(pl({ row: "y" }), labelled)).toBe("Kopf: Sicherheitsaugen vorne bei „Augen“ einsetzen.");
  });

  it("gaugeText", () => {
    expect(gaugeText(undefined)).toBeNull();
    expect(gaugeText({})).toBeNull();
    expect(gaugeText({ stitchesPer10cm: 18 })).toBe("Maschenprobe: 18 M = 10 × 10 cm");
    expect(gaugeText({ yarnDiameterMm: 2.25, hookMm: 3 })).toBe("Garndicke: 2,25 mm · Nadel: 3 mm");
  });

  it("summarizeTmcLosses says each kind once, in short German sentences", () => {
    const shell: Op = { kind: "group", ops: [st("DC", 2)] };
    const d = doc(
      [
        part([round("a", [st("MR", 1), sc(6)], 6), round("b", [st("BOBBLE", 6)], 6), round("c", [shell, st("BOBBLE", 5)], 7)], {
          finish: "gather",
          stuffing: "light",
          id: "k",
        }),
        part([], { name: "" }),
      ],
      {
        overview: { notes: "x", gauge: { hookMm: 3 }, materials: [{ kind: "yarn", label: "" }], colors: [{ id: "w", name: "Weiß" }] },
        assembly: [{ id: "p", kind: "eyes", target: "k", row: "a", angle: 0 }],
      },
    );
    const { losses } = toTellmeCrochetDraft(d);
    expect(summarizeTmcLosses(losses)).toEqual([
      "2 Runden mit mehreren Maschen in einer Einstichstelle und Noppen werden in TellmeCrochet als Text-Schritt gezeigt.",
      "Füllung und Abschluss stehen als Schritt am Ende des Teils.",
      "Die Montage wird zum Teil „Zusammensetzen“.",
      "Hinweise und Angaben zu Garn, Nadel und Maschenprobe stehen als Schritt am Anfang des ersten Teils.",
      "Die Farben stehen beim Garn in der Materialliste.",
      "1 Material ohne Namen entfällt.",
      "Ein Teil ohne Namen heißt „Teil 2“.",
      "1 Teil ohne Reihen bekommt einen Hinweis-Schritt.",
    ]);
    expect(summarizeTmcLosses([])).toEqual([]);
    expect(
      summarizeTmcLosses([
        { code: "row-as-text", rowType: "row", features: ["relief"], message: "" },
        { code: "row-id-changed", message: "" },
      ]),
    ).toEqual(["1 Reihe mit Reliefmaschen wird in TellmeCrochet als Text-Schritt gezeigt."]);
  });
});

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

describe("encodeTmcPayload / decodeTmcPayload / buildTmcImportUrl", () => {
  it("round-trips the envelope under the prefix tmc1.", async () => {
    const env = toTmcEnvelope(toTellmeCrochetDraft(doc([part(SPHERE)], { title: "Kugel „ä“ 🧶" })).draft, "imported");
    const payload = await encodeTmcPayload(env);
    expect(payload).toMatch(/^tmc1\.[A-Za-z0-9_-]+$/);
    expect(await decodeTmcPayload(payload)).toEqual(env);
    expect(await encodeTmcPayload(structuredClone(env))).toBe(payload);
    expect(buildTmcImportUrl(payload)).toBe(`${TMC_IMPORT_URL}#data=${payload}`);
    expect(TMC_IMPORT_URL).toBe("https://tellmecrochet.de/import");
  });

  it("refuses share payloads and invalid envelopes", async () => {
    const share = await encodeShare(doc([part(SPHERE)]));
    await expect(decodeTmcPayload(share)).rejects.toMatchObject({ code: "malformed" });
    await expect(decodeTmcPayload("tmc2.abc")).rejects.toBeInstanceOf(ShareDecodeError);
    await expect(decodeTmcPayload("x".repeat(MAX_SHARE_CHARS + 1))).rejects.toMatchObject({ code: "too-large" });
    // A BuilderExport packed under the tmc1 prefix is not an envelope.
    const wrong = "tmc1." + share.slice(3);
    await expect(decodeTmcPayload(wrong)).rejects.toMatchObject({ code: "invalid" });
    expect(() => buildTmcImportUrl(share)).toThrow(TypeError);
    await expect(encodeTmcPayload({ format: "tmc-draft" } as never)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Property: random version-2 exports always give schema-valid drafts and lose no text
// ---------------------------------------------------------------------------

const CODES: StitchCode[] = ["CH", "SL_ST", "SC", "HDC", "DC", "TR", "DTR", "MR", "INC", "DEC", "INVDEC", "ST", "BOBBLE", "PUFF", "POPCORN", "PICOT"];
const TEXT = "abcdefghijklmnopqrstuvwxyzäöüßÄÖÜ ×–„“…0123456789 ()[]\"'\\/#&=?%🧶\n";

function generator(seed: number) {
  const rnd = createRandom(seed);
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
  const pick = <T,>(list: readonly T[]): T => list[int(0, list.length - 1)]!;
  const maybe = <T,>(p: number, make: () => T): T | undefined => (rnd() < p ? make() : undefined);
  const text = (max: number) => Array.from({ length: int(0, max) }, () => pick([...TEXT])).join("");
  const colorIds = ["c0", "c1", "c2", "zz"];

  const stitch = (inGroup: boolean): Extract<Op, { kind: "stitch" }> => {
    const code = pick(inGroup ? CODES.filter((c) => c !== "MR" && c !== "DEC" && c !== "INVDEC") : CODES);
    const s: Extract<Op, { kind: "stitch" }> = { kind: "stitch", code, count: int(1, 20) };
    const mods = maybe(0.2, () => [pick(["BLO", "FLO", "TOG", "FP", "BP"] as const)]);
    if (mods) s.modifiers = mods;
    const into = maybe(0.1, () => text(8));
    if (into !== undefined) s.into = into;
    const color = maybe(0.15, () => pick(colorIds));
    if (color !== undefined) s.color = color;
    return s;
  };
  const groupOp = (depth: number): GroupOp =>
    depth < 2 && rnd() < 0.2 ? { kind: "repeat", times: int(1, 4), ops: Array.from({ length: int(0, 2) }, () => groupOp(depth + 1)) } : stitch(true);
  const op = (depth: number): Op => {
    const r = rnd();
    if (depth < 3 && r < 0.2) return { kind: "repeat", times: int(1, 12), ops: Array.from({ length: int(0, 3) }, () => op(depth + 1)) };
    if (r < 0.3) return { kind: "group", ops: Array.from({ length: int(0, 3) }, () => groupOp(0)) };
    return stitch(false);
  };
  const ids = ["a", "b", "c", "d", "e", "f"];
  const row = (i: number): Row => {
    const r: Row = {
      id: rnd() < 0.15 ? pick(ids) : `r${i}`,
      type: pick(["row", "round"] as const),
      ops: Array.from({ length: int(0, 4) }, () => op(0)),
      stitchCountTarget: int(0, 300),
    };
    const label = maybe(0.2, () => text(10));
    if (label !== undefined) r.label = label;
    const note = maybe(0.3, () => text(30));
    if (note !== undefined) r.note = note;
    const color = maybe(0.2, () => pick(colorIds));
    if (color !== undefined) r.color = color;
    return r;
  };
  const material = (): Material => {
    const m: Material = { kind: pick(["yarn", "hook", "accessory"] as const), label: text(12) };
    const colors = maybe(0.5, () => Array.from({ length: int(0, 3) }, () => text(6)));
    if (colors) m.colors = colors;
    const amount = maybe(0.5, () => text(5));
    if (amount !== undefined) m.amount = amount;
    return m;
  };
  const gauge = (): Gauge => {
    const g: Gauge = {};
    if (rnd() < 0.5) g.stitchesPer10cm = int(5, 40) + 0.5 * int(0, 1);
    if (rnd() < 0.5) g.rowsPer10cm = int(5, 40);
    if (rnd() < 0.5) g.yarnWeight = pick(["lace", "fingering", "sport", "dk", "worsted", "aran", "bulky", "jumbo"] as const);
    if (rnd() < 0.5) g.hookMm = int(4, 40) / 4;
    if (rnd() < 0.3) g.yarnDiameterMm = int(1, 30) / 4;
    return g;
  };

  return (): BuilderExport => {
    const parts: BuilderPart[] = Array.from({ length: int(1, 3) }, (_, p) => {
      const bp: BuilderPart = {
        id: `p${p}`,
        name: rnd() < 0.2 ? "" : text(10),
        quantity: int(1, 4),
        content: { schemaVersion: 2, rows: Array.from({ length: int(0, 14) }, (_, i) => row(p * 100 + i)) },
      };
      const finish = maybe(0.3, () => pick(["open", "gather", "flat"] as const));
      if (finish) bp.content.finish = finish;
      const stuffing = maybe(0.3, () => pick(["none", "light", "firm"] as const));
      if (stuffing) bp.content.stuffing = stuffing;
      return bp;
    });
    const overview: BuilderExport["overview"] = {};
    const materials = maybe(0.7, () => Array.from({ length: int(0, 4) }, material));
    if (materials) overview.materials = materials;
    const g = maybe(0.6, gauge);
    if (g) overview.gauge = g;
    const n = maybe(0.5, () => text(60));
    if (n !== undefined) overview.notes = n;
    const colors = maybe(0.6, () => Array.from({ length: int(0, 3) }, (_, i) => ({ id: `c${i}`, name: rnd() < 0.2 ? "" : text(8) })));
    if (colors) overview.colors = colors;
    const exp: BuilderExport = { schemaVersion: 2, title: text(20), overview, parts };
    const assembly = maybe(0.4, () =>
      Array.from({ length: int(1, 4) }, (_, i): Placement => {
        const target = pick(parts);
        const pl: Placement = {
          id: `pl${i}`,
          kind: pick(["attach", "eyes", "embroidery"] as const),
          target: rnd() < 0.1 ? "missing" : target.id!,
          row: target.content.rows.length > 0 && rnd() < 0.9 ? pick(target.content.rows).id : "missing",
          angle: int(-400, 400),
        };
        if (rnd() < 0.5) pl.part = pick(parts).id!;
        if (rnd() < 0.5) pl.spacing = int(0, 12);
        if (rnd() < 0.5) pl.size = int(1, 40) / 2;
        const note = maybe(0.3, () => text(12));
        if (note !== undefined) pl.note = note;
        return pl;
      }),
    );
    if (assembly) exp.assembly = assembly;
    return BuilderExportSchema.parse(exp);
  };
}

/** Whether version 1 cannot express `ops` (independent of the implementation). */
function needsText(ops: readonly Op[]): boolean {
  return ops.some((op) => {
    if (op.kind === "group") return true;
    if (op.kind === "repeat") return needsText(op.ops);
    return ["BOBBLE", "PUFF", "POPCORN", "PICOT"].includes(op.code) || (op.modifiers ?? []).some((m) => m === "FP" || m === "BP");
  });
}

describe("toTellmeCrochetDraft — property (seeded)", () => {
  it("300 random version-2 exports give schema-valid drafts that keep every text", async () => {
    for (let seed = 1; seed <= 300; seed++) {
      const exp = generator(seed)();
      const { draft, losses } = toTellmeCrochetDraft(exp);
      const ctx = `seed ${seed}`;
      expect(TmcDraftSchema.safeParse(draft).success, ctx).toBe(true);
      expect(draft.parts.length, ctx).toBe(exp.parts.length + (exp.assembly?.length ? 1 : 0));
      const palette = exp.overview.colors ?? [];

      exp.parts.forEach((p, i) => {
        const out = draft.parts[i]!;
        expect(out.name.trim(), ctx).not.toBe("");
        expect(out.quantity, ctx).toBe(p.quantity);
        expect(out.content.rows.length, ctx).toBeGreaterThan(0);
        expect(new Set(out.content.rows.map((r) => r.id)).size, ctx).toBe(out.content.rows.length);
        expect(out.stitchCheck.map((c) => c.rowId), ctx).toEqual(out.content.rows.map((r) => r.id));
        const texts = out.content.rows.map((r) => `${r.label ?? ""}\u0000${r.note ?? ""}`).join("\u0000");
        // What TellmeCrochet shows of a free instruction: its note, else its label.
        const shown = (r: TmcRow) => r.note?.trim() || r.label?.trim() || "";
        const withoutMarks = (s: string) => s.replace(/\[Farbe: [^\]]*\] /g, "");

        let stitchRows = 0;
        for (const row of p.content.rows) {
          if (row.label?.trim()) expect(texts.includes(row.label.trim()), `${ctx} label of ${row.id}`).toBe(true);
          if (row.note?.trim()) expect(texts.includes(row.note.trim()), `${ctx} note of ${row.id}`).toBe(true);
          if (row.ops.length === 0) {
            // A free instruction shows all its text in TellmeCrochet.
            if (!row.label?.trim() && !row.note?.trim()) continue;
            const visible = out.content.rows.filter((r) => r.ops.length === 0).map(shown).join("\u0000");
            for (const t of [row.label?.trim(), row.note?.trim()]) {
              if (t) expect(visible.includes(t), `${ctx} shown text of ${row.id}`).toBe(true);
            }
            continue;
          }
          stitchRows++;
          if (needsText(row.ops)) {
            // The stitches as text (colour marks aside: those that repeat the colour drop out).
            const ops = renderRow({ ...row, color: undefined }, "de");
            expect(withoutMarks(texts).includes(ops), `${ctx} text of ${row.id}`).toBe(true);
          }
        }

        // Colour changes survive: with two or more colours every colour a part uses is named
        // in it (as its first colour, a change step, a note or a mark in a text row).
        if (palette.length >= 2) {
          const ids = new Set(palette.map((c) => c.id));
          const used = new Set<string>();
          const collect = (ops: readonly Op[]) => {
            for (const op of ops) {
              if (op.kind === "stitch") {
                if (op.color && ids.has(op.color)) used.add(op.color);
              } else collect(op.ops);
            }
          };
          for (const row of p.content.rows) {
            // A row colour that the first stitch's own colour replaces at once is never worked.
            const first = row.ops[0];
            const overridden = first?.kind === "stitch" && first.color !== undefined && ids.has(first.color);
            if (row.color && ids.has(row.color) && !overridden) used.add(row.color);
            collect(row.ops);
          }
          for (const id of used) {
            const c = palette.find((x) => x.id === id)!;
            const name = (c.name.trim() || c.id).replace(/[[\]]/g, "");
            expect(texts.includes(name), `${ctx} colour ${id} in part ${i}`).toBe(true);
          }
        }
        // Every row with stitches is still there: structured or as its text.
        const asText = p.content.rows.filter((r) => r.ops.length > 0 && needsText(r.ops)).length;
        expect(losses.filter((l) => l.code === "row-as-text" && l.partIndex === i), ctx).toHaveLength(asText);
        expect(out.content.rows.filter((r) => r.ops.length > 0).length + asText, ctx).toBe(stitchRows);
      });

      if (exp.overview.notes?.trim()) expect(draft.parts[0]!.content.rows.some((r) => r.note?.includes(exp.overview.notes!.trim())), ctx).toBe(true);
      const names = new Set((draft.materials ?? []).flatMap((m) => m.colors ?? []));
      for (const c of palette) if (c.name.trim()) expect(names.has(c.name.trim()), ctx).toBe(true);
      if (exp.assembly?.length) expect(draft.parts.at(-1)!.content.rows).toHaveLength(exp.assembly.length);

      // The envelope packs and unpacks.
      if (seed % 10 === 0) {
        const env = toTmcEnvelope(draft, seed % 20 === 0 ? "imported" : "self_created");
        expect(await decodeTmcPayload(await encodeTmcPayload(env)), ctx).toEqual(env);
      }
    }
  });
});
