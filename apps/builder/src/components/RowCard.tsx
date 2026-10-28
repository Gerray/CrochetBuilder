import { memo, useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import { computeRowStitches, MAX_STITCH_COUNT_TARGET, type Finding, type Op, type Row } from "@crochetbuilder/engine";
import { setRunLength } from "../state/actions.js";
import { fanOut, isAutoTarget, MAX_RUN_LENGTH, type EditorAction } from "../state/editor.js";
import { countLabel, rangeLabel } from "../state/grouping.js";
import { isInstructionLike } from "../state/labels.js";
import { findingMessage } from "../state/messages.js";
import { adoptWrittenColors, type RowColor } from "../state/palette.js";
import { quickFixes, type QuickFix } from "../state/quickfix.js";
import type { RowSuggestion } from "../state/suggest.js";
import { NumberField } from "./fields.js";
import { FindingFixes } from "./FindingFixes.js";
import { focusLater } from "./focus.js";
import { OpEditor } from "./OpEditor.js";
import { RowColorChip, usePalette } from "./palette.js";
import { RowTextField, type RowTextExtras } from "./RowTextField.js";

export interface RowCardProps {
  /** The card's rows: one, or a group of identical rows ("Runde 7–12"). */
  rows: readonly Row[];
  /** Automatic label per row of the card ("Runde 7" …), used when a row has no own label. */
  autoLabels: readonly string[];
  /** All rows of the part (quick fixes look at the previous row). */
  partRows: readonly Row[];
  /** Rows whose Soll was set explicitly. */
  pinned: readonly string[];
  isFirst: boolean;
  isLast: boolean;
  /** Findings of the card's rows. */
  findings: readonly Finding[];
  selected: boolean;
  /** Changes whenever the editor wants this card's main input focused. */
  focusToken: number | undefined;
  /** Stitches of the previous stitch row (context for "fM rundherum"). */
  previousCount: number | undefined;
  /** Suggestion for an empty row (null: none). */
  suggestion: RowSuggestion | null;
  dispatch: Dispatch<EditorAction>;
  onSelect: (rowId: string, rowIds: readonly string[]) => void;
  /**
   * Enter in the text field: `lastId` is the card's last row now, `endId` the last row of the
   * run once the commit is applied (differs after "(4 Runden)").
   */
  onEnter: (lastId: string, endId: string, hasStitches: boolean) => void;
  onAddAfter: (rowId: string, instruction: boolean) => void;
  onDuplicate: (rowId: string) => void;
  onDelete: (rowIds: readonly string[]) => void;
  /** Move the card past its neighbouring card. */
  onMove: (delta: -1 | 1) => void;
  /** Show a group as single cards. */
  onSplit: () => void;
  /** On the first card of a split run: show the run as one card again. */
  onMerge?: (() => void) | undefined;
  /** The focus left the card (it may group with its neighbours again). */
  onRelease: (rowIds: readonly string[]) => void;
  /** Rows just created from this card ("×N", "(4 Runden)") stay with it while it is edited. */
  onExtendHold: (rowIds: readonly string[]) => void;
  onFocusRow: (rowId: string) => void;
  /** The colour at the start of the card's first row (format v2); absent without colours. */
  startColor?: RowColor | undefined;
}

/** A finding as the card shows it: once for the whole group, or for one row of it. */
interface ShownFinding {
  finding: Finding;
  /** Rows the finding (and its fixes) stands for. */
  rowIds: string[];
  /** "Runde 9" when it concerns only one row of a group. */
  rowLabel: string | null;
}

function shownFindings(findings: readonly Finding[], rows: readonly Row[], labels: readonly string[]): ShownFinding[] {
  if (rows.length === 1) return findings.map((finding) => ({ finding, rowIds: [finding.rowId], rowLabel: null }));
  const byKey = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.code}|${f.expected}|${f.actual}`;
    byKey.set(key, [...(byKey.get(key) ?? []), f]);
  }
  const out: ShownFinding[] = [];
  for (const list of byKey.values()) {
    if (list.length === rows.length) {
      out.push({ finding: list[0]!, rowIds: rows.map((r) => r.id), rowLabel: null });
      continue;
    }
    for (const f of list) {
      const index = rows.findIndex((r) => r.id === f.rowId);
      out.push({ finding: f, rowIds: [f.rowId], rowLabel: labels[index] ?? null });
    }
  }
  return out;
}

function RowCardImpl(props: RowCardProps) {
  const { rows, autoLabels, findings, selected, focusToken, dispatch, onSelect } = props;
  const palette = usePalette();
  const row = rows[0]!;
  const group = rows.length > 1;
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const mainInput = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const instruction = isInstructionLike(row);
  const title = group
    ? rangeLabel(autoLabels[0] ?? "", autoLabels[autoLabels.length - 1] ?? "")
    : row.label?.trim() || autoLabels[0] || "";
  const titleId = `row-title-${row.id}`;
  // Edits of a group card go to every row of the group (one undo step).
  const rowDispatch = useMemo<Dispatch<EditorAction>>(
    () => (group ? (action) => dispatch(fanOut(action, rowIds)) : dispatch),
    [group, dispatch, rowIds],
  );

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

  const shown = useMemo(() => shownFindings(findings, rows, autoLabels), [findings, rows, autoLabels]);
  const hasError = findings.some((f) => f.severity === "error");
  const className = [
    "row-card",
    group && "is-group",
    selected && "is-selected",
    instruction && "is-instruction",
    hasError && "has-error",
  ]
    .filter(Boolean)
    .join(" ");

  // The run's last row after a commit (for Enter after "(4 Runden)").
  const runEnd = useRef<string | null>(null);
  const commitText = (written: Op[], target: number | undefined, extras: RowTextExtras) => {
    // Colours written in the text that the palette does not have yet join it (one undo step).
    let ops = written;
    let color = extras.color;
    const before: EditorAction[] = [];
    if (color !== undefined) {
      const adopted = adoptWrittenColors(written, color ?? undefined, palette.getDoc());
      ops = adopted.ops;
      color = adopted.color ?? null;
      for (const c of adopted.added) before.push({ type: "addColor", color: c });
    }
    const edit: EditorAction = {
      type: "setRowOps",
      rowId: row.id,
      ops,
      ...(target === undefined ? {} : { target }),
      ...(color === undefined ? {} : { color }),
    };
    const rounds = extras.rounds;
    if (rounds === undefined || rounds === rowIds.length) {
      runEnd.current = null;
      if (before.length === 0) rowDispatch(edit);
      else dispatch({ type: "batch", actions: [...before, fanOut(edit, rowIds)] });
      return;
    }
    const length = setRunLength(rowIds, Math.min(rounds, MAX_RUN_LENGTH));
    runEnd.current = length.newIds[length.newIds.length - 1] ?? rowIds[length.length - 1] ?? null;
    props.onExtendHold(length.newIds);
    dispatch({ type: "batch", actions: [...before, fanOut(edit, rowIds), length] });
  };

  const applyFix = (fix: QuickFix, ids: readonly string[]) => {
    dispatch(fanOut(fix.action, ids));
    // The finding (and its button) goes away: keep the focus in this card.
    props.onFocusRow(row.id);
  };

  return (
    <article
      ref={cardRef}
      className={className}
      aria-labelledby={titleId}
      onFocusCapture={() => onSelect(row.id, rowIds)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) props.onRelease(rowIds);
      }}
    >
      <header className="row-head">
        <h3 id={titleId} className="row-title">
          {title}
        </h3>
        {group ? (
          <span className="row-group-count">{countLabel(rows.length, row.type)}</span>
        ) : (
          <input
            className="row-label-input"
            aria-label={`Bezeichnung von ${title}`}
            placeholder={autoLabels[0]}
            value={row.label ?? ""}
            onChange={(e) => dispatch({ type: "updateRow", rowId: row.id, patch: { label: e.target.value } })}
          />
        )}
        {!instruction && (
          <div className="segmented segmented-small" role="radiogroup" aria-label={`Art von ${title}`}>
            {(["round", "row"] as const).map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={row.type === type}
                title={type === "round" ? "Runde: im Kreis weiter" : "Reihe: am Ende wenden"}
                onClick={() => rowDispatch({ type: "updateRow", rowId: row.id, patch: { type } })}
              >
                {type === "round" ? "Runde" : "Reihe"}
              </button>
            ))}
          </div>
        )}
        {!instruction && props.startColor && (
          <RowColorChip
            title={title}
            word={row.type === "row" ? "Reihe" : "Runde"}
            start={props.startColor}
            inherited={props.startColor.before}
            own={row.color}
            onSet={(color) => rowDispatch({ type: "setRowColor", rowId: row.id, color })}
          />
        )}
        {!instruction && (
          <StitchCount
            row={row}
            title={title}
            auto={rows.every((r) => isAutoTarget(r, props.pinned))}
            dispatch={rowDispatch}
            onAdopted={() => props.onFocusRow(row.id)}
          />
        )}
        <RowActions {...props} title={title} rowIds={rowIds} group={group} instruction={instruction} />
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
            previousCount={props.previousCount}
            suggestion={props.suggestion}
            onCommit={commitText}
            onEnter={(hasStitches) => {
              const end = runEnd.current ?? rowIds[rowIds.length - 1]!;
              runEnd.current = null;
              props.onEnter(rowIds[rowIds.length - 1]!, end, hasStitches);
            }}
            onAccept={() => props.onFocusRow(row.id)}
          />
          <OpEditor rowId={row.id} rowTitle={title} ops={row.ops} dispatch={rowDispatch} />
          <RowNote row={row} title={title} dispatch={rowDispatch} />
        </>
      )}

      {shown.length > 0 && (
        <ul className="row-findings" aria-label={`Befunde zu ${title}`}>
          {shown.map(({ finding, rowIds: ids, rowLabel }, i) => (
            <li key={i} className={`finding finding-${finding.severity}`}>
              <span>
                {rowLabel && <strong>{rowLabel}: </strong>}
                {findingMessage(finding, row)}
              </span>
              <FindingFixes
                fixes={quickFixes(finding, props.partRows, props.pinned)}
                onApply={(fix) => applyFix(fix, ids)}
              />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export const RowCard = memo(RowCardImpl);

function StitchCount({
  row,
  title,
  auto,
  dispatch,
  onAdopted,
}: {
  row: Row;
  title: string;
  auto: boolean;
  dispatch: Dispatch<EditorAction>;
  /** "Soll übernehmen" disappears once used: the card takes the focus back. */
  onAdopted: () => void;
}) {
  const actual = computeRowStitches(row);
  const mismatch = actual !== row.stitchCountTarget;
  const className = ["stitch-count", mismatch && "is-mismatch", auto && "is-auto"].filter(Boolean).join(" ");
  return (
    <div className={className}>
      <label className="inline-field">
        <span>Soll</span>
        <NumberField
          className="narrow soll-input"
          aria-label={`Soll-Maschenzahl von ${title}`}
          title={
            auto
              ? "Automatisch: folgt der Ist-Zahl. Eine Zahl eintippen legt das Soll fest."
              : "Festgelegt und geprüft. Feld leeren: das Soll folgt wieder der Ist-Zahl."
          }
          data-auto={auto ? "true" : undefined}
          min={0}
          max={MAX_STITCH_COUNT_TARGET}
          allowEmpty
          value={row.stitchCountTarget}
          onValue={(target) =>
            dispatch(
              target === undefined
                ? { type: "unpinTarget", rowId: row.id }
                : { type: "setTarget", rowId: row.id, target },
            )
          }
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
          onClick={() => {
            dispatch({ type: "adoptTarget", rowId: row.id });
            onAdopted();
          }}
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
      // While it has the focus the field stays, even when the note is emptied.
      onFocus={() => setOpen(true)}
      onChange={(e) => dispatch({ type: "updateRow", rowId: row.id, patch: { note: e.target.value } })}
      onBlur={() => setOpen(false)}
    />
  );
}

function RowActions({
  rows,
  title,
  rowIds,
  group,
  instruction,
  isFirst,
  isLast,
  dispatch,
  onAddAfter,
  onDuplicate,
  onDelete,
  onMove,
  onSplit,
  onMerge,
  onExtendHold,
  onFocusRow,
}: RowCardProps & { title: string; rowIds: readonly string[]; group: boolean; instruction: boolean }) {
  const first = rowIds[0]!;
  const last = rowIds[rowIds.length - 1]!;
  // After moving, keep focus on the moved card: on the same arrow, or the other one if the
  // card reached the end of the list (a disabled button cannot hold focus).
  const move = (delta: -1 | 1) => {
    onMove(delta);
    const same = `row:${first}:${delta < 0 ? "up" : "down"}`;
    const other = `row:${first}:${delta < 0 ? "down" : "up"}`;
    focusLater(same, other);
  };
  const word = rows[0]!.type === "row" ? "Reihe" : "Runde";
  return (
    <div className="row-actions" role="group" aria-label={`Aktionen für ${title}`}>
      <button
        type="button"
        className="btn btn-icon btn-quiet"
        aria-label={`${title} nach oben`}
        title="Nach oben"
        disabled={isFirst}
        data-focus-id={`row:${first}:up`}
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
        data-focus-id={`row:${first}:down`}
        onClick={() => move(1)}
      >
        ↓
      </button>
      {!instruction && (
        <RepeatButton
          title={title}
          word={word}
          count={rowIds.length}
          onApply={(n) => {
            const action = setRunLength(rowIds, n);
            onExtendHold(action.newIds);
            dispatch(action);
            onFocusRow(first);
          }}
        />
      )}
      {group ? (
        <button
          type="button"
          className="btn btn-small btn-quiet row-split"
          aria-label={`${title} aufteilen`}
          title={`Als einzelne ${word === "Reihe" ? "Reihen" : "Runden"} zeigen`}
          onClick={() => {
            onSplit();
            onFocusRow(first);
          }}
        >
          aufteilen
        </button>
      ) : (
        <>
          {onMerge && (
            <button
              type="button"
              className="btn btn-small btn-quiet row-split"
              aria-label={`${title} zusammenfassen`}
              title={`Die gleichen ${word === "Reihe" ? "Reihen" : "Runden"} ab hier wieder als eine Karte zeigen`}
              onClick={() => {
                onMerge();
                onFocusRow(first);
              }}
            >
              zusammenfassen
            </button>
          )}
          <button
            type="button"
            className="btn btn-icon btn-quiet"
            aria-label={`${title} duplizieren`}
            title="Duplizieren"
            onClick={() => onDuplicate(first)}
          >
            ⧉
          </button>
        </>
      )}
      <button
        type="button"
        className="btn btn-icon btn-quiet"
        aria-label={`Neue Zeile nach ${title}`}
        title="Neue Runde/Reihe danach (Alt+N)"
        onClick={() => onAddAfter(last, false)}
      >
        +
      </button>
      <button
        type="button"
        className="btn btn-icon btn-quiet btn-danger"
        aria-label={`${title} löschen`}
        title={group ? `Alle ${rowIds.length} löschen` : "Löschen"}
        onClick={() => onDelete(rowIds)}
      >
        ✕
      </button>
    </div>
  );
}

/** "×N": work the row (or the group) N times in all — copies added or removed at the end. */
function RepeatButton({
  title,
  word,
  count,
  onApply,
}: {
  title: string;
  word: string;
  count: number;
  onApply: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<number | undefined>(undefined);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    field.current?.select();
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const apply = () => {
    if (value === undefined) return;
    setOpen(false);
    onApply(value);
  };

  return (
    <span className="popover-anchor" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="btn btn-small btn-quiet row-repeat"
        aria-label={`${title} wiederholen`}
        aria-expanded={open}
        title={`${word} ×N: diese ${word} insgesamt N-mal häkeln`}
        onClick={() => {
          setValue(count > 1 ? count : 2);
          setOpen((o) => !o);
        }}
      >
        ×N
      </button>
      {open && (
        <div
          className="popover repeat-popover"
          role="dialog"
          aria-label={`${title} wiederholen`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <label className="inline-field">
            <span>Insgesamt</span>
            <NumberField
              className="narrow"
              aria-label={`Wie oft ${title} insgesamt`}
              min={1}
              max={MAX_RUN_LENGTH}
              value={value}
              onValue={setValue}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  apply();
                }
              }}
              inputRef={field}
            />
            <span>× häkeln</span>
          </label>
          <button type="button" className="btn btn-small btn-primary" disabled={value === undefined} onClick={apply}>
            Übernehmen
          </button>
          <p className="popover-hint">
            <kbd>Enter</kbd> übernimmt, <kbd>Esc</kbd> schließt
          </p>
        </div>
      )}
    </span>
  );
}
