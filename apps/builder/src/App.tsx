import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { DEFAULT_MAX_STITCHES, validate } from "@crochetbuilder/engine";
import type { ExportActions } from "./components/ExportMenu.js";
import { PreviewPane } from "./components/PreviewPane.js";
import { RowList, type FocusRequest } from "./components/RowList.js";
import { SplitPane } from "./components/SplitPane.js";
import { StorageNotice } from "./components/StorageNotice.js";
import { TopBar } from "./components/TopBar.js";
import { useFragmentImport } from "./export/useFragmentImport.js";
import { addRow, duplicateRow, loadDemo, newDocument } from "./state/actions.js";
import { emptyDocument, type BuilderDoc } from "./state/document.js";
import { canRedo, canUndo, currentPart, editorReducer, initEditorState } from "./state/editor.js";
import { shortcutFor } from "./state/shortcuts.js";
import { usePersistence } from "./state/usePersistence.js";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export interface AppProps {
  /** Export side effects (tests replace PDF, download and clipboard). */
  exportActions?: Partial<ExportActions>;
}

/** The builder: top bar, row editor (left) and preview (right). */
export function App({ exportActions }: AppProps = {}) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => initEditorState(emptyDocument()));
  const persistence = usePersistence(state, dispatch);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const focusCounter = useRef(0);
  const [linkError, setLinkError] = useState<string | null>(null);

  const replaceDocument = useCallback((doc: BuilderDoc, pinned: string[]) => {
    dispatch({ type: "replaceDocument", doc, pinned });
    setSelectedRowId(null);
  }, []);

  // A document handed over in the URL (#data=…), once the stored one has been restored.
  useFragmentImport({
    ready: persistence.status !== "loading",
    doc: state.doc,
    onImport: (doc, pinned) => {
      setLinkError(null);
      replaceDocument(doc, pinned);
    },
    onError: setLinkError,
  });

  const part = currentPart(state.doc);
  // Validation only reruns when the part content changes (row/op limits keep it cheap).
  // The stitch budget of the 3D preview is reported like any other finding.
  const findings = useMemo(() => validate(part, { maxStitches: DEFAULT_MAX_STITCHES }), [part]);
  const rows = part.rows;

  const focusRow = useCallback((rowId: string) => {
    setSelectedRowId(rowId);
    setFocusRequest({ rowId, token: ++focusCounter.current });
  }, []);

  const addRowAfter = useCallback(
    (afterId: string | null, instruction: boolean) => {
      const action = addRow(afterId, instruction);
      dispatch(action);
      focusRow(action.id);
    },
    [focusRow],
  );

  const duplicate = useCallback(
    (rowId: string) => {
      const action = duplicateRow(rowId);
      dispatch(action);
      if (action.type === "duplicateRow") focusRow(action.newId);
    },
    [focusRow],
  );

  // Deleting a row moves focus to its neighbour (next, else previous), never to <body>.
  const deleteRow = useCallback(
    (rowId: string) => {
      const index = rows.findIndex((r) => r.id === rowId);
      const neighbour = rows[index + 1] ?? rows[index - 1];
      dispatch({ type: "deleteRow", rowId });
      if (neighbour) focusRow(neighbour.id);
      else setTimeout(() => document.querySelector<HTMLElement>("[data-focus-id='add-row']")?.focus(), 0);
    },
    [rows, focusRow],
  );

  // Global shortcuts (by produced character, see shortcuts.ts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shortcut = shortcutFor(e);
      if (shortcut === "addRow") {
        e.preventDefault();
        const exists = rows.some((r) => r.id === selectedRowId);
        addRowAfter(exists ? selectedRowId : null, false);
      } else if (shortcut && !isEditable(e.target)) {
        // Inside text fields the browser's own undo applies.
        e.preventDefault();
        dispatch({ type: shortcut });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selectedRowId, addRowAfter]);

  useEffect(() => {
    document.title = state.doc.title.trim() ? `${state.doc.title.trim()} – CrochetBuilder` : "CrochetBuilder";
  }, [state.doc.title]);

  if (persistence.status === "loading") {
    return (
      <div className="loading" role="status">
        Lade …
      </div>
    );
  }

  return (
    // Leaving a field ends its typing streak: the next edit is a separate undo step.
    <div className="app" onBlurCapture={() => dispatch({ type: "endTyping" })}>
      {persistence.invalidStored !== undefined && (
        <StorageNotice raw={persistence.invalidStored} onStartFresh={persistence.resume} />
      )}
      {linkError !== null && (
        <div className="link-notice" role="alert">
          <span>
            <strong>Anleitung aus dem Link konnte nicht geöffnet werden.</strong> {linkError}
          </span>
          <button type="button" className="btn btn-small" onClick={() => setLinkError(null)}>
            Schließen
          </button>
        </div>
      )}
      <TopBar
        doc={state.doc}
        dispatch={dispatch}
        canUndo={canUndo(state)}
        canRedo={canRedo(state)}
        status={persistence.status}
        onNew={() => dispatch(newDocument())}
        onDemo={(kind) => dispatch(loadDemo(kind))}
        onReplace={replaceDocument}
        {...(exportActions ? { exportActions } : {})}
      />
      <main className="workspace">
        <SplitPane
          left={
            <RowList
              rows={rows}
              findings={findings}
              selectedRowId={selectedRowId}
              focusRequest={focusRequest}
              dispatch={dispatch}
              onSelect={setSelectedRowId}
              onFocusRow={focusRow}
              onAddRow={addRowAfter}
              onDuplicate={duplicate}
              onDelete={deleteRow}
            />
          }
          right={
            <PreviewPane
              content={part}
              gauge={state.doc.overview.gauge}
              findings={findings}
              selectedRowId={selectedRowId}
              onSelectRow={focusRow}
            />
          }
        />
      </main>
    </div>
  );
}
