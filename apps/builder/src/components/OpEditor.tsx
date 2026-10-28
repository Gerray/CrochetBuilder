import type { Dispatch } from "react";
import {
  MAX_COUNT,
  MAX_TIMES,
  MOD_ABBREVIATIONS,
  MOD_NAMES,
  STITCH_ABBREVIATIONS,
  STITCH_NAMES,
  modifierAllowed,
  renderOp,
  type Mod,
  type Op,
  type RepeatGroup,
  type StitchCode,
  type StitchOp,
} from "@crochetbuilder/engine";
import type { EditorAction } from "../state/editor.js";
import type { OpPath } from "../state/op-tree.js";
import { NumberField } from "./fields.js";
import { focusLater } from "./focus.js";

/** Picker order: the MVP stitches first, then the rest. */
const PICKER_CODES: StitchCode[] = ["MR", "CH", "SL_ST", "SC", "HDC", "DC", "INC", "DEC", "INVDEC", "TR", "DTR", "ST"];
const MODS: Mod[] = ["BLO", "FLO", "TOG"];

interface OpEditorProps {
  rowId: string;
  /** Display label of the row ("Runde 3") — part of every accessible name below. */
  rowTitle: string;
  ops: readonly Op[];
  dispatch: Dispatch<EditorAction>;
}

/** "3" for the third op of the row, "2.1" for the first op inside the second one. */
const position = (path: OpPath) => path.map((i) => i + 1).join(".");
const focusId = (rowId: string, path: OpPath, part: string) => `op:${rowId}:${path.join(".")}:${part}`;
const listAddId = (rowId: string, listPath: OpPath) => `oplist:${rowId}:${listPath.join(".")}:add`;

/** Structured editor for a row's op tree: stitches, counts, modifiers, nested repeats. */
export function OpEditor(props: OpEditorProps) {
  return (
    <div className="op-editor">
      <OpList {...props} path={[]} />
    </div>
  );
}

