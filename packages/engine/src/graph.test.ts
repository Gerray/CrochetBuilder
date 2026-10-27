import { describe, it, expect } from "vitest";
import { buildGraph, LEG_LEAN, nodesOfRow, type StitchGraph } from "./graph.js";
import { expandPart } from "./expand.js";
import { resolveGauge } from "./gauge.js";
import { createRandom } from "./random.js";
import { checkConsumes } from "./validate.js";
import type { Mod, Op, PartContent, Row, StitchCode } from "./schema.js";

function st(code: StitchCode, count = 1, modifiers?: Mod[]): Op {
  return modifiers ? { kind: "stitch", code, count, modifiers } : { kind: "stitch", code, count };
}
function rep(times: number, ops: Op[]): Op {
  return { kind: "repeat", times, ops };
}
function row(id: string, ops: Op[], stitchCountTarget: number, extra: Partial<Row> = {}): Row {
  return { id, type: "round", ops, stitchCountTarget, ...extra };
}
function part(rows: Row[]): PartContent {
  return { schemaVersion: 1, rows };
}

/** The amigurumi sphere from docs/FORMAT.md. */
const SPHERE = part([
  row("r1", [st("MR"), st("SC", 6)], 6),
  row("r2", [st("INC", 6)], 12),
  row("r3", [rep(6, [st("SC"), st("INC")])], 18),
  row("r4", [rep(6, [st("SC", 2), st("INC")])], 24),
  row("r5", [st("SC", 24)], 24),
  row("r6", [rep(6, [st("SC", 2), st("DEC")])], 18),
  row("r7", [rep(6, [st("SC"), st("DEC")])], 12),
  row("r8", [st("DEC", 6)], 6),
]);

/** Foundation chain + three rows of single crochet, with turning chains. */
const FLAT = part([
  row("f", [st("CH", 7)], 0, { type: "row" }),
  row("1", [st("SC", 6)], 6, { type: "row" }),
  row("2", [st("CH"), st("SC", 6)], 6, { type: "row" }),
  row("3", [st("CH"), st("SC", 6)], 6, { type: "row" }),
]);

const nodesIn = (g: StitchGraph, rowId: string) => g.nodes.filter((n) => n.rowId === rowId);
const edge = (g: StitchGraph, a: number, b: number) =>
  g.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

