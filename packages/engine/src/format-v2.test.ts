/**
 * Format v2 (protocol E21): schema, expansion, counts, validation, graph, relaxation and mesh
 * for stitch groups, the new codes and modifiers, colours, finish and stuffing.
 */
import { describe, it, expect } from "vitest";
import { expandPart, expandRow } from "./expand.js";
import { BuilderExportSchema, validateExport, withCurrentVersion, type BuilderExport } from "./export.js";
import { STITCH_BULGE, STITCH_HEIGHT_FACTOR, resolveGauge } from "./gauge.js";
import { buildGraph, isFabricNode, LEG_LEAN, type StitchGraph } from "./graph.js";
import { measureRounds } from "./measure.js";
import { toMesh } from "./mesh.js";
import { buildModel, partRelaxOptions } from "./model.js";
import { relax, relaxOptionsForPart, resolveFinish, seamStrip, signedVolume, STUFFING_LEVELS } from "./relax.js";
import {
  CURRENT_SCHEMA_VERSION,
  OpSchema,
  PartContentSchema,
  RowSchema,
  STITCH_PROPERTIES,
  StitchOpSchema,
  isPostStitch,
  usesFormatV2,
  type Mod,
  type Op,
  type PartContent,
  type Row,
  type StitchCode,
} from "./schema.js";
import { computeRowStitches } from "./stitch-count.js";
import { anchorsConsumed, anchorsOffered, validate } from "./validate.js";

const st = (code: StitchCode, count = 1, extra: { modifiers?: Mod[]; color?: string } = {}): Op => ({
  kind: "stitch",
  code,
  count,
  ...extra,
});
const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });
const grp = (ops: Op[]): Op => ({ kind: "group", ops: ops as Extract<Op, { kind: "group" }>["ops"] });
const row = (id: string, ops: Op[], t: number, extra: Partial<Row> = {}): Row => ({
  id,
  type: "round",
  ops,
  stitchCountTarget: t,
  ...extra,
});
const part = (rows: Row[], extra: Partial<PartContent> = {}): PartContent => ({ schemaVersion: 2, rows, ...extra });

/** Magic ring of 6, then 6 × (3 SC in one stitch) = 18, then an even round of 18. */
const SHELLS = part([
  row("r1", [st("MR"), st("SC", 6)], 6),
  row("r2", [rep(6, [grp([st("SC", 3)])])], 18),
  row("r3", [st("SC", 18)], 18),
]);

/** A tube: start of a ball, then six even rounds of 18. */
const TUBE_ROWS = [
  row("r1", [st("MR"), st("SC", 6)], 6),
  row("r2", [st("INC", 6)], 12),
  row("r3", [rep(6, [st("SC"), st("INC")])], 18),
  ...Array.from({ length: 6 }, (_, i) => row(`e${i}`, [st("SC", 18)], 18)),
];

/** The classic amigurumi ball (four even rounds), decreased to 6 at the end. */
const BALL_ROWS = [
  row("r1", [st("MR"), st("SC", 6)], 6),
  row("r2", [st("INC", 6)], 12),
  row("r3", [rep(6, [st("SC"), st("INC")])], 18),
  row("r4", [rep(6, [st("SC", 2), st("INC")])], 24),
  ...["e1", "e2", "e3", "e4"].map((id) => row(id, [st("SC", 24)], 24)),
  row("r6", [rep(6, [st("SC", 2), st("DEC")])], 18),
  row("r7", [rep(6, [st("SC"), st("DEC")])], 12),
  row("r8", [st("DEC", 6)], 6),
];

