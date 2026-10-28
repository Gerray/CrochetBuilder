import { describe, it, expect } from "vitest";
import { placementAnchor, type Placement } from "./assembly.js";
import {
  anchorOfNode,
  applyTransform,
  composeAssembly,
  nodeAnchorAngles,
  rotate,
  transformMatrix4,
  type AssemblyDocument,
  type PartInstance,
} from "./assembly-scene.js";
import { isFabricNode, type StitchGraph } from "./graph.js";
import { buildModel, type Model } from "./model.js";
import type { Finish, Op, PartContent, Row, StitchCode } from "./schema.js";

const st = (code: StitchCode, count = 1): Op => ({ kind: "stitch", code, count });
const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });
const row = (id: string, ops: Op[], t: number, type: "row" | "round" = "round"): Row => ({ id, type, ops, stitchCountTarget: t });
const part = (rows: Row[], finish?: Finish): PartContent => ({ schemaVersion: 2, rows, ...(finish ? { finish } : {}) });

/** A ball: four increase rounds, five even rounds of 24, decreased and gathered. */
const HEAD_CONTENT = part([
  row("r1", [st("MR"), st("SC", 6)], 6),
  row("r2", [st("INC", 6)], 12),
  row("r3", [rep(6, [st("SC"), st("INC")])], 18),
  row("r4", [rep(6, [st("SC", 2), st("INC")])], 24),
  ...["e1", "e2", "e3", "e4", "e5"].map((id) => row(id, [st("SC", 24)], 24)),
  row("d1", [rep(6, [st("SC", 2), st("DEC")])], 18),
  row("d2", [rep(6, [st("SC"), st("DEC")])], 12),
  row("d3", [st("DEC", 6)], 6),
]);
/** A body: open at the top (12 of 24), so a head sits on it. */
const BODY_CONTENT = part([
  row("b1", [st("MR"), st("SC", 6)], 6),
  row("b2", [st("INC", 6)], 12),
  row("b3", [rep(6, [st("SC"), st("INC")])], 18),
  row("b4", [rep(6, [st("SC", 2), st("INC")])], 24),
  ...["b5", "b6", "b7", "b8"].map((id) => row(id, [st("SC", 24)], 24)),
  row("b9", [rep(6, [st("SC", 2), st("DEC")])], 18),
  row("b10", [rep(6, [st("SC"), st("DEC")])], 12),
]);
/** An ear: a small tube, crocheted flat shut. */
const EAR_CONTENT = part(
  [row("o1", [st("MR"), st("SC", 6)], 6), row("o2", [rep(3, [st("SC"), st("INC")])], 9), ...["o3", "o4", "o5", "o6"].map((id) => row(id, [st("SC", 9)], 9))],
  "flat",
);
/** An arm: an open tube. */
const ARM_CONTENT = part([row("a1", [st("MR"), st("SC", 6)], 6), ...["a2", "a3", "a4", "a5"].map((id) => row(id, [st("SC", 6)], 6))], "open");

const HEAD = buildModel(HEAD_CONTENT);
const BODY = buildModel(BODY_CONTENT);
const EAR = buildModel(EAR_CONTENT);
const ARM = buildModel(ARM_CONTENT);
const SW = HEAD.graph.gauge.stitchWidthMm;

