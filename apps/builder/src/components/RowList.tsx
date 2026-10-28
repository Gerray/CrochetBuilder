import { useCallback, useMemo, type Dispatch } from "react";
import type { Finding, Row } from "@crochetbuilder/engine";
import type { EditorAction } from "../state/editor.js";
import type { RowItem } from "../state/grouping.js";
import { autoRowLabels, isInstructionLike } from "../state/labels.js";
import { previousCountAt, previousCounts, previousStitchRow, type RoundSpec } from "../state/rounds.js";
import { suggestNextRow } from "../state/suggest.js";
import { RowCard } from "./RowCard.js";
import { SnippetButton } from "./SnippetButton.js";
import type { RowGroups } from "./useRowGroups.js";

export interface FocusRequest {
  rowId: string;
  token: number;
}

interface RowListProps {
  rows: readonly Row[];
  /** Cards and grouping state (`useRowGroups`, shared with the findings panel). */
  groups: RowGroups;
  /** Rows whose Soll was set explicitly. */
  pinned: readonly string[];
  selectedRowId: string | null;
  focusRequest: FocusRequest | null;
  dispatch: Dispatch<EditorAction>;
  /** A card got the focus: its first row and all rows of the card (a group). */
  onSelect: (rowId: string, rowIds: readonly string[]) => void;
  onFocusRow: (rowId: string) => void;
  onAddRow: (afterId: string | null, instruction: boolean) => void;
  onDuplicate: (rowId: string) => void;
  onDelete: (rowIds: readonly string[]) => void;
  /** Insert snippet rounds of `type` after `afterId` (null: at the end). */
  onInsertRounds: (afterId: string | null, rounds: RoundSpec[], type: Row["type"]) => void;
  /** The pattern has more than one part (the tip mentions switching). */
  severalParts?: boolean;
}

const NO_FINDINGS: readonly Finding[] = [];

/**
 * Left side of the editor: all rows/rounds of the part, in order. Consecutive identical
 * rows show as one card ("Runde 7–12", see `grouping.ts`); "aufteilen" shows them singly.
 */