type V3 = [number, number, number];
const P = (g: StitchGraph, i: number): V3 => [g.positions[3 * i]!, g.positions[3 * i + 1]!, g.positions[3 * i + 2]!];
const fabricOf = (g: StitchGraph, rowId: string) => g.nodes.filter((n) => n.rowId === rowId && isFabricNode(n)).map((n) => n.id);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("format v2 — schema", () => {
  it("reads every v1 document; writers stamp version 2 (withCurrentVersion)", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
    const old: BuilderExport = {
      schemaVersion: 1,
      title: "T",
      overview: {},
      parts: [{ name: "A", quantity: 1, content: { schemaVersion: 1, rows: TUBE_ROWS } }],
    };
    const written = withCurrentVersion(old);
    expect(written.schemaVersion).toBe(2);
    expect(written.parts[0]!.content).toEqual({ schemaVersion: 2, rows: TUBE_ROWS });
    expect(old.schemaVersion).toBe(1); // not mutated
    expect(BuilderExportSchema.safeParse(written).success).toBe(true);
    const v1 = { schemaVersion: 1, rows: [{ id: "a", type: "round", ops: [{ kind: "stitch", code: "SC", count: 6 }], stitchCountTarget: 6 }] };
    expect(PartContentSchema.parse(v1).schemaVersion).toBe(1);
    expect(PartContentSchema.parse({ ...v1, schemaVersion: 2 }).schemaVersion).toBe(2);
    expect(PartContentSchema.safeParse({ ...v1, schemaVersion: 3 }).success).toBe(false);
    expect(PartContentSchema.safeParse({ ...v1, schemaVersion: "2" }).success).toBe(false);
  });

  it("rejects version-2 features in a document that says version 1", () => {
    const v1 = (extra: Record<string, unknown>, ops: unknown[] = [{ kind: "stitch", code: "SC", count: 6 }]) => ({
      schemaVersion: 1,
      rows: [{ id: "a", type: "round", ops, stitchCountTarget: 6 }],
      ...extra,
    });
    const ok = (x: unknown) => PartContentSchema.safeParse(x).success;
    expect(ok(v1({}))).toBe(true);
    expect(ok(v1({ finish: "flat" }))).toBe(false);
    expect(ok(v1({ stuffing: "none" }))).toBe(false);
    expect(ok(v1({}, [{ kind: "group", ops: [{ kind: "stitch", code: "SC", count: 3 }] }]))).toBe(false);
    expect(ok(v1({}, [{ kind: "repeat", times: 6, ops: [{ kind: "stitch", code: "PICOT", count: 1 }] }]))).toBe(false);
    expect(ok(v1({}, [{ kind: "stitch", code: "DC", count: 6, modifiers: ["FP"] }]))).toBe(false);
    expect(ok(v1({}, [{ kind: "stitch", code: "SC", count: 6, color: "a" }]))).toBe(false);
    expect(ok({ ...v1({}), rows: [{ id: "a", type: "round", ops: [], stitchCountTarget: 0, color: "a" }] })).toBe(false);
    const issue = PartContentSchema.safeParse(v1({ finish: "flat" }));
    expect(!issue.success && issue.error.issues[0]!.path).toEqual(["schemaVersion"]);
    // The same document as version 2 is fine.
    expect(ok({ ...v1({ finish: "flat" }), schemaVersion: 2 })).toBe(true);
    expect(usesFormatV2({ rows: [] })).toBe(false);

    const exp = (extra: Record<string, unknown>) => ({ schemaVersion: 1, title: "T", overview: {}, parts: [], ...extra });
    const okExp = (x: unknown) => BuilderExportSchema.safeParse(x).success;
    expect(okExp(exp({}))).toBe(true);
    expect(okExp(exp({ overview: { colors: [] } }))).toBe(false);
    expect(okExp(exp({ assembly: [] }))).toBe(false);
    expect(okExp(exp({ parts: [{ id: "p", name: "A", quantity: 1, content: { schemaVersion: 1, rows: [] } }] }))).toBe(false);
    expect(okExp(exp({ parts: [{ name: "A", quantity: 1, content: { schemaVersion: 2, rows: [] } }] }))).toBe(false);
    expect(okExp({ ...exp({ assembly: [] }), schemaVersion: 2 })).toBe(true);
  });

  it("parses every v2 field of a part", () => {
    const parsed = PartContentSchema.parse({
      schemaVersion: 2,
      finish: "flat",
      stuffing: "light",
      rows: [
        {
          id: "r1",
          type: "round",
          color: "white",
          ops: [
            { kind: "stitch", code: "MR", count: 1 },
            { kind: "group", ops: [{ kind: "stitch", code: "DC", count: 2, modifiers: ["FP"] }, { kind: "stitch", code: "PICOT", count: 1 }] },
            { kind: "stitch", code: "BOBBLE", count: 1, color: "pink" },
            { kind: "stitch", code: "PUFF", count: 1, modifiers: ["BLO"] },
            { kind: "stitch", code: "POPCORN", count: 1 },
            { kind: "stitch", code: "HDC", count: 1, modifiers: ["BP"] },
          ],
          stitchCountTarget: 6,
        },
      ],
    });
    expect(parsed.finish).toBe("flat");
    expect(parsed.stuffing).toBe("light");
    expect(parsed.rows[0]!.color).toBe("white");
    expect(parsed.rows[0]!.ops[1]).toMatchObject({ kind: "group" });
  });

  it("accepts groups inside repeats and repeats inside groups, but never a group in a group", () => {
    expect(OpSchema.safeParse({ kind: "repeat", times: 6, ops: [{ kind: "group", ops: [{ kind: "stitch", code: "SC", count: 3 }] }] }).success).toBe(true);
    expect(
      OpSchema.safeParse({ kind: "group", ops: [{ kind: "repeat", times: 2, ops: [{ kind: "stitch", code: "DC", count: 1 }] }] }).success,
    ).toBe(true);
    expect(OpSchema.safeParse({ kind: "group", ops: [{ kind: "group", ops: [] }] }).success).toBe(false);
    expect(
      OpSchema.safeParse({ kind: "group", ops: [{ kind: "repeat", times: 2, ops: [{ kind: "group", ops: [] }] }] }).success,
    ).toBe(false);
    expect(OpSchema.safeParse({ kind: "group", ops: [], times: 2 }).success).toBe(false); // strict
  });

  it("rejects unknown finish/stuffing values and empty colour ids", () => {
    const base = { schemaVersion: 2, rows: [] };
    expect(PartContentSchema.safeParse({ ...base, finish: "sewn" }).success).toBe(false);
    expect(PartContentSchema.safeParse({ ...base, stuffing: "medium" }).success).toBe(false);
    expect(StitchOpSchema.safeParse({ kind: "stitch", code: "SC", count: 1, color: "" }).success).toBe(false);
    expect(RowSchema.safeParse({ id: "a", type: "round", ops: [], stitchCountTarget: 0, color: "" }).success).toBe(false);
    expect(StitchOpSchema.safeParse({ kind: "stitch", code: "SC", count: 1, modifiers: ["XP"] }).success).toBe(false);
  });

  it("gives the new codes their counts and DC height; FP/BP only fit post stitches", () => {
    for (const code of ["BOBBLE", "PUFF", "POPCORN"] as const) {
      expect(STITCH_PROPERTIES[code]).toEqual({ producesStitches: 1, consumesStitches: 1 });
      expect(STITCH_HEIGHT_FACTOR[code]).toBe(STITCH_HEIGHT_FACTOR.DC);
      expect(STITCH_BULGE[code]).toBeGreaterThan(0);
    }
    expect(STITCH_PROPERTIES.PICOT).toEqual({ producesStitches: 0, consumesStitches: 0 });
    expect(STITCH_HEIGHT_FACTOR.PICOT).toBe(0);
    expect(["SC", "HDC", "DC", "TR", "DTR"].every((c) => isPostStitch(c as StitchCode))).toBe(true);
    expect(["CH", "SL_ST", "MR", "INC", "DEC", "INVDEC", "ST", "BOBBLE", "PICOT"].some((c) => isPostStitch(c as StitchCode))).toBe(false);
  });
});

