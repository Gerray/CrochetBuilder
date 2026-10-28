/**
 * Assembly of the demo patterns (B4): which demo parts are sewn where, and the eyes. Kept
 * apart from the demo stitches in `document.ts`; `demoDocument` applies it to a fresh demo.
 * Rows are named by their 1-based number in the part (as in the pattern: "Runde 4").
 */

import type { Finish, Placement } from "@crochetbuilder/engine";
import type { BuilderDoc, DemoKind } from "./document.js";
import { slug } from "./assembly.js";

interface DemoPlacement extends Omit<Placement, "part" | "target" | "row"> {
  /** Part names. */
  part?: string;
  target: string;
  /** 1-based row number of the target part. */
  round: number;
}

interface DemoAssembly {
  /** Finish per part name (how the part is closed, so it can be sewn on as the pattern says). */
  finish?: Record<string, Finish>;
  placements: DemoPlacement[];
}

const ASSEMBLIES: Partial<Record<DemoKind, DemoAssembly>> = {
  // The head is crocheted from the crown down and sits on the open top of the body; the ears
  // (crocheted flat shut) go near the crown, arms on the upper sides, legs under the body.
  bunny: {
    finish: { Ohr: "flat" },
    placements: [
      { id: "kopf", kind: "attach", part: "Kopf", target: "Körper", round: 14, angle: 0 },
      { id: "ohren", kind: "attach", part: "Ohr", target: "Kopf", round: 4, angle: 45, note: "flach annähen" },
      { id: "arme", kind: "attach", part: "Arm", target: "Körper", round: 11, angle: 80 },
      { id: "beine", kind: "attach", part: "Bein", target: "Körper", round: 3, angle: 35 },
      { id: "augen", kind: "eyes", target: "Kopf", round: 8, angle: 0, spacing: 6, size: 8 },
      { id: "nase", kind: "embroidery", target: "Kopf", round: 10, angle: 0, size: 4, note: "mit rosa Garn sticken" },
    ],
  },
};

/** The demo with its part ids, finishes and assembly (unchanged for demos without one). */
export function withDemoAssembly(doc: BuilderDoc, kind: DemoKind): BuilderDoc {
  const spec = ASSEMBLIES[kind];
  if (!spec) return doc;
  const parts = doc.parts.map((p) => {
    const finish = spec.finish?.[p.name];
    return { ...p, id: slug(p.name), content: finish ? { ...p.content, finish } : p.content };
  });
  const index = (name: string) => parts.findIndex((p) => p.name === name);
  const assembly = spec.placements.map(({ round, part, target, ...rest }): Placement => {
    const t = parts[index(target)]!;
    return {
      ...rest,
      ...(part !== undefined ? { part: parts[index(part)]!.id } : {}),
      target: t.id,
      row: t.content.rows[round - 1]!.id,
    };
  });
  return { ...doc, parts, assembly };
}
