/**
 * Thin React wrapper around `createModelView`: one canvas, props mirrored into the view.
 * Loaded lazily by the preview pane so Three.js is not part of the first paint.
 */

import { useEffect, useRef } from "react";
import {
  createModelView,
  WebGLUnavailableError,
  type ModelView,
  type ModelViewStyle,
  type ViewMesh,
} from "./modelView.js";

export interface ModelCanvasProps {
  mesh: ViewMesh | null;
  highlightRowId: string | null;
  dimmed: boolean;
  showGrid: boolean;
  /** Changing this number frames the model again ("Ansicht zurücksetzen"). */
  resetToken: number;
  onPickRow: (rowId: string) => void;
  /** No WebGL. Any other start-up error is thrown to the nearest error boundary. */
  onUnavailable: (error: WebGLUnavailableError) => void;
  /** The view, once created (and null on unmount) — e.g. for snapshots. */
  onView?: (view: ModelView | null) => void;
}

/** Colours from the theme's CSS custom properties (see styles.css, `.model-host`). */
export function themeColors(el: Element): Partial<ModelViewStyle> {
  const css = getComputedStyle(el);
  const read = (name: string) => css.getPropertyValue(name).trim() || undefined;
  const colors: Partial<ModelViewStyle> = {};
  const background = read("--model-bg");
  const yarn = read("--model-yarn");
  const highlight = read("--model-highlight");
  const grid = read("--model-grid");
  if (background) colors.background = background;
  if (yarn) colors.yarn = yarn;
  if (highlight) colors.highlight = highlight;
  if (grid) colors.grid = grid;
  return colors;
}

/** A click is a pointer that went down and up within this many pixels (else it was a drag). */
const CLICK_SLOP = 5;

export default function ModelCanvas(props: ModelCanvasProps) {
  const { mesh, highlightRowId, dimmed, showGrid, resetToken } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ModelView | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const down = useRef<{ x: number; y: number } | null>(null);

  // Create the view once per mount, on a fresh canvas: a disposed view force-loses its WebGL
  // context, and a canvas keeps its (lost) context for good — StrictMode remounts would
  // otherwise get a dead renderer. Follow the colour scheme.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.className = "model-canvas";
    host.prepend(canvas);
    let view: ModelView;
    try {
      view = createModelView(canvas, { style: { ...themeColors(host), dimmed, showGrid } });
    } catch (err) {
      canvas.remove();
      if (err instanceof WebGLUnavailableError) {
        callbacks.current.onUnavailable(err);
        return;
      }
      throw err; // a bug, not a missing feature: the boundary offers a retry
    }
    viewRef.current = view;
    callbacks.current.onView?.(view);
    const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    const onScheme = () => view.setStyle(themeColors(host));
    media?.addEventListener?.("change", onScheme);
    return () => {
      media?.removeEventListener?.("change", onScheme);
      callbacks.current.onView?.(null);
      viewRef.current = null;
      view.dispose();
      canvas.remove();
    };
    // Mount-only: later prop changes go through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => viewRef.current?.setMesh(mesh), [mesh]);
  useEffect(() => viewRef.current?.setHighlight(highlightRowId), [highlightRowId, mesh]);
  useEffect(() => viewRef.current?.setStyle({ dimmed, showGrid }), [dimmed, showGrid]);
  useEffect(() => {
    if (resetToken > 0) viewRef.current?.resetView();
  }, [resetToken]);

  return (
    <div
      ref={hostRef}
      className="model-host"
      role="img"
      aria-label="3D-Modell – ziehen zum Drehen, Mausrad zum Zoomen, Klick auf eine Masche wählt ihre Runde"
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const start = down.current;
        down.current = null;
        if (!start || e.button !== 0) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP) return;
        const hit = viewRef.current?.pick(e.clientX, e.clientY);
        if (hit) callbacks.current.onPickRow(hit.rowId);
      }}
    />
  );
}
