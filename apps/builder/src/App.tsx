import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { PaletteColor, Row } from "@crochetbuilder/engine";
import { createPortal } from "react-dom";
import type { ExportActions } from "./components/ExportMenu.js";
import { focusLater } from "./components/focus.js";
import { PaletteContext, type PaletteInfo } from "./components/palette.js";
import { PART_PANEL_ID, PartsBar, partTabId } from "./components/PartsBar.js";
import { PasteDialog, pasteShortcut, type PasteImport } from "./components/PasteDialog.js";
import { commitPendingEdits } from "./components/pendingEdits.js";
import { PreviewPane } from "./components/PreviewPane.js";
import { RowList, type FocusRequest } from "./components/RowList.js";
import { useRowGroups } from "./components/useRowGroups.js";
import { SplitPane } from "./components/SplitPane.js";
import { StorageNotice } from "./components/StorageNotice.js";
import { TopBar } from "./components/TopBar.js";
import { isDocumentEmpty } from "./export/prepare.js";
import { useFragmentImport } from "./export/useFragmentImport.js";
import { looksLikePattern } from "./paste/detect.js";
import type { PastePreviewOptions } from "./paste/usePastePreview.js";
import { addPart, addRow, duplicatePart, duplicateRow, insertRounds, loadDemo, newDocument } from "./state/actions.js";
import { emptyDocument, type BuilderDoc } from "./state/document.js";
import { canRedo, canUndo, editorReducer, initEditorState, selectedPart, type EditorAction } from "./state/editor.js";
import { paletteCss } from "./state/palette.js";
import { partFindings, partName } from "./state/parts.js";
import type { RoundSpec } from "./state/rounds.js";
import { isMacPlatform, shortcutFor } from "./state/shortcuts.js";
import { usePersistence } from "./state/usePersistence.js";

const NO_COLORS: readonly PaletteColor[] = [];

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
  /** "Anleitung einfügen" preview options (tests: no debounce). */
  pastePreviewOptions?: PastePreviewOptions;
}

/** The notice after a pasted pattern was imported (German). */
export function pasteNotice({ mode, parts, unread }: Pick<PasteImport, "mode" | "parts" | "unread">): string {
  const what = `${parts} ${parts === 1 ? "Teil" : "Teile"}`;
  const head = mode === "replace" ? `Anleitung übernommen: ${what}.` : `${what} hinzugefügt.`;
  const rest =
    unread === 0
      ? ""
      : ` ${unread === 1 ? "1 Stelle blieb" : `${unread} Stellen blieben`} Text – markiert mit „Nicht gelesen“ oder „Nicht unterstützt“, bitte prüfen.`;
  return `${head}${rest} „Rückgängig“ holt den vorherigen Stand zurück.`;
}

