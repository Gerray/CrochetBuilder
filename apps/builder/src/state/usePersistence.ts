import { useEffect, useRef, useState, type Dispatch } from "react";
import type { EditorAction, EditorState } from "./editor.js";
import { loadState, saveState } from "./storage.js";

export type SaveStatus = "loading" | "idle" | "saving" | "saved" | "error";

const SAVE_DELAY_MS = 400;

/**
 * Restore the last document on mount, then autosave every change (debounced). Until the
 * restore finished the status is "loading" and nothing is written, so an empty start
 * document can never overwrite what was stored.
 */
export function usePersistence(state: EditorState, dispatch: Dispatch<EditorAction>): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>("loading");
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const done = () => {
      if (cancelled) return;
      hydrated.current = true;
      setStatus("idle");
    };
    loadState().then((stored) => {
      if (!cancelled && stored) dispatch({ type: "hydrate", doc: stored.doc, pinned: stored.pinned });
      done();
    }, done);
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const { doc, pinned } = state;
  useEffect(() => {
    if (!hydrated.current) return;
    setStatus("saving");
    const timer = setTimeout(() => {
      saveState({ doc, pinned: [...pinned] }).then(
        () => setStatus("saved"),
        () => setStatus("error"),
      );
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [doc, pinned]);

  return status;
}
