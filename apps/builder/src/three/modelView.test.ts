// @vitest-environment jsdom
/**
 * createModelView without WebGL: Three's renderer is replaced by a recording fake; scene,
 * camera, OrbitControls, raycasting and the view's own logic are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildModel, toMesh, type PartContent } from "@crochetbuilder/engine";
import { backingOf, nodeRows } from "../preview/protocol.js";
import type { ViewMesh } from "./mapping.js";

const renderers: FakeRenderer[] = [];

class FakeRenderer {
  renders = 0;
  disposed = false;
  contextLost = false;
  pixelRatio = 1;
  width = 0;
  height = 0;
  constructor(readonly params: { canvas: HTMLCanvasElement }) {
    renderers.push(this);
  }
  setClearColor() {}
  setPixelRatio(r: number) {
    this.pixelRatio = r;
  }
  getPixelRatio() {
    return this.pixelRatio;
  }
  setSize(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.params.canvas.width = Math.floor(w * this.pixelRatio);
    this.params.canvas.height = Math.floor(h * this.pixelRatio);
  }
  getSize(target: { set(x: number, y: number): unknown }) {
    return target.set(this.width, this.height);
  }
  render() {
    if (this.disposed) throw new Error("render after dispose");
    this.renders++;
  }
  dispose() {
    this.disposed = true;
  }
  forceContextLoss() {
    this.contextLost = true;
  }
}

vi.mock("three", async (importOriginal) => ({ ...(await importOriginal<typeof import("three")>()), WebGLRenderer: FakeRenderer }));

const { createModelView } = await import("./modelView.js");

// Manually driven animation frames and clock.
let frames: Array<(t: number) => void> = [];
let now = 0;
function step(ms: number) {
  now += ms;
  const due = frames;
  frames = [];
  due.forEach((fn) => fn(now));
}

const round = (id: string, ops: PartContent["rows"][number]["ops"], target: number) => ({ id, type: "round" as const, ops, stitchCountTarget: target });
const MR = { kind: "stitch" as const, code: "MR" as const, count: 1 };
const sc = (count: number) => ({ kind: "stitch" as const, code: "SC" as const, count });
const inc = (count: number) => ({ kind: "stitch" as const, code: "INC" as const, count });

function meshOf(rounds: number): ViewMesh {
  const rows = [round("r1", [MR, sc(6)], 6), round("r2", [inc(6)], 12), round("r3", [{ kind: "repeat" as const, times: 6, ops: [sc(1), inc(1)] }], 18)];
  for (let i = 4; i <= rounds; i++) rows.push(round(`r${i}`, [sc(18)], 18));
  const model = buildModel({ schemaVersion: 1, rows: rows.slice(0, Math.max(rounds, 1)) });
  return { ...toMesh(model.graph, "surface"), ...nodeRows(model), stitchWidthMm: model.graph.gauge.stitchWidthMm };
}

function makeCanvas() {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: 400 });
  Object.defineProperty(canvas, "clientHeight", { value: 300 });
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON() {} });
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.toDataURL = () => `data:${canvas.width}x${canvas.height}`;
  document.body.append(canvas);
  return canvas;
}

const pointer = (canvas: HTMLCanvasElement, type: string, x: number, y: number) =>
  canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true }));

beforeEach(() => {
  renderers.length = 0;
  frames = [];
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (fn: (t: number) => void) => frames.push(fn));
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, k) => v - b[k]!));

describe("createModelView (fake renderer)", () => {
  it("frames the first mesh at once and renders on demand", () => {
    const view = createModelView(makeCanvas());
    view.setMesh(meshOf(3));
    const cam = view.cameraState();
    expect(cam.following).toBe(true);
    expect(dist(cam.position, cam.target)).toBeGreaterThan(20);
    step(16);
    const r = renderers[0]!;
    expect(r.renders).toBe(1);
    step(16);
    expect(r.renders).toBe(1); // nothing changed: no render
    view.setHighlight("r2");
    step(16);
    expect(r.renders).toBe(2);
    view.dispose();
  });

  it("a click during the framing animation does not stop following", () => {
    const canvas = makeCanvas();
    const view = createModelView(canvas);
    view.setMesh(meshOf(3));
    step(16);
    view.setMesh(meshOf(9)); // taller piece: animated reframing starts
    step(100);
    pointer(canvas, "pointerdown", 200, 150);
    step(16); // animation frames emit controls "change" events
    pointer(canvas, "pointerup", 200, 150);
    step(400);
    expect(view.cameraState().following).toBe(true);
    // The animation reached its target: the next mesh moves the camera again.
    const before = view.cameraState().position;
    view.setMesh(meshOf(14));
    step(400);
    expect(dist(view.cameraState().position, before)).toBeGreaterThan(1);
    view.dispose();
  });

  it("a drag stops following; a fitting mesh then keeps the camera, resetView resumes", () => {
    const canvas = makeCanvas();
    const view = createModelView(canvas);
    view.setMesh(meshOf(9));
    step(16);
    pointer(canvas, "pointerdown", 200, 150);
    pointer(canvas, "pointermove", 240, 150);
    pointer(canvas, "pointerup", 240, 150);
    for (let i = 0; i < 120; i++) step(16); // let the orbit damping settle
    expect(view.cameraState().following).toBe(false);
    const cam = view.cameraState().position;
    view.setMesh(meshOf(8)); // still fits
    step(400);
    expect(dist(view.cameraState().position, cam)).toBeLessThan(1e-3); // only damping residue
    view.resetView();
    step(400);
    expect(view.cameraState().following).toBe(true);
    expect(dist(view.cameraState().position, cam)).toBeGreaterThan(1); // reframed
    view.dispose();
  });

  it("the wheel stops following", () => {
    const canvas = makeCanvas();
    const view = createModelView(canvas);
    view.setMesh(meshOf(3));
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true }));
    expect(view.cameraState().following).toBe(false);
    view.dispose();
  });

  it("picks the row of the stitch under the pointer", () => {
    const view = createModelView(makeCanvas());
    view.setMesh(meshOf(3));
    const hit = view.pick(200, 150); // centre of the framed disc
    expect(hit).not.toBeNull();
    expect(["r1", "r2", "r3"]).toContain(hit!.rowId);
    expect(view.pick(0, 0)).toBeNull(); // corner: background
    view.dispose();
  });

  it("picks the stitch lattice through its backing; the backing can be shown and hidden", () => {
    const rows = [round("r1", [MR, sc(6)], 6), round("r2", [inc(6)], 12), round("r3", [{ kind: "repeat" as const, times: 6, ops: [sc(1), inc(1)] }], 18)];
    const model = buildModel({ schemaVersion: 1, rows });
    const lattice: ViewMesh = { ...toMesh(model.graph, "stitches"), ...nodeRows(model), stitchWidthMm: model.graph.gauge.stitchWidthMm };
    const view = createModelView(makeCanvas());
    view.setMesh({ ...lattice, backing: backingOf(model.graph) });
    // Sweep a line of pointer positions across the disc: with the backing every one inside
    // the piece finds a stitch, holes included.
    let withBacking = 0;
    for (let x = 160; x <= 240; x += 4) if (view.pick(x, 150)) withBacking++;
    view.setMesh(lattice);
    let without = 0;
    for (let x = 160; x <= 240; x += 4) if (view.pick(x, 150)) without++;
    expect(withBacking).toBeGreaterThanOrEqual(without);
    expect(withBacking).toBe(21);
    expect(() => view.setStyle({ backing: 0.45 })).not.toThrow();
    view.dispose();
  });

  it("snapshots at a requested size and restores the canvas", () => {
    const canvas = makeCanvas();
    const view = createModelView(canvas);
    view.setMesh(meshOf(3));
    const before = { w: canvas.width, h: canvas.height };
    expect(view.snapshot({ width: 1200 })).toBe("data:1200x900");
    expect({ w: canvas.width, h: canvas.height }).toEqual(before);
    expect(view.snapshot()).toBe(`data:${before.w}x${before.h}`);
    view.dispose();
  });

  it("re-reads the pixel ratio when it changes", () => {
    const listeners: Array<() => void> = [];
    vi.stubGlobal("matchMedia", () => ({ addEventListener: (_: string, fn: () => void) => listeners.push(fn), removeEventListener() {} }));
    vi.stubGlobal("devicePixelRatio", 1);
    const view = createModelView(makeCanvas());
    expect(renderers[0]!.pixelRatio).toBe(1);
    vi.stubGlobal("devicePixelRatio", 1.5);
    listeners.at(-1)!();
    expect(renderers[0]!.pixelRatio).toBe(1.5);
    view.dispose();
  });

  it("dispose releases everything; later calls are harmless", () => {
    const canvas = makeCanvas();
    const view = createModelView(canvas);
    view.setMesh(meshOf(3));
    view.dispose();
    const r = renderers[0]!;
    expect(r.disposed).toBe(true);
    expect(r.contextLost).toBe(true);
    expect(frames).toHaveLength(0);
    expect(view.snapshot()).toBeNull();
    expect(() => {
      view.setMesh(meshOf(3));
      view.setHighlight("r1");
      view.setStyle({ dimmed: true });
      view.resetView();
      view.dispose();
    }).not.toThrow();
    expect(view.pick(200, 150)).toBeNull();
    // Input after dispose does not reach the view.
    pointer(canvas, "pointerdown", 1, 1);
    expect(r.renders).toBeLessThanOrEqual(1);
  });
});