type V3 = [number, number, number];
const P = (g: StitchGraph, i: number): V3 => [g.positions[3 * i]!, g.positions[3 * i + 1]!, g.positions[3 * i + 2]!];
const fabric = (g: StitchGraph, rowId: string) => g.nodes.filter((n) => n.rowId === rowId && isFabricNode(n)).map((n) => n.id);
const centroid = (g: StitchGraph, ids: number[]): V3 => {
  const c: V3 = [0, 0, 0];
  for (const id of ids) for (let k = 0; k < 3; k++) c[k] = c[k]! + P(g, id)[k]! / ids.length;
  return c;
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(...a);
const unit = (a: V3): V3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lastRowId = (g: StitchGraph) => g.rows[g.rows.length - 1]!.rowId;
const firstRowId = (g: StitchGraph) => g.rows.find((r) => fabric(g, r.rowId).length > 0)!.rowId;
/** World centre of a part instance's last row (where it is sewn on) and of its first row (tip). */
const base = (m: Model, inst: PartInstance) => applyTransform(inst.transform, centroid(m.graph, fabric(m.graph, lastRowId(m.graph))));
const tip = (m: Model, inst: PartInstance) => applyTransform(inst.transform, centroid(m.graph, fabric(m.graph, firstRowId(m.graph))));
/** Smallest distance from `p` to a node of the (transformed) part. */
const distanceTo = (m: Model, inst: PartInstance, p: V3) => {
  let best = Infinity;
  for (let i = 0; i < m.graph.nodes.length; i++) best = Math.min(best, len(sub(applyTransform(inst.transform, P(m.graph, i)), p)));
  return best;
};
/** Front (angle 0) of a round and the viewer's right, horizontal. */
const frame = (g: StitchGraph, rowId: string) => {
  const ids = fabric(g, rowId);
  const c = centroid(g, ids);
  const s = P(g, ids[0]!);
  const front = unit([c[0] - s[0], 0, c[2] - s[2]]);
  const right: V3 = [front[2], 0, -front[0]];
  return { c, front, right };
};
/** Mirror `p` across the plane through `c` with unit normal `m`. */
const mirror = (p: V3, c: V3, m: V3): V3 => {
  const d = 2 * dot(sub(p, c), m);
  return [p[0] - d * m[0], p[1] - d * m[1], p[2] - d * m[2]];
};

const placement = (p: Partial<Placement> & Pick<Placement, "id" | "target" | "row" | "angle">): Placement => ({ kind: "attach", ...p });
const find = (instances: PartInstance[], partIndex: number, copy = 0) => instances.find((i) => i.part === partIndex && i.copy === copy)!;

describe("composeAssembly: attaching", () => {
  // parts: 0 head (root), 1 ear ×2 at round 4, 30°
  const doc: AssemblyDocument = {
    parts: [
      { id: "head", quantity: 1 },
      { id: "ear", quantity: 2 },
    ],
    assembly: [placement({ id: "ears", part: "ear", target: "head", row: "r4", angle: 30 })],
  };
  const scene = composeAssembly(doc, [HEAD, EAR]);
  const head = find(scene.instances, 0);
  const ear0 = find(scene.instances, 1, 0);
  const ear1 = find(scene.instances, 1, 1);

  it("keeps the target in its own pose and draws both copies, the second mirrored", () => {
    expect(scene.findings).toEqual([]);
    expect(head.transform.rotation).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(head.transform.translation).toEqual([0, 0, 0]);
    expect(head.placed && ear0.placed && ear1.placed).toBe(true);
    expect([ear0.mirrored, ear1.mirrored]).toEqual([false, true]);
    expect(ear0.placement).toBe("ears");
    expect(ear1.placement).toBe("ears");
  });

  it("sews the ear's last row onto the surface at round 4, at 30°", () => {
    const anchor = placementAnchor(HEAD.graph, "r4", 30)!;
    const b = base(EAR, ear0);
    // On the surface (within a stitch of the head's stitches) and at the anchor, sunk a little.
    expect(distanceTo(HEAD, head, b)).toBeLessThan(1.2 * SW);
    expect(len(sub(b, anchor.point))).toBeLessThan(0.6 * SW);
    // At that latitude: between round 4 and the next.
    const y4 = centroid(HEAD.graph, fabric(HEAD.graph, "r4"))[1];
    const y5 = centroid(HEAD.graph, fabric(HEAD.graph, "e1"))[1];
    expect(b[1]).toBeGreaterThan(Math.min(y4, y5) - 0.5 * SW);
    expect(b[1]).toBeLessThan(Math.max(y4, y5) + 0.5 * SW);
    // On the right-hand front side.
    const { c, front, right } = frame(HEAD.graph, "r4");
    expect(dot(sub(b, c), front)).toBeGreaterThan(0);
    expect(dot(sub(b, c), right)).toBeGreaterThan(0);
  });

  it("points the ear outwards along the surface normal", () => {
    const anchor = placementAnchor(HEAD.graph, "r4", 30)!;
    const out = unit(sub(tip(EAR, ear0), base(EAR, ear0)));
    expect(dot(out, anchor.normal)).toBeGreaterThan(0.9);
    // The growth axis (+Y of the ear's pose) points into the head.
    expect(dot(rotate(ear0.transform.rotation, [0, 1, 0]), anchor.normal)).toBeLessThan(-0.99);
  });

  it("lays the flat seam along the round (horizontal tangent)", () => {
    const anchor = placementAnchor(HEAD.graph, "r4", 30)!;
    const ids = fabric(EAR.graph, lastRowId(EAR.graph));
    const c = centroid(EAR.graph, ids);
    const s = P(EAR.graph, ids[0]!);
    const seamLocal = unit([s[0] - c[0], 0, s[2] - c[2]]);
    const seam = rotate(ear0.transform.rotation, seamLocal);
    const tangent = unit([anchor.normal[2], 0, -anchor.normal[0]]);
    expect(Math.abs(dot(seam, tangent))).toBeGreaterThan(0.95);
    expect(Math.abs(seam[1])).toBeLessThan(0.1);
  });

  it("mirrors the second copy across the front plane", () => {
    const { c, right } = frame(HEAD.graph, "r4");
    for (const pick of [base, tip]) {
      const a = pick(EAR, ear0);
      const b = pick(EAR, ear1);
      expect(len(sub(mirror(a, c, right), b))).toBeLessThan(0.5 * SW);
    }
    // The whole ear, not just its axis: the mean of all stitches.
    const mean = (inst: PartInstance) => {
      const m: V3 = [0, 0, 0];
      const n = EAR.graph.nodes.length;
      for (let i = 0; i < n; i++) {
        const p = applyTransform(inst.transform, P(EAR.graph, i));
        for (let k = 0; k < 3; k++) m[k] = m[k]! + p[k]! / n;
      }
      return m;
    };
    expect(len(sub(mirror(mean(ear0), c, right), mean(ear1)))).toBeLessThan(0.5 * SW);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(composeAssembly(doc, [HEAD, EAR]))).toBe(JSON.stringify(scene));
  });
});