describe("format v2 — builder export schema", () => {
  const doc = (): BuilderExport => ({
    schemaVersion: 2,
    title: "Hase",
    overview: { colors: [{ id: "white", name: "Weiß", hex: "#ffffff" }, { id: "pink", name: "Rosa" }] },
    parts: [
      { id: "head", name: "Kopf", quantity: 1, content: part(BALL_ROWS) },
      { id: "ear", name: "Ohr", quantity: 2, content: part(TUBE_ROWS, { finish: "flat" }) },
    ],
    assembly: [
      { id: "p1", kind: "attach", part: "ear", target: "head", row: "e1", angle: 30, note: "flach annähen" },
      { id: "p2", kind: "eyes", target: "head", row: "e2", angle: 0, spacing: 6, size: 8 },
      { id: "p3", kind: "embroidery", target: "head", row: "e3", angle: 0, size: 5 },
    ],
  });

  it("parses palette, part ids and the assembly; v1 exports still parse", () => {
    const parsed = BuilderExportSchema.parse(doc());
    expect(parsed.overview.colors).toHaveLength(2);
    expect(parsed.parts[1]!.id).toBe("ear");
    expect(parsed.assembly).toHaveLength(3);
    const v1 = { schemaVersion: 1, title: "T", overview: {}, parts: [{ name: "A", quantity: 1, content: { schemaVersion: 1, rows: [] } }] };
    expect(BuilderExportSchema.safeParse(v1).success).toBe(true);
  });

  it("rejects malformed colours, part ids and placements", () => {
    const bad = (edit: (d: Record<string, any>) => void) => {
      const d = doc() as unknown as Record<string, any>;
      edit(d);
      return BuilderExportSchema.safeParse(d).success;
    };
    expect(bad(() => {})).toBe(true);
    expect(bad((d) => (d.overview.colors[0].hex = "#fff"))).toBe(false);
    expect(bad((d) => (d.overview.colors[0].hex = "white"))).toBe(false);
    expect(bad((d) => (d.overview.colors[0].hex = "#GG0000"))).toBe(false);
    expect(bad((d) => (d.overview.colors[0].hex = "#A0b1C2"))).toBe(true);
    expect(bad((d) => (d.overview.colors[0].id = ""))).toBe(false);
    expect(bad((d) => (d.parts[0].id = ""))).toBe(false);
    expect(bad((d) => (d.assembly[0].kind = "glue"))).toBe(false);
    expect(bad((d) => (d.assembly[0].angle = Infinity))).toBe(false);
    expect(bad((d) => delete d.assembly[0].row)).toBe(false);
    expect(bad((d) => (d.assembly[1].spacing = -1))).toBe(false);
    expect(bad((d) => (d.assembly[1].size = 0))).toBe(false);
    expect(bad((d) => (d.assembly[1].extra = 1))).toBe(false);
  });

  it("validateExport: a consistent export has no findings", () => {
    expect(validateExport(doc())).toEqual([]);
  });

  it("validateExport reports duplicate ids, dangling references and unknown colours", () => {
    const d = doc();
    d.overview.colors!.push({ id: "white", name: "Noch ein Weiß" });
    d.parts.push({ id: "ear", name: "Ohr 2", quantity: 1, content: part([]) });
    d.parts[0]!.content.rows[1]!.color = "blue";
    d.assembly!.push(
      { id: "p1", kind: "eyes", target: "nose", row: "e1", angle: 0 },
      { id: "p4", kind: "attach", target: "head", row: "nope", angle: 90 },
      { id: "p5", kind: "attach", part: "tail", target: "head", row: "e1", angle: 180 },
    );
    const codes = validateExport(d).map((f) => [f.code, f.ref ?? f.placementId ?? f.rowId]);
    expect(codes).toContainEqual(["UNKNOWN_COLOR", "r2"]);
    expect(codes).toContainEqual(["DUPLICATE_PART_ID", "ear"]);
    expect(codes).toContainEqual(["DUPLICATE_COLOR_ID", "white"]);
    expect(codes).toContainEqual(["DUPLICATE_PLACEMENT_ID", "p1"]);
    expect(codes).toContainEqual(["UNKNOWN_PART", "nose"]);
    expect(codes).toContainEqual(["UNKNOWN_ROW", "nope"]);
    expect(codes).toContainEqual(["UNKNOWN_PART", "tail"]);
    expect(codes).toContainEqual(["ATTACH_WITHOUT_PART", "p4"]);
    const colour = validateExport(d).find((f) => f.code === "UNKNOWN_COLOR")!;
    expect(colour).toMatchObject({ severity: "error", partIndex: 0, rowId: "r2" });
    expect(validateExport(d).find((f) => f.code === "ATTACH_WITHOUT_PART")!.severity).toBe("warning");
  });
});

