/**
 * React side of the paste preview: debounces typing, asks the parser (Worker or main thread)
 * and drops stale answers, so the preview always belongs to the latest text. A text over the
 * parser's size limit is not read at all (German message instead).
 */

import { useEffect, useRef, useState } from "react";
import { createPasteParser, SupersededError, type PasteParser } from "./client.js";
import type { LocaleChoice, PastePreview } from "./preview.js";

export interface PastePreviewState {
  /** Preview of the latest text that has been read (null: nothing read yet, empty text, error). */
  preview: PastePreview | null;
  /** The text and notation `preview` was read from. */
  text: string;
  choice: LocaleChoice;
  /** The text changed and is being read. */
  computing: boolean;
  /** Why there is no preview (too long, or the text could not be read at all), German. */
  error: string | null;
}

export interface PastePreviewOptions {
  /** Wait this long after the last keystroke (default 200 ms). */
  debounceMs?: number;
  /** Parser factory (tests pass a fake). Must be stable. */
  createParser?: () => PasteParser;
}

const kb = (chars: number) => Math.ceil(chars / 1000).toLocaleString("de-DE");

/** German message for a text over the size limit. */
export function tooLongMessage(chars: number, max: number): string {
  return `Der Text ist zu lang (${kb(chars)} KB) – höchstens ${kb(max)} KB auf einmal. Bitte die Anleitung in Teilen einfügen und mit „Teile hinzufügen“ ergänzen.`;
}

export function usePastePreview(
  text: string,
  choice: LocaleChoice,
  { debounceMs = 200, createParser = createPasteParser }: PastePreviewOptions = {},
): PastePreviewState {
  const [state, setState] = useState<PastePreviewState>({
    preview: null,
    text: "",
    choice,
    computing: false,
    error: null,
  });
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
    const settle = (patch: Partial<PastePreviewState>) =>
      setState({ preview: null, text, choice, computing: false, error: null, ...patch });
    if (text.trim() === "") {
      lastText.current = text;
      settle({});
      return;
    }
    const max = parser.current?.maxChars ?? Number.POSITIVE_INFINITY;
    if (text.length > max) {
      lastText.current = text;
      settle({ error: tooLongMessage(text.length, max) });
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
            if (request === latest.current) settle({ preview });
          },
          (err: unknown) => {
            if (err instanceof SupersededError || request !== latest.current) return;
            console.error(err);
            // Never keep an outdated preview after a failure: nothing can be imported.
            settle({
              error: `Der Text konnte nicht gelesen werden: ${err instanceof Error ? err.message : String(err)}`,
            });
          },
        );
      },
      typed ? debounceMs : 0,
    );
    return () => clearTimeout(timer);
  }, [text, choice, debounceMs]);

  return state;
}