describe("composeAssembly: copies", () => {
  const parts = (q: number) => [
    { id: "head", quantity: 1 },
    { id: "ear", quantity: q },
  ];
  it("uses one placement per copy when there are several (no mirroring)", () => {
    const scene = composeAssembly(
      {
        parts: parts(2),
        assembly: [
          placement({ id: "left", part: "ear", target: "head", row: "e2", angle: -60 }),
          placement({ id: "right", part: "ear", target: "head", row: "e4", angle: 45 }),
        ],
      },
      [HEAD, EAR],
    );
    const [a, b] = [find(scene.instances, 1, 0), find(scene.instances, 1, 1)];
    expect([a.placement, b.placement, a.mirrored, b.mirrored]).toEqual(["left", "right", false, false]);
    const anchor = placementAnchor(HEAD.graph, "e4", 45)!;
    expect(len(sub(base(EAR, b), anchor.point))).toBeLessThan(0.6 * SW);
  });

  it("draws no further copies than placed ones, and reports placements beyond the quantity", () => {
    const three = composeAssembly(
      { parts: parts(3), assembly: [placement({ id: "x", part: "ear", target: "head", row: "e2", angle: 90 })] },
      [HEAD, EAR],
    );
    expect(three.instances.filter((i) => i.part === 1).map((i) => i.copy)).toEqual([0, 1]);
    const one = composeAssembly(
      {
        parts: parts(1),
        assembly: [
          placement({ id: "x", part: "ear", target: "head", row: "e2", angle: 90 }),
          placement({ id: "y", part: "ear", target: "head", row: "e2", angle: -90 }),
        ],
      },
      [HEAD, EAR],
    );
    expect(one.instances.filter((i) => i.part === 1)).toHaveLength(1);
    expect(one.findings.map((f) => [f.code, f.placementId])).toEqual([["EXTRA_PLACEMENT", "y"]]);
  });
});

