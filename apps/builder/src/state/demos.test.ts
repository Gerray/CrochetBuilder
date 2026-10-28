import { describe, expect, it } from "vitest";
import { BuilderExportSchema, buildModel, computeRowStitches, validate } from "@crochetbuilder/engine";
import { loadDemo } from "./actions.js";
import { DEMOS, demoDocument } from "./document.js";
import { currentPart, editorReducer, initEditorState } from "./editor.js";

const counter = () => {
  let i = 0;
  return () => `id-${++i}`;
};

describe("demo patterns", () => {
  it("every demo is a valid builder export without findings in any part", () => {
    for (const { kind } of DEMOS) {
      const doc = demoDocument(counter(), kind);
      expect(BuilderExportSchema.safeParse(doc).success, kind).toBe(true);
      for (const part of doc.parts) expect(validate(part.content), `${kind}: ${part.name}`).toEqual([]);
    }
  });

  it("the default demo is still the 8-round sphere of docs/FORMAT.md", () => {
    const doc = demoDocument(counter());
    expect(doc.title).toBe("Amigurumi-Kugel");
    expect(currentPart(doc).rows).toHaveLength(8);
  });

  it("the ball relaxes rounder than the 8-round sphere", () => {
    const aspect = (kind: "sphere" | "ball") => {
      const doc = demoDocument(counter(), kind);
      const { size, maxDiameter } = buildModel(currentPart(doc), doc.overview.gauge);
      return { ratio: size.height / maxDiameter, size };
    };
    const sphere = aspect("sphere");
    const ball = aspect("ball");
    expect(currentPart(demoDocument(counter(), "ball")).rows).toHaveLength(11);
    // Height along the axis vs. the widest round: the ball is close to 1, the sphere flatter.
    expect(Math.abs(1 - ball.ratio)).toBeLessThan(Math.abs(1 - sphere.ratio));
    expect(ball.ratio).toBeGreaterThan(0.8);
    expect(ball.ratio).toBeLessThan(1.2);
  });

  it("the potholder is a flat, roughly square piece", () => {
    const doc = demoDocument(counter(), "potholder");
    const { size, maxDiameter } = buildModel(currentPart(doc), doc.overview.gauge);
    expect(maxDiameter).toBe(0);
    expect(size.depth).toBeLessThan(0.1 * Math.min(size.width, size.height));
    expect(size.width / size.height).toBeGreaterThan(0.8);
    expect(size.width / size.height).toBeLessThan(1.25);
  });

  it("loadDemo(kind) replaces the document with that demo and pins its rows", () => {
    const state = editorReducer(initEditorState(demoDocument(counter())), loadDemo("ball"));
    expect(state.doc.title).toBe("Amigurumi-Ball");
    expect(state.pinned).toEqual(currentPart(state.doc).rows.map((r) => r.id));
  });

  it("the bunny is a multi-part toy: head, body, and ears, arms and legs twice each", () => {
    const doc = demoDocument(counter(), "bunny");
    expect(doc.parts.map((p) => [p.name, p.quantity])).toEqual([
      ["Kopf", 1],
      ["Körper", 1],
      ["Ohr", 2],
      ["Arm", 2],
      ["Bein", 2],
    ]);
    // Row ids are unique across all parts.
    const ids = doc.parts.flatMap((p) => p.content.rows.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
    // Each part builds a closed or tubular model; the ears are long and slim.
    const model = (name: string) => buildModel(doc.parts.find((p) => p.name === name)!.content, doc.overview.gauge);
    const head = model("Kopf");
    const ear = model("Ohr");
    expect(head.maxDiameter).toBeGreaterThan(ear.maxDiameter * 1.8);
    expect(ear.size.height).toBeGreaterThan(ear.maxDiameter * 1.5);
    const total = doc.parts.reduce(
      (sum, p) => sum + p.quantity * p.content.rows.reduce((n, r) => n + computeRowStitches(r), 0),
      0,
    );
    expect(total).toBeGreaterThan(1000);
  });

  it("loadDemo pins the rows of every part", () => {
    const state = editorReducer(initEditorState(demoDocument(counter())), loadDemo("bunny"));
    expect(state.doc.parts).toHaveLength(5);
    expect(state.part).toBe(0);
    expect(state.pinned).toEqual(state.doc.parts.flatMap((p) => p.content.rows.map((r) => r.id)));
  });

  it("demo documents do not share mutable state", () => {
    const a = demoDocument(counter(), "ball");
    const b = demoDocument(counter(), "ball");
    expect(a.overview.materials).not.toBe(b.overview.materials);
    expect(currentPart(a).rows[0]!.ops).not.toBe(currentPart(b).rows[0]!.ops);
  });
});
