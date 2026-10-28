import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ExportActions } from "./components/ExportMenu.js";
import { focusLater } from "./components/focus.js";
import { PART_PANEL_ID, PartsBar, partTabId } from "./components/PartsBar.js";
import { commitPendingEdits } from "./components/pendingEdits.js";
import { PreviewPane } from "./components/PreviewPane.js";
import { RowList, type FocusRequest } from "./components/RowList.js";
import { SplitPane } from "./components/SplitPane.js";
import { StorageNotice } from "./components/StorageNotice.js";
import { TopBar } from "./components/TopBar.js";
import { useFragmentImport } from "./export/useFragmentImport.js";
import { addPart, addRow, duplicatePart, duplicateRow, loadDemo, newDocument } from "./state/actions.js";
import { emptyDocument, type BuilderDoc } from "./state/document.js";
import { canRedo, canUndo, editorReducer, initEditorState, selectedPart } from "./state/editor.js";
import { partFindings, partName } from "./state/parts.js";
import { isMacPlatform, shortcutFor } from "./state/shortcuts.js";
import { usePersistence } from "./state/usePersistence.js";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Alt+↑/↓ belongs to the control itself here: a list opens, a text area moves by paragraph,
 * and on macOS Option+↑/↓ moves the caret in any text field.
 */
function keepsAltArrows(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (["TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return isMacPlatform() && isEditable(target);
}

/** A menu or dialog (demos, export, storage notice) is open: it owns the keyboard. */
function overlayOpen(): boolean {
  return document.querySelector("[role='menu'], [role='dialog'], [role='alertdialog']") !== null;
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
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [nameFocusToken, setNameFocusToken] = useState(0);
  // The deleted part the notice offers to bring back, with the document before the deletion
  // (the notice shows while that deletion is the latest undo step).
  const [deleted, setDeleted] = useState<{ name: string; index: number; before: BuilderDoc } | null>(null);
  // Another part in view (click, shortcut, undo …): no row of it is selected, and an old focus
  // request must not pull focus into the rows when they mount. Reset during render, so the
  // new rows never see the old values.
  const [shownPart, setShownPart] = useState(state.part);
  if (shownPart !== state.part) {
    setShownPart(state.part);
    setSelectedRowId(null);
    setFocusRequest(null);
  }

  const replaceDocument = useCallback((doc: BuilderDoc, pinned: string[]) => {
    dispatch({ type: "replaceDocument", doc, pinned });
    setSelectedRowId(null);
  }, []);

  // A document handed over in the URL (#data=…), once the stored one has been restored.
  useFragmentImport({
    ready: persistence.status !== "loading",
    doc: state.doc,
    onImport: (doc, pinned, notice) => {
      setLinkError(null);
      setLinkNotice(notice ?? null);
      replaceDocument(doc, pinned);
    },
    onError: (message) => {
      setLinkNotice(null);
      setLinkError(message);
    },
  });

  const part = selectedPart(state);
  // Validation only reruns when a part's content changes (cached per part, see parts.ts).
  // The stitch budget of the 3D preview is reported like any other finding.
  const findings = partFindings(part);
  const rows = part.rows;

  // Everything that swaps the rows in view first commits typed text; an unreadable text stops
  // it (the field keeps its error and the focus).
  const selectPart = useCallback(
    (index: number) => {
      if (index === state.part) return true;
      if (!commitPendingEdits()) return false;
      dispatch({ type: "selectPart", index });
      return true;
    },
    [state.part],
  );

  const addNewPart = useCallback(() => {
    if (!commitPendingEdits()) return;
    dispatch(addPart());
    setNameFocusToken((t) => t + 1);
  }, []);

  const duplicateSelectedPart = useCallback(
    (index: number) => {
      if (commitPendingEdits()) dispatch(duplicatePart(state.doc, index));
    },
    [state.doc],
  );

  const deletePart = useCallback(
    (index: number) => {
      const target = state.doc.parts[index];
      if (!target || state.doc.parts.length <= 1 || !commitPendingEdits()) return;
      const next = editorReducer(state, { type: "deletePart", index });
      dispatch({ type: "deletePart", index });
      setDeleted({ name: partName(target.name, index), index, before: state.doc });
      focusLater(partTabId(next.part));
    },
    [state],
  );
  const lastStep = state.past[state.past.length - 1];
  const deletedName = deleted && lastStep?.doc === deleted.before ? deleted.name : null;

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
      } else if (shortcut === "prevPart" || shortcut === "nextPart") {
        if (keepsAltArrows(e.target) || overlayOpen()) return;
        e.preventDefault();
        const count = state.doc.parts.length;
        const next = (state.part + (shortcut === "nextPart" ? 1 : count - 1)) % count;
        if (next === state.part) return;
        const active = document.activeElement;
        const inEditor = active instanceof HTMLElement && active.closest(`.parts-bar, #${PART_PANEL_ID}`) !== null;
        if (!selectPart(next)) return;
        // From the rows or the parts bar (name, quantity, tabs) focus moves to the new tab;
        // from elsewhere (title, preview) it stays where it was.
        if (inEditor) focusLater(partTabId(next));
      } else if (shortcut && !isEditable(e.target)) {
        // Inside text fields the browser's own undo applies.
        e.preventDefault();
        dispatch({ type: shortcut });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selectedRowId, addRowAfter, selectPart, state.doc.parts.length, state.part]);

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
      {linkNotice !== null && (
        <div className="link-notice link-notice-info" role="status">
          <span>{linkNotice}</span>
          <button type="button" className="btn btn-small" onClick={() => setLinkNotice(null)}>
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
            <>
              <PartsBar
                doc={state.doc}
                selected={state.part}
                dispatch={dispatch}
                onSelect={selectPart}
                onAdd={addNewPart}
                onDuplicate={duplicateSelectedPart}
                onDelete={deletePart}
                nameFocusToken={nameFocusToken}
                onRequestNameFocus={() => setNameFocusToken((t) => t + 1)}
                deletedName={deletedName}
                onUndoDelete={() => {
                  dispatch({ type: "undo" });
                  if (deleted) focusLater(partTabId(deleted.index));
                  setDeleted(null);
                }}
              />
              <div id={PART_PANEL_ID} role="tabpanel" aria-labelledby={partTabId(state.part)}>
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
                  severalParts={state.doc.parts.length > 1}
                />
              </div>
            </>
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
