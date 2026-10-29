/**
 * Joining while crocheting (`StitchOp.from` / `.through`): schema, single-part validation,
 * cross-part resolution and findings, the stitch graph and the joint relaxation. Shapes are
 * checked by measures and topology only.
 */
import { describe, expect, it } from "vitest";
import { composeAssembly, applyTransform } from "./assembly-scene.js";
import { validateExport, type BuilderExport } from "./export.js";
import { buildGraph, isFabricNode, type StitchGraph } from "./graph.js";
import { gathersByDefault, joinCapacity, planJoins } from "./join.js";
import { buildJoinedModels, type JoinedComponent } from "./joined.js";
import { buildModel } from "./model.js";
import { relax } from "./relax.js";
import { PartContentSchema, StitchOpSchema, usesFormatV2 } from "./schema.js";
import { anchorsConsumed, checkConsumes, validate } from "./validate.js";
import { armDoc, content, legsDoc, pumpkinDoc, rep, rnd, sealDoc, st, tube } from "./test/join-fixtures.js";

type V = [number, number, number];
const P = (g: StitchGraph, i: number): V => [g.positions[3 * i]!, g.positions[3 * i + 1]!, g.positions[3 * i + 2]!];
const centroid = (ps: V[]): V => ps.reduce<V>((a, p) => [a[0] + p[0] / ps.length, a[1] + p[1] / ps.length, a[2] + p[2] / ps.length], [0, 0, 0]);
const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const horizontal = (a: V, b: V) => Math.hypot(a[0] - b[0], a[2] - b[2]);
function rowPoints(g: StitchGraph, rowId: string): V[] {
  const r = g.rows.find((x) => x.rowId === rowId)!;
  const out: V[] = [];
  for (let i = r.firstNode; i < r.firstNode + r.nodeCount; i++) if (isFabricNode(g.nodes[i]!)) out.push(P(g, i));
  return out;
}
const allPoints = (g: StitchGraph) => g.nodes.map((_, i) => P(g, i));
const yRange = (g: StitchGraph) => {
  const ys = allPoints(g).map((p) => p[1]);
  return { min: Math.min(...ys), max: Math.max(...ys) };
};
const codes = (doc: BuilderExport) => validateExport(doc).map((f) => f.code);
const only = (c: JoinedComponent, part: number, copy = 0) => c.parts.find((p) => p.part === part && p.copy === copy)!;

describe("schema", () => {
  it("accepts from / through with part, copy, row and start — strictly, and only in format v2", () => {
    const op = { kind: "stitch", code: "SC", count: 18, from: { part: "leg", copy: 2, row: "r5", start: 0 } };
    expect(StitchOpSchema.safeParse(op).success).toBe(true);
    expect(StitchOpSchema.safeParse({ kind: "stitch", code: "SC", count: 5, through: { part: "arm" } }).success).toBe(true);
    expect(StitchOpSchema.safeParse({ ...op, from: { part: "leg", side: 1 } }).success).toBe(false);
    expect(StitchOpSchema.safeParse({ ...op, from: { part: "" } }).success).toBe(false);
    expect(StitchOpSchema.safeParse({ ...op, from: { part: "leg", copy: 0 } }).success).toBe(false);
    expect(StitchOpSchema.safeParse({ ...op, from: { part: "leg", start: -1 } }).success).toBe(false);
    const c = content([rnd("r1", [st("SC", 6, { from: { part: "x" } })], 6)]);
    expect(usesFormatV2(c)).toBe(true);
    expect(PartContentSchema.safeParse(c).success).toBe(true);
    expect(PartContentSchema.safeParse({ ...c, schemaVersion: 1 }).success).toBe(false);
  });
});

describe("validation of one part", () => {
  it("does not count stitches worked into another part against the own previous row", () => {
    const body = legsDoc().parts[1]!.content;
    const round = body.rows[1]!;
    expect(anchorsConsumed(round)).toBe(6); // only the two sides of the bridge
    expect(checkConsumes(body)).toEqual([]);
    expect(validate(body)).toEqual([]);
    // A first round made only of joined stitches needs no previous row.
    expect(validate(pumpkinDoc().parts[1]!.content)).toEqual([]);
  });

  it("reports joins that cannot be worked (INVALID_JOIN)", () => {
    const bad = content([
      rnd("r1", [st("MR"), st("SC", 6)], 6),
      rnd("r2", [st("SC", 6, { from: { part: "a" }, through: { part: "b" } })], 6),
      rnd("r3", [{ kind: "group", ops: [{ kind: "stitch", code: "SC", count: 2, from: { part: "a" } }] }, st("SC", 5)], 7),
      rnd("r4", [st("CH", 1, { from: { part: "a" } }), st("SC", 7)], 7),
    ]);
    const found = validate(bad).filter((f) => f.code === "INVALID_JOIN");
    expect(found.map((f) => f.rowId)).toEqual(["r2", "r3", "r4"]);
    expect(found.every((f) => f.severity === "error")).toBe(true);
  });
});

