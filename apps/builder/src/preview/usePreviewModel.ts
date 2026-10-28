/**
 * React side of the preview computation: debounces edits, asks the preview client (Worker or
 * main thread) for a model and keeps the last good one around.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Gauge, MeshStyle, PartContent } from "@crochetbuilder/engine";
import { createPreviewClient } from "./client.js";
import { geometryKey, withColors, type PreviewClient, type PreviewModel, type PreviewResult } from "./protocol.js";

export interface PreviewState {
  /**
   * `pending` before the first result, then the kind of the latest result: a model, no
   * stitches yet, over the stitch budget, or an error.
   */
  status: "pending" | "model" | "empty" | "overBudget" | "error";
  /**
   * The latest model that was built. Kept (and shown greyed out) while the pattern is over
   * the budget or the computation failed, cleared when the pattern is empty.
   */
  model: PreviewModel | null;
  /** A computation is scheduled or running. */
  computing: boolean;
  overBudget?: { stitchCount: number; maxStitches: number };
  error?: string;
  /**
   * The model is computed on the main thread (no Worker): a smaller stitch budget applies
   * (`MAIN_THREAD_MAX_STITCHES`).
   */
  mainThread?: boolean;
}

export const INITIAL_PREVIEW: PreviewState = { status: "pending", model: null, computing: true };

/** Fold a (current, non-stale) result into the state. */
export function applyResult(state: PreviewState, result: PreviewResult, stillComputing = false): PreviewState {
  const computing = stillComputing;
  switch (result.kind) {
    case "model":
      return { status: "model", model: result.model, computing };
    case "empty":
      return { status: "empty", model: null, computing };
    case "overBudget":
      return {
        status: "overBudget",
        model: state.model,
        computing,
        overBudget: { stitchCount: result.stitchCount, maxStitches: result.maxStitches },
      };
    case "error":
      return { status: "error", model: state.model, computing, error: result.message };
    case "colors":
      // New colours for the model shown: same geometry arrays, so the view only recolours.
      return state.model ? { ...state, status: "model", model: withColors(state.model, result.colors), computing } : state;
  }
}

export interface PreviewOptions {
  /** Wait this long after the last edit before computing (default 200 ms). */
  debounceMs?: number;
  /** Client factory (tests pass a fake). Must be stable. */
  createClient?: () => PreviewClient;
}

/**
 * The model for `content`/`gauge` in mesh `style`. The first computation and style changes
 * start at once; edits are debounced. Stale results never overwrite newer ones. With
 * `palette` (the palette's ids, format v2) the model carries every stitch's colour index.
 */
export function usePreviewModel(
  content: PartContent,
  gauge: Gauge | undefined,
  style: MeshStyle,
  { debounceMs = 200, createClient = createPreviewClient }: PreviewOptions = {},
  palette: readonly string[] = [],
): PreviewState {
  // Only the ids matter (renaming or recolouring a colour needs no new model).
  const paletteKey = palette.join("\u0000");
  const [state, setState] = useState<PreviewState>(INITIAL_PREVIEW);
  const clientRef = useRef<PreviewClient | null>(null);
  const scheduled = useRef(false);
  const last = useRef<{ content: PartContent; gauge: Gauge | undefined } | null>(null);
  // What shapes the mesh (without colours, labels, targets) and the shape of the model shown.
  const shape = useMemo(() => `${geometryKey(content, gauge, 0)}\u0001${style}`, [content, gauge, style]);
  const shownShape = useRef<string | null>(null);

  useEffect(() => {
    const client = createClient();
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, [createClient]);

  useEffect(() => {
    const edited = last.current !== null && (last.current.content !== content || last.current.gauge !== gauge);
    last.current = { content, gauge };
    // The mesh shown has this shape already: only its colours (or nothing visible) changed.
    const colorsOnly = shownShape.current === shape;
    if (!colorsOnly) setState((s) => (s.computing ? s : { ...s, computing: true }));
    scheduled.current = true;
    const timer = setTimeout(
      () => {
        scheduled.current = false;
        const client = clientRef.current;
        if (!client) return;
        const ids = paletteKey === "" ? [] : paletteKey.split("\u0000");
        const request = { content, gauge, style, ...(ids.length > 0 ? { palette: ids } : {}), ...(colorsOnly ? { colorsOnly } : {}) };
        client
          .compute(request)
          .then((result) => {
            if (!result) return;
            const mainThread = client.degraded;
            if (result.kind === "model") shownShape.current = shape;
            else if (result.kind !== "colors") shownShape.current = null;
            setState((s) => ({ ...applyResult(s, result, scheduled.current || client.busy), ...(mainThread ? { mainThread } : {}) }));
          })
          .catch((err: unknown) => {
            // compute() does not reject; a throwing state update must not go unhandled.
            console.error(err);
          });
      },
      edited && !colorsOnly ? debounceMs : 0,
    );
    return () => {
      clearTimeout(timer);
      scheduled.current = false;
    };
  }, [content, gauge, style, debounceMs, paletteKey, shape]);

  return state;
}