// ---------------------------------------------------------------------------
// Expansion and counts
// ---------------------------------------------------------------------------

describe("format v2 — expansion and counts", () => {
  it("expands a group into its stitches, each marked with its place in the group", () => {
    const atoms = expandRow(row("a", [st("SC"), grp([st("DC", 2), st("CH"), st("DC", 2)]), st("SC")], 6));
    expect(atoms.map((a) => a.code)).toEqual(["SC", "DC", "DC", "CH", "DC", "DC", "SC"]);
    expect(atoms.map((a) => a.group)).toEqual([undefined, 0, 1, 2, 3, 4, undefined]);
  });

  it("restarts the group marks for every repetition and inside a group's own repeats", () => {
    const atoms = expandRow(row("a", [rep(3, [grp([st("SC"), rep(2, [st("HDC")])])])], 9));
    expect(atoms).toHaveLength(9);
    expect(atoms.map((a) => a.group)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2]);
  });

  it("carries an op's colour on each of its stitches", () => {
    const atoms = expandRow(row("a", [st("SC", 2, { color: "pink" }), st("SC")], 3));
    expect(atoms.map((a) => a.color)).toEqual(["pink", "pink", undefined]);
  });

  it("3 SC in one stitch consumes 1 and produces 3; a V-stitch produces 2", () => {
    const three = row("a", [grp([st("SC", 3)])], 3);
    expect(computeRowStitches(three)).toBe(3);
    expect(anchorsConsumed(three)).toBe(1);
    const v = row("v", [grp([st("DC"), st("CH"), st("DC")])], 2);
    expect(computeRowStitches(v)).toBe(2);
    expect(anchorsConsumed(v)).toBe(1);
    expect(anchorsConsumed(row("e", [grp([])], 0))).toBe(0);
  });

  it("6 × (3 SC in one) after a round of 6 gives 18, with no findings", () => {
    expect(computeRowStitches(SHELLS.rows[1]!)).toBe(18);
    expect(anchorsConsumed(SHELLS.rows[1]!)).toBe(6);
    expect(anchorsOffered(SHELLS.rows[1]!)).toBe(18);
    expect(validate(SHELLS)).toEqual([]);
  });

  it("counts the new codes: bobble/puff/popcorn 1 for 1, a picot nothing", () => {
    const r = row("b", [st("BOBBLE"), st("PUFF"), st("POPCORN"), st("PICOT", 2), st("SC", 3)], 6);
    expect(computeRowStitches(r)).toBe(6);
    expect(anchorsConsumed(r)).toBe(6);
    expect(validate(part([row("r1", [st("MR"), st("SC", 6)], 6), r]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("format v2 — validation", () => {
  const ring = row("r1", [st("MR"), st("SC", 6)], 6);

  it("reports FP/BP on stitches without a post, and both on one stitch", () => {
    const ok = part([ring, row("r2", [st("DC", 3, { modifiers: ["FP"] }), st("SC", 3, { modifiers: ["BP"] })], 6)]);
    expect(validate(ok)).toEqual([]);
    const bad = part([
      ring,
      row("r2", [st("BOBBLE", 1, { modifiers: ["FP"] }), st("INC", 1, { modifiers: ["BP"] }), grp([st("DC", 2, { modifiers: ["FP", "BP"] })]), st("SC", 1)], 6),
    ]);
    const f = validate(bad).filter((x) => x.code === "INVALID_MODIFIER");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rowId: "r2", severity: "error", actual: 3 });
  });

  it("reports colour ids that are not in the palette, only when a palette is given", () => {
    const content = part([
      row("r1", [st("MR"), st("SC", 6)], 6, { color: "white" }),
      row("r2", [st("SC", 3, { color: "pink" }), st("SC", 3, { color: "blue" })], 6),
    ]);
    expect(validate(content)).toEqual([]);
    const f = validate(content, { palette: [{ id: "white" }, { id: "pink" }] });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rowId: "r2", code: "UNKNOWN_COLOR", actual: 1 });
    expect(f[0]!.message).toContain("blue");
  });

  it("warns about empty stitch groups (also inside repeats)", () => {
    const content = part([ring, row("r2", [rep(2, [grp([])]), st("SC", 6)], 6)]);
    const f = validate(content);
    expect(f.map((x) => x.code)).toEqual(["EMPTY_GROUP"]);
    expect(f[0]).toMatchObject({ severity: "warning", actual: 1 });
  });

  it("rejects a magic ring, decreases and TOG inside a group; an INC is two stitches into it", () => {
    const bad = (ops: Op[]) => validate(part([ring, row("r2", ops, 0)])).filter((x) => x.code === "INVALID_GROUP");
    expect(bad([rep(6, [grp([st("DEC")])])])).toHaveLength(1);
    expect(bad([grp([st("INVDEC"), st("SC")]), st("SC", 5)])[0]).toMatchObject({ severity: "error", actual: 1 });
    expect(bad([grp([st("SC", 2, { modifiers: ["TOG"] })]), st("SC", 5)])).toHaveLength(1);
    expect(bad([grp([rep(2, [st("MR")])]), st("SC", 5)])).toHaveLength(1);
    expect(bad([rep(6, [grp([st("SC", 3)])])])).toEqual([]);
    // "(inc, sc) in one stitch": 3 stitches into one stitch, no finding.
    const inc = part([ring, row("r2", [rep(6, [grp([st("INC"), st("SC")])])], 18)]);
    expect(computeRowStitches(inc.rows[1]!)).toBe(18);
    expect(anchorsConsumed(inc.rows[1]!)).toBe(6);
    expect(validate(inc)).toEqual([]);
    const g = buildGraph(inc);
    const r2 = g.nodes.filter((n) => n.rowId === "r2");
    expect(r2[0]!.parentSlots).toEqual(r2[1]!.parentSlots);
    expect(g.rows[1]!.anchorsOffered).toBe(18);
  });

  it("treats a group of only chains and picots as worked into no stitch, in validation and graph", () => {
    const content = part([ring, row("r2", [rep(6, [st("SC"), grp([st("CH", 3)]), grp([st("PICOT")])])], 6), row("r3", [st("SC", 6)], 6)]);
    expect(anchorsConsumed(content.rows[1]!)).toBe(6);
    expect(validate(content).map((f) => f.code)).toEqual(["EMPTY_GROUP"]);
    const g = buildGraph(content);
    const slots = new Set(g.nodes.filter((n) => n.rowId === "r2").flatMap((n) => (n.parentSlots ?? []).map((s) => `${s.node}:${s.slot}`)));
    expect(slots.size).toBe(6); // only the six SC
  });

  it("reads a row that is only a group of chains as a foundation chain, in validation and graph", () => {
    const content = part([row("f", [grp([st("CH", 5)])], 0, { type: "row" }), row("1", [st("SC", 4)], 4, { type: "row" })]);
    expect(anchorsOffered(content.rows[0]!)).toBe(5);
    const g = buildGraph(content);
    expect(g.rows[0]!.kind).toBe("chain");
    expect(g.rows[0]!.anchorsOffered).toBe(5);
    // Both skip the chain next to the hook: one chain left unworked. (The group itself is still
    // reported: nothing in it is worked into a stitch.)
    expect(validate(content).map((f) => [f.code, f.expected, f.actual])).toEqual([
      ["EMPTY_GROUP", undefined, 1],
      ["CONSUMES_UNDERFLOW", 5, 4],
    ]);
    expect(g.nodes.filter((n) => n.rowId === "1").map((n) => n.parents[0])).toEqual([3, 2, 1, 0]);
  });

  it("agrees with the graph on the anchors every kind of group consumes", () => {
    const cases: Op[][] = [
      [rep(6, [grp([st("SC", 3)])])],
      [rep(6, [grp([st("INC")])])],
      [rep(6, [grp([rep(2, [st("DC")]), st("CH"), rep(2, [st("DC")])])])],
      [rep(6, [grp([st("CH", 3)])])],
      [rep(6, [grp([st("PICOT")])])],
      [rep(3, [grp([st("CH"), st("DC", 2)]), st("SC")])],
      [rep(6, [grp([])]), st("SC", 6)],
    ];
    for (const ops of cases) {
      const content = part([ring, row("r2", ops, 0)]);
      const g = buildGraph(content);
      const slots = new Set(g.nodes.filter((n) => n.rowId === "r2").flatMap((n) => (n.parentSlots ?? []).map((s) => `${s.node}:${s.slot}`)));
      expect(slots.size, JSON.stringify(ops)).toBe(anchorsConsumed(content.rows[1]!));
      expect(g.rows[1]!.anchorsOffered, JSON.stringify(ops)).toBe(anchorsOffered(content.rows[1]!));
    }
  });

  it("checks the next row against the stitches a group row offers", () => {
    const content = part([ring, row("r2", [rep(6, [grp([st("SC", 3)])])], 18), row("r3", [st("SC", 20)], 20)]);
    expect(validate(content).map((x) => x.code)).toEqual(["CONSUMES_OVERFLOW"]);
  });
});

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

describe("format v2 — stitch graph", () => {
  const g = buildGraph(SHELLS);
  const w = g.gauge.stitchWidthMm;
  const h = g.gauge.stitchHeightMm;

  it("works the k stitches of a group into one parent slot, like an INC of k", () => {
    const r2 = g.nodes.filter((n) => n.rowId === "r2");
    const r1 = fabricOf(g, "r1");
    expect(r2).toHaveLength(18);
    for (let k = 0; k < 6; k++) {
      const trio = r2.slice(3 * k, 3 * k + 3);
      expect(trio.map((n) => n.parents)).toEqual([[r1[k]], [r1[k]], [r1[k]]]);
      expect(trio.map((n) => n.parentSlots)).toEqual([[{ node: r1[k], slot: 0 }], [{ node: r1[k], slot: 0 }], [{ node: r1[k], slot: 0 }]]);
      expect(trio.map((n) => n.group)).toEqual([trio[0]!.id, trio[0]!.id, trio[0]!.id]);
      expect(trio.map((n) => n.lean)).toEqual([-1, 0, 1]);
      expect(trio.map((n) => n.span)).toEqual([1, 1, 1]);
    }
    // Every stitch of the group offers its own slot: the next round has 18 distinct parents.
    expect(new Set(g.nodes.filter((n) => n.rowId === "r3").flatMap((n) => n.parents)).size).toBe(18);
    expect(g.rows[1]!.widthStitches).toBe(18);
    expect(g.rows[1]!.anchorsOffered).toBe(18);
  });

  it("lets the outer legs of a group lean like an INC's", () => {
    const [a, b, c] = g.nodes.filter((n) => n.rowId === "r2").slice(0, 3);
    const rest = (id: number) => g.edges.find((e) => e.kind === "parent" && e.b === id)!.restLength;
    expect(rest(b!.id)).toBeCloseTo(h, 9);
    expect(rest(a!.id)).toBeCloseTo(Math.hypot(h, LEG_LEAN * w), 9);
    expect(rest(c!.id)).toBeCloseTo(rest(a!.id), 9);
  });

  it("leaves chains inside a group without parent, but gives them width", () => {
    const content = part([row("r1", [st("MR"), st("SC", 6)], 6), row("r2", [rep(6, [grp([st("DC"), st("CH"), st("DC")])])], 12)]);
    const graph = buildGraph(content);
    const [d1, ch, d2] = graph.nodes.filter((n) => n.rowId === "r2");
    expect(ch!.code).toBe("CH");
    expect(ch!.parents).toEqual([]);
    expect(ch!.lift).toBe(false);
    expect(d1!.parents).toEqual(d2!.parents);
    expect([d1!.lean, ch!.lean, d2!.lean]).toEqual([-1, 0, 1]);
    expect(graph.rows[1]!.anchorsOffered).toBe(12);
    expect(graph.rows[1]!.widthStitches).toBe(18);
  });

  it("works a group row into a foundation chain one chain per group", () => {
    const content = part([
      row("f", [st("CH", 4)], 0, { type: "row" }),
      row("1", [rep(4, [grp([st("DC", 2)])])], 8, { type: "row" }),
    ]);
    const graph = buildGraph(content);
    const chains = graph.nodes.filter((n) => n.rowId === "f").map((n) => n.id);
    const parents = graph.nodes.filter((n) => n.rowId === "1").map((n) => n.parents[0]);
    expect(parents).toEqual([chains[3], chains[3], chains[2], chains[2], chains[1], chains[1], chains[0], chains[0]]);
  });

  it("makes bobble, puff and popcorn DC-tall one-stitch nodes with a bulge", () => {
    const content = part([row("r1", [st("MR"), st("SC", 6)], 6), row("r2", [st("BOBBLE"), st("PUFF"), st("POPCORN"), st("SC", 3)], 6)]);
    const graph = buildGraph(content);
    const sc = graph.nodes.find((n) => n.rowId === "r2" && n.code === "SC")!;
    for (const code of ["BOBBLE", "PUFF", "POPCORN"] as const) {
      const node = graph.nodes.find((n) => n.code === code)!;
      expect(node.span).toBe(1);
      expect(node.parents).toHaveLength(1);
      expect(node.height).toBeCloseTo(2 * sc.height, 9);
      expect(node.bulge).toBe(STITCH_BULGE[code]);
    }
    expect(sc.bulge).toBeUndefined();
  });

  it("puts a picot on the yarn path with zero width, no parent and no slot", () => {
    const content = part([
      row("r1", [st("MR"), st("SC", 6)], 6),
      row("r2", [rep(6, [st("SC"), st("PICOT")])], 6),
      row("r3", [st("SC", 6)], 6),
    ]);
    const graph = buildGraph(content);
    const picots = graph.nodes.filter((n) => n.code === "PICOT");
    expect(picots).toHaveLength(6);
    for (const p of picots) {
      expect(p.parents).toEqual([]);
      expect(p.span).toBe(0);
      expect(p.height).toBe(0);
      expect(isFabricNode(p)).toBe(false);
      expect(graph.nodes[p.id + 1]?.prev).toBe(p.id);
    }
    expect(graph.rows[1]!.anchorsOffered).toBe(6);
    expect(graph.rows[1]!.widthStitches).toBe(6);
    // Round 3 is worked into the six SC, never into a picot.
    const sc = new Set(graph.nodes.filter((n) => n.rowId === "r2" && n.code === "SC").map((n) => n.id));
    expect(graph.nodes.filter((n) => n.rowId === "r3").every((n) => n.parents.every((p) => sc.has(p)))).toBe(true);
    const relaxed = relax(graph);
    expect(Array.from(relaxed.positions).every(Number.isFinite)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Relaxation: finish and stuffing
// ---------------------------------------------------------------------------

/** Extent of a round: its longest chord and the largest distance from that chord's line. */
function roundShape(g: StitchGraph, rowId: string): { width: number; thickness: number } {
  const pts = fabricOf(g, rowId).map((id) => P(g, id));
  let width = 0;
  let a: V3 = pts[0]!;
  let b: V3 = pts[0]!;
  for (const p of pts) {
    for (const q of pts) {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (d > width) {
        width = d;
        a = p;
        b = q;
      }
    }
  }
  const u: V3 = [(b[0] - a[0]) / width, (b[1] - a[1]) / width, (b[2] - a[2]) / width];
  let thickness = 0;
  for (const p of pts) {
    const v: V3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const t = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
    thickness = Math.max(thickness, Math.hypot(v[0] - t * u[0], v[1] - t * u[1], v[2] - t * u[2]));
  }
  return { width, thickness };
}

describe("format v2 — finish", () => {
  const graph = buildGraph(part(TUBE_ROWS));
  const relaxed = (finish: "open" | "gather" | "flat") => relax(graph, { finish });
  const open = relaxed("open");
  const gather = relaxed("gather");
  const flat = relaxed("flat");
  const w = graph.gauge.stitchWidthMm;

  it("resolves the finish from the option, else from `closed`, else from the shape", () => {
    expect(resolveFinish(graph)).toBe("open"); // a straight tube is open
    expect(resolveFinish(graph, { closed: true })).toBe("gather");
    expect(resolveFinish(graph, { finish: "flat", closed: false })).toBe("flat");
    expect(resolveFinish(buildGraph(part(BALL_ROWS)))).toBe("gather");
  });

  it("open leaves the last round a circle as wide as the tube", () => {
    const last = measureRounds(open).at(-1)!;
    expect(last.circularity).toBeLessThan(0.1);
    expect(last.diameter).toBeGreaterThan(0.8 * ((18 * w) / Math.PI));
    const s = roundShape(open, "e5");
    expect(s.thickness / s.width).toBeGreaterThan(0.4); // a circle: 0.5
  });

  it("gather pulls the last round together", () => {
    const last = measureRounds(gather).at(-1)!;
    const openLast = measureRounds(open).at(-1)!;
    expect(last.diameter).toBeLessThan(0.6 * openLast.diameter);
  });

  it("flat presses the last round into a straight seam: wide, but thin", () => {
    const s = roundShape(flat, "e5");
    expect(s.thickness / s.width).toBeLessThan(0.15);
    // Half the round's circumference lies along the seam.
    expect(s.width).toBeGreaterThan(0.75 * (18 / 2) * w);
    // The joined stitches lie against each other.
    const ids = fabricOf(flat, "e5");
    for (let k = 0; k < 9; k++) {
      const a = P(flat, ids[k]!);
      const b = P(flat, ids[17 - k]!);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1.2 * w);
    }
    expect(Array.from(flat.positions).every(Number.isFinite)).toBe(true);
  });

  it("is deterministic per finish", () => {
    expect(Array.from(relaxed("flat").positions)).toEqual(Array.from(flat.positions));
  });

  it("seamStrip triangulates a flattened round between its halves, in working order", () => {
    expect(seamStrip(3)).toEqual([[0, 1, 2]]);
    expect(seamStrip(4)).toEqual([
      [0, 1, 3],
      [1, 2, 3],
    ]);
    for (const S of [4, 5, 6, 18, 19]) {
      const strip = seamStrip(S);
      expect(strip).toHaveLength(S - 2);
      for (const [a, b, c] of strip) expect(a < b && b < c).toBe(true);
      // Every rim edge of the polygon is used exactly once.
      const used = new Set(strip.flatMap(([a, b, c]) => [`${a}-${b}`, `${b}-${c}`, `${a}-${c}`]));
      for (let k = 0; k < S; k++) expect(used.has(k + 1 < S ? `${k}-${k + 1}` : `0-${S - 1}`)).toBe(true);
    }
  });
});

describe("format v2 — stuffing levels", () => {
  /** Volume of the closed surface mesh of a model (mm³). */
  const volume = (stuffing: "none" | "light" | "firm") => {
    const model = buildModel(part(BALL_ROWS, { stuffing }));
    const mesh = toMesh(model.graph, "surface", { finish: model.finish });
    return Math.abs(signedVolume(Float64Array.from(mesh.positions), mesh.indices));
  };

  it("maps the part's levels onto the stuffing option", () => {
    expect(STUFFING_LEVELS).toEqual({ none: 0, light: 0.5, firm: 1 });
    expect(relaxOptionsForPart({ stuffing: "light", finish: "flat" })).toEqual({ stuffing: 0.5, finish: "flat" });
    expect(relaxOptionsForPart({})).toEqual({});
  });

  it("lets explicit options win over the part's own finish and stuffing", () => {
    const content = part([], { finish: "flat", stuffing: "firm" });
    expect(partRelaxOptions(content)).toEqual({ finish: "flat", stuffing: 1 });
    expect(partRelaxOptions(content, { stuffing: "auto" })).toEqual({ finish: "flat", stuffing: 1 });
    expect(partRelaxOptions(content, { stuffing: 0.2, closed: false })).toEqual({ stuffing: 0.2, closed: false });
    expect(partRelaxOptions(content, { finish: "open" })).toEqual({ finish: "open", stuffing: 1 });
  });

  it("orders the volume: none < light < firm", () => {
    const none = volume("none");
    const light = volume("light");
    const firm = volume("firm");
    expect(none).toBeLessThan(light);
    expect(light).toBeLessThan(firm);
    expect(firm / none).toBeGreaterThan(1.15);
  });

  it("buildModel reports the finish it relaxed with", () => {
    expect(buildModel(part(BALL_ROWS)).finish).toBe("gather");
    expect(buildModel(part(TUBE_ROWS)).finish).toBe("open");
    expect(buildModel(part(TUBE_ROWS, { finish: "flat" })).finish).toBe("flat");
    expect(buildModel(part(TUBE_ROWS, { finish: "flat" }), undefined, { closed: true }).finish).toBe("gather");
  });
});

// ---------------------------------------------------------------------------
// Mesh
// ---------------------------------------------------------------------------

describe("format v2 — mesh", () => {
  it("closes a flat finish with a strip across the seam: a watertight surface without a pole", () => {
    const g = relax(buildGraph(part(TUBE_ROWS)), { finish: "flat" });
    const mesh = toMesh(g, "surface", { finish: "flat" });
    expect(mesh.positions.length / 3).toBe(g.nodes.length); // no pole vertex
    const count = new Map<string, number>();
    for (let t = 0; t < mesh.indices.length; t += 3) {
      for (let j = 0; j < 3; j++) {
        const a = mesh.indices[t + j]!;
        const b = mesh.indices[t + ((j + 1) % 3)]!;
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        count.set(key, (count.get(key) ?? 0) + 1);
      }
    }
    expect([...count.values()].every((c) => c === 2)).toBe(true);
    const open = toMesh(g, "surface", { finish: "open" });
    expect(mesh.indices.length - open.indices.length).toBe(3 * 16);
  });

  it("carries a palette index per vertex in every style", () => {
    const g = relax(buildGraph(SHELLS));
    const nodeColors = Uint16Array.from(g.nodes, (n) => (n.rowId === "r2" ? 1 : 0));
    for (const style of ["surface", "tube", "points", "stitches"] as const) {
      const mesh = toMesh(g, style, { nodeColors });
      expect(mesh.colorIndex).toBeInstanceOf(Uint16Array);
      expect(mesh.colorIndex!.length).toBe(mesh.nodeIndex.length);
      for (let v = 0; v < mesh.nodeIndex.length; v++) expect(mesh.colorIndex![v]).toBe(nodeColors[mesh.nodeIndex[v]!]);
      expect(new Set(mesh.colorIndex)).toEqual(new Set([0, 1]));
    }
    expect(toMesh(g, "surface").colorIndex).toBeUndefined();
  });

  it("draws a bobble standing proud of the fabric and a picot as a loop", () => {
    const swatch = (code: StitchCode) =>
      relax(
        buildGraph(
          part([
            row("f", [st("CH", 7)], 0, { type: "row" }),
            row("1", [st("SC", 6)], 6, { type: "row" }),
            row("2", [st("CH"), st("SC", 2), st(code), st("SC", 3)], 6, { type: "row" }),
            row("3", [st("CH"), st("SC", 6), st("PICOT")], 6, { type: "row" }),
          ]),
        ),
      );
    /** How far the yarn of the stitch sits from its node: the centroid of its vertices. */
    const proud = (code: StitchCode) => {
      const g = swatch(code);
      const node = g.nodes.find((n) => n.rowId === "2" && n.code === code)!;
      const mesh = toMesh(g, "stitches");
      const c = [0, 0, 0];
      let k = 0;
      for (let v = 0; v < mesh.nodeIndex.length; v++) {
        if (mesh.nodeIndex[v] !== node.id) continue;
        for (let a = 0; a < 3; a++) c[a] = c[a]! + mesh.positions[3 * v + a]!;
        k++;
      }
      const p = P(g, node.id);
      return { offset: Math.hypot(c[0]! / k - p[0], c[1]! / k - p[1], c[2]! / k - p[2]), mesh, g };
    };
    const bobble = proud("BOBBLE");
    const dc = proud("DC"); // as tall as a bobble
    expect(bobble.offset).toBeGreaterThan(dc.offset + 0.25 * resolveGauge().stitchWidthMm);
    const picot = bobble.g.nodes.find((n) => n.code === "PICOT")!;
    expect(Array.from(bobble.mesh.nodeIndex).filter((i) => i === picot.id).length).toBeGreaterThan(0);
  });
});

describe("format v2 — free instructions between rounds", () => {
  it("builds, relaxes and meshes every finish in every style with notes between the rounds", () => {
    const rows = [...TUBE_ROWS];
    rows.splice(1, 0, row("n1", [], 0, { note: "Faden markieren" }));
    rows.splice(5, 0, row("n2", [], 0, { note: "Augen einsetzen", color: "c1" }));
    for (const finish of ["open", "gather", "flat"] as const) {
      const model = buildModel(part(rows, { finish }));
      expect(model.finish).toBe(finish);
      expect(Array.from(model.graph.positions).every(Number.isFinite)).toBe(true);
      for (const style of ["surface", "tube", "points", "stitches"] as const) {
        const mesh = toMesh(model.graph, style, { finish, smooth: "auto" });
        expect(mesh.positions.length, `${finish} ${style}`).toBeGreaterThan(0);
        expect(Array.from(mesh.positions).every(Number.isFinite), `${finish} ${style}`).toBe(true);
      }
    }
  });
});

describe("format v2 — whole-part check", () => {
  it("expandPart, graph and validation agree on a part using every v2 construct", () => {
    const content = part(
      [
        row("r1", [st("MR"), st("SC", 6)], 6, { color: "white" }),
        row("r2", [rep(6, [grp([st("HDC", 2)])])], 12),
        row("r3", [rep(6, [st("SC", 1, { color: "pink" }), st("BOBBLE", 1, { color: "white" })])], 12),
        row("r4", [rep(4, [st("DC", 1, { modifiers: ["FP"] }), st("SC", 2), st("PICOT")])], 12),
        row("r5", [st("DEC", 6)], 6),
      ],
      { finish: "gather", stuffing: "light" },
    );
    expect(validate(content, { palette: [{ id: "white" }, { id: "pink" }] })).toEqual([]);
    const atoms = expandPart(content);
    const g = buildGraph(content);
    expect(g.nodes).toHaveLength(atoms.length);
    const model = buildModel(content);
    expect(model.finish).toBe("gather");
    expect(Array.from(model.graph.positions).every(Number.isFinite)).toBe(true);
  });
});
