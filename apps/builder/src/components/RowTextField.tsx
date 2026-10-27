import { useEffect, useRef, useState, type Ref } from "react";
import { parseRowText, renderRow, type Op, type Row } from "@crochetbuilder/engine";
import { parseErrorMessage } from "../state/messages.js";

interface RowTextFieldProps {
  row: Row;
  inputRef?: Ref<HTMLInputElement>;
  /** Parsed ops (and a trailing stitch count, if the text had one). */
  onCommit: (ops: Op[], target: number | undefined) => void;
  /** Enter after a successful commit; `hasStitches` tells whether the row now has ops. */
  onEnter: (hasStitches: boolean) => void;
  label: string;
}

/**
 * The row as editable text: shows `renderRow(row, "de")`, parses on Enter or blur. An
 * unreadable text stays in the field with an inline error; Escape restores the row.
 */
export function RowTextField({ row, inputRef, onCommit, onEnter, label }: RowTextFieldProps) {
  const rendered = renderRow(row, "de");
  const [draft, setDraftState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The ref mirrors the draft so blur right after Enter sees the committed state.
  const draftRef = useRef<string | null>(null);
  // The ops the draft was started from. If they change elsewhere (structured editor, undo),
  // the draft is stale and is dropped, so a later commit cannot overwrite that change.
  const baseOps = useRef(row.ops);
  const setDraft = (value: string | null) => {
    if (draftRef.current === null && value !== null) baseOps.current = row.ops;
    draftRef.current = value;
    setDraftState(value);
  };
  useEffect(() => {
    if (draftRef.current !== null && baseOps.current !== row.ops) {
      draftRef.current = null;
      setDraftState(null);
      setError(null);
    }
  }, [row.ops]);
  const errorId = `row-text-error-${row.id}`;

  /** Returns whether the row has stitches afterwards, or null if the text is invalid. */
  const commit = (): boolean | null => {
    const text = draftRef.current;
    if (text === null) return row.ops.length > 0;
    if (text.trim() === "") {
      onCommit([], undefined);
      setDraft(null);
      setError(null);
      return false;
    }
    const result = parseRowText(text, "de");
    if (!result.ok) {
      setError(parseErrorMessage(result));
      return null;
    }
    if (text !== rendered || result.stitchCountTarget !== undefined) onCommit(result.ops, result.stitchCountTarget);
    setDraft(null);
    setError(null);
    return result.ops.length > 0;
  };

  return (
    <div className="row-text">
      <input
        ref={inputRef}
        className="row-text-input"
        type="text"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder="Maschen eintippen, z. B. 6× (1 fM, 1 Zun)"
        spellCheck={false}
        autoComplete="off"
        value={draft ?? rendered}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            const hasStitches = commit();
            if (hasStitches !== null) onEnter(hasStitches);
          } else if (e.key === "Escape") {
            setDraft(null);
            setError(null);
          }
        }}
        onBlur={() => {
          commit();
        }}
      />
      {error && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