function OpList({ rowId, rowTitle, ops, path, dispatch }: OpEditorProps & { path: OpPath }) {
  const nested = path.length > 0;
  const where = nested ? `Wiederholung ${position(path)} von ${rowTitle}` : rowTitle;
  return (
    <>
      {ops.length > 0 && (
        <ol className="op-list">
          {ops.map((op, i) => {
            const item = {
              rowId,
              rowTitle,
              path: [...path, i],
              first: i === 0,
              last: i === ops.length - 1,
              dispatch,
            };
            return (
              <li key={`${i}-${op.kind}`}>
                {op.kind === "stitch" ? (
                  <StitchEditor {...item} op={op} />
                ) : op.kind === "repeat" ? (
                  <RepeatEditor {...item} op={op} />
                ) : (
                  // Stitch groups (format v2) are shown read-only until the editor supports them.
                  <span className="op-group">{renderOp(op, "de")}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div className="op-list-actions">
        <button
          type="button"
          className="btn btn-small"
          aria-label={`Masche hinzufügen in ${where}`}
          data-focus-id={listAddId(rowId, path)}
          onClick={() => {
            const at = [...path, ops.length];
            dispatch({ type: "insertOp", rowId, path: at, op: { kind: "stitch", code: "SC", count: 1 } });
            focusLater(focusId(rowId, at, "count"));
          }}
        >
          + Masche{nested ? " in Wiederholung" : ""}
        </button>
        {ops.length > 1 && (
          <button
            type="button"
            className="btn btn-small btn-quiet"
            aria-label={`Alle Maschen von ${where} wiederholen`}
            title="Alle Maschen dieser Liste in eine Wiederholung setzen"
            onClick={() => {
              const at = [...path, 0];
              dispatch({ type: "wrapInRepeat", rowId, path: at, length: ops.length, times: 2 });
              focusLater(focusId(rowId, at, "times"));
            }}
          >
            Alle wiederholen
          </button>
        )}
      </div>
    </>
  );
}

interface ItemProps<T> {
  rowId: string;
  rowTitle: string;
  op: T;
  path: OpPath;
  first: boolean;
  last: boolean;
  dispatch: Dispatch<EditorAction>;
}

function ItemActions({ rowId, path, first, last, dispatch, name }: Omit<ItemProps<unknown>, "op" | "rowTitle"> & { name: string }) {
  const index = path[path.length - 1]!;
  const listPath = path.slice(0, -1);
  const sibling = (i: number) => [...listPath, i];

  const move = (delta: -1 | 1) => {
    dispatch({ type: "moveOp", rowId, path, delta });
    const to = sibling(index + delta);
    // Same arrow at the new position, or the other one once the end is reached.
    focusLater(focusId(rowId, to, delta < 0 ? "prev" : "next"), focusId(rowId, to, delta < 0 ? "next" : "prev"));
  };
  const remove = () => {
    dispatch({ type: "removeOp", rowId, path });
    // The op that slides into this place, else the previous one, else the list's add button
    // (or the parent list's, when an emptied repeat group disappears with it).
    focusLater(
      focusId(rowId, path, "count"),
      focusId(rowId, path, "times"),
      focusId(rowId, sibling(index - 1), "count"),
      focusId(rowId, sibling(index - 1), "times"),
      listAddId(rowId, listPath),
      listAddId(rowId, listPath.slice(0, -1)),
    );
  };

  return (
    <span className="op-actions">
      <button
        type="button"
        className="btn btn-icon btn-quiet"
        aria-label={`${name} nach vorne`}
        title="Nach vorne"
        disabled={first}
        data-focus-id={focusId(rowId, path, "prev")}
        onClick={() => move(-1)}
      >
        ←
      </button>
      <button
        type="button"
        className="btn btn-icon btn-quiet"
        aria-label={`${name} nach hinten`}
        title="Nach hinten"
        disabled={last}
        data-focus-id={focusId(rowId, path, "next")}
        onClick={() => move(1)}
      >
        →
      </button>
      <button
        type="button"
        className="btn btn-icon btn-quiet"
        aria-label={`${name} entfernen`}
        title="Entfernen"
        onClick={remove}
      >
        ✕
      </button>
    </span>
  );
}

function StitchEditor({ rowId, rowTitle, op, path, first, last, dispatch }: ItemProps<StitchOp>) {
  const mods = op.modifiers ?? [];
  const name = `Masche ${position(path)} von ${rowTitle}`;
  const toggle = (mod: Mod) => {
    let next = mods.includes(mod) ? mods.filter((m) => m !== mod) : [...mods, mod];
    // Back and front loop exclude each other.
    if (mod === "BLO" && !mods.includes("BLO")) next = next.filter((m) => m !== "FLO");
    if (mod === "FLO" && !mods.includes("FLO")) next = next.filter((m) => m !== "BLO");
    dispatch({ type: "updateStitch", rowId, path, patch: { modifiers: next } });
  };

  return (
    <div className="op op-stitch">
      <NumberField
        className="op-count"
        aria-label={`Anzahl, ${name}`}
        data-focus-id={focusId(rowId, path, "count")}
        min={1}
        max={MAX_COUNT}
        value={op.count}
        onValue={(count) => count !== undefined && dispatch({ type: "updateStitch", rowId, path, patch: { count } })}
      />
      <select
        className="op-code"
        aria-label={`Maschenart, ${name}`}
        value={op.code}
        onChange={(e) => dispatch({ type: "updateStitch", rowId, path, patch: { code: e.target.value as StitchCode } })}
      >
        {PICKER_CODES.map((code) => (
          <option key={code} value={code}>
            {STITCH_ABBREVIATIONS[code].de} – {STITCH_NAMES[code].de}
          </option>
        ))}
      </select>
      <span className="op-mods" role="group" aria-label={`Besonderheiten, ${name}`}>
        {MODS.map((mod) => {
          const allowed = modifierAllowed(op.code, mod);
          return (
            <button
              key={mod}
              type="button"
              className="chip"
              aria-pressed={mods.includes(mod)}
              aria-label={`${MOD_ABBREVIATIONS[mod].de}, ${name}`}
              title={allowed ? MOD_NAMES[mod].de : `${MOD_NAMES[mod].de} – nicht bei dieser Masche`}
              disabled={!allowed && !mods.includes(mod)}
              onClick={() => toggle(mod)}
            >
              {MOD_ABBREVIATIONS[mod].de}
            </button>
          );
        })}
      </span>
      <button
        type="button"
        className="btn btn-small btn-quiet"
        aria-label={`${name} in Wiederholung setzen`}
        title="Diese Masche in eine Wiederholung setzen"
        onClick={() => {
          dispatch({ type: "wrapInRepeat", rowId, path, times: 2 });
          focusLater(focusId(rowId, path, "times"));
        }}
      >
        ( )×
      </button>
      <ItemActions rowId={rowId} path={path} first={first} last={last} dispatch={dispatch} name={name} />
    </div>
  );
}

function RepeatEditor({ rowId, rowTitle, op, path, first, last, dispatch }: ItemProps<RepeatGroup>) {
  const name = `Wiederholung ${position(path)} von ${rowTitle}`;
  return (
    <div className="op op-repeat" role="group" aria-label={`${name}, ${op.times}×`}>
      <div className="repeat-head">
        <NumberField
          className="op-count"
          aria-label={`Anzahl Wiederholungen, ${name}`}
          data-focus-id={focusId(rowId, path, "times")}
          min={1}
          max={MAX_TIMES}
          value={op.times}
          onValue={(times) => times !== undefined && dispatch({ type: "setRepeatTimes", rowId, path, times })}
        />
        <span className="repeat-times" aria-hidden="true">
          × wiederholen
        </span>
        <button
          type="button"
          className="btn btn-small btn-quiet"
          aria-label={`${name} auflösen`}
          title="Wiederholung auflösen (Maschen bleiben, einmal gearbeitet)"
          onClick={() => {
            dispatch({ type: "unwrapRepeat", rowId, path });
            focusLater(focusId(rowId, path, "count"), focusId(rowId, path, "times"), listAddId(rowId, path.slice(0, -1)));
          }}
        >
          Auflösen
        </button>
        <ItemActions rowId={rowId} path={path} first={first} last={last} dispatch={dispatch} name={name} />
      </div>
      <div className="repeat-body">
        <OpList rowId={rowId} rowTitle={rowTitle} ops={op.ops} path={path} dispatch={dispatch} />
      </div>
    </div>
  );
}
