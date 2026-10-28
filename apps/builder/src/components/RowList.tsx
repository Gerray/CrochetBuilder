import { useMemo, type Dispatch } from "react";
import type { Finding, Row } from "@crochetbuilder/engine";
import type { EditorAction } from "../state/editor.js";
import { autoRowLabels } from "../state/labels.js";
import { RowCard } from "./RowCard.js";

export interface FocusRequest {
  rowId: string;
  token: number;
}

interface RowListProps {
  rows: readonly Row[];
  findings: readonly Finding[];
  selectedRowId: string | null;
  focusRequest: FocusRequest | null;
  dispatch: Dispatch<EditorAction>;
  onSelect: (rowId: string) => void;
  onFocusRow: (rowId: string) => void;
  onAddRow: (afterId: string | null, instruction: boolean) => void;
  onDuplicate: (rowId: string) => void;
  onDelete: (rowId: string) => void;
  /** The pattern has more than one part (the tip mentions switching). */
  severalParts?: boolean;
}

const NO_FINDINGS: readonly Finding[] = [];

/** Left side of the editor: all rows/rounds of the part, in order. */
export function RowList(props: RowListProps) {
  const { rows, findings, selectedRowId, focusRequest, dispatch, onSelect, onFocusRow, onAddRow, onDuplicate, onDelete } =
    props;
  const autoLabels = useMemo(() => autoRowLabels(rows), [rows]);
  const byRow = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of findings) map.set(f.rowId, [...(map.get(f.rowId) ?? []), f]);
    return map;
  }, [findings]);

  const onEnter = (rowId: string, hasStitches: boolean) => {
    const index = rows.findIndex((r) => r.id === rowId);
    const next = rows[index + 1];
    if (next) onFocusRow(next.id);
    else if (hasStitches) onAddRow(rowId, false);
  };

  const lastType = rows[rows.length - 1]?.type ?? "round";

  return (
    <section className="row-list" aria-label="Runden und Reihen">
      {rows.length === 0 && <p className="muted empty-hint">Noch keine Runde. Leg mit „+ Runde“ los.</p>}
      {rows.map((row, i) => (
        <RowCard
          key={row.id}
          row={row}
          autoLabel={autoLabels[i] ?? ""}
          index={i}
          count={rows.length}
          findings={byRow.get(row.id) ?? NO_FINDINGS}
          selected={row.id === selectedRowId}
          focusToken={focusRequest?.rowId === row.id ? focusRequest.token : undefined}
          dispatch={dispatch}
          onSelect={onSelect}
          onEnter={onEnter}
          onAddAfter={(id, instruction) => onAddRow(id, instruction)}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onFocusRow={onFocusRow}
        />
      ))}
      <div className="row-list-actions">
        <button type="button" className="btn btn-primary" data-focus-id="add-row" onClick={() => onAddRow(null, false)}>
          + {lastType === "row" ? "Reihe" : "Runde"}
        </button>
        <button type="button" className="btn" onClick={() => onAddRow(null, true)}>
          + Hinweis
        </button>
      </div>
      <p className="hint">
        Tipp: Maschen als Text eintippen, z. B. <kbd>6× (1 fM, 1 Zun)</kbd> oder <kbd>6 Zun (12)</kbd>.{" "}
        <kbd>Enter</kbd> übernimmt und springt weiter, <kbd>Esc</kbd> verwirft, <kbd>Alt</kbd>+<kbd>N</kbd> fügt eine
        neue Runde ein.
        {props.severalParts && (
          <>
            {" "}
            <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> wechselt das Teil.
          </>
        )}
      </p>
    </section>
  );
}
