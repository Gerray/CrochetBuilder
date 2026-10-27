/**
 * Model view — a small, framework-free Three.js viewer for a crocheted piece.
 *
 * Used by the builder's preview (through the React wrapper `ModelCanvas.tsx`) and meant to
 * be reused as is by the standalone viewer page and for PDF snapshots. It owns a renderer,
 * a scene with soft lighting, OrbitControls and an optional 1-cm grid; it knows nothing
 * about patterns: it shows a `ViewMesh` (engine `toMesh` arrays + the row of every node).
 *
 *   const view = createModelView(canvas, { style: { background: "#fff" } });
 *   view.setMesh(mesh);            // first mesh frames the camera
 *   view.setHighlight(rowId);      // colours that row's stitches
 *   const hit = view.pick(e.clientX, e.clientY); // → { rowId, node } | null
 *   const png = view.snapshot({ width: 1200 }); // data URL; size optional
 *   view.dispose();
 *
 * Camera: while the user has not moved the camera the view follows the piece — each new
 * mesh is framed (smoothly). Dragging or zooming stops that (a click does not, nor do the
 * view's own camera moves); `resetView()` frames again and resumes following. A mesh that
 * no longer fits the view is framed anyway. Pixel-ratio changes (another screen) are
 * picked up automatically.
 *
 * Throws `WebGLUnavailableError` when no WebGL context can be created.
 * Units: millimetres. Rendering is on demand (only when something changed).
 */

import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  RGBAFormat,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Intersection,
  type Material,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createGrid, linearRgb, toBufferGeometry } from "./geometry.js";
import { CameraFollow, snapshotSize, watchPixelRatio, type SnapshotOptions } from "./viewport.js";
import {
  frameCamera,
  gridPlacement,
  meshBounds,
  choosePick,
  pickFromBacking,
  pickFromHit,
  rowIndexOf,
  vertexColors,
  type Bounds,
  type Framing,
  type PickResult,
  type ViewMesh,
} from "./mapping.js";

export type { PickResult, ViewMesh } from "./mapping.js";
export type { SnapshotOptions } from "./viewport.js";

/** Visual settings; every field can be changed later with `setStyle`. */
export interface ModelViewStyle {
  /** Canvas background (CSS colour). */
  background: string;
  /** Yarn colour. */
  yarn: string;
  /** Colour of the highlighted row. */
  highlight: string;
  /** Grid line colour. */
  grid: string;
  /** Show the 1-cm grid. */
  showGrid: boolean;
  /** Grey the model out (e.g. it is outdated because the pattern exceeds the budget). */
  dimmed: boolean;
  /**
   * Opacity of the faint fabric surface drawn behind an open style (the stitch lattice),
   * 0–1; 0 hides it. Only meshes that carry a `backing` have one.
   */
  backing: number;
}

export const DEFAULT_STYLE: ModelViewStyle = {
  background: "#ffffff",
  yarn: "#e7b48f",
  highlight: "#2f7d72",
  grid: "#cfc8bd",
  showGrid: true,
  dimmed: false,
  backing: 0,
};

export interface ModelViewOptions {
  style?: Partial<ModelViewStyle>;
  /** Upper bound of the device pixel ratio used for rendering (default 2). */
  maxPixelRatio?: number;
  /** Follow the canvas size with a ResizeObserver (default true). Else call `resize()`. */
  autoResize?: boolean;
  /** Vertical field of view in degrees (default 35). */
  fov?: number;
}

export interface ModelView {
  /** Show a mesh (or nothing). The first mesh, and every mesh while following, is framed. */
  setMesh(mesh: ViewMesh | null): void;
  /** Highlight the stitches of one row (null: none). Unknown rows highlight nothing. */
  setHighlight(rowId: string | null): void;
  /** Change colours, grid or dimming. */
  setStyle(style: Partial<ModelViewStyle>): void;
  /** Frame the current mesh and follow new meshes again. */
  resetView(): void;
  /** Re-read the canvas size (automatic unless `autoResize: false`). */
  resize(): void;
  /** Stitch under a client (viewport) coordinate, or null. */
  pick(clientX: number, clientY: number): PickResult | null;
  /**
   * The current view as a data URL (default PNG), optionally rendered at another pixel size
   * (e.g. for a PDF). Null after `dispose()`.
   */
  snapshot(opts?: SnapshotOptions): string | null;
  /** Camera state (for tests and to restore a view). */
  cameraState(): { position: [number, number, number]; target: [number, number, number]; following: boolean };
  /** Release GPU resources, listeners and the WebGL context. The view is unusable after. */
  dispose(): void;
}