/** The builder: top bar, row editor (left) and preview (right). */
export function App({ exportActions, pastePreviewOptions }: AppProps = {}) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => initEditorState(emptyDocument()));
  const persistence = usePersistence(state, dispatch);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  // All rows of the selected card (a group "Runde 7–12" has several).
  const [selectedGroup, setSelectedGroup] = useState<readonly string[]>([]);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const focusCounter = useRef(0);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [nameFocusToken, setNameFocusToken] = useState(0);
  // "Anleitung einfügen": the open dialog's starting text, and the text of the last dialog
  // closed without importing (offered again next time).
  const [paste, setPaste] = useState<{ text: string } | null>(null);
  const [pasteDraft, setPasteDraft] = useState("");
  const [importNotice, setImportNotice] = useState<string | null>(null);
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

  // A document from a file or a link: its author is unknown (provenance "foreign", E25).
  const replaceDocument = useCallback((doc: BuilderDoc, pinned: string[]) => {
    dispatch({ type: "replaceDocument", doc, pinned, source: "foreign" });
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

  // The palette for the row cards (context: they are memoised), with the live document for
  // new colour ids.
  const docRef = useRef(state.doc);
  docRef.current = state.doc;
  const colors = state.doc.overview.colors ?? NO_COLORS;
  const palette = useMemo<PaletteInfo>(() => ({ colors, css: paletteCss(colors), getDoc: () => docRef.current }), [colors]);

  const part = selectedPart(state);
  // Validation only reruns when a part's content changes (cached per part, see parts.ts).
  // The stitch budget of the 3D preview is reported like any other finding.
  const findings = partFindings(part);
  const rows = part.rows;
  // Cards of the row list (groups of identical rounds), shared with the findings panel.
  const groups = useRowGroups(rows, findings);

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

  const selectRow = useCallback((rowId: string, rowIds: readonly string[]) => {
    setSelectedRowId(rowId);
    setSelectedGroup(rowIds);
  }, []);
  // The rows of the selected card: highlighted together in 3D; new rows go after the last.
  const selectedRows =
    selectedRowId === null ? [] : selectedGroup.includes(selectedRowId) ? selectedGroup : [selectedRowId];
  const selectionEnd = selectedRows.length > 0 ? selectedRows[selectedRows.length - 1]! : null;

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

  // Deleting a row (or a group) moves focus to its neighbour (next, else previous), never
  // to <body>.
  const deleteRows = useCallback(
    (rowIds: readonly string[]) => {
      const first = rows.findIndex((r) => r.id === rowIds[0]);
      const last = rows.findIndex((r) => r.id === rowIds[rowIds.length - 1]);
      if (first < 0) return;
      const neighbour = rows[last + 1] ?? rows[first - 1];
      const actions: EditorAction[] = rowIds.map((rowId) => ({ type: "deleteRow", rowId }));
      dispatch(actions.length === 1 ? actions[0]! : { type: "batch", actions });
      if (neighbour) focusRow(neighbour.id);
      else setTimeout(() => document.querySelector<HTMLElement>("[data-focus-id='add-row']")?.focus(), 0);
    },
    [rows, focusRow],
  );

  // Snippet rounds: one undo step, the last inserted row is selected afterwards.
  const insertSnippet = useCallback(
    (afterId: string | null, rounds: RoundSpec[], type: Row["type"]) => {
      const action = insertRounds(afterId, rounds, type);
      dispatch(action);
      const last = action.rows[action.rows.length - 1];
      if (last) focusRow(last.id);
    },
    [focusRow],
  );

  /** Open "Anleitung einfügen"; false when typed text elsewhere could not be committed. */
  const openPaste = useCallback(
    (text?: string): boolean => {
      if (!commitPendingEdits()) return false;
      setPaste({ text: text ?? pasteDraft });
      return true;
    },
    [pasteDraft],
  );

  const importPasted = useCallback(
    (result: PasteImport) => {
      // `result.mode`: adding parts to an empty pattern is a new pattern.
      const first = result.mode === "replace" ? 0 : state.doc.parts.length;
      dispatch(result.action);
      setSelectedRowId(null);
      setPaste(null);
      setPasteDraft("");
      setLinkNotice(null);
      setImportNotice(pasteNotice(result));
      // The first imported part is shown; its tab takes the focus, the findings come into view.
      focusLater(partTabId(first));
      setTimeout(() => document.getElementById("findings-title")?.scrollIntoView?.({ block: "nearest" }), 0);
    },
    [state.doc.parts.length],
  );

  // Pasting a pattern outside a text field opens "Anleitung einfügen" with it. The browser's
  // own paste is only cancelled when the dialog really opens.
  // Safari fires "paste" only where something is editable or selected, so there Ctrl/⌘+V on
  // the page usually does nothing; the button and the offer in an empty pattern still work.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (paste !== null || isEditable(e.target) || isEditable(document.activeElement) || overlayOpen()) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!looksLikePattern(text)) return;
      if (openPaste(text)) e.preventDefault();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [paste, openPaste]);

  // Global shortcuts (by produced character, see shortcuts.ts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The paste dialog owns the keyboard (undo there must not change the pattern behind it).
      if (paste !== null) return;
      const shortcut = shortcutFor(e);
      if (shortcut === "addRow") {
        e.preventDefault();
        const exists = rows.some((r) => r.id === selectionEnd);
        addRowAfter(exists ? selectionEnd : null, false);
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
  }, [rows, selectionEnd, addRowAfter, selectPart, state.doc.parts.length, state.part, paste]);

  const appRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = appRoot.current;
    if (!root) return;
    if (paste !== null) root.setAttribute("inert", "");
    else root.removeAttribute("inert");
  }, [paste]);

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
    <PaletteContext.Provider value={palette}>
      <div ref={appRoot} className="app" onBlurCapture={() => dispatch({ type: "endTyping" })}>
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
        {importNotice !== null && (
          <div className="link-notice link-notice-info" role="status">
            <span>{importNotice}</span>
            <button type="button" className="btn btn-small" onClick={() => setImportNotice(null)}>
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
          onPaste={() => openPaste()}
          onDemo={(kind) => dispatch(loadDemo(kind))}
          onReplace={replaceDocument}
          imported={state.imported}
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
                  {isDocumentEmpty(state.doc) && (
                    <p className="paste-offer">
                      Anleitung schon als Text?
                      <button type="button" className="btn btn-small" onClick={() => openPaste()}>
                        Ganze Anleitung einfügen…
                      </button>
                      <span className="muted small">oder {pasteShortcut()} außerhalb eines Eingabefelds</span>
                    </p>
                  )}
                  <RowList
                    rows={rows}
                    groups={groups}
                    pinned={state.pinned}
                    selectedRowId={selectedRowId}
                    focusRequest={focusRequest}
                    dispatch={dispatch}
                    onSelect={selectRow}
                    onFocusRow={focusRow}
                    onAddRow={addRowAfter}
                    onDuplicate={duplicate}
                    onDelete={deleteRows}
                    onInsertRounds={insertSnippet}
                    severalParts={state.doc.parts.length > 1}
                  />
                </div>
              </>
            }
            right={
              <PreviewPane
                content={part}
                gauge={state.doc.overview.gauge}
                palette={colors}
                findings={findings}
                selectedRowId={selectedRowId}
                highlightRowIds={selectedRows}
                onSelectRow={focusRow}
                pinned={state.pinned}
                groups={groups.items}
                onApplyFix={(action) => dispatch(action)}
              />
            }
          />
        </main>
      </div>
      {/* Outside the app root, which is inert while the dialog is open. */}
      {paste !== null &&
        createPortal(
          <PasteDialog
            initialText={paste.text}
            doc={state.doc}
            onImport={importPasted}
            onClose={(text) => {
              setPaste(null);
              setPasteDraft(text);
            }}
            {...(pastePreviewOptions ? { previewOptions: pastePreviewOptions } : {})}
          />,
          document.body,
        )}
    </PaletteContext.Provider>
  );
}
