/**
 * Stand-in for `src/three/modelView.ts` in jsdom tests (no WebGL there):
 *
 *   vi.mock("../three/modelView.js", async () => (await import("../test/fakeModelView.js")).fakeModule);
 *
 * Records every view and its calls; `fakeViews.webgl = false` makes `createModelView` throw
 * like a browser without WebGL.
 */

import type { ModelView, ModelViewStyle, PickResult, ViewMesh } from "../three/modelView.js";

export interface FakeView extends ModelView {
  mesh: ViewMesh | null;
  highlight: string | null;
  style: Partial<ModelViewStyle>;
  resets: number;
  disposed: boolean;
  /** What `pick` returns. */
  nextPick: PickResult | null;
}

export const fakeViews = {
  webgl: true,
  /** When set, `createModelView` throws this (a start-up bug, not missing WebGL). */
  failWith: null as Error | null,
  created: [] as FakeView[],
  reset() {
    this.webgl = true;
    this.failWith = null;
    this.created = [];
  },
  get last(): FakeView | undefined {
    return this.created[this.created.length - 1];
  },
};

class WebGLUnavailableError extends Error {
  constructor() {
    super("WebGL ist in diesem Browser nicht verfügbar.");
    this.name = "WebGLUnavailableError";
  }
}

function createModelView(_canvas: HTMLCanvasElement, opts: { style?: Partial<ModelViewStyle> } = {}): ModelView {
  if (!fakeViews.webgl) throw new WebGLUnavailableError();
  if (fakeViews.failWith) throw fakeViews.failWith;
  const view: FakeView = {
    mesh: null,
    highlight: null,
    style: { ...opts.style },
    resets: 0,
    disposed: false,
    nextPick: null,
    setMesh(mesh) {
      view.mesh = mesh;
    },
    setHighlight(rowId) {
      view.highlight = rowId;
    },
    setStyle(style) {
      view.style = { ...view.style, ...style };
    },
    resetView() {
      view.resets++;
    },
    resize() {},
    pick() {
      return view.nextPick;
    },
    snapshot() {
      return view.disposed ? null : "data:image/png;base64,";
    },
    cameraState() {
      return { position: [0, 0, 100], target: [0, 0, 0], following: true };
    },
    dispose() {
      view.disposed = true;
    },
  };
  fakeViews.created.push(view);
  return view;
}

export const fakeModule = {
  createModelView,
  WebGLUnavailableError,
  DEFAULT_STYLE: {},
};
