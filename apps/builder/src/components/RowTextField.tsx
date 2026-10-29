import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from "react";
import { parseRowText, renderRow, type Op, type Row } from "@crochetbuilder/engine";
import { useJoinParts } from "./joinParts.js";
import { parseErrorMessage, parseWarningMessage, type ParseWarning } from "../state/messages.js";
import type { RowSuggestion } from "../state/suggest.js";
import { usePalette } from "./palette.js";
import { registerPendingEdit } from "./pendingEdits.js";

/** What the text says beyond the ops. */
export interface RowTextExtras {
  /** "(4 Runden)": the row stands for this many rounds. */
  rounds?: number;
  /**
   * The row's colour as the text says it (a leading `[Farbe: Weiß]`): a palette id, or the
   * name as written when it is not in the palette; null when the text has none. Absent when
   * the text was not typed (an accepted suggestion keeps the row's colour).
   */
  color?: string | null;
  /**
   * Whether the text starts with "um die Lm-Kette:" (`Row.around`, a round around the chain
   * before it); null when it does not. Absent when unchanged (an accepted suggestion says
   * `true` when it is such a round).
   */
  around?: true | null;
}

interface RowTextFieldProps {
  row: Row;
  inputRef?: Ref<HTMLInputElement>;
  /** Stitches of the previous stitch row, for "fM rundherum", "(1 fM, 1 Zun)*". */
  previousCount?: number | undefined;
  /** Offered while the row is empty: shown selected on focus, Enter/Tab accepts it. */
  suggestion?: RowSuggestion | null | undefined;
  /** Parsed ops (and a trailing stitch count, if the text had one). */
  onCommit: (ops: Op[], target: number | undefined, extras: RowTextExtras) => void;
  /** Enter after a successful commit; `hasStitches` tells whether the row now has ops. */
  onEnter: (hasStitches: boolean) => void;
  /** Tab accepted the suggestion (the focus stays in the row). */
  onAccept?: () => void;
  label: string;
}

/**
 * The row as editable text: shows the row (`renderRow`, colour changes as `[Farbe: Weiß]`
 * with the palette's names — the row's own colour first — so that editing the text keeps
 * them; names are read back to palette ids; a round around the foundation chain starts with
 * „um die Lm-Kette:“, and the mark sets or clears it), parses on Enter or blur. An
 * unreadable text stays in the field with an inline error; Escape restores the row. The
 * field is registered as a pending edit, so switching parts commits it first (or stops).
 *
 * An empty row offers a suggestion for the next round: focusing the field fills it in,
 * selected, so typing replaces it and Enter (commit and go on) or Tab (commit, stay) takes
 * it. Leaving the field without touching the suggestion leaves the row empty: a suggestion
 * is only kept by an explicit Enter or Tab. Text that arrives by input — typed, pasted or
 * autofilled — is the user's own, even when it equals the suggestion, and is committed on
 * blur like any typed text.
 */
