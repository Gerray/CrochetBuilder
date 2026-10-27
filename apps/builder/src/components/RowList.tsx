import { useMemo, type Dispatch } from "react";
import { rowLabel, rowOrdinals, type Finding, type Op, type Row } from "@crochetbuilder/engine";
import type { EditorAction } from "../state/editor.js";
import { RowCard, isInstructionLike } from "./RowCard.js";

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
}

const NO_FINDINGS: readonly Finding[] = [];
const PLACEHOLDER_OP: Op = { kind: "stitch", code: "ST", count: 1 };

/** Left side of the editor: all rows/rounds of the part, in order. */
export function RowList(props: RowListProps) {
  const { rows, findings, selectedRowId, focusRequest, dispatch, onSelect, onFocusRow, onAddRow, onDuplicate } = props;
  // Automatic labels via rowOrdinals/rowLabel. A stitch row that is still empty counts as
  // the next round already ("Runde 9" while typing), so it gets a stand-in op here.
  const autoLabels = useMemo(() => {
    const counted = rows.map((r) =>
      r.ops.length === 0 && !isInstructionLike(r) ? { ...r, ops: [PLACEHOLDER_OP], label: undefined } : { ...r, label: undefined },
    );
    const ordinals = rowOrdinals(counted);
    return counted.map((r, i) => rowLabel(r, ordinals[i] ?? 0, "de"));
  }, [rows]);
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
        />
      ))}
      <div className="row-list-actions">
        <button type="button" className="btn btn-primary" onClick={() => onAddRow(null, false)}>
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
      </p>
    </section>
  );
}