describe("planJoins", () => {
  it("takes leg copy 1 and copy 2 in turn, each from its first stitch", () => {
    const plan = planJoins(legsDoc());
    expect(plan.findings).toEqual([]);
    expect(plan.sources.map((s) => [s.part, s.copy, s.rowId, s.capacity])).toEqual([
      [0, 0, "le4", 18],
      [0, 1, "le4", 18],
    ]);
    const fromLeg = (copy: number) => plan.links.filter((l) => plan.sources[l.source]!.copy === copy);
    expect(fromLeg(0).map((l) => l.slot)).toEqual([...Array(18).keys()]);
    expect(fromLeg(1).map((l) => l.offset)).toEqual([...Array(18).keys()].map((k) => 21 + k));
    expect(plan.components).toEqual([[{ part: 0, copy: 0 }, { part: 0, copy: 1 }, { part: 1, copy: 0 }]]);
  });

  it("continues where the previous join into the same row stopped, or at `start`", () => {
    const plan = planJoins(sealDoc());
    expect(plan.findings).toEqual([]);
    // Two copies of a branch without `start`: the first and the second half of the tail.
    expect(plan.links.map((l) => [l.copy, l.slot])).toEqual([...Array(12).keys()].map((k) => [k < 6 ? 0 : 1, k]));
    const doc = sealDoc();
    doc.parts[1]!.quantity = 1;
    doc.parts.push({ id: "fin2", name: "B", quantity: 1, content: content([rnd("g1", [st("SC", 6, { from: { part: "seal", start: 6 } })], 6)]) });
    const explicit = planJoins(doc);
    expect(explicit.findings).toEqual([]);
    expect(explicit.links.filter((l) => l.part === 2).map((l) => l.slot)).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it("counts a decrease as two stitches of the other part, and a round as pairs for `through`", () => {
    const doc = legsDoc();
    const b1 = doc.parts[1]!.content.rows[1]!;
    b1.ops[0] = st("DEC", 9, { from: { part: "leg", copy: 1 } });
    b1.stitchCountTarget = 33;
    const plan = planJoins(doc);
    expect(plan.links.filter((l) => plan.sources[l.source]!.copy === 0).map((l) => [l.slot, l.count])[1]).toEqual([2, 2]);
    expect(plan.findings).toEqual([]);
    const arm = armDoc();
    expect(joinCapacity(arm.parts[1]!.content.rows.at(-1)!, "through")).toEqual({ capacity: 4, layered: true });
    expect(planJoins(arm).findings).toEqual([]);
  });

  it("reports unknown parts, copies and rows, and joins to the own part", () => {
    const doc = legsDoc();
    const ops = doc.parts[1]!.content.rows[1]!.ops;
    ops[0] = st("SC", 18, { from: { part: "nope" } });
    ops[2] = st("SC", 18, { from: { part: "leg", copy: 3 } });
    expect(codes(doc)).toEqual(expect.arrayContaining(["JOIN_UNKNOWN_PART", "JOIN_UNKNOWN_COPY"]));
    const doc2 = legsDoc();
    doc2.parts[1]!.content.rows[1]!.ops[0] = st("SC", 18, { from: { part: "leg", row: "zzz" } });
    doc2.parts[1]!.content.rows[1]!.ops[2] = st("SC", 18, { from: { part: "body" } });
    expect(codes(doc2)).toEqual(expect.arrayContaining(["JOIN_UNKNOWN_ROW", "JOIN_SELF"]));
    const f = validateExport(doc2).find((x) => x.code === "JOIN_UNKNOWN_ROW")!;
    expect(f).toMatchObject({ severity: "error", partIndex: 1, rowId: "b1", ref: "zzz" });
  });

  it("reports cycles between parts", () => {
    const doc: BuilderExport = {
      schemaVersion: 2,
      title: "c",
      overview: {},
      parts: [
        { id: "a", name: "A", quantity: 1, content: content([...tube("a", 12, 1), rnd("ax", [st("SC", 6, { from: { part: "b" } }), st("SC", 6)], 12)]) },
        { id: "b", name: "B", quantity: 1, content: content([...tube("b", 12, 1), rnd("bx", [st("SC", 6, { from: { part: "a", row: "ae1" } }), st("SC", 6)], 12)]) },
      ],
    };
    const cycle = validateExport(doc).filter((f) => f.code === "JOIN_CYCLE");
    expect(cycle.map((f) => f.partIndex)).toEqual([0, 1]);
  });

  it("reports stitches taken twice, beyond the row, or left free", () => {
    const twice = sealDoc();
    twice.parts[1]!.content.rows[0]!.ops = [st("SC", 6, { from: { part: "seal", start: 0 } })];
    expect(codes(twice)).toContain("JOIN_OVERLAP");
    const beyond = sealDoc();
    beyond.parts[1]!.content.rows[0]!.ops = [st("SC", 6, { from: { part: "seal", start: 9 } })];
    const over = validateExport(beyond).find((f) => f.code === "JOIN_OVERFLOW")!;
    expect(over).toMatchObject({ severity: "error", partIndex: 1, expected: 12, actual: 15 });
    const free = sealDoc();
    free.parts[1]!.quantity = 1;
    const under = validateExport(free).find((f) => f.code === "JOIN_UNDERFLOW")!;
    expect(under).toMatchObject({ severity: "warning", expected: 12, actual: 6 });
  });

  it("warns about `through` on an end that is gathered shut, and about a joined part that is also sewn on", () => {
    const arm = armDoc();
    expect(codes(arm)).not.toContain("THROUGH_NOT_FLAT");
    delete arm.parts[1]!.content.finish; // an open tube: fine
    expect(codes(arm)).not.toContain("THROUGH_NOT_FLAT");
    arm.parts[1]!.content.finish = "gather";
    expect(validateExport(arm).find((f) => f.code === "THROUGH_NOT_FLAT")).toMatchObject({ severity: "warning", partIndex: 0, rowId: "join" });
    const ball = content([...tube("x", 18, 2), rnd("xd", [rep(6, [st("SC"), st("DEC")])], 12), rnd("xd2", [st("DEC", 6)], 6)]);
    expect(gathersByDefault(ball)).toBe(true);
    const placed = legsDoc();
    placed.assembly = [{ id: "p1", kind: "attach", part: "leg", target: "body", row: "be3", angle: 0 }];
    expect(validateExport(placed).find((f) => f.code === "JOINED_AND_PLACED")).toMatchObject({ severity: "warning", placementId: "p1", partIndex: 0 });
  });
});

describe("the stitch graph of a joined part", () => {
  it("gives stitches worked into another part no parents and keeps the own fabric apart from them", () => {
    const body = legsDoc().parts[1]!.content;
    const g = buildGraph(body);
    const b1 = g.rows[1]!;
    const nodes = g.nodes.slice(b1.firstNode, b1.firstNode + b1.nodeCount);
    expect(nodes.filter((n) => n.joined === "from")).toHaveLength(36);
    expect(nodes.filter((n) => n.joined === "from").every((n) => n.parents.length === 0)).toBe(true);
    expect(nodes.filter((n) => !n.joined).every((n) => n.parents.length === 1)).toBe(true);
    expect(b1.closed).toBe(true);
    // No triangle of the first round reaches across a leg (between stitches that are not neighbours).
    for (let t = 0; t < g.triangles.length; t += 3) {
      const ids = [g.triangles[t]!, g.triangles[t + 1]!, g.triangles[t + 2]!].filter((i) => g.nodes[i]!.rowId === "b1");
      for (const a of ids) {
        for (const b of ids) {
          const d = Math.abs(a - b);
          expect(Math.min(d, b1.nodeCount - d)).toBeLessThanOrEqual(2);
        }
      }
    }
    // The stem's first round, worked into the pumpkin, is a closed round of its own.
    const stem = buildGraph(pumpkinDoc().parts[1]!.content);
    expect(stem.rows[0]!.closed).toBe(true);
    expect(stem.rows[0]!.widthStitches).toBe(24);
  });

  it("keeps a part without joins exactly as before (through stitches are wired as usual)", () => {
    const arm = armDoc();
    const g = buildGraph(arm.parts[0]!.content);
    const join = g.rows.find((r) => r.rowId === "join")!;
    const through = g.nodes.slice(join.firstNode, join.firstNode + join.nodeCount).filter((n) => n.joined === "through");
    expect(through).toHaveLength(4);
    expect(through.every((n) => n.parents.length === 1)).toBe(true);
    const plain = content(tube("p", 18, 3));
    expect(Array.from(relax(buildGraph(plain)).positions)).toEqual(Array.from(buildModel(plain).graph.positions));
  });
});

describe("joint relaxation", () => {
  it("puts both legs side by side under the body, roughly symmetric, the bridge between them", () => {
    const doc = legsDoc();
    const { components, plan } = buildJoinedModels(doc);
    expect(plan.findings).toEqual([]);
    expect(components).toHaveLength(1);
    const c = components[0]!;
    expect(c.parts.map((p) => [p.part, p.copy])).toEqual([[0, 0], [0, 1], [1, 0]]);
    expect(c.root).toBe(2); // the body
    const leg1 = only(c, 0, 0).graph;
    const leg2 = only(c, 0, 1).graph;
    const body = only(c, 1).graph;
    const w = body.gauge.stitchWidthMm;
    const h = body.gauge.stitchHeightMm;
    const l1 = centroid(allPoints(leg1));
    const l2 = centroid(allPoints(leg2));
    const b = centroid(allPoints(body));
    // Under the body: the legs end where the body starts, the body above them.
    expect(yRange(leg1).max).toBeLessThan(b[1]);
    expect(yRange(leg2).max).toBeLessThan(b[1]);
    expect(yRange(body).min).toBeGreaterThan(Math.min(l1[1], l2[1]));
    // Side by side, more than a leg's width apart, about the body's axis.
    const legDiameter = (18 * w) / Math.PI;
    const apart = horizontal(l1, l2);
    expect(apart).toBeGreaterThan(legDiameter);
    expect(horizontal([l1[0] + l2[0], 0, l1[2] + l2[2]], [2 * b[0], 0, 2 * b[2]])).toBeLessThan(0.15 * apart);
    expect(Math.abs(l1[1] - l2[1])).toBeLessThan(0.5 * h);
    // The bridge lies between the legs.
    const bridge = centroid(rowPoints(body, "bridge"));
    const axis: V = [l2[0] - l1[0], 0, l2[2] - l1[2]];
    const t = ((bridge[0] - l1[0]) * axis[0] + (bridge[2] - l1[2]) * axis[2]) / (axis[0] ** 2 + axis[2] ** 2);
    expect(t).toBeGreaterThan(0.3);
    expect(t).toBeLessThan(0.7);
    // Every joined stitch sits on the stitch of the leg it is worked into.
    const b1 = body.rows[1]!;
    const top1 = leg1.rows.at(-1)!;
    const gaps = [...Array(18).keys()].map((k) => dist(P(body, b1.firstNode + k), P(leg1, top1.firstNode + k))).sort((x, y) => x - y);
    expect(gaps[9]!).toBeLessThan(1.2 * h); // median: one stitch height, as a parent
    expect(gaps[17]!).toBeLessThan(2.5 * h); // the ends next to the bridge are pulled towards it
    // The fabric across the joins: one strip per leg.
    expect(c.bridge.triangles.length / 3).toBeGreaterThanOrEqual(2 * 17);
  });

  it("puts the stem on top of the pumpkin", () => {
    const c = buildJoinedModels(pumpkinDoc()).components[0]!;
    const pumpkin = only(c, 0).graph;
    const stem = only(c, 1).graph;
    const h = pumpkin.gauge.stitchHeightMm;
    const top = centroid(rowPoints(pumpkin, "ptop"));
    const base = centroid(rowPoints(stem, "s1"));
    const tip = centroid(rowPoints(stem, "s6"));
    const radius = Math.max(...rowPoints(pumpkin, "pe1").map((p) => horizontal(p, centroid(rowPoints(pumpkin, "pe1")))));
    expect(yRange(pumpkin).max).toBeLessThan(yRange(stem).max);
    expect(base[1]).toBeGreaterThan(top[1]);
    expect(base[1] - top[1]).toBeLessThan(2 * h);
    expect(tip[1]).toBeGreaterThan(base[1] + 3 * h);
    expect(horizontal(tip, top)).toBeLessThan(0.2 * radius);
    // The pumpkin's last round stays open: the stem goes on from it.
    expect(only(c, 0).finish).toBe("open");
  });

  it("lets the two branches of the seal's tail diverge", () => {
    const c = buildJoinedModels(sealDoc()).components[0]!;
    const seal = only(c, 0).graph;
    const a = only(c, 1, 0).graph;
    const b = only(c, 1, 1).graph;
    const h = seal.gauge.stitchHeightMm;
    const baseA = centroid(rowPoints(a, "f1"));
    const baseB = centroid(rowPoints(b, "f1"));
    const tipA = centroid(rowPoints(a, "f4"));
    const tipB = centroid(rowPoints(b, "f4"));
    expect(dist(tipA, tipB)).toBeGreaterThan(1.25 * dist(baseA, baseB));
    // Both start on the tail and grow away from the body.
    const tail = centroid(rowPoints(seal, "tail"));
    expect(dist(baseA, tail)).toBeLessThan(dist(tipA, tail));
    expect(Math.min(baseA[1], baseB[1])).toBeGreaterThan(tail[1] - h);
    expect(tipA[1]).toBeGreaterThan(tail[1]);
  });

  it("hangs the arm worked `through` at the body's side, at the height of its round", () => {
    const c = buildJoinedModels(armDoc()).components[0]!;
    const body = only(c, 0).graph;
    const arm = only(c, 1).graph;
    const h = body.gauge.stitchHeightMm;
    const round = rowPoints(body, "join");
    const axis = centroid(round);
    const radius = round.reduce((s, p) => s + horizontal(p, axis), 0) / round.length;
    const edge = centroid(rowPoints(arm, "ae5"));
    const tip = centroid(rowPoints(arm, "a1"));
    expect(horizontal(edge, axis)).toBeGreaterThan(0.7 * radius);
    expect(horizontal(tip, axis)).toBeGreaterThan(radius + 3 * h);
    expect(Math.abs(edge[1] - axis[1])).toBeLessThan(1.5 * h);
    // The arm's edge lies on the four body stitches worked through it.
    const join = body.rows.find((r) => r.rowId === "join")!;
    const through = [];
    for (let i = join.firstNode; i < join.firstNode + join.nodeCount; i++) if (body.nodes[i]!.joined === "through") through.push(P(body, i));
    expect(dist(centroid(through), edge)).toBeLessThan(1.5 * h);
  });

  it("is deterministic and stays within the budget for a body and two legs of ~1,500 stitches", () => {
    const doc = legsDoc(24, 3, 12, 12);
    buildJoinedModels(doc, undefined, { iterations: 10 }); // warm-up (JIT)
    const times: number[] = [];
    let last: JoinedComponent | undefined;
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      last = buildJoinedModels(doc).components[0]!;
      times.push(performance.now() - t0);
    }
    const stitches = last!.parts.reduce((s, p) => s + p.graph.nodes.length, 0);
    expect(stitches).toBeGreaterThan(1450);
    expect(stitches).toBeLessThan(1700);
    times.sort((a, b) => a - b);
    expect(times[1]!).toBeLessThan(1000);
    const again = buildJoinedModels(doc).components[0]!;
    expect(Array.from(again.parts[2]!.graph.positions)).toEqual(Array.from(last!.parts[2]!.graph.positions));
  });

  it("skips components with a part over the budget", () => {
    const res = buildJoinedModels(legsDoc(), undefined, { maxStitches: 50 });
    expect(res.components).toEqual([]);
    expect(res.skipped[0]!.reason).toBe("overBudget");
  });
});

describe("assembly of joined parts", () => {
  it("draws joined copies where the joint relaxation put them and drops their placements", () => {
    const doc = legsDoc();
    doc.parts.push({ id: "head", name: "Kopf", quantity: 1, content: content([...tube("h", 24, 3), rnd("hd", [rep(6, [st("SC", 2), st("DEC")])], 18)]) });
    doc.assembly = [
      { id: "p1", kind: "attach", part: "leg", target: "body", row: "be2", angle: 30 },
      { id: "p2", kind: "attach", part: "head", target: "body", row: doc.parts[1]!.content.rows.at(-1)!.id, angle: 0 },
    ];
    const joined = buildJoinedModels(doc).components;
    const models = doc.parts.map((p) => buildModel(p.content));
    const scene = composeAssembly(doc, models, { joined });
    expect(scene.findings.map((f) => f.code)).toEqual(["JOINED"]);
    const legs = scene.instances.filter((i) => i.part === 0);
    expect(legs.map((i) => [i.copy, i.joined, i.placed])).toEqual([
      [0, true, true],
      [1, true, true],
    ]);
    const body = scene.instances.find((i) => i.part === 1)!;
    expect(body.joined).toBe(true);
    // All joined copies share one frame (the body is the main part, at identity).
    for (const i of [...legs, body]) expect(i.transform.rotation).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    // The head sits on the top of the joined body.
    const head = scene.instances.find((i) => i.part === 2)!;
    expect(head.placed).toBe(true);
    const bodyGraph = joined[0]!.parts.find((p) => p.part === 1)!.graph;
    const headBase = applyTransform(head.transform, centroid(rowPoints(models[2]!.graph, "hd")));
    expect(headBase[1]).toBeGreaterThan(yRange(bodyGraph).max - 2 * bodyGraph.gauge.stitchHeightMm);
  });
});
