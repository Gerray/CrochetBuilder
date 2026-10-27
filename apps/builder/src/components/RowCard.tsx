import { memo, useEffect, useRef, useState, type Dispatch } from "react";
import { computeRowStitches, type Finding, type Row } from "@crochetbuilder/engine";
import type { EditorAction } from "../state/editor.js";
import { isInstructionLike } from "../state/labels.js";
import { findingMessage } from "../state/messages.js";
import { MAX_STITCH_COUNT_TARGET } from "@crochetbuilder/engine";
import { NumberField } from "./fields.js";
import { focusLater } from "./focus.js";
import { OpEditor } from "./OpEditor.js";
import { RowTextField } from "./RowTextField.js";

export interface RowCardProps {
  row: Row;
  /** Automatic label ("Runde 3") used when the row has no own label. */
  autoLabel: string;
  index: number;
  count: number;
  findings: readonly Finding[];
  selected: boolean;
  /** Changes whenever the editor wants this row's main input focused. */
  focusToken: number | undefined;
  dispatch: Dispatch<EditorAction>;
  onSelect: (rowId: string) => void;
  onEnter: (rowId: string, hasStitches: boolean) => void;
  onAddAfter: (rowId: string, instruction: boolean) => void;
  onDuplicate: (rowId: string) => void;
  onDelete: (rowId: string) => void;
  onFocusRow: (rowId: string) => void;
}

