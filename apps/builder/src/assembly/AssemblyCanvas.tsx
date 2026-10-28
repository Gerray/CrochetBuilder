/**
 * The "Montage" 3D view: the assembled toy (one combined mesh, see `combine.ts`) in the same
 * model view as a single part, plus the eyes and embroidery as small spheres. While a
 * placement is being set, hovering reports the stitch under the pointer (for the round
 * highlight) and a click picks it. Loaded lazily (Three.js).
 */

import { useEffect, useRef } from "react";
import { createModelView, WebGLUnavailableError, type ModelView, type PickResult } from "../three/modelView.js";
import { themeColors, watchTheme } from "../three/ModelCanvas.js";
import type { CombinedScene } from "./combine.js";
import { sceneSpheres } from "./spheres.js";

export interface AssemblyCanvasProps {
  combined: CombinedScene | null;
  /** Combined row keys to highlight (`rowKey`). */
  highlight: readonly string[];
  showGrid: boolean;
  backing: number;
  resetToken: number;
  /** A placement is being set: hover and click pick stitches. */
  picking: boolean;
  onHover: (hit: PickResult | null) => void;
  onPick: (hit: PickResult) => void;
  onUnavailable: (error: WebGLUnavailableError) => void;
  /** The view, once created (and null on unmount). */
  onView?: (view: ModelView | null) => void;
}

const CLICK_SLOP = 5;

export default function AssemblyCanvas(props: AssemblyCanvasProps) {
  const { combined, highlight, showGrid, backing, resetToken, picking } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ModelView | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const down = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.className = "model-canvas";
    host.prepend(canvas);
    let view: ModelView;
    try {
      view = createModelView(canvas, { style: { ...themeColors(host), showGrid, backing } });
    } catch (err) {
      canvas.remove();
      if (err instanceof WebGLUnavailableError) {
        callbacks.current.onUnavailable(err);
        return;
      }
      throw err;
    }
    viewRef.current = view;
    callbacks.current.onView?.(view);
    const unwatch = watchTheme(() => view.setStyle(themeColors(host)));
    return () => {
      unwatch();
      cancelAnimationFrame(frame.current);
      callbacks.current.onView?.(null);
      viewRef.current = null;
      view.dispose();
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.setMesh(combined?.mesh ?? null);
    viewRef.current?.setSpheres(sceneSpheres(combined));
  }, [combined]);
  const highlightKey = highlight.join("\u0000");
  useEffect(
    () => viewRef.current?.setHighlight(highlightKey ? highlightKey.split("\u0000") : null),
    [highlightKey, combined],
  );
  useEffect(() => viewRef.current?.setStyle({ showGrid, backing }), [showGrid, backing]);
  useEffect(() => {
    if (resetToken > 0) viewRef.current?.resetView();
  }, [resetToken]);

  return (
    <div
      ref={hostRef}
      className={`model-host${picking ? " is-picking" : ""}`}
      role="img"
      aria-label={
        picking
          ? "Montage – klicke auf die Stelle, an der die Platzierung sitzen soll"
          : "Montage – alle Teile zusammengesetzt; ziehen zum Drehen, Mausrad zum Zoomen"
      }
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        if (!picking || down.current) return;
        const { clientX, clientY } = e;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => callbacks.current.onHover(viewRef.current?.pick(clientX, clientY) ?? null));
      }}
      onPointerLeave={() => {
        if (picking) callbacks.current.onHover(null);
      }}
      onPointerUp={(e) => {
        const start = down.current;
        down.current = null;
        if (!start || e.button !== 0 || !picking) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP) return;
        const hit = viewRef.current?.pick(e.clientX, e.clientY);
        if (hit) callbacks.current.onPick(hit);
      }}
    />
  );
}
