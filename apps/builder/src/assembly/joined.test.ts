/** The Montage with parts crocheted together: one joint relaxation, a mesh per joined copy. */
import { describe, expect, it } from "vitest";
import type { Op, Row } from "@crochetbuilder/engine";
import { combineScene } from "./combine.js";
import { AssemblyComputer, assemblyTransferables, joinedMeshesOf, meshesByPart, type AssemblyDoc, type AssemblyResult } from "./compute.js";

const st = (code: "MR" | "SC" | "INC" | "DEC" | "CH", count: number, extra: Partial<Extract<Op, { kind: "stitch" }>> = {}): Op => ({ kind: "stitch", code, count, ...extra });
const rnd = (id: string, ops: Op[], t: number, extra: Partial<Row> = {}): Row => ({ id, type: "round", ops, stitchCountTarget: t, ...extra });

/** Two legs (one part ×2) joined into a body by a bridge of 2 chains. */
function legsDoc(): AssemblyDoc {
  const leg = [rnd("l1", [st("MR", 1), st("SC", 6)], 6), rnd("l2", [st("INC", 6)], 12), rnd("l3", [st("SC", 12)], 12), rnd("l4", [st("SC", 12)], 12)];
  const body: Row[] = [
    { id: "br", type: "round", ops: [st("CH", 2)], stitchCountTarget: 0 },
    rnd("b1", [st("SC", 12, { from: { part: "leg", copy: 1 } }), st("SC", 2), st("SC", 12, { from: { part: "leg", copy: 2 } }), st("SC", 2)], 28, { around: true }),
    rnd("b2", [st("SC", 28)], 28),
    rnd("b3", [st("SC", 28)], 28),
    rnd("b4", [{ kind: "repeat", times: 14, ops: [st("DEC", 1)] }], 14),
    rnd("b5", [st("DEC", 7)], 7),
  ];
  return {
    overview: {},
    parts: [
      { id: "leg", name: "Bein", quantity: 2, content: { schemaVersion: 2, rows: leg } },
      { id: "body", name: "Körper", quantity: 1, content: { schemaVersion: 2, rows: body } },
    ],
    assembly: [{ id: "p1", kind: "attach", part: "leg", target: "body", row: "b2", angle: 40 }],
  };
}

/** Body and two legs of about 1,500 stitches in all: legs of 24 stitches, body of 54. */
function bigLegsDoc(): AssemblyDoc {
  const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });
  const leg: Row[] = [rnd("l1", [st("MR", 1), st("SC", 6)], 6)];
  for (let k = 1; k <= 3; k++) leg.push(rnd(`l${k + 1}`, [rep(6, [...(k > 1 ? [st("SC", k - 1)] : []), st("INC", 1)])], 6 * (k + 1)));
  for (let e = 1; e <= 12; e++) leg.push(rnd(`le${e}`, [st("SC", 24)], 24));
  const body: Row[] = [
    { id: "br", type: "round", ops: [st("CH", 3)], stitchCountTarget: 0 },
    rnd("b1", [st("SC", 24, { from: { part: "leg", copy: 1 } }), st("SC", 3), st("SC", 24, { from: { part: "leg", copy: 2 } }), st("SC", 3)], 54, { around: true }),
  ];
  for (let e = 1; e <= 12; e++) body.push(rnd(`be${e}`, [st("SC", 54)], 54));
  for (let k = 8; k >= 1; k--) body.push(rnd(`bd${k}`, [rep(6, [...(k > 1 ? [st("SC", k - 1)] : []), st("DEC", 1)])], 6 * k));
  return {
    overview: {},
    parts: [
      { id: "leg", name: "Bein", quantity: 2, content: { schemaVersion: 2, rows: leg } },
      { id: "body", name: "Körper", quantity: 1, content: { schemaVersion: 2, rows: body } },
    ],
  };
}

