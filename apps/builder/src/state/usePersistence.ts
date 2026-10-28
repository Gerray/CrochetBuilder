import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import type { EditorAction, EditorState } from "./editor.js";
import { loadShownPart, loadState, saveShownPart, saveState } from "./storage.js";

export type SaveStatus = "loading" | "idle" | "saving" | "saved" | "error" | "suspended";

export interface Persistence {
  status: SaveStatus;
  /** The unreadable stored value, while autosave is suspended because of it. */
  invalidStored: unknown;
  /** The person decided to start fresh: autosave resumes (the backup key keeps the old value). */
  resume: () => void;
}

export const SAVE_DELAY_MS = 400;

interface Pending {
  doc: EditorState["doc"];
  pinned: EditorState["pinned"];
  imported: EditorState["imported"];
}

/**
 * Restore the last document on mount, then autosave every change (debounced, flushed
 * immediately when the page is hidden or closed). Until the restore finished nothing is
 * written. If the stored value cannot be read, autosave stays suspended until `resume()`,
 * so an empty start document can never overwrite it.
 */
export function usePersistence(state: EditorState, dispatch: Dispatch<EditorAction>): Persistence {
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [invalidStored, setInvalidStored] = useState<unknown>(undefined);
  const [resumed, setResumed] = useState(0);
  const ready = useRef(false); // restore finished and not suspended
  const pending = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const save = useCallback((value: Pending) => {
    setStatus("saving");
    saveState(value).then(
      () => setStatus((s) => (s === "saving" ? "saved" : s)),
      () => setStatus("error"),
    );
  }, []);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const value = pending.current;
    pending.current = null;
    if (value && ready.current) save(value);
  }, [save]);

  useEffect(() => {
    let cancelled = false;
    loadState().then(
      (result) => {
        if (cancelled) return;
        if (result.kind === "ok") {
          dispatch({
            type: "hydrate",
            doc: result.state.doc,
            pinned: result.state.pinned,
            part: loadShownPart(),
            imported: result.state.imported === true,
          });
        }
        if (result.kind === "invalid") {
          setInvalidStored(result.raw);
          setStatus("suspended");
          return;
        }
        ready.current = true;
        setStatus("idle");
      },
      () => {
        if (cancelled) return;
        ready.current = true;
        setStatus("idle");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const { doc, pinned, part, imported } = state;
  useEffect(() => {
    if (!ready.current) return;
    pending.current = { doc, pinned, imported };
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [doc, pinned, imported, resumed, flush]);

  // The part shown is remembered on its own: switching parts is no document save.
  useEffect(() => {
    if (ready.current) saveShownPart(part);
  }, [part, resumed]);

  // Never lose the last edits when the tab is hidden or closed.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  const resume = useCallback(() => {
    if (ready.current) return;
    ready.current = true;
    setInvalidStored(undefined);
    setStatus("idle");
    setResumed((n) => n + 1);
  }, []);

  return { status, invalidStored, resume };
}
