/**
 * React side of the paste preview: debounces typing, asks the parser (Worker or main thread)
 * and drops stale answers, so the preview always belongs to the latest text.
 */

import { useEffect, useRef, useState } from "react";
import { createPasteParser, type PasteParser } from "./client.js";
import type { LocaleChoice, PastePreview } from "./preview.js";

export interface PastePreviewState {
  /** Preview of the latest text that has been read (null: nothing read yet / empty text). */
  preview: PastePreview | null;
  /** The text changed and is being read. */
  computing: boolean;
  /** The text could not be read at all (a bug, shown as a message). */
  error: string | null;
}

export interface PastePreviewOptions {
  /** Wait this long after the last keystroke (default 200 ms). */
  debounceMs?: number;
  /** Parser factory (tests pass a fake). Must be stable. */
  createParser?: () => PasteParser;
}

export function usePastePreview(
  text: string,
  choice: LocaleChoice,
  { debounceMs = 200, createParser = createPasteParser }: PastePreviewOptions = {},
): PastePreviewState {
  const [state, setState] = useState<PastePreviewState>({ preview: null, computing: false, error: null });
  const parser = useRef<PasteParser | null>(null);
  const latest = useRef(0);
  const lastText = useRef<string | null>(null);

  useEffect(() => {
    const p = createParser();
    parser.current = p;
    return () => {
      p.dispose();
      parser.current = null;
    };
  }, [createParser]);

  useEffect(() => {
    const request = ++latest.current;
    if (text.trim() === "") {
      lastText.current = text;
      setState({ preview: null, computing: false, error: null });
      return;
    }
    // A new choice of notation answers at once; typing waits for a pause.
    const typed = lastText.current !== null && lastText.current !== text;
    lastText.current = text;
    setState((s) => (s.computing ? s : { ...s, computing: true }));
    const timer = setTimeout(
      () => {
        parser.current?.parse(text, choice).then(
          (preview) => {
            if (request === latest.current) setState({ preview, computing: false, error: null });
          },
          (err: unknown) => {
            if (request !== latest.current) return;
            console.error(err);
            setState((s) => ({ ...s, computing: false, error: err instanceof Error ? err.message : String(err) }));
          },
        );
      },
      typed ? debounceMs : 0,
    );
    return () => clearTimeout(timer);
  }, [text, choice, debounceMs]);

  return state;
}