describe("composeAssembly: chains", () => {
  // 0 body (root), 1 head on the body's top, 2 ears ×2 on the head, 3 arms ×2 on the body.
  const doc: AssemblyDocument = {
    parts: [
      { id: "body", quantity: 1 },
      { id: "head", quantity: 1 },
      { id: "ear", quantity: 2 },
      { id: "arm", quantity: 2 },
    ],
    assembly: [
      placement({ id: "ears", part: "ear", target: "head", row: "r4", angle: 30 }),
      placement({ id: "head", part: "head", target: "body", row: "b10", angle: 0 }),
      placement({ id: "arms", part: "arm", target: "body", row: "b6", angle: 90 }),
    ],
  };
  const scene = composeAssembly(doc, [BODY, HEAD, EAR, ARM]);
  const body = find(scene.instances, 0);
  const head = find(scene.instances, 1);

  it("keeps the body as the root and puts the head centred on its open top", () => {
    expect(scene.findings).toEqual([]);
    expect(body.transform.translation).toEqual([0, 0, 0]);
    expect(scene.instances.every((i) => i.placed)).toBe(true);
    const top = centroid(BODY.graph, fabric(BODY.graph, "b10"));
    expect(len(sub(base(HEAD, head), top))).toBeLessThan(1e-6);
    // The head sticks up, its first round on top.
    expect(unit(sub(tip(HEAD, head), base(HEAD, head)))[1]).toBeGreaterThan(0.99);
  });

  it("turns the head's front to the body's front", () => {
    const bodyFront = frame(BODY.graph, "b10").front;
    const headFront = rotate(head.transform.rotation, frame(HEAD.graph, "d3").front);
    expect(dot(headFront, bodyFront)).toBeGreaterThan(0.99);
  });

  it("attaches the ears to the head where the head is now", () => {
    for (const copy of [0, 1]) {
      const ear = find(scene.instances, 2, copy);
      const angle = copy === 0 ? 30 : -30;
      const anchor = placementAnchor(HEAD.graph, "r4", angle)!;
      const expected = applyTransform(head.transform, anchor.point);
      expect(len(sub(base(EAR, ear), expected))).toBeLessThan(0.6 * SW);
      expect(distanceTo(HEAD, head, base(EAR, ear))).toBeLessThan(1.2 * SW);
      const normal = rotate(head.transform.rotation, anchor.normal);
      expect(dot(unit(sub(tip(EAR, ear), base(EAR, ear))), normal)).toBeGreaterThan(0.9);
    }
  });

  it("puts the arms on both sides of the body, front to front", () => {
    const { c, front, right } = frame(BODY.graph, "b6");
    const arm0 = find(scene.instances, 3, 0);
    const arm1 = find(scene.instances, 3, 1);
    expect(dot(unit(sub(tip(ARM, arm0), base(ARM, arm0))), right)).toBeGreaterThan(0.9);
    expect(dot(unit(sub(tip(ARM, arm1), base(ARM, arm1))), right)).toBeLessThan(-0.9);
    expect(len(sub(mirror(tip(ARM, arm0), c, right), tip(ARM, arm1)))).toBeLessThan(0.5 * SW);
    const armFront = rotate(arm0.transform.rotation, frame(ARM.graph, "a5").front);
    expect(dot(armFront, front)).toBeGreaterThan(0.9);
  });
});

