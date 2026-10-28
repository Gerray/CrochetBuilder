/**
 * Snippets ("Bausteine"): whole runs of rounds inserted with one click — the shapes almost
 * every amigurumi starts or ends with. Pure generators; the editor turns their rounds into
 * rows with fresh ids (`actions.ts`) and inserts them as one undo step.
 *
 * Everything works with six sections (six increases / decreases per round), the amigurumi
 * standard, so sizes are multiples of 6.
 *
 * In a piece worked in rows ("Reihe") every row starts with its turning chain ("1 Lm, …"),
 * and the snippets that start with a magic ring are not offered (a flat piece starts with
 * a chain).
 */

import type { Row } from "@crochetbuilder/engine";
import { decreaseRound, increaseRound, plainRound, ringStart, withTurningChain, type RoundSpec } from "./rounds.js";

export type SnippetKind = "ballStart" | "even" | "decreaseTo" | "sphere" | "tube";

export interface SnippetParams {
  /** Largest stitch count (ball start, sphere, tube). */
  max: number;
  /** Number of even rounds (even, tube). */
  rounds: number;
  /** Stitch count to decrease to ("Abnehmen bis"). */
  min: number;
}

export const SECTIONS = 6;
/** Largest stitch count a snippet grows to. */
export const MAX_SNIPPET_STITCHES = 300;
/** Most even rounds in one snippet. */
export const MAX_SNIPPET_ROUNDS = 100;

export const SNIPPETS: ReadonlyArray<{ kind: SnippetKind; label: string; description: string }> = [
  { kind: "ballStart", label: "Kugelanfang", description: "Magischer Ring mit 6 fM, dann zunehmen bis zur Maschenzahl" },
  { kind: "even", label: "Gerade Runden", description: "Runden ohne Zu- und Abnahmen mit der aktuellen Maschenzahl" },
  { kind: "decreaseTo", label: "Abnehmen bis", description: "Abnahmerunden bis zur Maschenzahl, Spiegel der Zunahmen" },
  { kind: "sphere", label: "Kugel", description: "Anfang, gerade Runden und Abnahmen bis 6 Maschen" },
  { kind: "tube", label: "Röhre", description: "Anfang mit 6 fM, zunehmen, dann gerade Runden" },
];

export type SnippetResult = { ok: true; rounds: RoundSpec[] } | { ok: false; message: string };

const fail = (message: string): SnippetResult => ({ ok: false, message });

function sizeProblem(n: number, what: string): string | null {
  if (!Number.isInteger(n) || n < SECTIONS) return `${what}: mindestens ${SECTIONS}.`;
  if (n > MAX_SNIPPET_STITCHES) return `${what}: höchstens ${MAX_SNIPPET_STITCHES}.`;
  if (n % SECTIONS !== 0) return `${what} muss durch ${SECTIONS} teilbar sein (z. B. ${Math.round(n / SECTIONS) * SECTIONS || SECTIONS}).`;
  return null;
}

function roundsProblem(k: number): string | null {
  if (!Number.isInteger(k) || k < 1) return "Mindestens eine Runde.";
  if (k > MAX_SNIPPET_ROUNDS) return `Höchstens ${MAX_SNIPPET_ROUNDS} Runden auf einmal.`;
  return null;
}

/** Magic ring with 6 fM, then one increase round after another up to `max` stitches. */
export function ballStart(max: number): RoundSpec[] {
  const rounds = [ringStart(SECTIONS)];
  while (rounds[rounds.length - 1]!.count < max) {
    const next = increaseRound(rounds[rounds.length - 1]!.count, SECTIONS);
    if (!next) break;
    rounds.push(next);
  }
  return rounds;
}

/** `rounds` even rounds of `count` single crochets. */
export function evenRounds(count: number, rounds: number): RoundSpec[] {
  return Array.from({ length: rounds }, () => plainRound(count));
}

/** Decrease rounds from `from` down to `to` stitches (mirror of the increases). */
export function decreaseTo(from: number, to: number): RoundSpec[] {
  const rounds: RoundSpec[] = [];
  let count = from;
  while (count > to) {
    const next = decreaseRound(count, SECTIONS);
    if (!next) break;
    rounds.push(next);
    count = next.count;
  }
  return rounds;
}

