import { useCallback, useEffect, useMemo, useState } from "react";
import type { Finding, Row } from "@crochetbuilder/engine";
import { activeSplits, groupRows, type RowItem } from "../state/grouping.js";

const NOTHING: ReadonlySet<string> = new Set();

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => b[i] === id);

export interface RowGroups {
  /** The cards of the row list. */
  items: RowItem[];
  /** Findings per row id. */
  byRow: ReadonlyMap<string, Finding[]>;
  /** A card got the focus: keep its rows together, apart from their neighbours. */
  hold: (rowIds: readonly string[]) => void;
  /** The focus left the card: it may group with its neighbours again. */
  release: (rowIds: readonly string[]) => void;
  /** Rows created from the card being edited ("×N", "(4 Runden)") belong to it. */
  extendHold: (rowIds: readonly string[]) => void;
  /** Show a group as single cards ("aufteilen"). */
  split: (rowIds: readonly string[]) => void;
  /** Group a split run again ("zusammenfassen"). */
  merge: (rowIds: readonly string[]) => void;
}

/**
 * Grouping state of the row list (see `grouping.ts`), shared by the list and the findings
 * panel so both show the same cards. Splits that no longer match their run are dropped.
 */
export function useRowGroups(rows: readonly Row[], findings: readonly Finding[]): RowGroups {
  const byRow = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of findings) map.set(f.rowId, [...(map.get(f.rowId) ?? []), f]);
    return map;
  }, [findings]);
  const [splits, setSplits] = useState<ReadonlyArray<readonly string[]>>([]);
  const [held, setHeld] = useState<ReadonlySet<string>>(NOTHING);
  const items = useMemo(() => groupRows(rows, { split: splits, findings: byRow, held }), [rows, splits, byRow, held]);

  // A split ends when its run changes (edit, copy, removal) — the rows group again.
  useEffect(() => {
    const active = activeSplits(rows, splits, byRow);
    if (active.length !== splits.length) setSplits(active);
  }, [rows, splits, byRow]);

  const hold = useCallback((rowIds: readonly string[]) => {
    setHeld((prev) => (prev.size === rowIds.length && rowIds.every((id) => prev.has(id)) ? prev : new Set(rowIds)));
  }, []);
  const release = useCallback((rowIds: readonly string[]) => {
    setHeld((prev) => (rowIds.some((id) => prev.has(id)) ? NOTHING : prev));
  }, []);
  const extendHold = useCallback((rowIds: readonly string[]) => {
    setHeld((prev) => (prev.size === 0 || rowIds.length === 0 ? prev : new Set([...prev, ...rowIds])));
  }, []);
  const split = useCallback((rowIds: readonly string[]) => {
    setSplits((prev) => (prev.some((ids) => sameList(ids, rowIds)) ? prev : [...prev, [...rowIds]]));
  }, []);
  const merge = useCallback((rowIds: readonly string[]) => {
    setSplits((prev) => prev.filter((ids) => !sameList(ids, rowIds)));
  }, []);

  return { items, byRow, hold, release, extendHold, split, merge };
}