export function RowList(props: RowListProps) {
  const { rows, groups, pinned, selectedRowId, focusRequest, dispatch, onSelect, onFocusRow, onAddRow } = props;
  const { items, byRow } = groups;
  const autoLabels = useMemo(() => autoRowLabels(rows), [rows]);
  const previous = useMemo(() => previousCounts(rows), [rows]);

  // A focused card keeps its rows together until the focus leaves it (`useRowGroups`).
  const select = useCallback(
    (rowId: string, rowIds: readonly string[]) => {
      groups.hold(rowIds);
      onSelect(rowId, rowIds);
    },
    [groups, onSelect],
  );

  const itemOf = useCallback(
    (rowId: string | null | undefined) => (rowId ? items.find((item) => item.rows.some((r) => r.id === rowId)) : undefined),
    [items],
  );

  const onEnter = useCallback(
    (lastId: string, endId: string, hasStitches: boolean) => {
      const index = rows.findIndex((r) => r.id === lastId);
      const next = rows[index + 1];
      if (next) onFocusRow(next.id);
      else if (hasStitches) onAddRow(endId, false);
    },
    [rows, onFocusRow, onAddRow],
  );

  // A card moves past its whole neighbouring card (a group moves as a block).
  const move = (item: RowItem, position: number, delta: -1 | 1) => {
    const neighbour = items[position + delta];
    if (!neighbour) return;
    const step = neighbour.rows.length * delta;
    const ordered = delta < 0 ? item.rows : [...item.rows].reverse();
    const actions: EditorAction[] = ordered.map((r) => ({ type: "moveRow", rowId: r.id, delta: step }));
    dispatch(actions.length === 1 ? actions[0]! : { type: "batch", actions });
  };

  // Snippets go after the selected card (its last row), else at the end.
  const selectedItem = itemOf(selectedRowId);
  const anchorId = selectedItem ? selectedItem.rows[selectedItem.rows.length - 1]!.id : null;
  const anchorIndex = anchorId ? rows.findIndex((r) => r.id === anchorId) : rows.length - 1;
  const currentCount = previousCountAt(rows, anchorIndex + 1);
  const lastRow = rows[rows.length - 1];
  const placeText =
    anchorId && anchorId !== lastRow?.id ? `nach ${autoLabels[anchorIndex] ?? "der Runde"}` : "am Ende";
  // Rounds or rows: as the piece is worked at the insertion point.
  const snippetType = rows[anchorIndex]?.type ?? previousStitchRow(rows, anchorIndex + 1)?.type ?? "round";

  const lastType = lastRow?.type ?? "round";

  return (
    <section className="row-list" aria-label="Runden und Reihen">
      {rows.length === 0 && <p className="muted empty-hint">Noch keine Runde. Leg mit „+ Runde“ los.</p>}
      {items.map((item, position) => {
        const first = item.rows[0]!;
        const ids = item.rows.map((r) => r.id);
        const itemFindings =
          item.rows.length === 1 ? (byRow.get(first.id) ?? NO_FINDINGS) : item.rows.flatMap((r) => byRow.get(r.id) ?? []);
        const empty = item.rows.length === 1 && first.ops.length === 0 && !isInstructionLike(first);
        return (
          <RowCard
            key={first.id}
            rows={item.rows}
            autoLabels={autoLabels.slice(item.start, item.start + item.rows.length)}
            partRows={rows}
            pinned={pinned}
            isFirst={position === 0}
            isLast={position === items.length - 1}
            findings={itemFindings.length === 0 ? NO_FINDINGS : itemFindings}
            selected={selectedRowId !== null && ids.includes(selectedRowId)}
            focusToken={focusRequest && ids.includes(focusRequest.rowId) ? focusRequest.token : undefined}
            previousCount={previous[item.start]}
            suggestion={empty ? suggestNextRow(rows, item.start) : null}
            dispatch={dispatch}
            onSelect={select}
            onRelease={groups.release}
            onExtendHold={groups.extendHold}
            onEnter={onEnter}
            onAddAfter={onAddRow}
            onDuplicate={props.onDuplicate}
            onDelete={props.onDelete}
            onMove={(delta) => move(item, position, delta)}
            onSplit={() => groups.split(ids)}
            onMerge={item.splitRun ? () => groups.merge(item.splitRun!) : undefined}
            onFocusRow={onFocusRow}
          />
        );
      })}
      <div className="row-list-actions">
        <button type="button" className="btn btn-primary" data-focus-id="add-row" onClick={() => onAddRow(null, false)}>
          + {lastType === "row" ? "Reihe" : "Runde"}
        </button>
        <SnippetButton
          currentCount={currentCount}
          placeText={placeText}
          type={snippetType}
          onInsert={(rounds) => props.onInsertRounds(anchorId, rounds, snippetType)}
        />
        <button type="button" className="btn" onClick={() => onAddRow(null, true)}>
          + Hinweis
        </button>
      </div>
      <p className="hint">
        Tipp: Maschen als Text eintippen, z. B. <kbd>6× (1 fM, 1 Zun)</kbd>, <kbd>6 Zun (12)</kbd> oder{" "}
        <kbd>18 fM (4 Runden)</kbd>. <kbd>Enter</kbd> übernimmt und springt weiter; in einer leeren Runde steht ein
        Vorschlag – <kbd>Enter</kbd> oder <kbd>Tab</kbd> nimmt ihn, Tippen ersetzt ihn. <kbd>Esc</kbd> verwirft,{" "}
        <kbd>Alt</kbd>+<kbd>N</kbd> fügt eine neue Runde ein, <kbd>Strg</kbd>+<kbd>Z</kbd> macht rückgängig.
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