/**
 * A sphere: ball start up to `max`, as many even rounds as there were increase rounds
 * (`max / 6`, e.g. 6 at 36 stitches — the classic proportion), decreases down to 6.
 */
export function sphere(max: number): RoundSpec[] {
  return [...ballStart(max), ...evenRounds(max, max / SECTIONS), ...decreaseTo(max, SECTIONS)];
}

/** A tube: ball start up to `max`, then `rounds` even rounds. */
export function tube(max: number, rounds: number): RoundSpec[] {
  return [...ballStart(max), ...evenRounds(max, rounds)];
}

/** Snippets that begin with a magic ring (not for pieces worked in rows). */
export const RING_SNIPPETS: readonly SnippetKind[] = ["ballStart", "sphere", "tube"];

/**
 * The rounds of snippet `kind`, or a German reason why it does not fit. `current` is the
 * stitch count of the row it is inserted after (needed by "Gerade Runden" and "Abnehmen bis"),
 * `type` how the piece is worked there.
 */
export function snippetRounds(
  kind: SnippetKind,
  params: SnippetParams,
  current: number | undefined,
  type: Row["type"] = "round",
): SnippetResult {
  if (type !== "row") return roundSnippet(kind, params, current);
  if (RING_SNIPPETS.includes(kind)) {
    return fail("Beginnt mit einem Magischen Ring – das Teil wird hier in Reihen gehäkelt und beginnt mit einer Luftmaschenkette.");
  }
  const result = roundSnippet(kind, params, current);
  if (!result.ok) return result;
  return { ok: true, rounds: result.rounds.map((r) => ({ ops: withTurningChain(r.ops), count: r.count })) };
}

function roundSnippet(kind: SnippetKind, params: SnippetParams, current: number | undefined): SnippetResult {
  switch (kind) {
    case "ballStart":
    case "sphere": {
      const problem = sizeProblem(params.max, "Maschenzahl");
      if (problem) return fail(problem);
      return { ok: true, rounds: kind === "sphere" ? sphere(params.max) : ballStart(params.max) };
    }
    case "tube": {
      const problem = sizeProblem(params.max, "Maschenzahl") ?? roundsProblem(params.rounds);
      if (problem) return fail(problem);
      return { ok: true, rounds: tube(params.max, params.rounds) };
    }
    case "even": {
      if (!current) return fail("Erst eine Runde mit Maschen anlegen – gerade Runden wiederholen deren Maschenzahl.");
      const problem = roundsProblem(params.rounds);
      if (problem) return fail(problem);
      return { ok: true, rounds: evenRounds(current, params.rounds) };
    }
    case "decreaseTo": {
      if (!current) return fail("Erst eine Runde mit Maschen anlegen – abgenommen wird von deren Maschenzahl aus.");
      if (current % SECTIONS !== 0) return fail(`Die aktuelle Runde hat ${current} Maschen – nicht durch ${SECTIONS} teilbar.`);
      const problem = sizeProblem(params.min, "Ziel");
      if (problem) return fail(problem);
      if (params.min >= current) return fail(`Das Ziel muss kleiner als ${current} sein.`);
      return { ok: true, rounds: decreaseTo(current, params.min) };
    }
  }
}

/** "6 Runden: 6 → 36 M" — what a snippet adds, for the preview line. */
export function snippetSummary(rounds: readonly RoundSpec[], type: Row["type"] = "round"): string {
  if (rounds.length === 0) return "";
  const first = rounds[0]!.count;
  const last = rounds[rounds.length - 1]!.count;
  const most = Math.max(...rounds.map((r) => r.count));
  const n = rounds.length;
  const word = type === "row" ? (n === 1 ? "Reihe" : "Reihen") : n === 1 ? "Runde" : "Runden";
  if (first === last && most === first) return `${n} ${word} mit ${first} M`;
  const path = most > first && most > last ? [first, most, last] : [first, last];
  return `${n} ${word}: ${path.join(" → ")} M`;
}