describe("composeAssembly: eyes and embroidery", () => {
  const doc: AssemblyDocument = {
    parts: [{ id: "head", quantity: 1 }],
    assembly: [
      { id: "eyes", kind: "eyes", target: "head", row: "e3", angle: 0, spacing: 6, size: 12 },
      { id: "nose", kind: "embroidery", target: "head", row: "e2", angle: 0, size: 4 },
      { id: "one", kind: "eyes", target: "head", row: "e3", angle: 90 },
    ],
  };
  const scene = composeAssembly(doc, [HEAD]);
  const pair = scene.eyes.filter((e) => e.placement === "eyes");

  it("sets two eyes symmetric about the front plane, spacing stitches apart", () => {
    expect(pair).toHaveLength(2);
    const { c, front, right } = frame(HEAD.graph, "e3");
    expect(len(sub(mirror(pair[0]!.position, c, right), pair[1]!.position))).toBeLessThan(0.3 * SW);
    for (const eye of pair) {
      expect(dot(sub(eye.position, c), front)).toBeGreaterThan(0);
      expect(eye.diameter).toBe(12);
      expect(Math.hypot(...eye.normal)).toBeCloseTo(1, 9);
    }
    // 6 stitches apart along the round (the chord is a little shorter than the arc).
    const apart = len(sub(pair[0]!.position, pair[1]!.position));
    expect(apart).toBeGreaterThan(4.5 * SW);
    expect(apart).toBeLessThan(6.5 * SW);
    // The left eye (negative angle) is on the viewer's left.
    expect(dot(sub(pair[0]!.position, c), right)).toBeLessThan(0);
  });

  it("puts the eye's centre on the surface (half of it sunk in)", () => {
    for (const eye of pair) {
      const head = find(scene.instances, 0);
      expect(distanceTo(HEAD, head, eye.position)).toBeLessThan(1.2 * SW);
    }
  });

  it("sets a single eye without spacing, default 10 mm, and a mark for embroidery", () => {
    const single = scene.eyes.filter((e) => e.placement === "one");
    expect(single).toHaveLength(1);
    expect(single[0]!.diameter).toBe(10);
    expect(scene.marks).toHaveLength(1);
    expect(scene.marks[0]!.size).toBe(4);
  });
});

describe("composeAssembly: findings", () => {
  it("reports cycles and sets the parts beside the scene", () => {
    const scene = composeAssembly(
      {
        parts: [
          { id: "body", quantity: 1 },
          { id: "a", quantity: 1 },
          { id: "b", quantity: 1 },
        ],
        assembly: [
          placement({ id: "a-on-b", part: "a", target: "b", row: "o3", angle: 0 }),
          placement({ id: "b-on-a", part: "b", target: "a", row: "o3", angle: 0 }),
        ],
      },
      [BODY, EAR, EAR],
    );
    expect(scene.findings.map((f) => f.code).sort()).toEqual(["CYCLE", "CYCLE"]);
    expect(scene.findings.map((f) => f.placementId).sort()).toEqual(["a-on-b", "b-on-a"]);
    const [body, a, b] = [find(scene.instances, 0), find(scene.instances, 1), find(scene.instances, 2)];
    expect(body.placed).toBe(true);
    expect([a.placed, b.placed]).toEqual([false, false]);
    // Beside the body, to its right, not overlapping it.
    let maxX = -Infinity;
    for (let i = 0; i < BODY.graph.nodes.length; i++) maxX = Math.max(maxX, P(BODY.graph, i)[0]);
    for (const inst of [a, b]) {
      for (let i = 0; i < EAR.graph.nodes.length; i++) {
        expect(applyTransform(inst.transform, P(EAR.graph, i))[0]).toBeGreaterThan(maxX);
      }
    }
  });

  it("reports missing references and keeps every part in the scene", () => {
    const scene = composeAssembly(
      {
        parts: [
          { id: "head", quantity: 1 },
          { id: "ear", quantity: 1 },
          { quantity: 1 },
        ],
        assembly: [
          placement({ id: "t", part: "ear", target: "nobody", row: "r4", angle: 0 }),
          placement({ id: "r", part: "ear", target: "head", row: "zz", angle: 0 }),
          placement({ id: "p", part: "nobody", target: "head", row: "r4", angle: 0 }),
          { id: "m", kind: "attach", target: "head", row: "r4", angle: 0 },
          placement({ id: "s", part: "head", target: "head", row: "r4", angle: 0 }),
        ],
      },
      [HEAD, EAR, null],
    );
    expect(scene.findings.map((f) => [f.placementId, f.code])).toEqual([
      ["t", "UNKNOWN_TARGET"],
      ["r", "UNKNOWN_ROW"],
      ["p", "UNKNOWN_PART"],
      ["m", "MISSING_PART"],
      ["s", "SELF_ATTACH"],
    ]);
    // Head and ear are drawn; the part without a model is not.
    expect(scene.instances.map((i) => [i.part, i.placed])).toEqual([
      [0, true],
      [1, false],
    ]);
  });

  it("reports a placement on a part without a model", () => {
    const scene = composeAssembly(
      { parts: [{ id: "head", quantity: 1 }, { id: "ear", quantity: 1 }], assembly: [placement({ id: "x", part: "ear", target: "head", row: "r4", angle: 0 })] },
      [HEAD, null],
    );
    expect(scene.findings.map((f) => f.code)).toEqual(["NO_MODEL"]);
  });
});

