/**
 * DOM-level helpers of the model view that need no WebGL: when the camera follows the
 * piece, device-pixel-ratio changes, and snapshot sizes. Unit-tested on their own.
 */

/** Pointer travel (px) that turns a press into a drag. */
export const DRAG_SLOP = 4;

/**
 * Whether the camera follows the piece. It does until the user really moves the camera —
 * drags beyond `DRAG_SLOP` or zooms with the wheel. A plain click (e.g. picking a stitch)
 * and camera moves made by the view itself (framing animation) do not count.
 */
export class CameraFollow {
  following = true;
  private down: { x: number; y: number } | null = null;

  pointerDown(x: number, y: number): void {
    this.down = { x, y };
  }

  /** Returns `true` when this move ended following. */
  pointerMove(x: number, y: number): boolean {
    if (!this.down || !this.following) return false;
    if (Math.hypot(x - this.down.x, y - this.down.y) <= DRAG_SLOP) return false;
    this.following = false;
    return true;
  }

  pointerUp(): void {
    this.down = null;
  }

  wheel(): void {
    this.following = false;
  }

  reset(): void {
    this.following = true;
  }

  /**
   * Frame a new mesh? Always the first one; later ones while following, or when the piece
   * no longer fits the view (or shrank to a speck in it).
   */
  shouldFrame(hadMesh: boolean, fitsView: boolean): boolean {
    return !hadMesh || this.following || !fitsView;
  }
}

interface PixelRatioHost {
  devicePixelRatio: number;
  matchMedia?: (query: string) => MediaQueryList;
}

/**
 * Calls `onChange` whenever the device pixel ratio changes (window moved to another screen,
 * browser zoom). Uses a `(resolution: Xdppx)` media query, re-armed after every change.
 * Returns a function that stops watching.
 */
export function watchPixelRatio(onChange: () => void, host: PixelRatioHost | undefined = globalThis as PixelRatioHost): () => void {
  let query: MediaQueryList | null = null;
  let stopped = false;
  const handler = () => {
    if (stopped) return;
    query?.removeEventListener("change", handler);
    onChange();
    arm();
  };
  const arm = () => {
    if (!host?.matchMedia) return;
    query = host.matchMedia(`(resolution: ${host.devicePixelRatio || 1}dppx)`);
    query.addEventListener?.("change", handler);
  };
  arm();
  return () => {
    stopped = true;
    query?.removeEventListener?.("change", handler);
  };
}

export interface SnapshotOptions {
  /** Image type for `toDataURL` (default `image/png`). */
  type?: string;
  /** Quality 0–1 for lossy types. */
  quality?: number;
  /** Target width in pixels; with only one side given the other keeps the view's aspect. */
  width?: number;
  /** Target height in pixels. */
  height?: number;
}

/**
 * Pixel size to render a snapshot at, or null to use the canvas as it is. Sizes are
 * rounded and clamped to 1…`max` (a WebGL drawing buffer has limits).
 */
export function snapshotSize(
  opts: SnapshotOptions,
  current: { width: number; height: number },
  max = 4096,
): { width: number; height: number } | null {
  const { width, height } = opts;
  if (width === undefined && height === undefined) return null;
  const aspect = current.height > 0 ? current.width / current.height : 1;
  const w = width ?? (height as number) * aspect;
  const h = height ?? (width as number) / aspect;
  const clamp = (v: number) => Math.min(max, Math.max(1, Math.round(Number.isFinite(v) ? v : 1)));
  return { width: clamp(w), height: clamp(h) };
}