describe("buildGraph — nodes", () => {
  it("creates one node per atomic stitch, NOTE atoms excluded, globalIndex as in expandPart", () => {
    const content = part([
      ...SPHERE.rows.slice(0, 2),
      row("eyes", [], 12, { note: "Insert safety eyes" }),
      ...SPHERE.rows.slice(2),
    ]);
    const atoms = expandPart(content);
    const g = buildGraph(content);
    const stitches = atoms.filter((a) => a.code !== "NOTE");
    expect(g.nodes).toHaveLength(stitches.length);
    expect(g.nodes.map((n) => [n.globalIndex, n.rowId, n.rowIndex, n.code])).toEqual(
      stitches.map((a) => [a.globalIndex, a.rowId, a.rowIndex, a.code]),
    );
    g.nodes.forEach((n, i) => expect(n.id).toBe(i));
    expect(nodesOfRow(g, "eyes")).toBeNull();
    expect(g.rows.map((r) => r.rowId)).not.toContain("eyes");
  });

  it("numbers stitches within their row by offset", () => {
    const g = buildGraph(SPHERE);
    expect(nodesIn(g, "r1").map((n) => n.offset)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(nodesIn(g, "r3").map((n) => n.offset)).toEqual([...Array(12).keys()]);
    expect(nodesOfRow(g, "r3")).toEqual({ first: 7 + 6, count: 12 }); // MR + 6 SC, 6 INC atoms
  });

  it("links every node to the one worked before it, across row boundaries", () => {
    const g = buildGraph(SPHERE);
    expect(g.nodes[0]!.prev).toBeNull();
    for (let i = 1; i < g.nodes.length; i++) expect(g.nodes[i]!.prev).toBe(i - 1);
  });

  it("keeps modifiers on the node", () => {
    const g = buildGraph(part([row("r1", [st("MR"), st("SC", 6)], 6), row("r2", [st("SC", 6, ["BLO"])], 6)]));
    expect(nodesIn(g, "r2").every((n) => n.modifiers?.[0] === "BLO")).toBe(true);
  });
});

describe("buildGraph — parents", () => {
  it("has 1 parent per normal stitch and INC, 2 per DEC, none for MR/CH", () => {
    const g = buildGraph(SPHERE);
    for (const n of g.nodes) {
      const expected = n.code === "MR" || n.code === "CH" ? 0 : n.code === "DEC" ? 2 : 1;
      expect(n.parents.length, `${n.rowId}/${n.offset} ${n.code}`).toBe(expected);
    }
  });

  it("attaches all stitches of a ring row to the magic ring", () => {
    const g = buildGraph(SPHERE);
    const mr = g.nodes[0]!;
    expect(mr.code).toBe("MR");
    for (const n of nodesIn(g, "r1").slice(1)) expect(n.parents).toEqual([mr.id]);
  });

  it("consumes the previous round's anchors in order (spiral): an INC offers two slots", () => {
    const g = buildGraph(SPHERE);
    const r2 = nodesIn(g, "r2");
    const r3 = nodesIn(g, "r3");
    // 6 × (SC, INC) works into 12 slots of 6 INC nodes: two consecutive stitches per INC.
    expect(r3.map((n) => n.parents[0])).toEqual(r2.flatMap((p) => [p.id, p.id]));
    // Round 2 sits on round 1 one-to-one, first on first.
    expect(nodesIn(g, "r2").map((n) => n.parents[0])).toEqual(nodesIn(g, "r1").slice(1).map((n) => n.id));
  });

  it("a DEC is worked into two neighbouring stitches", () => {
    const g = buildGraph(SPHERE);
    const r7 = nodesIn(g, "r7");
    const r8 = nodesIn(g, "r8");
    expect(r8.map((n) => n.parents)).toEqual(
      [0, 1, 2, 3, 4, 5].map((k) => [r7[2 * k]!.id, r7[2 * k + 1]!.id]),
    );
  });

  it("TOG makes a stitch consume two", () => {
    const g = buildGraph(part([row("a", [st("MR"), st("SC", 6)], 6), row("b", [st("SC", 3, ["TOG"])], 3)]));
    expect(nodesIn(g, "b").map((n) => n.parents.length)).toEqual([2, 2, 2]);
  });

  it("turns after a row: the next row consumes the anchors in reverse, skipping chains from the hook", () => {
    const g = buildGraph(FLAT);
    const chain = nodesIn(g, "f");
    const r1 = nodesIn(g, "1");
    const r2 = nodesIn(g, "2");
    expect(chain.every((n) => n.parents.length === 0)).toBe(true);
    // "sc into the 2nd chain from the hook": chain 6 (last made) is skipped, 5…0 are used.
    expect(r1.map((n) => n.parents)).toEqual([5, 4, 3, 2, 1, 0].map((k) => [chain[k]!.id]));
    // Row 2: turning chain without parent, then back along row 1.
    expect(r2[0]!.code).toBe("CH");
    expect(r2[0]!.lift).toBe(true);
    expect(r2[0]!.parents).toEqual([]);
    expect(r2.slice(1).map((n) => n.parents[0])).toEqual(r1.map((n) => n.id).reverse());
    expect(g.rows.map((r) => [r.kind, r.reversed, r.direction])).toEqual([
      ["chain", false, 1],
      ["stitch", true, -1],
      ["stitch", true, 1],
      ["stitch", true, -1],
    ]);
  });
});

describe("buildGraph — chains", () => {
  it("works a foundation chain back from the hook end even when it is declared a round", () => {
    const g = buildGraph(part([row("f", [st("CH", 7)], 0), row("1", [st("SC", 5)], 5)]));
    const chain = nodesIn(g, "f");
    // Chain 6 is next to the hook. The two surplus chains are skipped there (6, 5), then the
    // row works back 4 … 0 — not 0 … 4 from the far end.
    expect(nodesIn(g, "1").map((n) => n.parents[0])).toEqual([4, 3, 2, 1, 0].map((k) => chain[k]!.id));
    expect(g.rows[1]!.reversed).toBe(true);
  });

  it("treats a trailing chain of a turned row as turning chain: no width, climbs vertically", () => {
    const gauge = { stitchesPer10cm: 20, rowsPer10cm: 25 }; // w 5, h 4
    const g = buildGraph(
      part([
        row("f", [st("CH", 7)], 0, { type: "row" }),
        row("1", [st("SC", 6), st("CH")], 6, { type: "row" }),
        row("2", [st("SC", 6), st("CH")], 6, { type: "row" }),
      ]),
      gauge,
    );
    const r1 = nodesIn(g, "1");
    const turn = r1[6]!;
    expect(turn.code).toBe("CH");
    expect(turn.lift).toBe(true);
    expect(g.rows.map((r) => r.widthStitches)).toEqual([7, 6, 6]);
    // Last SC → CH → first SC of row 2: two steps climbing one SC height together.
    expect(edge(g, r1[5]!.id, turn.id)!.restLength).toBeCloseTo(2);
    expect(edge(g, turn.id, nodesIn(g, "2")[0]!.id)!.restLength).toBeCloseTo(2);
    // Laid out above the row's last stitch, not beside it.
    expect(g.positions[3 * turn.id]).toBeCloseTo(g.positions[3 * r1[5]!.id]!);
    expect(g.positions[3 * turn.id + 1]!).toBeGreaterThan(g.positions[3 * r1[5]!.id + 1]!);
  });

  it("keeps a trailing chain of a round as an ordinary stitch", () => {
    const g = buildGraph(part([row("a", [st("MR"), st("SC", 6)], 6), row("b", [st("SC", 6), st("CH")], 6)]));
    expect(nodesIn(g, "b")[6]!.lift).toBe(false);
  });
});

describe("buildGraph — anchor slots", () => {
  it("records which slot of each parent a stitch consumed", () => {
    const g = buildGraph(SPHERE);
    const mr = nodesIn(g, "r1")[0]!;
    for (const n of nodesIn(g, "r1").slice(1)) expect(n.parentSlots).toEqual([{ node: mr.id, slot: 0 }]);
    // r3 = 6 × (SC, INC) on the 6 INC of r2: the SC takes slot 0 of an INC, the INC slot 1.
    const r2 = nodesIn(g, "r2");
    const r3 = nodesIn(g, "r3");
    expect(r3.map((n) => n.parentSlots)).toEqual(
      r2.flatMap((p) => [[{ node: p.id, slot: 0 }], [{ node: p.id, slot: 1 }]]),
    );
    // A DEC consumes two slots, in working order; parents stay the distinct nodes.
    const dec = nodesIn(g, "r8")[0]!;
    expect(dec.parentSlots!.map((s) => s.node)).toEqual(dec.parents);
    expect(dec.parentSlots!.every((s) => s.slot === 0)).toBe(true);
    // Every stitch with parents has one slot per consumed anchor, only from those parents.
    for (const n of g.nodes) {
      const consumed = n.parents.length === 0 ? 0 : n.code === "DEC" ? 2 : 1;
      expect(n.parentSlots ?? []).toHaveLength(consumed);
      for (const s of n.parentSlots ?? []) expect(n.parents).toContain(s.node);
    }
  });

  it("keeps the parent's own slot order when a turned row consumes it in reverse", () => {
    const g = buildGraph(
      part([
        row("f", [st("CH", 3)], 0, { type: "row" }),
        row("1", [st("SC"), st("INC"), st("SC")], 4, { type: "row" }),
        row("2", [st("CH"), st("SC", 4)], 4, { type: "row" }),
      ]),
    );
    const inc = nodesIn(g, "1")[1]!;
    const onInc = nodesIn(g, "2").filter((n) => n.parents[0] === inc.id);
    // Worked back across the row: the INC's second slot comes first.
    expect(onInc.map((n) => n.parentSlots![0]!.slot)).toEqual([1, 0]);
  });
});

describe("buildGraph — stitch budget", () => {
  it("builds nothing above the budget and reports the stitch count, quickly", () => {
    const content = part([row("a", [rep(1000, [st("SC", 1000)])], 1_000_000, { type: "row" })]);
    const t0 = performance.now();
    const g = buildGraph(content);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(g.overBudget).toBe(true);
    expect(g.stitchCount).toBe(1_000_000);
    expect(g.nodes).toEqual([]);
    expect(g.positions).toHaveLength(0);
  });

  it("honours a custom budget and builds at or below it", () => {
    expect(buildGraph(SPHERE, undefined, { maxStitches: 50 }).overBudget).toBe(true);
    const g = buildGraph(SPHERE, undefined, { maxStitches: 103 });
    expect(g.overBudget).toBe(false);
    expect(g.stitchCount).toBe(103);
    expect(g.nodes).toHaveLength(103);
  });
});

describe("buildGraph — degrades gracefully on invalid patterns", () => {
  it("attaches surplus stitches to the last anchor when a row works into too many", () => {
    const g = buildGraph(part([row("a", [st("MR"), st("SC", 6)], 6), row("b", [st("SC", 9)], 9)]));
    const a = nodesIn(g, "a");
    const b = nodesIn(g, "b");
    expect(b.map((n) => n.parents[0])).toEqual([1, 2, 3, 4, 5, 6, 6, 6, 6].map((k) => a[k]!.id));
  });

  it("leaves surplus anchors free when a row works into too few", () => {
    const g = buildGraph(part([row("a", [st("MR"), st("SC", 6)], 6), row("b", [st("SC", 4)], 4)]));
    const used = new Set(nodesIn(g, "b").flatMap((n) => n.parents));
    expect(used.size).toBe(4);
  });

  it("gives no parents to a first row without chain or ring, and ignores empty rows", () => {
    const g = buildGraph(part([row("x", [], 0), row("a", [st("SC", 5)], 5), row("b", [st("SC", 5)], 5)]));
    expect(nodesIn(g, "a").every((n) => n.parents.length === 0)).toBe(true);
    expect(nodesIn(g, "b").every((n) => n.parents.length === 1)).toBe(true);
    expect(nodesOfRow(g, "x")).toBeNull();
  });

  it("builds an empty graph for empty content", () => {
    const g = buildGraph(part([]));
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.positions).toHaveLength(0);
    expect(g.triangles).toHaveLength(0);
  });
});

