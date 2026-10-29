/**
 * Joining while crocheting (B5b) in the row editor: the other parts the rows of the part shown
 * may be joined to (`JoinPartsContext`, for the row text and the picker), and the picker of a
 * stitch — "aus Teil … (Runde …)" or "zusammen mit Teil …".
 */

import { createContext, useContext, useId, useState } from "react";
import type { JoinNotationPart, JoinRef, StitchOp } from "@crochetbuilder/engine";
import type { BuilderDoc } from "../state/document.js";
import { defaultJoinRow, nextFreeStitch, partIndexOfId, stitchRowsOf, withAllPartIds, type JoinDraft } from "../state/joins.js";
import { PopoverButton } from "./palette.js";

export interface JoinPartsInfo {
  /** The other parts (with the ids they have or will get), for the row text. */
  parts: readonly JoinNotationPart[];
  /** Index of the part shown in the editor. */
  part: number;
  /** The current document. */
  getDoc: () => BuilderDoc;
}

export const JoinPartsContext = createContext<JoinPartsInfo>({ parts: [], part: 0, getDoc: () => ({ parts: [] }) as unknown as BuilderDoc });

export function useJoinParts(): JoinPartsInfo {
  return useContext(JoinPartsContext);
}

/** "Bein 2 (Runde 12)" — the other part of a join, as the editor shows it. */
export function joinRefText(doc: BuilderDoc, ref: JoinRef): string {
  const index = partIndexOfId(doc, ref.part);
  const part = doc.parts[index];
  const name = part ? part.name.trim() || `Teil ${index + 1}` : ref.part;
  let text = name;
  if (ref.copy !== undefined || (part?.quantity ?? 1) >= 2) text += ` ${ref.copy ?? 1}`;
  const extra: string[] = [];
  if (ref.row !== undefined && index >= 0) {
    const row = stitchRowsOf(doc, index).find((r) => r.id === ref.row);
    extra.push(row?.label ?? "Runde fehlt");
  }
  if (ref.start !== undefined) extra.push(`ab M ${ref.start + 1}`);
  return extra.length > 0 ? `${text} (${extra.join(", ")})` : text;
}

/**
 * The join button of a stitch op: shows the join ("aus Bein 1", "mit Arm") and opens the
 * picker — kind, part, copy, row (default: its last stitch row) and first stitch (default: the
 * next free one, where the previous join into that row stopped). Hidden for a document with a
 * single part, unless the stitch has a join that must stay removable.
 */
export function OpJoinButton({ name, op, onSet }: { name: string; op: StitchOp; onSet: (join: JoinDraft | null) => void }) {
  const info = useJoinParts();
  const ref = op.from ?? op.through;
  if (info.parts.length === 0 && !ref) return null;
  const doc = info.getDoc();
  const shown = ref ? `${op.from ? "aus" : "mit"} ${joinRefText(doc, ref)}` : null;
  return (
    <PopoverButton
      className={`btn btn-small btn-quiet op-join${ref ? " is-set" : ""}`}
      label={ref ? `Verbindung ${shown}, ${name}` : `Mit anderem Teil verbinden, ${name}`}
      title={ref ? `${op.from ? "Aus Teil" : "Zusammen mit Teil"} ${joinRefText(doc, ref)} – ändern oder entfernen` : "Diese Maschen in ein anderes Teil arbeiten (aus Teil …, zusammen mit Teil …)"}
      dialogLabel={`Verbindung von ${name}`}
      popoverClass="join-popover"
      buttonContent={ref ? <span>{shown}</span> : <span aria-hidden="true">⇄ Teil</span>}
    >
      {(close) => (
        <JoinPicker
          doc={doc}
          own={info.part}
          op={op}
          onSet={(join) => {
            onSet(join);
            close();
          }}
        />
      )}
    </PopoverButton>
  );
}

