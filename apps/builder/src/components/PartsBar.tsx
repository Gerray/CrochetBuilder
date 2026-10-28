import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent } from "react";
import type { Finish, PartContent, Stuffing } from "@crochetbuilder/engine";
import type { BuilderDoc } from "../state/document.js";
import { MAX_PART_QUANTITY, MAX_PARTS, type EditorAction } from "../state/editor.js";
import {
  automaticFinish,
  automaticStuffing,
  largeGatheredRound,
  findingsSummary,
  partFindings,
  partName,
  partStatus,
  partStitches,
  partsTotal,
  totalText,
} from "../state/parts.js";
import { NumberField } from "./fields.js";
import { focusLater } from "./focus.js";
import { PaletteStrip } from "./palette.js";
import { registerPendingEdit } from "./pendingEdits.js";

/** Id of the element the tabs control (the row editor of the shown part). */
export const PART_PANEL_ID = "part-panel";
export const partTabId = (index: number) => `part-tab-${index}`;
export const PART_SWITCH_HINT = "Alt+↑ / Alt+↓ wechselt das Teil";

interface PartsBarProps {
  doc: BuilderDoc;
  /** Index of the part shown. */
  selected: number;
  dispatch: Dispatch<EditorAction>;
  /** Show part `index`; false when a field with unreadable text stopped the switch. */
  onSelect: (index: number) => boolean;
  onAdd: () => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  /** Changes whenever the name field should take focus (new part, double click on a tab). */
  nameFocusToken: number;
  onRequestNameFocus: () => void;
  /** Name of the part just deleted, while that deletion is the latest change. */
  deletedName: string | null;
  onUndoDelete: () => void;
}

const STATUS_LABEL = { ok: "in Ordnung", warning: "mit Hinweisen", error: "mit Fehlern" } as const;

/**
 * The parts of the pattern above the row editor: one tab per part (name, quantity, stitch
 * count, validation light), "+ Teil", and the tools of the shown part (name, quantity, move,
 * duplicate, delete). The tabs follow the ARIA tabs pattern (arrow keys, Home/End).
 */