function scene(result: AssemblyResult) {
  if (result.kind !== "scene") throw new Error(result.message);
  return result;
}

describe("Montage of parts crocheted together", () => {
  const computer = new AssemblyComputer();
  const doc = legsDoc();
  const first = scene(computer.compute({ id: 1, doc, style: "surface", have: [] }));

  it("relaxes the joined copies together and draws them instead of their placements", () => {
    expect(first.joined.map((j) => [j.part, j.copy, j.mesh !== undefined])).toEqual([
      [0, 0, true],
      [0, 1, true],
      [1, 0, true],
    ]);
    expect(first.scene.findings.map((f) => f.code)).toEqual(["JOINED"]);
    expect(first.scene.instances.map((i) => [i.part, i.copy, i.joined, i.placed])).toEqual([
      [0, 0, true, true],
      [0, 1, true, true],
      [1, 0, true, true],
    ]);
    const combined = combineScene(first.scene, meshesByPart(first), joinedMeshesOf(first))!;
    expect(combined.ranges.map((r) => r.mesh.key)).toEqual(first.joined.map((j) => j.key));
    // The legs hang below the body.
    const yOf = (range: (typeof combined.ranges)[number]) => {
      let s = 0;
      for (let v = range.vertexStart; v < range.vertexStart + range.vertexCount; v++) s += combined.mesh.positions[3 * v + 1]!;
      return s / range.vertexCount;
    };
    expect(yOf(combined.ranges[0]!)).toBeLessThan(yOf(combined.ranges[2]!));
    expect(yOf(combined.ranges[1]!)).toBeLessThan(yOf(combined.ranges[2]!));
  });

  it("adds the fabric across the joins to the body's mesh", () => {
    const body = first.joined[2]!.mesh!.model;
    const own = first.parts[1]!.mesh!.model;
    expect(body.indices.length).toBeGreaterThan(own.indices.length);
    // Every added vertex belongs to a stitch of the body.
    expect(Math.max(...body.nodeIndex)).toBeLessThan(body.nodeRow.length);
  });

  it("computes a body with two legs of ~1,500 stitches within the budget (relaxation + meshes)", () => {
    const big = bigLegsDoc();
    const run = () => {
      const t0 = performance.now();
      const res = scene(new AssemblyComputer().compute({ id: 1, doc: big, style: "surface", have: [] }));
      return { res, ms: performance.now() - t0 };
    };
    run(); // warm-up (JIT)
    const runs = [run(), run(), run()];
    const stitches = runs[0]!.res.joined.reduce((s, j) => s + j.mesh!.model.nodeRow.length, 0);
    expect(stitches).toBeGreaterThan(1450);
    expect(stitches).toBeLessThan(1700);
    const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
    console.info(`Montage, body + 2 legs (${stitches} stitches): median ${ms[1]!.toFixed(0)} ms`);
    // Budgets: relaxation of ~1,500 stitches < 1 s, meshing < 300 ms.
    expect(ms[1]!).toBeLessThan(1300);
  });

  it("sends joined meshes only once, and again after a change of the joined parts", () => {
    const have = [...first.parts.map((p) => p.key), ...first.joined.map((j) => j.key)];
    const again = scene(computer.compute({ id: 2, doc, style: "surface", have }));
    expect(again.joined.every((j) => j.mesh === undefined)).toBe(true);
    expect(assemblyTransferables(again)).toEqual([]);
    const edited = structuredClone(doc);
    edited.parts[0]!.content.rows.pop();
    edited.parts[1]!.content.rows[1]!.ops = [st("SC", 12, { from: { part: "leg", copy: 1 } }), st("SC", 2), st("SC", 12, { from: { part: "leg", copy: 2 } }), st("SC", 2)];
    const third = scene(computer.compute({ id: 3, doc: edited, style: "surface", have }));
    expect(third.joined.every((j) => j.mesh !== undefined)).toBe(true);
  });
});