function JoinPicker({ doc, own, op, onSet }: { doc: BuilderDoc; own: number; op: StitchOp; onSet: (join: JoinDraft | null) => void }) {
  const ids = useId();
  const withIds = withAllPartIds(doc);
  const others = doc.parts.map((p, i) => ({ p, i })).filter(({ i }) => i !== own);
  const ref = op.from ?? op.through;
  const refPart = ref ? partIndexOfId(doc, ref.part) : -1;
  const [kind, setKind] = useState<JoinDraft["kind"]>(op.through ? "through" : "from");
  const [part, setPart] = useState<number>(refPart >= 0 ? refPart : (others[0]?.i ?? -1));
  const [copy, setCopy] = useState<number>(ref?.copy ?? 1);
  const [row, setRow] = useState<string>(ref?.row ?? "");
  const [start, setStart] = useState<string>(ref?.start !== undefined ? String(ref.start + 1) : "");
  const quantity = doc.parts[part]?.quantity ?? 1;
  const rows = part >= 0 ? stitchRowsOf(doc, part) : [];
  const lastRow = part >= 0 ? defaultJoinRow(doc, part) : undefined;
  const rowId = row || lastRow;
  // The next free stitch of that row, without this op's own join.
  const free = part >= 0 && rowId ? nextFreeStitch(withoutOwnJoin(withIds, op), part, Math.min(copy, quantity), rowId, kind) : 0;
  const startNumber = start.trim() === "" ? undefined : Number(start);
  const startValid = startNumber === undefined || (Number.isInteger(startNumber) && startNumber >= 1);
  const apply = () => {
    if (part < 0 || !startValid) return;
    const draft: JoinDraft = { kind, part };
    if (quantity >= 2) draft.copy = Math.min(copy, quantity);
    if (row) draft.row = row;
    if (startNumber !== undefined) draft.start = startNumber - 1;
    onSet(draft);
  };
  if (others.length === 0) {
    return (
      <>
        <p className="popover-title">Verbindung</p>
        <p className="popover-hint">Es gibt kein anderes Teil.</p>
        {ref && (
          <button type="button" className="btn btn-small btn-quiet" onClick={() => onSet(null)}>
            Verbindung entfernen
          </button>
        )}
      </>
    );
  }
  return (
    <>
      <p className="popover-title">Mit anderem Teil verbinden</p>
      <div className="segmented segmented-small" role="radiogroup" aria-label="Art der Verbindung">
        <button type="button" role="radio" aria-checked={kind === "from"} data-autofocus="" onClick={() => setKind("from")}>
          aus Teil
        </button>
        <button type="button" role="radio" aria-checked={kind === "through"} onClick={() => setKind("through")}>
          zusammen mit Teil
        </button>
      </div>
      <p className="popover-hint">
        {kind === "from"
          ? "Die Maschen werden in die Maschen des anderen Teils gearbeitet statt in die Vorrunde (z. B. „18 fM um Bein 1“)."
          : "Die Maschen gehen durch die Vorrunde und durch das andere Teil, bei einer Runde durch beide Lagen (z. B. „5 fM mit dem Arm“)."}
      </p>
      <label className="join-field" htmlFor={`${ids}-part`}>
        Teil
      </label>
      <select
        id={`${ids}-part`}
        value={part}
        onChange={(e) => {
          setPart(Number(e.target.value));
          setRow("");
          setCopy(1);
        }}
      >
        {others.map(({ p, i }) => (
          <option key={i} value={i}>
            {(p.name.trim() || `Teil ${i + 1}`) + (p.quantity >= 2 ? ` (×${p.quantity})` : "")}
          </option>
        ))}
      </select>
      {quantity >= 2 && (
        <>
          <label className="join-field" htmlFor={`${ids}-copy`}>
            Kopie
          </label>
          <select id={`${ids}-copy`} value={Math.min(copy, quantity)} onChange={(e) => setCopy(Number(e.target.value))}>
            {Array.from({ length: Math.min(quantity, 20) }, (_, k) => (
              <option key={k} value={k + 1}>
                {k + 1}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="join-field" htmlFor={`${ids}-row`}>
        Runde
      </label>
      <select id={`${ids}-row`} value={row} onChange={(e) => setRow(e.target.value)}>
        <option value="">letzte ({rows.find((r) => r.id === lastRow)?.label ?? "–"})</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      <label className="join-field" htmlFor={`${ids}-start`}>
        Ab Masche
      </label>
      <input
        id={`${ids}-start`}
        type="text"
        inputMode="numeric"
        className="narrow"
        placeholder={`nächste freie (${free + 1})`}
        aria-invalid={startValid ? undefined : true}
        value={start}
        onChange={(e) => setStart(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          }
        }}
      />
      <div className="join-actions">
        <button type="button" className="btn btn-small btn-primary" disabled={part < 0 || !startValid} onClick={apply}>
          Übernehmen
        </button>
        {ref && (
          <button type="button" className="btn btn-small btn-quiet" onClick={() => onSet(null)}>
            Verbindung entfernen
          </button>
        )}
      </div>
    </>
  );
}

/** `doc` without the join of `op` (found by identity), so the picker counts the other joins only. */
function withoutOwnJoin(doc: BuilderDoc, op: StitchOp): BuilderDoc {
  if (!op.from && !op.through) return doc;
  const strip = (ops: readonly StitchOp[] | readonly unknown[]): unknown[] =>
    (ops as Array<StitchOp | { kind: string; ops: unknown[] }>).map((o) => {
      if ("code" in o) {
        if (o.from === op.from && o.through === op.through) {
          const { from: _f, through: _t, ...rest } = o;
          return rest;
        }
        return o;
      }
      return { ...o, ops: strip(o.ops) };
    });
  return {
    ...doc,
    parts: doc.parts.map((p) => ({ ...p, content: { ...p.content, rows: p.content.rows.map((r) => ({ ...r, ops: strip(r.ops) as typeof r.ops })) } })),
  };
}