export class WebGLUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("WebGL ist in diesem Browser nicht verfügbar.");
    this.name = "WebGLUnavailableError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Round sprite for the points style (white disc with a soft edge). */
function discTexture(size = 32): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      const a = Math.max(0, Math.min(1, (1 - d) * 6));
      const i = 4 * (y * size + x);
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a);
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

const FOLLOW_MS = 350;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

export function createModelView(canvas: HTMLCanvasElement, opts: ModelViewOptions = {}): ModelView {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "low-power" });
  } catch (err) {
    throw new WebGLUnavailableError(err);
  }

  let style: ModelViewStyle = { ...DEFAULT_STYLE, ...opts.style };
  const maxPixelRatio = opts.maxPixelRatio ?? 2;

  const scene = new Scene();
  const camera = new PerspectiveCamera(opts.fov ?? 35, 1, 0.5, 5000);
  camera.position.set(60, 50, 100);

  // Soft light: sky/ground fill, a key light that follows the camera, a little ambient.
  const hemi = new HemisphereLight(0xffffff, 0x8a7a6c, 0.9);
  const ambient = new AmbientLight(0xffffff, 0.15);
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(-0.8, 1.2, 0.6);
  const rim = new DirectionalLight(0xffffff, 0.6);
  rim.position.set(1, 0.3, -0.8);
  // Lights follow the camera, so the piece is always lit from the viewer's upper left.
  camera.add(key, rim, key.target, rim.target);
  key.target.position.set(0, 0, -1);
  rim.target.position.set(0, 0, -1);
  scene.add(hemi, ambient, camera);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = true;

  const surfaceMaterial = new MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    sheen: 1,
    sheenRoughness: 0.6,
    sheenColor: 0xffffff,
    side: DoubleSide, // open pieces and tube ends show their inside
  });
  // The fabric behind the stitch lattice: matte, translucent, never hides yarn in
  // front of it (no depth writes; the yarn is opaque and drawn first).
  const backingMaterial = new MeshStandardMaterial({
    roughness: 1,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const sprite = discTexture();
  const pointsMaterial = new PointsMaterial({
    vertexColors: true,
    size: 4,
    sizeAttenuation: true,
    map: sprite,
    alphaTest: 0.5,
    transparent: false,
  });

  let mesh: ViewMesh | null = null;
  let object: Mesh | Points | null = null;
  let geometry: BufferGeometry | null = null;
  let backingObject: Mesh | null = null;
  let bounds: Bounds | null = null;
  let grid: GridHelper | null = null;
  let highlightRowId: string | null = null;
  const follow = new CameraFollow();
  let animation: { from: Framing & { start: number }; to: Framing } | null = null;
  let dirty = true;
  let frame = 0;
  let disposed = false;

  const invalidate = () => {
    dirty = true;
  };
  controls.addEventListener("change", invalidate);

  // Following ends only when the user really moves the camera (drag or wheel) — not on a
  // click, and not through the "change" events the framing animation itself causes.
  const onPointerDown = (e: PointerEvent) => follow.pointerDown(e.clientX, e.clientY);
  const onPointerMove = (e: PointerEvent) => {
    if (follow.pointerMove(e.clientX, e.clientY)) animation = null;
  };
  const onPointerUp = () => follow.pointerUp();
  const onWheel = () => {
    follow.wheel();
    animation = null;
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: true });

  function applyBackground() {
    renderer.setClearColor(style.background, 1);
  }

  function applyBacking() {
    const c = linearRgb(style.yarn);
    // A darker shade of the yarn, like the shadowed inside of the fabric.
    backingMaterial.color.setRGB(c[0] * 0.55, c[1] * 0.5, c[2] * 0.48);
    backingMaterial.opacity = Math.min(1, Math.max(0, style.backing));
    backingMaterial.needsUpdate = true;
    if (backingObject) backingObject.visible = style.backing > 0 && !style.dimmed;
    invalidate();
  }

  function applyMaterials() {
    const dim = style.dimmed;
    for (const m of [surfaceMaterial, pointsMaterial]) {
      m.color.set(dim ? 0xb0b0b0 : 0xffffff);
      m.transparent = dim;
      m.opacity = dim ? 0.45 : 1;
      m.depthWrite = !dim;
      m.needsUpdate = true;
    }
  }

  function applyColors() {
    if (!mesh || !geometry) return;
    const attr = geometry.getAttribute("color");
    const base = linearRgb(style.yarn);
    const hi = linearRgb(style.highlight);
    vertexColors(mesh, rowIndexOf(mesh, highlightRowId), base, hi, attr.array as Float32Array);
    attr.needsUpdate = true;
    invalidate();
  }

  function rebuildGrid() {
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as Material).dispose();
      grid = null;
    }
    if (!bounds || !style.showGrid) return;
    grid = createGrid(gridPlacement(bounds), style.grid);
    scene.add(grid);
  }

  function currentFraming(): Framing {
    return {
      target: [controls.target.x, controls.target.y, controls.target.z],
      position: [camera.position.x, camera.position.y, camera.position.z],
      radius: 0,
      near: camera.near,
      far: camera.far,
    };
  }

  function applyFraming(f: Framing) {
    controls.target.set(...f.target);
    camera.position.set(...f.position);
    camera.near = f.near;
    camera.far = f.far;
    camera.updateProjectionMatrix();
    controls.update();
    invalidate();
  }

  function frameMesh(animate: boolean) {
    if (!bounds) return;
    const to = frameCamera(bounds, camera.fov, camera.aspect);
    controls.minDistance = to.radius * 0.2;
    controls.maxDistance = to.radius * 12;
    if (animate) {
      animation = { from: { ...currentFraming(), start: performance.now() }, to };
      invalidate();
    } else {
      animation = null;
      applyFraming(to);
    }
  }

  function stepAnimation(now: number) {
    if (!animation) return;
    const { from, to } = animation;
    const t = Math.min(1, (now - from.start) / FOLLOW_MS);
    const e = easeOut(t);
    const mix = (a: readonly number[], b: readonly number[]) =>
      [0, 1, 2].map((k) => a[k]! + (b[k]! - a[k]!) * e) as [number, number, number];
    applyFraming({
      target: mix(from.target, to.target),
      position: mix(from.position, to.position),
      radius: to.radius,
      near: Math.min(from.near, to.near),
      far: Math.max(from.far, to.far),
    });
    if (t >= 1) {
      animation = null;
      applyFraming(to);
    }
  }

  const corner = new Vector3();
  /** All bbox corners inside the view, and the piece not tiny in it. */
  function fitsView(b: Bounds): boolean {
    camera.updateMatrixWorld();
    let maxNdc = 0;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]);
      corner.project(camera);
      if (corner.z > 1 || corner.z < -1) return false;
      maxNdc = Math.max(maxNdc, Math.abs(corner.x), Math.abs(corner.y));
    }
    return maxNdc <= 1 && maxNdc >= 0.15;
  }

  function render() {
    renderer.render(scene, camera);
    dirty = false;
  }

  function loop(now: number) {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    stepAnimation(now);
    const moved = controls.update();
    if (dirty || moved) render();
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, maxPixelRatio));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    invalidate();
  }

  const observer =
    opts.autoResize !== false && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  observer?.observe(canvas);
  // Moving the window to a screen with another pixel density changes no size: watch it.
  const stopPixelRatio = watchPixelRatio(() => resize());

  applyBackground();
  applyMaterials();
  resize();
  frame = requestAnimationFrame(loop);

  const raycaster = new Raycaster();
  const ndc = new Vector2();

  return {
    setMesh(next) {
      if (disposed) return;
      const hadMesh = mesh !== null;
      if (object) {
        scene.remove(object);
        object = null;
      }
      geometry?.dispose();
      geometry = null;
      if (backingObject) {
        scene.remove(backingObject);
        backingObject.geometry.dispose();
        backingObject = null;
      }
      mesh = next;
      bounds = null;
      if (next && next.positions.length > 0) {
        geometry = toBufferGeometry(next);
        bounds = meshBounds(next.positions);
        if (next.primitive === "points") {
          // With size attenuation Three scales by (buffer height / 2) / depth; dividing by
          // tan(fov / 2) makes `size` a true world size: a dot of 70 % of a stitch width.
          pointsMaterial.size = ((next.stitchWidthMm ?? 5) * 0.7) / Math.tan((camera.fov * Math.PI) / 360);
          object = new Points(geometry, pointsMaterial);
        } else {
          object = new Mesh(geometry, surfaceMaterial);
        }
        scene.add(object);
        if (next.backing && next.backing.indices.length > 0) {
          const g = new BufferGeometry();
          g.setAttribute("position", new BufferAttribute(next.backing.positions, 3));
          g.setAttribute("normal", new BufferAttribute(next.backing.normals, 3));
          g.setIndex(new BufferAttribute(next.backing.indices, 1));
          g.computeBoundingSphere();
          backingObject = new Mesh(g, backingMaterial);
          backingObject.renderOrder = 1; // after the opaque yarn
          scene.add(backingObject);
          applyBacking();
        }
        applyColors();
        applyMaterials();
        // Frame the first mesh; later ones while following, or when the piece left the view
        // or shrank to a fraction of it (a different pattern was loaded).
        if (follow.shouldFrame(hadMesh, fitsView(bounds))) frameMesh(hadMesh);
      }
      rebuildGrid();
      invalidate();
    },

    setHighlight(rowId) {
      if (disposed) return;
      highlightRowId = rowId;
      applyColors();
    },

    setStyle(patch) {
      if (disposed) return;
      const prev = style;
      style = { ...style, ...patch };
      if (prev.background !== style.background) applyBackground();
      if (prev.yarn !== style.yarn || prev.highlight !== style.highlight) applyColors();
      if (prev.dimmed !== style.dimmed) applyMaterials();
      if (prev.dimmed !== style.dimmed || prev.backing !== style.backing || prev.yarn !== style.yarn) applyBacking();
      if (prev.showGrid !== style.showGrid || prev.grid !== style.grid) rebuildGrid();
      invalidate();
    },

    resetView() {
      if (disposed) return;
      follow.reset();
      frameMesh(true);
    },

    resize,

    pick(clientX, clientY) {
      if (disposed || !object || !mesh) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      camera.updateMatrixWorld(); // also valid before the first frame was rendered
      object.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      raycaster.params.Points = { threshold: (mesh.stitchWidthMm ?? 5) * 0.45 };
      const hits: Intersection[] = raycaster.intersectObject(object, false);
      let yarn: { pick: PickResult; distance: number } | null = null;
      for (const hit of hits) {
        const picked = pickFromHit(mesh, {
          point: hit.point,
          face: hit.face ?? null,
          ...(hit.index !== undefined ? { index: hit.index } : {}),
        });
        if (picked) {
          yarn = { pick: picked, distance: hit.distance };
          break;
        }
      }
      let backing: { pick: PickResult; distance: number } | null = null;
      if (backingObject) {
        // Raycasting ignores visibility: the backing is picked even when it is not drawn.
        backingObject.updateMatrixWorld();
        const hit = raycaster.intersectObject(backingObject, false)[0];
        const picked = hit ? pickFromBacking(mesh, { point: hit.point, face: hit.face ?? null }) : null;
        if (hit && picked) backing = { pick: picked, distance: hit.distance };
      }
      return choosePick(yarn, backing, 2 * (mesh.yarnDiameterMm ?? 2.5));
    },

    snapshot(snap = {}) {
      if (disposed) return null;
      const { type = "image/png", quality } = snap;
      const size = snapshotSize(snap, { width: canvas.clientWidth, height: canvas.clientHeight });
      if (!size) {
        render(); // toDataURL needs the frame in the same task (no preserveDrawingBuffer).
        return canvas.toDataURL(type, quality);
      }
      // Render once at the requested pixel size, then restore the on-screen size.
      const ratio = renderer.getPixelRatio();
      const prev = renderer.getSize(new Vector2());
      const aspect = camera.aspect;
      renderer.setPixelRatio(1);
      renderer.setSize(size.width, size.height, false);
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      render();
      const url = canvas.toDataURL(type, quality);
      renderer.setPixelRatio(ratio);
      renderer.setSize(prev.x, prev.y, false);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      invalidate();
      return url;
    },

    cameraState() {
      return {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
        following: follow.following,
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      stopPixelRatio();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      controls.dispose();
      if (object) scene.remove(object);
      geometry?.dispose();
      backingObject?.geometry.dispose();
      backingMaterial.dispose();
      if (grid) {
        grid.geometry.dispose();
        (grid.material as Material).dispose();
      }
      surfaceMaterial.dispose();
      pointsMaterial.dispose();
      sprite.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      mesh = null;
      object = null;
      geometry = null;
    },
  };
}