export function PartsBar(props: PartsBarProps) {
  const { doc, selected, dispatch, onSelect, onAdd, onDuplicate, onDelete, nameFocusToken, onRequestNameFocus } = props;
  const parts = doc.parts;
  const part = parts[selected]!;
  const total = partsTotal(doc);

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number;
    if (e.key === "ArrowRight") next = (selected + 1) % parts.length;
    else if (e.key === "ArrowLeft") next = (selected - 1 + parts.length) % parts.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = parts.length - 1;
    else if (e.key === "F2" || e.key === "Enter") {
      // Enter on a tab is a click (select); F2 renames like in a file list.
      if (e.key === "F2") {
        e.preventDefault();
        onRequestNameFocus();
      }
      return;
    } else return;
    e.preventDefault();
    if (onSelect(next)) focusLater(partTabId(next));
  };

  const move = (delta: number) => {
    const to = selected + delta;
    dispatch({ type: "movePart", index: selected, delta });
    // At either end the button turns disabled: keep focus on the other one.
    if (to <= 0) focusLater("part-move-later", partTabId(0));
    else if (to >= parts.length - 1) focusLater("part-move-earlier", partTabId(parts.length - 1));
  };

  return (
    <section className="parts-bar" aria-label="Teile">
      <div className="parts-strip">
        <div
          className="parts-tabs"
          role="tablist"
          aria-label="Teile der Anleitung"
          onKeyDown={onTabKey}
        >
          {parts.map((p, i) => {
            const findings = partFindings(p.content);
            const status = partStatus(findings);
            const stitches = partStitches(p.content);
            const name = partName(p.name, i);
            const label = [
              name,
              p.quantity > 1 ? `${p.quantity}-mal` : null,
              `${stitches.toLocaleString("de-DE")} Maschen`,
              findings.length > 0 ? findingsSummary(findings) : STATUS_LABEL.ok,
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <button
                key={i}
                id={partTabId(i)}
                type="button"
                role="tab"
                className={`part-tab part-${status}`}
                aria-selected={i === selected}
                aria-controls={PART_PANEL_ID}
                aria-label={label}
                tabIndex={i === selected ? 0 : -1}
                data-focus-id={partTabId(i)}
                title={`${label} – ${PART_SWITCH_HINT}, Doppelklick benennt um`}
                onClick={() => onSelect(i)}
                onDoubleClick={() => {
                  if (onSelect(i)) onRequestNameFocus();
                }}
              >
                <span className="part-dot" aria-hidden="true" />
                <span className="part-tab-name">{name}</span>
                {p.quantity > 1 && <span className="part-tab-qty">×{p.quantity}</span>}
                <span className="part-tab-count">{stitches.toLocaleString("de-DE")}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="btn btn-small parts-add"
          onClick={onAdd}
          disabled={parts.length >= MAX_PARTS}
          title={parts.length >= MAX_PARTS ? `Höchstens ${MAX_PARTS} Teile` : "Neues Teil mit einer leeren Runde"}
        >
          + Teil
        </button>
      </div>

      <div className="part-tools" role="toolbar" aria-label={`Teil „${partName(part.name, selected)}“`}>
        <PartNameField
          name={part.name}
          index={selected}
          focusToken={nameFocusToken}
          onRename={(index, name) => dispatch({ type: "renamePart", index, name })}
        />
        <span className="part-quantity" role="group" aria-label="Anzahl">
          <span className="part-tools-label" aria-hidden="true">
            Anzahl
          </span>
          <button
            type="button"
            className="btn btn-small btn-icon"
            aria-label="Anzahl verringern"
            title="Anzahl verringern"
            disabled={part.quantity <= 1}
            // Also brings a quantity above the limit (old or foreign data) back into range.
            onClick={() =>
              dispatch({
                type: "setPartQuantity",
                index: selected,
                quantity: Math.min(part.quantity - 1, MAX_PART_QUANTITY),
              })
            }
          >
            −
          </button>
          <NumberField
            className="part-quantity-input"
            aria-label="Anzahl des Teils"
            title={`Wie oft dieses Teil gehäkelt wird (1 bis ${MAX_PART_QUANTITY})`}
            value={part.quantity}
            min={1}
            max={MAX_PART_QUANTITY}
            onValue={(quantity) => {
              if (quantity !== undefined) dispatch({ type: "setPartQuantity", index: selected, quantity });
            }}
          />
          <button
            type="button"
            className="btn btn-small btn-icon"
            aria-label="Anzahl erhöhen"
            title="Anzahl erhöhen"
            disabled={part.quantity >= MAX_PART_QUANTITY}
            onClick={() => dispatch({ type: "setPartQuantity", index: selected, quantity: part.quantity + 1 })}
          >
            +
          </button>
        </span>
        <span className="part-actions">
          <button
            type="button"
            className="btn btn-small btn-icon btn-quiet"
            data-focus-id="part-move-earlier"
            aria-label="Teil nach vorne verschieben"
            title="Teil nach vorne verschieben"
            disabled={selected === 0}
            onClick={() => move(-1)}
          >
            ←
          </button>
          <button
            type="button"
            className="btn btn-small btn-icon btn-quiet"
            data-focus-id="part-move-later"
            aria-label="Teil nach hinten verschieben"
            title="Teil nach hinten verschieben"
            disabled={selected === parts.length - 1}
            onClick={() => move(1)}
          >
            →
          </button>
          <button
            type="button"
            className="btn btn-small btn-quiet"
            disabled={parts.length >= MAX_PARTS}
            aria-label="Teil duplizieren"
            title="Kopie mit allen Zeilen anlegen, z. B. für linkes und rechtes Bein"
            onClick={() => onDuplicate(selected)}
          >
            Duplizieren
          </button>
          <button
            type="button"
            className="btn btn-small btn-quiet btn-danger"
            disabled={parts.length <= 1}
            title={parts.length <= 1 ? "Das einzige Teil kann nicht gelöscht werden" : "Teil löschen (rückgängig machbar)"}
            onClick={() => onDelete(selected)}
          >
            Teil löschen
          </button>
        </span>
        <span className="parts-total">
          {totalText(total)}
        </span>
      </div>

      <div className="part-settings" role="group" aria-label={`Einstellungen von „${partName(part.name, selected)}“`}>
        <PartFinishFields content={part.content} index={selected} dispatch={dispatch} />
        <PaletteStrip doc={doc} dispatch={dispatch} />
      </div>
      <FinishHint content={part.content} index={selected} dispatch={dispatch} />

      {props.deletedName !== null && (
        <div className="parts-notice" role="status">
          <span>„{props.deletedName}“ gelöscht.</span>
          <button
            type="button"
            className="btn btn-small"
            aria-label={`Löschen von „${props.deletedName}“ rückgängig machen`}
            title="Rückgängig (Strg+Z)"
            onClick={props.onUndoDelete}
          >
            Rückgängig
          </button>
        </div>
      )}
    </section>
  );
}

export const FINISH_LABELS: Record<Finish, string> = {
  open: "Offen",
  gather: "Zusammengezogen",
  flat: "Flach zusammengehäkelt",
};
export const STUFFING_LABELS: Record<Stuffing, string> = { none: "Keine", light: "Leicht", firm: "Fest" };
const FINISH_TITLES: Record<Finish, string> = {
  open: "Die letzte Runde bleibt offen (z. B. Arme, die angenäht werden)",
  gather: "Die letzte Runde wird zusammengezogen (Kugel, Kopf)",
  flat: "Die letzte Runde wird flach zusammengehäkelt (Ohren, Füße)",
};

/**
 * How the shown part is finished and stuffed (format v2). "Automatisch" leaves it to the
 * engine and says what it decides: a closed piece is gathered and stuffed firmly, anything
 * else stays open and empty.
 */
function PartFinishFields({ content, index, dispatch }: { content: PartContent; index: number; dispatch: Dispatch<EditorAction> }) {
  const autoFinish = automaticFinish(content);
  const autoStuffing = automaticStuffing(content);
  return (
    <>
      <label className="part-setting">
        <span className="part-tools-label">Abschluss</span>
        <select
          aria-label="Abschluss des Teils"
          title={content.finish ? FINISH_TITLES[content.finish] : `Automatisch: ${FINISH_TITLES[autoFinish]}`}
          className={content.finish ? "" : "is-auto"}
          value={content.finish ?? ""}
          onChange={(e) =>
            dispatch({ type: "setPartFinish", index, finish: e.target.value === "" ? null : (e.target.value as Finish) })
          }
        >
          <option value="">Automatisch ({FINISH_LABELS[autoFinish]})</option>
          {FINISHES.map((f) => (
            <option key={f} value={f}>
              {FINISH_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      <label className="part-setting">
        <span className="part-tools-label">Füllung</span>
        <select
          aria-label="Füllung des Teils"
          title="Wie fest das Teil gefüllt wird – das 3D-Modell wölbt sich entsprechend"
          className={content.stuffing ? "" : "is-auto"}
          value={content.stuffing ?? ""}
          onChange={(e) =>
            dispatch({ type: "setPartStuffing", index, stuffing: e.target.value === "" ? null : (e.target.value as Stuffing) })
          }
        >
          <option value="">Automatisch ({autoStuffing === "none" ? "keine Füllung" : STUFFING_LABELS[autoStuffing]})</option>
          {STUFFINGS.map((s) => (
            <option key={s} value={s}>
              {STUFFING_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

const FINISHES: Finish[] = ["open", "gather", "flat"];
const STUFFINGS: Stuffing[] = ["none", "light", "firm"];

/** A large last round that is gathered automatically: offer to crochet it flat instead. */
function FinishHint({ content, index, dispatch }: { content: PartContent; index: number; dispatch: Dispatch<EditorAction> }) {
  // Only while the engine decides: a finish chosen on purpose is not questioned.
  const count = content.finish === undefined ? largeGatheredRound(content) : null;
  if (count === null) return null;
  // No live region: it would be announced again on every switch to this part.
  return (
    <p className="part-hint">
      <span>Die letzte Runde hat {count} M – flach zusammenhäkeln statt zusammenziehen?</span>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => dispatch({ type: "setPartFinish", index, finish: "flat" })}
      >
        Flach zusammenhäkeln
      </button>
    </p>
  );
}

/**
 * The shown part's name, edited in place: Enter or leaving the field keeps the name, Escape
 * restores it. An empty name keeps the old one.
 */
function PartNameField({
  name,
  index,
  focusToken,
  onRename,
}: {
  name: string;
  index: number;
  focusToken: number;
  onRename: (index: number, name: string) => void;
}) {
  // A draft belongs to the part it was typed for; switching parts shows the other name.
  const [draft, setDraftState] = useState<{ index: number; text: string } | null>(null);
  // Mirrored in a ref, so a commit from the pending-edit registry sees the latest text.
  const draftRef = useRef(draft);
  const setDraft = (value: { index: number; text: string } | null) => {
    draftRef.current = value;
    setDraftState(value);
  };
  const text = draft?.index === index ? draft.text : null;
  const input = useRef<HTMLInputElement>(null);
  const handled = useRef(focusToken);

  useEffect(() => {
    // Not on mount: only a new token (new part, double click, F2) takes focus.
    if (focusToken === handled.current) return;
    handled.current = focusToken;
    input.current?.focus();
    input.current?.select();
  }, [focusToken]);

  /** Keep the typed name (an empty one keeps the old name) for the part it was typed for. */
  const commit = () => {
    const current = draftRef.current;
    if (current === null) return;
    setDraft(null);
    const next = current.text.trim();
    if (next !== "") onRename(current.index, next);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(
    () =>
      registerPendingEdit({
        commit: () => {
          commitRef.current();
          return true;
        },
        focus: () => input.current?.focus(),
      }),
    [],
  );

  return (
    <input
      ref={input}
      className="part-name-input"
      aria-label="Name des Teils"
      title="Name des Teils – Enter übernimmt, Esc verwirft"
      placeholder={`Teil ${index + 1}`}
      maxLength={80}
      value={text ?? name}
      onChange={(e) => setDraft({ index, text: e.target.value })}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          focusLater(partTabId(index));
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(null);
          focusLater(partTabId(index));
        }
      }}
    />
  );
}
