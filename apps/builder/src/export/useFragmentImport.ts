/**
 * Opens a document handed over in the builder's own URL (`#data=…`, e.g. from the viewer's
 * "Im Builder bearbeiten"). Runs once the stored document has been restored, and again when
 * the fragment changes. Asks before replacing a non-empty document; the fragment is removed
 * from the address bar either way, so a reload does not import again.
 */

import { useEffect, useRef } from "react";
import { decodeShare, readShareFragment } from "@crochetbuilder/engine";
import type { BuilderDoc } from "../state/document.js";
import { documentFromExport, shareErrorMessage } from "./import.js";
import { isDocumentEmpty } from "./prepare.js";

export const REPLACE_FROM_LINK_QUESTION =
  "Anleitung aus dem Link öffnen? Deine aktuelle Anleitung wird dabei ersetzt (mit „Rückgängig“ zurückholbar).";

export interface FragmentImportOptions {
  /** The stored document has been restored (imports wait for it). */
  ready: boolean;
  doc: BuilderDoc;
  onImport: (doc: BuilderDoc, pinned: string[]) => void;
  onError: (message: string) => void;
  /** Ask the person (default `window.confirm`). */
  confirm?: (question: string) => boolean;
}

function clearFragment() {
  const { pathname, search } = globalThis.location;
  try {
    globalThis.history.replaceState(globalThis.history.state, "", `${pathname}${search}`);
  } catch {
    globalThis.location.hash = "";
  }
}

export function useFragmentImport({ ready, doc, onImport, onError, confirm }: FragmentImportOptions): void {
  const latest = useRef({ doc, onImport, onError, confirm });
  latest.current = { doc, onImport, onError, confirm };
  // The payload being handled: a fragment event during the decode does not start it twice.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const run = () => {
      const payload = readShareFragment(globalThis.location.hash);
      if (!payload || payload === handled.current) return;
      handled.current = payload;
      clearFragment();
      decodeShare(payload).then(
        (exp) => {
          const { doc: current, onImport: apply, onError: fail, confirm: ask } = latest.current;
          const result = documentFromExport(exp);
          if (!result.ok) {
            fail(result.message);
            return;
          }
          const question = ask ?? ((q: string) => globalThis.confirm(q));
          if (!isDocumentEmpty(current) && !question(REPLACE_FROM_LINK_QUESTION)) return;
          apply(result.doc, result.pinned);
        },
        (err: unknown) => latest.current.onError(shareErrorMessage(err)),
      ).finally(() => {
        // The same link may be opened again later.
        if (handled.current === payload) handled.current = null;
      });
    };
    run();
    globalThis.addEventListener("hashchange", run);
    return () => globalThis.removeEventListener("hashchange", run);
  }, [ready]);
}
