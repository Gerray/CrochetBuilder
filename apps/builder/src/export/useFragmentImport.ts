/**
 * Opens a document handed over in the builder's own URL (`#data=…`, e.g. from the viewer's
 * "Im Builder bearbeiten"). Runs once the stored document has been restored, and again when
 * the fragment changes. Asks before replacing a non-empty document; the fragment is removed
 * from the address bar either way, so a reload does not import again.
 */

import { useEffect, useRef } from "react";
import { decodeShare, readShareFragment, type BuilderExport } from "@crochetbuilder/engine";
import { newId, type BuilderDoc } from "../state/document.js";
import { documentFromExport, shareErrorMessage } from "./import.js";
import { isDocumentEmpty } from "./prepare.js";

export const REPLACE_FROM_LINK_QUESTION =
  "Anleitung aus dem Link öffnen? Deine aktuelle Anleitung wird dabei ersetzt (mit „Rückgängig“ zurückholbar).";

export interface FragmentImportOptions {
  /** The stored document has been restored (imports wait for it). */
  ready: boolean;
  doc: BuilderDoc;
  /** `notice`: something to tell the person about the opened document (German), if anything. */
  onImport: (doc: BuilderDoc, pinned: string[], notice?: string) => void;
  onError: (message: string) => void;
  /** Ask the person (default `window.confirm`). */
  confirm?: (question: string) => boolean;
  /** Decode a payload (default `decodeShare`; tests control the timing). */
  decode?: (payload: string) => Promise<BuilderExport>;
}

function clearFragment() {
  const { pathname, search } = globalThis.location;
  try {
    globalThis.history.replaceState(globalThis.history.state, "", `${pathname}${search}`);
  } catch {
    globalThis.location.hash = "";
  }
}

export function useFragmentImport({ ready, doc, onImport, onError, confirm, decode }: FragmentImportOptions): void {
  const latest = useRef({ doc, onImport, onError, confirm, decode });
  latest.current = { doc, onImport, onError, confirm, decode };
  // The payload being handled: a fragment event during the decode does not start it twice.
  const handled = useRef<string | null>(null);
  // Only the latest link counts: a decode that finishes after a newer link arrived is dropped
  // (no second question, no older document winning the race).
  const latestRun = useRef(0);

  useEffect(() => {
    if (!ready) return;
    const run = () => {
      const payload = readShareFragment(globalThis.location.hash);
      if (!payload || payload === handled.current) return;
      handled.current = payload;
      const id = ++latestRun.current;
      const current = () => id === latestRun.current;
      clearFragment();
      const decodePayload = latest.current.decode ?? decodeShare;
      decodePayload(payload)
        .then(
          (exp) => {
            if (!current()) return;
            const { doc: present, onImport: apply, onError: fail, confirm: ask } = latest.current;
            const result = documentFromExport(exp, newId, "link");
            if (!result.ok) {
              fail(result.message);
              return;
            }
            const question = ask ?? ((q: string) => globalThis.confirm(q));
            if (!isDocumentEmpty(present) && !question(REPLACE_FROM_LINK_QUESTION)) return;
            apply(result.doc, result.pinned, result.notice);
          },
          (err: unknown) => {
            if (current()) latest.current.onError(shareErrorMessage(err));
          },
        )
        .finally(() => {
          // The same link may be opened again later.
          if (handled.current === payload) handled.current = null;
        });
    };
    run();
    globalThis.addEventListener("hashchange", run);
    // No invalidation on cleanup: under StrictMode the effect re-runs after the fragment has
    // already been cleared, and the first decode must still land.
    return () => globalThis.removeEventListener("hashchange", run);
  }, [ready]);
}