describe("transformMatrix4", () => {
  it("is the column-major form of the transform", () => {
    const scene = composeAssembly(
      { parts: [{ id: "head", quantity: 1 }, { id: "ear", quantity: 1 }], assembly: [placement({ id: "x", part: "ear", target: "head", row: "e3", angle: 50 })] },
      [HEAD, EAR],
    );
    const t = find(scene.instances, 1).transform;
    const m = transformMatrix4(t);
    const p: V3 = [1.5, -2, 3];
    const q = [0, 1, 2].map((r) => m[r]! * p[0] + m[4 + r]! * p[1] + m[8 + r]! * p[2] + m[12 + r]!);
    const expected = applyTransform(t, p);
    for (let k = 0; k < 3; k++) expect(q[k]).toBeCloseTo(expected[k]!, 9);
  });
});

describe("anchorOfNode", () => {
  it("finds the row and angle of a stitch, so that placementAnchor lands on it", () => {
    const g = HEAD.graph;
    const { c } = frame(g, "e3");
    for (const id of fabric(g, "e3")) {
      const a = anchorOfNode(g, id)!;
      expect(a.rowId).toBe("e3");
      expect(a.angleDeg).toBeGreaterThan(-180);
      expect(a.angleDeg).toBeLessThanOrEqual(180);
      const point = placementAnchor(g, a.rowId, a.angleDeg)!.point;
      const want = unit([P(g, id)[0] - c[0], 0, P(g, id)[2] - c[2]]);
      const got = unit([point[0] - c[0], 0, point[2] - c[2]]);
      expect(dot(want, got)).toBeGreaterThan(0.995);
    }
  });

  it("puts the round's first stitch at the back (180°) and the stitch opposite at the front", () => {
    const ids = fabric(HEAD.graph, "e3");
    expect(Math.abs(anchorOfNode(HEAD.graph, ids[0]!)!.angleDeg)).toBeGreaterThan(170);
    expect(Math.abs(anchorOfNode(HEAD.graph, ids[12]!)!.angleDeg)).toBeLessThan(15);
  });

  it("runs along a flat row from −180 (left) to 180 (right)", () => {
    const flat = buildModel(
      part([row("c", [st("CH", 10)], 0, "row"), row("f1", [st("CH"), st("SC", 10)], 10, "row"), row("f2", [st("CH"), st("SC", 10)], 10, "row")]),
    ).graph;
    const ids = fabric(flat, "f2");
    const angles = ids.map((id) => anchorOfNode(flat, id)!.angleDeg);
    expect(Math.min(...angles)).toBeCloseTo(-180, 6);
    expect(Math.max(...angles)).toBeCloseTo(180, 6);
  });

  it("gives the ring's position to the magic ring node and null for unknown nodes", () => {
    const mr = HEAD.graph.nodes.find((n) => n.code === "MR")!;
    expect(anchorOfNode(HEAD.graph, mr.id)!.rowId).toBe("r1");
    expect(anchorOfNode(HEAD.graph, 99_999)).toBeNull();
  });

  it("matches nodeAnchorAngles for every node", () => {
    const angles = nodeAnchorAngles(HEAD.graph);
    for (let id = 0; id < HEAD.graph.nodes.length; id++) {
      expect(angles[id]).toBeCloseTo(anchorOfNode(HEAD.graph, id)!.angleDeg, 3);
    }
  });
});
