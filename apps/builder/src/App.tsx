import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { validate } from "@crochetbuilder/engine";
import { PreviewPane } from "./components/PreviewPane.js";
import { RowList, type FocusRequest } from "./components/RowList.js";
import { SplitPane } from "./components/SplitPane.js";
import { TopBar } from "./components/TopBar.js";
import { addRow, duplicateRow, loadDemo, newDocument } from "./state/actions.js";
import { emptyDocument } from "./state/document.js";
import { canRedo, canUndo, currentPart, editorReducer, initEditorState } from "./state/editor.js";
import { usePersistence } from "./state/usePersistence.js";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** The builder: top bar, row editor (left) and preview (right). */
export function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => initEditorState(emptyDocument()));
  const status = usePersistence(state, dispatch);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const focusCounter = useRef(0);

  const part = currentPart(state.doc);
  const findings = useMemo(() => validate(part), [part]);

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

  // Global shortcuts: Alt+N adds a row after the selected one; Ctrl+Z / Ctrl+Y outside fields.
  const rows = part.rows;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyN") {
        e.preventDefault();
        const exists = rows.some((r) => r.id === selectedRowId);
        addRowAfter(exists ? selectedRowId : null, false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !isEditable(e.target)) {
        if (e.code === "KeyZ") {
          e.preventDefault();
          dispatch({ type: e.shiftKey ? "redo" : "undo" });
        } else if (e.code === "KeyY") {
          e.preventDefault();
          dispatch({ type: "redo" });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selectedRowId, addRowAfter]);

  useEffect(() => {
    document.title = state.doc.title.trim() ? `${state.doc.title.trim()} – CrochetBuilder` : "CrochetBuilder";
  }, [state.doc.title]);

  if (status === "loading") {
    return (
      <div className="loading" role="status">
        Lade …
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar
        doc={state.doc}
        dispatch={dispatch}
        canUndo={canUndo(state)}
        canRedo={canRedo(state)}
        status={status}
        onNew={() => dispatch(newDocument())}
        onDemo={() => dispatch(loadDemo())}
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