describe("buildGraph — rest lengths and gauge", () => {
  it("uses stitch width horizontally and stitch height × factor vertically", () => {
    const gauge = { stitchesPer10cm: 20, rowsPer10cm: 25 };
    const w = 5;
    const h = 4;
    const g = buildGraph(
      part([
        row("a", [st("MR"), st("SC", 6)], 6),
        row("b", [st("INC", 6)], 12),
        row("c", [st("DC", 12)], 12),
      ]),
      gauge,
    );
    const a = nodesIn(g, "a");
    const b = nodesIn(g, "b");
    const c = nodesIn(g, "c");
    expect(edge(g, a[1]!.id, a[2]!.id)!.restLength).toBeCloseTo(w); // SC–SC
    expect(edge(g, b[0]!.id, b[1]!.id)!.restLength).toBeCloseTo(2 * w); // INC–INC: two stitches wide
    expect(edge(g, a[0]!.id, a[1]!.id)!.restLength).toBeCloseTo(h); // ring → SC
    expect(edge(g, a[1]!.id, b[0]!.id)!.kind).toBe("parent");
    expect(edge(g, a[1]!.id, b[0]!.id)!.restLength).toBeCloseTo(h); // INC centred over its parent
    // A DC on one half of an INC: twice as tall, offset by half a stitch.
    expect(edge(g, b[0]!.id, c[0]!.id)!.restLength).toBeCloseTo(Math.hypot(2 * h, w / 2));
  });

  it("lets the legs of a decrease lean by LEG_LEAN of half a stitch", () => {
    const gauge = { stitchesPer10cm: 20, rowsPer10cm: 25 };
    const g = buildGraph(part([row("a", [st("MR"), st("SC", 6)], 6), row("b", [st("DEC", 3)], 3)]), gauge);
    const dec = nodesIn(g, "b")[0]!;
    for (const p of dec.parents) expect(edge(g, p, dec.id)!.restLength).toBeCloseTo(Math.hypot(4, (LEG_LEAN * 5) / 2));
  });

  it("splits a turning chain's climb over its chains", () => {
    const g = buildGraph(
      part([
        row("f", [st("CH", 6)], 0, { type: "row" }),
        row("1", [st("SC", 5)], 5, { type: "row" }),
        row("2", [st("CH", 2), st("DC", 5)], 5, { type: "row" }),
      ]),
      { stitchesPer10cm: 20, rowsPer10cm: 25 },
    );
    const r2 = nodesIn(g, "2");
    const climb = 2 * 4; // DC height
    expect(edge(g, r2[0]!.id - 1, r2[0]!.id)!.restLength).toBeCloseTo(climb / 3);
    expect(edge(g, r2[0]!.id, r2[1]!.id)!.restLength).toBeCloseTo(climb / 3);
    expect(edge(g, r2[1]!.id, r2[2]!.id)!.restLength).toBeCloseTo(climb / 3);
  });

  it("never duplicates an edge and keeps every rest length positive", () => {
    const g = buildGraph(SPHERE);
    const keys = g.edges.map((e) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(g.edges.every((e) => e.restLength > 0 && e.a !== e.b)).toBe(true);
  });

  it("exposes the resolved gauge and the estimated flag", () => {
    expect(buildGraph(SPHERE).estimated).toBe(true);
    expect(buildGraph(SPHERE).gauge).toEqual(resolveGauge({}));
    const swatch = buildGraph(SPHERE, { stitchesPer10cm: 18, rowsPer10cm: 20 });
    expect(swatch.estimated).toBe(false);
    expect(swatch.gauge.stitchWidthMm).toBeCloseTo(100 / 18);
  });
});

describe("buildGraph — surface and layout", () => {
  it("triangulates rows against their parents without degenerate triangles", () => {
    for (const content of [SPHERE, FLAT]) {
      const g = buildGraph(content);
      const t = g.triangles;
      expect(t.length % 3).toBe(0);
      expect(t.length).toBeGreaterThan(0);
      for (let k = 0; k < t.length; k += 3) {
        expect(new Set([t[k], t[k + 1], t[k + 2]]).size).toBe(3);
        for (let j = 0; j < 3; j++) expect(t[k + j]!).toBeLessThan(g.nodes.length);
      }
      // Every stitch that is worked into something is part of the surface.
      const used = new Set(t);
      for (const n of g.nodes) if (n.parents.length > 0) expect(used.has(n.id)).toBe(true);
    }
  });

  it("closes rounds into rings: the sphere surface has no open edge except the last round", () => {
    const g = buildGraph(SPHERE);
    const count = new Map<string, number>();
    const t = g.triangles;
    for (let k = 0; k < t.length; k += 3) {
      for (let j = 0; j < 3; j++) {
        const a = t[k + j]!;
        const b = t[k + ((j + 1) % 3)]!;
        const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
        count.set(key, (count.get(key) ?? 0) + 1);
      }
    }
    const last = new Set(nodesIn(g, "r8").map((n) => n.id));
    for (const [key, c] of count) {
      const [a, b] = key.split("-").map(Number) as [number, number];
      if (c === 1) expect(last.has(a) && last.has(b), key).toBe(true);
      else expect(c, key).toBe(2);
    }
  });

  it("winds the surface consistently on random valid patterns (no directed edge twice)", () => {
    // Patterns whose every row consumes exactly what the previous row offers, mixing rows and
    // rounds, turning chains, INC and DEC — including tiny rounds of 2–4 stitches.
    let tested = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      const r = createRandom(seed);
      const rows: Row[] = [];
      let offered: number;
      if (r() < 0.5) {
        rows.push(row("a", [st("MR"), st("SC", 6)], 6, { type: r() < 0.7 ? "round" : "row" }));
        offered = 6;
      } else {
        offered = 4 + Math.floor(r() * 10);
        rows.push(row("a", [st("CH", offered)], 0, { type: "row" }));
        offered -= 1; // the first row skips the chain next to the hook
      }
      const n = 1 + Math.floor(r() * 7);
      for (let i = 0; i < n; i++) {
        const ops: Op[] = [];
        if (r() < 0.4) ops.push(st("CH"));
        let need = offered;
        let produced = 0;
        while (need > 0) {
          const x = r();
          if (x < 0.3 && need >= 2) {
            ops.push(st("DEC"));
            need -= 2;
            produced += 1;
          } else if (x < 0.6) {
            ops.push(st("INC"));
            need -= 1;
            produced += 2;
          } else {
            ops.push(st("SC"));
            need -= 1;
            produced += 1;
          }
        }
        rows.push(row("x" + i, ops, produced, { type: r() < 0.5 ? "row" : "round" }));
        offered = produced;
      }
      const content = part(rows);
      if (checkConsumes(content).some((f) => f.severity === "error")) continue;
      tested++;
      const t = buildGraph(content).triangles;
      const directed = new Set<number>();
      const n3 = t.length + 1;
      let duplicates = 0;
      for (let k = 0; k < t.length; k += 3) {
        for (let j = 0; j < 3; j++) {
          const key = t[k + j]! * n3 * 4 + t[k + ((j + 1) % 3)]!;
          if (directed.has(key)) duplicates++;
          directed.add(key);
        }
      }
      expect(duplicates, "seed " + seed).toBe(0);
    }
    expect(tested).toBeGreaterThan(1000);
  });

  it("lays rounds out on circles of their circumference and rows as a flat grid", () => {
    const sphere = buildGraph(SPHERE);
    const w = sphere.gauge.stitchWidthMm;
    for (const id of nodesIn(sphere, "r5").map((n) => n.id)) {
      const r = Math.hypot(sphere.positions[3 * id]!, sphere.positions[3 * id + 2]!);
      expect(r).toBeCloseTo((24 * w) / (2 * Math.PI));
    }
    const flat = buildGraph(FLAT);
    for (let i = 0; i < flat.nodes.length; i++) expect(flat.positions[3 * i + 2]).toBe(0);
    expect(flat.relaxed).toBe(false);
  });
});
