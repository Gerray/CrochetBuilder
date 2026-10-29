/**
 * Test documents for joins (`StitchOp.from` / `.through`): the four cases of the format
 * documentation, written for the tests (no pattern text copied from anywhere).
 */
import type { BuilderExport } from "../export.js";
import type { JoinRef, Op, PartContent, Row, StitchCode } from "../schema.js";

export const st = (code: StitchCode, count = 1, extra: { from?: JoinRef; through?: JoinRef } = {}): Op => ({
  kind: "stitch",
  code,
  count,
  ...extra,
});
export const rep = (times: number, ops: Op[]): Op => ({ kind: "repeat", times, ops });
export const rnd = (id: string, ops: Op[], target: number, extra: Partial<Row> = {}): Row => ({
  id,
  type: "round",
  ops,
  stitchCountTarget: target,
  ...extra,
});
export const content = (rows: Row[], extra: Partial<PartContent> = {}): PartContent => ({ schemaVersion: 2, rows, ...extra });

/** Magic ring of 6, increased to `n` (a multiple of 6), then `even` even rounds. */
export function tube(prefix: string, n: number, even: number): Row[] {
  const rows: Row[] = [rnd(`${prefix}1`, [st("MR"), st("SC", 6)], 6)];
  for (let k = 1; 6 * (k + 1) <= n; k++) {
    rows.push(rnd(`${prefix}${k + 1}`, [rep(6, [...(k > 1 ? [st("SC", k - 1)] : []), st("INC")])], 6 * (k + 1)));
  }
  for (let e = 0; e < even; e++) rows.push(rnd(`${prefix}e${e + 1}`, [st("SC", n)], n));
  return rows;
}

/** Decreases from `n` (a multiple of 6) down to 6. */
export function closeDown(prefix: string, n: number): Row[] {
  const rows: Row[] = [];
  for (let k = n / 6 - 1; k >= 1; k--) {
    rows.push(rnd(`${prefix}d${k}`, [rep(6, [...(k > 1 ? [st("SC", k - 1)] : []), st("DEC")])], 6 * k));
  }
  return rows;
}

/**
 * Case 1 — legs joined into the body: one part "leg" ×2 (rounds of `legN`), the body starts with
 * a bridge of `bridge` chains and a round around both legs and both sides of the bridge.
 */
export function legsDoc(legN = 18, bridge = 3, legEven = 4, bodyEven = 6): BuilderExport {
  const first = 2 * legN + 2 * bridge;
  const bodyN = first; // even rounds at the width of the first
  const body: Row[] = [
    { id: "bridge", type: "round", ops: [st("CH", bridge)], stitchCountTarget: 0 },
    rnd(
      "b1",
      [
        st("SC", legN, { from: { part: "leg", copy: 1 } }),
        st("SC", bridge),
        st("SC", legN, { from: { part: "leg", copy: 2 } }),
        st("SC", bridge),
      ],
      first,
      { around: true },
    ),
  ];
  for (let e = 0; e < bodyEven; e++) body.push(rnd(`be${e + 1}`, [st("SC", bodyN)], bodyN));
  // Decrease to 6 in steps of 6 when the width is a multiple of 6, else straight to the end.
  const n6 = bodyN - (bodyN % 6);
  if (bodyN !== n6) body.push(rnd("bfix", [st("SC", n6 - (bodyN - n6)), st("DEC", bodyN - n6)], n6));
  body.push(...closeDown("b", n6));
  return {
    schemaVersion: 2,
    title: "Legs",
    overview: {},
    parts: [
      { id: "leg", name: "Bein", quantity: 2, content: content(tube("l", legN, legEven)) },
      { id: "body", name: "Körper", quantity: 1, content: content(body) },
    ],
  };
}

/** Case 3 — a stem whose first round is worked into the last round of the pumpkin. */
export function pumpkinDoc(): BuilderExport {
  const pumpkin = [...tube("p", 36, 4), ...closeDown("p", 36).slice(0, 2), rnd("ptop", [st("SC", 24)], 24)];
  const stem = [
    rnd("s1", [st("SC", 24, { from: { part: "pumpkin" } })], 24),
    rnd("s2", [rep(6, [st("SC", 2), st("DEC")])], 18),
    rnd("s3", [rep(6, [st("SC", 1), st("DEC")])], 12),
    rnd("s4", [st("SC", 12)], 12),
    rnd("s5", [st("SC", 12)], 12),
    rnd("s6", [st("SC", 12)], 12),
  ];
  return {
    schemaVersion: 2,
    title: "Pumpkin",
    overview: {},
    parts: [
      { id: "pumpkin", name: "Kürbis", quantity: 1, content: content(pumpkin, { stuffing: "firm" }) },
      { id: "stem", name: "Stiel", quantity: 1, content: content(stem) },
    ],
  };
}

/** Case 4 — a tail of 12 split into two branches of 6 (one part ×2, no `start`: halves in turn). */
export function sealDoc(): BuilderExport {
  const body = [...tube("s", 24, 6), rnd("sd2", [rep(6, [st("SC", 2), st("DEC")])], 18), rnd("sd1", [rep(6, [st("SC"), st("DEC")])], 12), rnd("tail", [st("SC", 12)], 12)];
  const branch = [
    rnd("f1", [st("SC", 6, { from: { part: "seal" } })], 6),
    rnd("f2", [rep(6, [st("INC")])], 12),
    rnd("f3", [st("SC", 12)], 12),
    rnd("f4", [st("SC", 12)], 12),
  ];
  return {
    schemaVersion: 2,
    title: "Seal",
    overview: {},
    parts: [
      { id: "seal", name: "Robbe", quantity: 1, content: content(body, { finish: "open" }) },
      { id: "fin", name: "Flosse", quantity: 2, content: content(branch, { finish: "flat" }) },
    ],
  };
}

/** Case 2 — an arm flattened and worked into a body round: "5 sc through the arm and the body". */
export function armDoc(armStart = 3): BuilderExport {
  const arm = [rnd("a1", [st("MR"), st("SC", 6)], 6), rnd("a2", [st("SC", 2), st("INC"), st("SC", 2), st("INC")], 8), ...[1, 2, 3, 4, 5].map((k) => rnd(`ae${k}`, [st("SC", 8)], 8))];
  const body = [
    ...tube("b", 30, 2),
    rnd("join", [st("SC", armStart), st("SC", 4, { through: { part: "arm" } }), st("SC", 30 - armStart - 4)], 30),
    ...[1, 2, 3].map((k) => rnd(`bt${k}`, [st("SC", 30)], 30)),
    ...closeDown("b", 30),
  ];
  return {
    schemaVersion: 2,
    title: "Arm",
    overview: {},
    parts: [
      { id: "body", name: "Körper", quantity: 1, content: content(body) },
      { id: "arm", name: "Arm", quantity: 1, content: content(arm, { finish: "flat" }) },
    ],
  };
}
