import { describe, expect, it } from "vitest";
import { renderOps, validate, type PartContent } from "@crochetbuilder/engine";
import { ballStart, decreaseTo, evenRounds, ovalStart, snippetRounds, snippetSummary, sphere, tube, type SnippetParams } from "./snippets.js";
import type { RoundSpec } from "./rounds.js";

const texts = (rounds: readonly RoundSpec[]) => rounds.map((r) => renderOps(r.ops, "de"));
const counts = (rounds: readonly RoundSpec[]) => rounds.map((r) => r.count);
const params = (p: Partial<SnippetParams>): SnippetParams => ({ max: 36, rounds: 4, min: 6, chain: 7, increases: 2, bridge: 3, legA: "", legB: "", ...p });

/** The rounds as a part, every Soll set — validation must find nothing. */
function asPart(rounds: readonly RoundSpec[]): PartContent {
  return {
    schemaVersion: 1,
    rows: rounds.map((r, i) => ({ id: `r${i}`, type: "round", ops: r.ops, stitchCountTarget: r.count })),
  };
}

describe("snippets", () => {
  it("ball start: magic ring, then increases up to the size", () => {
    const rounds = ballStart(36);
    expect(texts(rounds)).toEqual([
      "1 MR, 6 fM",
      "6 Zun",
      "6× (1 fM, 1 Zun)",
      "6× (2 fM, 1 Zun)",
      "6× (3 fM, 1 Zun)",
      "6× (4 fM, 1 Zun)",
    ]);
    expect(counts(rounds)).toEqual([6, 12, 18, 24, 30, 36]);
    expect(counts(ballStart(6))).toEqual([6]);
    expect(validate(asPart(rounds))).toEqual([]);
  });

  it("even rounds and decreases down to a size", () => {
    expect(texts(evenRounds(24, 3))).toEqual(["24 fM", "24 fM", "24 fM"]);
    const down = decreaseTo(36, 6);
    expect(texts(down)).toEqual(["6× (4 fM, 1 Abn)", "6× (3 fM, 1 Abn)", "6× (2 fM, 1 Abn)", "6× (1 fM, 1 Abn)", "6 Abn"]);
    expect(counts(decreaseTo(36, 18))).toEqual([30, 24, 18]);
  });

  it("a sphere has as many even rounds as increase rounds and closes to 6", () => {
    const rounds = sphere(36);
    expect(counts(rounds)).toEqual([6, 12, 18, 24, 30, 36, 36, 36, 36, 36, 36, 36, 30, 24, 18, 12, 6]);
    expect(validate(asPart(rounds))).toEqual([]);
  });

  it("a tube: start, increases, then even rounds", () => {
    expect(counts(tube(18, 5))).toEqual([6, 12, 18, 18, 18, 18, 18, 18]);
    expect(validate(asPart(tube(18, 5)))).toEqual([]);
  });

  it("checks the parameters and explains in German what does not fit", () => {
    expect(snippetRounds("ballStart", params({ max: 40 }), undefined)).toEqual({
      ok: false,
      message: "Maschenzahl muss durch 6 teilbar sein (z. B. 42).",
    });
    expect(snippetRounds("sphere", params({ max: 0 }), undefined)).toMatchObject({ ok: false });
    expect(snippetRounds("tube", params({ max: 600 }), undefined)).toMatchObject({ ok: false });
    expect(snippetRounds("tube", params({ rounds: 0 }), undefined)).toMatchObject({ ok: false, message: "Mindestens eine Runde." });
    expect(snippetRounds("even", params({}), undefined)).toMatchObject({ ok: false });
    expect(snippetRounds("decreaseTo", params({}), 20)).toMatchObject({ ok: false });
    expect(snippetRounds("decreaseTo", params({ min: 36 }), 36)).toMatchObject({ ok: false });
    expect(snippetRounds("decreaseTo", params({ min: 4 }), 36)).toMatchObject({ ok: false });
  });

  it("generates every kind with valid parameters", () => {
    const ok = (r: ReturnType<typeof snippetRounds>) => (r.ok ? counts(r.rounds) : r.message);
    expect(ok(snippetRounds("ballStart", params({ max: 18 }), undefined))).toEqual([6, 12, 18]);
    expect(ok(snippetRounds("even", params({ rounds: 2 }), 30))).toEqual([30, 30]);
    expect(ok(snippetRounds("decreaseTo", params({ min: 12 }), 24))).toEqual([18, 12]);
    expect(ok(snippetRounds("sphere", params({ max: 12 }), undefined))).toEqual([6, 12, 12, 12, 6]);
    expect(ok(snippetRounds("tube", params({ max: 12, rounds: 1 }), 99))).toEqual([6, 12, 12]);
  });

  it("in a piece worked in rows: turning chains, and no snippet with a magic ring", () => {
    const even = snippetRounds("even", params({ rounds: 2 }), 20, "row");
    expect(even.ok && texts(even.rounds)).toEqual(["1 Lm, 20 fM", "1 Lm, 20 fM"]);
    const down = snippetRounds("decreaseTo", params({ min: 12 }), 24, "row");
    expect(down.ok && texts(down.rounds)).toEqual(["1 Lm, 6× (2 fM, 1 Abn)", "1 Lm, 6× (1 fM, 1 Abn)"]);
    for (const kind of ["ballStart", "sphere", "tube"] as const) {
      expect(snippetRounds(kind, params({}), 20, "row")).toEqual({
        ok: false,
        message: "Beginnt mit einem Magischen Ring – das Teil wird hier in Reihen gehäkelt und beginnt mit einer Luftmaschenkette.",
      });
    }
    expect(snippetSummary(evenRounds(20, 2), "row")).toBe("2 Reihen mit 20 M");
  });

  it("summarises what a snippet adds", () => {
    expect(snippetSummary(ballStart(36))).toBe("6 Runden: 6 → 36 M");
    expect(snippetSummary(evenRounds(24, 1))).toBe("1 Runde mit 24 M");
    expect(snippetSummary(sphere(24))).toBe("11 Runden: 6 → 24 → 6 M");
    expect(snippetSummary([])).toBe("");
    expect(snippetSummary(ovalStart(7, 2))).toBe("7 Lm, 3 Runden: 14 → 26 M");
  });

  it("oval start: the chain, the round around it, then three increases at each end", () => {
    const rounds = ovalStart(7, 3);
    expect(texts(rounds)).toEqual([
      "7 Lm",
      "5 fM, (3 fM) in dieselbe M, 4 fM, 1 Zun",
      "1 Zun, 4 fM, 3 Zun, 4 fM, 2 Zun",
      "1 fM, 1 Zun, 4 fM, 3× (1 fM, 1 Zun), 4 fM, 2× (1 fM, 1 Zun)",
      "2 fM, 1 Zun, 4 fM, 3× (2 fM, 1 Zun), 4 fM, 2× (2 fM, 1 Zun)",
    ]);
    expect(counts(rounds)).toEqual([0, 14, 20, 26, 32]);
    expect(rounds.map((r) => r.around ?? false)).toEqual([false, true, false, false, false]);
    // As a part (format v2): no findings — the round uses the usual places around the chain.
    const part: PartContent = {
      schemaVersion: 2,
      rows: rounds.map((r, i) => ({ id: `r${i}`, type: "round", ops: r.ops, stitchCountTarget: r.count, ...(r.around ? { around: true } : {}) })),
    };
    expect(validate(part)).toEqual([]);
    // The shortest chain: no plain stitches along the sides.
    expect(texts(ovalStart(3, 1))).toEqual(["3 Lm", "1 fM, (3 fM) in dieselbe M, 1 Zun", "1 Zun, 3 Zun, 2 Zun"]);
    expect(ovalStart(2, 1)).toEqual([]);
  });

  it("checks the oval start's parameters, and offers it only in rounds", () => {
    const ok = (r: ReturnType<typeof snippetRounds>) => (r.ok ? counts(r.rounds) : r.message);
    expect(ok(snippetRounds("oval", params({ chain: 9, increases: 0 }), undefined))).toEqual([0, 18]);
    expect(ok(snippetRounds("oval", params({ chain: 2 }), undefined))).toBe("Luftmaschenkette: mindestens 3 Lm.");
    expect(ok(snippetRounds("oval", params({ chain: 101 }), undefined))).toBe("Luftmaschenkette: höchstens 100 Lm.");
    expect(ok(snippetRounds("oval", params({ increases: 21 }), undefined))).toBe("Höchstens 20 Zunahmerunden auf einmal.");
    expect(ok(snippetRounds("oval", params({ chain: 100, increases: 20 }), undefined))).toBe("Zu viele Zunahmerunden – höchstens 300 Maschen.");
    expect(ok(snippetRounds("oval", params({}), 20, "row"))).toBe(
      "Ein ovaler Anfang wird in Runden um die Kette herum gehäkelt – hier wird in Reihen gehäkelt.",
    );
  });
});