function RowCardImpl(props: RowCardProps) {
  const { row, autoLabel, index, count, findings, selected, focusToken, dispatch, onSelect } = props;
  const mainInput = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const instruction = isInstructionLike(row);
  const title = row.label?.trim() || autoLabel;
  const titleId = `row-title-${row.id}`;

  useEffect(() => {
    if (focusToken === undefined) return;
    cardRef.current?.scrollIntoView?.({ block: "nearest" });
    mainInput.current?.focus();
  }, [focusToken]);

  // Switching between stitch row and instruction swaps the main input; keep focus in the card.
  const wasInstruction = useRef(instruction);
  useEffect(() => {
    if (wasInstruction.current === instruction) return;
    wasInstruction.current = instruction;
    const active = document.activeElement;
    if (!active || active === document.body) mainInput.current?.focus();
  }, [instruction]);

  const hasError = findings.some((f) => f.severity === "error");
  const className = ["row-card", selected && "is-selected", instruction && "is-instruction", hasError && "has-error"]
    .filter(Boolean)
    .join(" ");

  return (
    <article ref={cardRef} className={className} aria-labelledby={titleId} onFocusCapture={() => onSelect(row.id)}>
      <header className="row-head">
        <h3 id={titleId} className="row-title">
          {title}
        </h3>
        <input
          className="row-label-input"
          aria-label={`Bezeichnung von ${title}`}
          placeholder={autoLabel}
          value={row.label ?? ""}
          onChange={(e) => dispatch({ type: "updateRow", rowId: row.id, patch: { label: e.target.value } })}
        />
        {!instruction && (
          <div className="segmented segmented-small" role="radiogroup" aria-label={`Art von ${title}`}>
            {(["round", "row"] as const).map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={row.type === type}
                title={type === "round" ? "Runde: im Kreis weiter" : "Reihe: am Ende wenden"}
                onClick={() => dispatch({ type: "updateRow", rowId: row.id, patch: { type } })}
              >
                {type === "round" ? "Runde" : "Reihe"}
              </button>
            ))}
          </div>
        )}
        {!instruction && <StitchCount row={row} title={title} dispatch={dispatch} />}
        <RowActions {...props} title={title} isFirst={index === 0} isLast={index === count - 1} />
      </header>

      {instruction ? (
        <>
          <textarea
            ref={mainInput}
            className="row-note-input"
            aria-label={`Hinweistext von ${title}`}
            placeholder="z. B. Sicherheitsaugen zwischen Runde 8 und 9 einsetzen"
            rows={2}
            value={row.note ?? ""}
            onChange={(e) => dispatch({ type: "updateRow", rowId: row.id, patch: { note: e.target.value } })}
          />
          <button
            type="button"
            className="btn btn-small btn-quiet row-add-stitches"
            title="Aus dem Hinweis eine Runde/Reihe mit Maschen machen (der Text bleibt als Notiz)"
            onClick={() => {
              dispatch({ type: "insertOp", rowId: row.id, path: [0], op: { kind: "stitch", code: "SC", count: 1 } });
              props.onFocusRow(row.id);
            }}
          >
            + Maschen hinzufügen
          </button>
        </>
      ) : (
        <>
          <RowTextField
            row={row}
            inputRef={mainInput}
            label={`Maschen von ${title} als Text`}
            onCommit={(ops, target) =>
              dispatch(
                target === undefined
                  ? { type: "setRowOps", rowId: row.id, ops }
                  : { type: "setRowOps", rowId: row.id, ops, target },
              )
            }
            onEnter={(hasStitches) => props.onEnter(row.id, hasStitches)}
          />
          <OpEditor rowId={row.id} rowTitle={title} ops={row.ops} dispatch={dispatch} />
          <RowNote row={row} title={title} dispatch={dispatch} />
        </>
      )}

      {findings.length > 0 && (
        <ul className="row-findings" aria-label={`Befunde zu ${title}`}>
          {findings.map((f, i) => (
            <li key={i} className={`finding finding-${f.severity}`}>
              {findingMessage(f, row)}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export const RowCard = memo(RowCardImpl);

function StitchCount({ row, title, dispatch }: { row: Row; title: string; dispatch: Dispatch<EditorAction> }) {
  const actual = computeRowStitches(row);
  const mismatch = actual !== row.stitchCountTarget;
  return (
    <div className={`stitch-count${mismatch ? " is-mismatch" : ""}`}>
      <label className="inline-field">
        <span>Soll</span>
        <NumberField
          className="narrow"
          aria-label={`Soll-Maschenzahl von ${title}`}
          min={0}
          max={MAX_STITCH_COUNT_TARGET}
          value={row.stitchCountTarget}
          onValue={(target) => target !== undefined && dispatch({ type: "setTarget", rowId: row.id, target })}
        />
      </label>
      <span className="inline-field">
        <span>Ist</span>
        <output className="ist" aria-label={`Ist-Maschenzahl von ${title}`}>
          {actual}
        </output>
      </span>
      {mismatch && (
        <button
          type="button"
          className="btn btn-small"
          title="Ist-Maschenzahl als Soll übernehmen"
          onClick={() => dispatch({ type: "adoptTarget", rowId: row.id })}
        >
          Soll übernehmen
        </button>
      )}
    </div>
  );
}

function RowNote({ row, title, dispatch }: { row: Row; title: string; dispatch: Dispatch<EditorAction> }) {
  const [open, setOpen] = useState(false);
  if (row.note === undefined && !open) {
    return (
      <button type="button" className="btn btn-small btn-quiet row-note-add" onClick={() => setOpen(true)}>
        + Notiz
      </button>
    );
  }
  return (
    <input
      className="row-note-inline"
      aria-label={`Notiz zu ${title}`}
      placeholder="Notiz zur Runde, z. B. „Markierer setzen“"
      autoFocus={open && row.note === undefined}
      value={row.note ?? ""}
      onChange={(e) => dispatch({ type: "updateRow", rowId: row.id, patch: { note: e.target.value } })}
      onBlur={() => setOpen(false)}
    />
  );
}

function RowActions({
  row,
  title,
  isFirst,
  isLast,
  dispatch,
  onAddAfter,
  onDuplicate,
  onDelete,
}: RowCardProps & { title: string; isFirst: boolean; isLast: boolean }) {
  // After moving, keep focus on the moved row: on the same arrow, or the other one if the
  // row reached the end of the list (a disabled button cannot hold focus).
  const move = (delta: -1 | 1) => {
    dispatch({ type: "moveRow", rowId: row.id, delta });
    const same = `row:${row.id}:${delta < 0 ? "up" : "down"}`;
    const other = `row:${row.id}:${delta < 0 ? "down" : "up"}`;
    focusLater(same, other);
  };
  return (
    <div className="row-actions" role="group" aria-label={`Aktionen für ${title}`}>
      <button
        type="button"
        className="btn btn-icon btn-quiet"
        aria-label={`${title} nach oben`}
        title="Nach oben"
        disabled={isFirst}
        data-focus-id={`row:${row.id}:up`}
        onClick={() => move(-1)}
      >
        ↑
      </button>
      <button
        type="button"
        className="btn btn-icon btn-quiet"
        aria-label={`${title} nach unten`}
        title="Nach unten"
        disabled={isLast}
        data-focus-id={`row:${row.id}:down`}
        onClick={() => move(1)}
      >
        ↓
      </button>
      <button
        type="button"
        className="btn btn-icon btn-quiet"
        aria-label={`${title} duplizieren`}
        title="Duplizieren"
        onClick={() => onDuplicate(row.id)}
      >
        ⧉
      </button>
      <button
        type="button"
        className="btn btn-icon btn-quiet"
        aria-label={`Neue Zeile nach ${title}`}
        title="Neue Runde/Reihe danach (Alt+N)"
        onClick={() => onAddAfter(row.id, false)}
      >
        +
      </button>
      <button
        type="button"
        className="btn btn-icon btn-quiet btn-danger"
        aria-label={`${title} löschen`}
        title="Löschen"
        onClick={() => onDelete(row.id)}
      >
        ✕
      </button>
    </div>
  );
}
