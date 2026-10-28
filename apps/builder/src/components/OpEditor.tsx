import type { Dispatch } from "react";
import {
  MAX_COUNT,
  MAX_TIMES,
  MOD_ABBREVIATIONS,
  MOD_NAMES,
  STITCH_ABBREVIATIONS,
  STITCH_NAMES,
  modifierAllowed,
  type Mod,
  type Op,
  type RepeatGroup,
  type StitchGroup,
  type StitchCode,
  type StitchOp,
} from "@crochetbuilder/engine";
import type { EditorAction } from "../state/editor.js";
import type { OpPath } from "../state/op-tree.js";
import { NumberField } from "./fields.js";
import { focusLater } from "./focus.js";

/** Picker order: the MVP stitches first, then the rest, then the special stitches (format v2). */
const PICKER_CODES: StitchCode[] = [
  "MR", "CH", "SL_ST", "SC", "HDC", "DC", "INC", "DEC", "INVDEC", "TR", "DTR", "ST",
  "BOBBLE", "PUFF", "POPCORN", "PICOT",
];
/** Modifier chips; FP/BP (relief, format v2) only show where they are allowed or set. */
const MODS: Mod[] = ["BLO", "FLO", "TOG", "FP", "BP"];
const RELIEF: readonly Mod[] = ["FP", "BP"];

/** Picker label: "fM – Feste Masche", or just the name when it is its own abbreviation ("Noppe"). */
function pickerLabel(code: StitchCode): string {
  const abbr = STITCH_ABBREVIATIONS[code].de;
  const name = STITCH_NAMES[code].de;
  return abbr === name ? name : `${abbr} – ${name}`;
}

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

interface OpListProps extends OpEditorProps {
  path: OpPath;
  /** What the list belongs to: the row, a repeat group or a stitch group. */
  container?: "row" | "repeat" | "group";
  /** The list lies inside a stitch group (no further group may be made in it). */
  inGroup?: boolean;
}

function OpList({ rowId, rowTitle, ops, path, dispatch, container = "row", inGroup = false }: OpListProps) {
  const where =
    container === "repeat"
      ? `Wiederholung ${position(path)} von ${rowTitle}`
      : container === "group"
        ? `Gruppe ${position(path)} von ${rowTitle}`
        : rowTitle;
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
              inGroup,
            };
            return (
              <li key={`${i}-${op.kind}`}>
                {op.kind === "stitch" ? (
                  <StitchEditor {...item} op={op} />
                ) : op.kind === "repeat" ? (
                  <RepeatEditor {...item} op={op} />
                ) : (
                  <GroupEditor {...item} op={op} />
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
          + Masche{container === "repeat" ? " in Wiederholung" : container === "group" ? " in Gruppe" : ""}
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
  /** The item lies inside a stitch group. */
  inGroup?: boolean;
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

function StitchEditor({ rowId, rowTitle, op, path, first, last, dispatch, inGroup }: ItemProps<StitchOp>) {
  const mods = op.modifiers ?? [];
  const name = `Masche ${position(path)} von ${rowTitle}`;
  const toggle = (mod: Mod) => {
    let next = mods.includes(mod) ? mods.filter((m) => m !== mod) : [...mods, mod];
    // Back and front loop exclude each other, as do front and back post.
    if (mod === "BLO" && !mods.includes("BLO")) next = next.filter((m) => m !== "FLO");
    if (mod === "FLO" && !mods.includes("FLO")) next = next.filter((m) => m !== "BLO");
    if (mod === "FP" && !mods.includes("FP")) next = next.filter((m) => m !== "BP");
    if (mod === "BP" && !mods.includes("BP")) next = next.filter((m) => m !== "FP");
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
            {pickerLabel(code)}
          </option>
        ))}
      </select>
      <span className="op-mods" role="group" aria-label={`Besonderheiten, ${name}`}>
        {MODS.map((mod) => {
          const allowed = modifierAllowed(op.code, mod);
          // Relief only where it can be worked (or where it is set and must be removable).
          if (RELIEF.includes(mod) && !allowed && !mods.includes(mod)) return null;
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
      {!inGroup && (
        <button
          type="button"
          className="btn btn-small btn-quiet"
          aria-label={`${name} in dieselbe Masche`}
          title="Alle diese Maschen in dieselbe Einstichstelle arbeiten (z. B. 3 fM in 1 M)"
          onClick={() => {
            dispatch({ type: "wrapInGroup", rowId, path });
            focusLater(focusId(rowId, [...path, 0], "count"));
          }}
        >
          in 1 M
        </button>
      )}
      <ItemActions rowId={rowId} path={path} first={first} last={last} dispatch={dispatch} name={name} />
    </div>
  );
}

/** A stitch group (format v2): its ops, all worked into the same stitch. */
function GroupEditor({ rowId, rowTitle, op, path, first, last, dispatch }: ItemProps<StitchGroup>) {
  const name = `Gruppe ${position(path)} von ${rowTitle}`;
  return (
    <div className="op op-repeat op-group" role="group" aria-label={`${name}, in dieselbe Masche`}>
      <div className="repeat-head">
        <span className="repeat-times" data-focus-id={focusId(rowId, path, "times")} tabIndex={-1}>
          in dieselbe Masche
        </span>
        <button
          type="button"
          className="btn btn-small btn-quiet"
          aria-label={`${name} auflösen`}
          title="Gruppe auflösen (jede Masche wieder in ihre eigene Einstichstelle)"
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
        <OpList rowId={rowId} rowTitle={rowTitle} ops={op.ops} path={path} dispatch={dispatch} container="group" inGroup />
      </div>
    </div>
  );
}

function RepeatEditor({ rowId, rowTitle, op, path, first, last, dispatch, inGroup }: ItemProps<RepeatGroup>) {
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
        <OpList rowId={rowId} rowTitle={rowTitle} ops={op.ops} path={path} dispatch={dispatch} container="repeat" inGroup={inGroup} />
      </div>
    </div>
  );
}