export function RowTextField(props: RowTextFieldProps) {
  const { row, inputRef, previousCount, suggestion, onCommit, onEnter, label } = props;
  const palette = usePalette();
  const joins = useJoinParts();
  const rendered = renderRow(row, "de", { colors: palette.colors, parts: joins.parts });
  const [draft, setDraftState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly ParseWarning[]>([]);
  // The draft is the untouched suggestion (not the user's text).
  const [suggested, setSuggestedState] = useState(false);
  const suggestedRef = useRef(false);
  const setSuggested = (value: boolean) => {
    suggestedRef.current = value;
    setSuggestedState(value);
  };
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
      setSuggested(false);
    }
  }, [row.ops]);
  const errorId = `row-text-error-${row.id}`;
  const hintId = `row-text-hint-${row.id}`;

  const input = useRef<HTMLInputElement | null>(null);
  const setInput = useCallback(
    (el: HTMLInputElement | null) => {
      input.current = el;
      if (typeof inputRef === "function") inputRef(el);
      else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
    },
    [inputRef],
  );
  // The latest commit, for the pending-edit registry.
  const commitRef = useRef<() => boolean | null>(() => null);
  useEffect(
    () =>
      registerPendingEdit({
        commit: () => commitRef.current() !== null,
        focus: () => input.current?.focus(),
      }),
    [],
  );

  // A suggestion that just appeared is selected, so typing replaces it.
  useLayoutEffect(() => {
    if (suggested && document.activeElement === input.current) input.current?.select();
  }, [suggested]);

  // The rows above changed while a suggestion is shown: show the new one.
  const suggestionText = suggestion?.text;
  useEffect(() => {
    if (!suggestedRef.current) return;
    if (suggestionText === undefined) {
      draftRef.current = null;
      setDraftState(null);
      setSuggested(false);
    } else if (draftRef.current !== suggestionText) {
      draftRef.current = suggestionText;
      setDraftState(suggestionText);
    }
  }, [suggestionText]);

  const offerSuggestion = () => {
    if (!suggestion || row.ops.length > 0 || draftRef.current !== null) return;
    setDraft(suggestion.text);
    setSuggested(true);
  };

  const dropSuggestion = () => {
    setDraft(null);
    setSuggested(false);
  };

  /** Returns whether the row has stitches afterwards, or null if the text is invalid. */
  const commit = (acceptSuggestion = false): boolean | null => {
    const text = draftRef.current;
    if (suggestedRef.current) {
      // An untouched suggestion only counts when it is accepted explicitly.
      if (!acceptSuggestion || !suggestion) {
        dropSuggestion();
        return row.ops.length > 0;
      }
      onCommit(structuredClone(suggestion.ops), undefined, suggestion.around ? { around: true } : {});
      dropSuggestion();
      setWarnings([]);
      return suggestion.ops.length > 0;
    }
    if (text === null) return row.ops.length > 0;
    if (text.trim() === "") {
      onCommit([], undefined, { color: null });
      setDraft(null);
      setError(null);
      setWarnings([]);
      return false;
    }
    const context = {
      colors: palette.colors,
      rowColor: true,
      ...(joins.parts.length > 0 ? { parts: joins.parts } : {}),
      ...(previousCount === undefined ? {} : { previousCount }),
    };
    const result = parseRowText(text, "de", context);
    if (!result.ok) {
      setError(parseErrorMessage(result));
      return null;
    }
    const extras: RowTextExtras = { color: result.color ?? null, around: result.around ?? null };
    if (result.rounds !== undefined && result.rounds > 1) extras.rounds = result.rounds;
    if (text !== rendered || result.stitchCountTarget !== undefined || extras.rounds !== undefined) {
      onCommit(result.ops, result.stitchCountTarget, extras);
    }
    setDraft(null);
    setError(null);
    setWarnings(result.warnings ?? []);
    return result.ops.length > 0;
  };
  commitRef.current = () => commit(false);

  const describedBy = [error && errorId, (suggested || warnings.length > 0) && hintId].filter(Boolean).join(" ");

  return (
    <div className="row-text">
      <input
        ref={setInput}
        className={`row-text-input${suggested ? " is-suggested" : ""}`}
        type="text"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        placeholder="Maschen eintippen, z. B. 6× (1 fM, 1 Zun)"
        spellCheck={false}
        autoComplete="off"
        value={draft ?? rendered}
        onFocus={offerSuggestion}
        onMouseUp={(e) => {
          // A click must not undo the selection of a freshly offered suggestion.
          const el = e.currentTarget;
          if (suggestedRef.current && el.selectionStart === el.selectionEnd) el.select();
        }}
        // Any input (typing, paste, autofill) makes the text the user's own — even when it is
        // exactly the suggested text, which then counts like typed text on blur.
        onInput={() => {
          if (suggestedRef.current) setSuggested(false);
        }}
        onPaste={() => {
          if (suggestedRef.current) setSuggested(false);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          if (suggestedRef.current) setSuggested(false);
          if (error) setError(null);
          if (warnings.length > 0) setWarnings([]);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            const hasStitches = commit(true);
            if (hasStitches !== null) onEnter(hasStitches);
          } else if (e.key === "Tab" && !e.shiftKey && suggestedRef.current) {
            e.preventDefault();
            commit(true);
            props.onAccept?.();
          } else if (e.key === "Escape") {
            setDraft(null);
            setError(null);
            setSuggested(false);
          }
        }}
        onBlur={() => {
          commit(false);
        }}
      />
      {error && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
      {suggested && suggestion && (
        <p id={hintId} className="row-suggestion-hint">
          Vorschlag: ergibt <strong>{suggestion.count} M</strong> · <kbd>Enter</kbd> übernimmt und geht weiter,{" "}
          <kbd>Tab</kbd> übernimmt, Tippen ersetzt
        </p>
      )}
      {!suggested && warnings.length > 0 && (
        <ul id={hintId} className="field-warnings" aria-label="Hinweise zum Text">
          {warnings.map((w) => (
            <li key={w}>{parseWarningMessage(w, row.type)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
