import type { Dispatch } from "react";
import {
  MOD_ABBREVIATIONS,
  MOD_NAMES,
  STITCH_ABBREVIATIONS,
  STITCH_NAMES,
  type Mod,
  type Op,
  type RepeatGroup,
  type StitchCode,
  type StitchOp,
} from "@crochetbuilder/engine";
import type { EditorAction } from "../state/editor.js";
import type { OpPath } from "../state/op-tree.js";
import { NumberField } from "./fields.js";

/** Picker order: the MVP stitches first, then the rest. */
const PICKER_CODES: StitchCode[] = ["MR", "CH", "SL_ST", "SC", "HDC", "DC", "INC", "DEC", "INVDEC", "TR", "DTR", "ST"];
const MODS: Mod[] = ["BLO", "FLO", "TOG"];

interface OpEditorProps {
  rowId: string;
  ops: readonly Op[];
  dispatch: Dispatch<EditorAction>;
}

/** Structured editor for a row's op tree: stitches, counts, modifiers, nested repeats. */
export function OpEditor({ rowId, ops, dispatch }: OpEditorProps) {
  return (
    <div className="op-editor">
      <OpList rowId={rowId} ops={ops} path={[]} dispatch={dispatch} />
    </div>
  );
}

function OpList({ rowId, ops, path, dispatch }: OpEditorProps & { path: OpPath }) {
  const nested = path.length > 0;
  return (
    <>
      {ops.length > 0 && (
        <ol className="op-list">
          {ops.map((op, i) => (
            <li key={`${i}-${op.kind}`}>
              {op.kind === "stitch" ? (
                <StitchEditor
                  rowId={rowId}
                  op={op}
                  path={[...path, i]}
                  first={i === 0}
                  last={i === ops.length - 1}
                  dispatch={dispatch}
                />
              ) : (
                <RepeatEditor
                  rowId={rowId}
                  op={op}
                  path={[...path, i]}
                  first={i === 0}
                  last={i === ops.length - 1}
                  dispatch={dispatch}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="op-list-actions">
        <button
          type="button"
          className="btn btn-small"
          onClick={() =>
            dispatch({ type: "insertOp", rowId, path: [...path, ops.length], op: { kind: "stitch", code: "SC", count: 1 } })
          }
        >
          + Masche{nested ? " in Wiederholung" : ""}
        </button>
        {ops.length > 1 && (
          <button
            type="button"
            className="btn btn-small btn-quiet"
            title="Alle Maschen dieser Liste in eine Wiederholung setzen"
            onClick={() => dispatch({ type: "wrapInRepeat", rowId, path: [...path, 0], length: ops.length, times: 2 })}
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
  op: T;
  path: OpPath;
  first: boolean;
  last: boolean;
  dispatch: Dispatch<EditorAction>;
}

function ItemActions({ rowId, path, first, last, dispatch, what }: Omit<ItemProps<unknown>, "op"> & { what: string }) {
  return (
    <span className="op-actions">
      <button
        type="button"
        className="btn btn-icon btn-quiet"
        aria-label={`${what} nach vorne`}
        title="Nach vorne"
        disabled={first}
        onClick={() => dispatch({ type: "moveOp", rowId, path, delta: -1 })}
      >
        ←
      </button>
      <button
        type="button"
        className="btn btn-icon btn-quiet"
        aria-label={`${what} nach hinten`}
        title="Nach hinten"
        disabled={last}
        onClick={() => dispatch({ type: "moveOp", rowId, path, delta: 1 })}
      >
        →
      </button>
      <button
        type="button"
        className="btn btn-icon btn-quiet"
        aria-label={`${what} entfernen`}
        title="Entfernen"
        onClick={() => dispatch({ type: "removeOp", rowId, path })}
      >
        ✕
      </button>
    </span>
  );
}

function StitchEditor({ rowId, op, path, first, last, dispatch }: ItemProps<StitchOp>) {
  const mods = op.modifiers ?? [];
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
        aria-label="Anzahl"
        min={1}
        value={op.count}
        onValue={(count) => count !== undefined && dispatch({ type: "updateStitch", rowId, path, patch: { count } })}
      />
      <select
        className="op-code"
        aria-label="Masche"
        value={op.code}
        onChange={(e) => dispatch({ type: "updateStitch", rowId, path, patch: { code: e.target.value as StitchCode } })}
      >
        {PICKER_CODES.map((code) => (
          <option key={code} value={code}>
            {STITCH_ABBREVIATIONS[code].de} – {STITCH_NAMES[code].de}
          </option>
        ))}
      </select>
      <span className="op-mods" role="group" aria-label="Besonderheiten">
        {MODS.map((mod) => (
          <button
            key={mod}
            type="button"
            className="chip"
            aria-pressed={mods.includes(mod)}
            title={MOD_NAMES[mod].de}
            onClick={() => toggle(mod)}
          >
            {MOD_ABBREVIATIONS[mod].de}
          </button>
        ))}
      </span>
      <button
        type="button"
        className="btn btn-small btn-quiet"
        title="Diese Masche in eine Wiederholung setzen"
        onClick={() => dispatch({ type: "wrapInRepeat", rowId, path, times: 2 })}
      >
        ( )×
      </button>
      <ItemActions rowId={rowId} path={path} first={first} last={last} dispatch={dispatch} what="Masche" />
    </div>
  );
}

function RepeatEditor({ rowId, op, path, first, last, dispatch }: ItemProps<RepeatGroup>) {
  return (
    <div className="op op-repeat" role="group" aria-label={`Wiederholung ${op.times}×`}>
      <div className="repeat-head">
        <NumberField
          className="op-count"
          aria-label="Wiederholungen"
          min={1}
          value={op.times}
          onValue={(times) => times !== undefined && dispatch({ type: "setRepeatTimes", rowId, path, times })}
        />
        <span className="repeat-times" aria-hidden="true">
          × wiederholen
        </span>
        <button
          type="button"
          className="btn btn-small btn-quiet"
          title="Wiederholung auflösen (Maschen bleiben, einmal gearbeitet)"
          onClick={() => dispatch({ type: "unwrapRepeat", rowId, path })}
        >
          Auflösen
        </button>
        <ItemActions rowId={rowId} path={path} first={first} last={last} dispatch={dispatch} what="Wiederholung" />
      </div>
      <div className="repeat-body">
        <OpList rowId={rowId} ops={op.ops} path={path} dispatch={dispatch} />
      </div>
    </div>
  );
}
