/**
 * Colours in the editor (format v2): the palette strip of the parts bar, the palette editor
 * of "Material & Hinweise", the colour chip of a row card and the colour button of a stitch.
 *
 * The palette reaches the row cards through `PaletteContext` (row cards are memoised; only
 * the colour widgets re-render when the palette changes).
 */

import { createContext, useContext, useEffect, useId, useRef, useState, type Dispatch, type ReactNode } from "react";
import type { PaletteColor } from "@crochetbuilder/engine";
import type { BuilderDoc } from "../state/document.js";
import type { EditorAction } from "../state/editor.js";
import {
  COLOR_SUGGESTIONS,
  colorCss,
  colorName,
  colorUsage,
  newColorId,
  suggestionFor,
  type RowColor,
} from "../state/palette.js";

export interface PaletteInfo {
  /** `overview.colors` (empty without a palette). */
  colors: readonly PaletteColor[];
  /** Display colour of every entry (`paletteCss`). */
  css: readonly string[];
  /** The current document (new ids must not collide with anything in it). */
  getDoc: () => BuilderDoc;
}

const NO_COLORS: readonly PaletteColor[] = [];

export const PaletteContext = createContext<PaletteInfo>({ colors: NO_COLORS, css: [], getDoc: () => ({}) as BuilderDoc });

export function usePalette(): PaletteInfo {
  return useContext(PaletteContext);
}

/** Display name and colour of palette id `id` (an id outside the palette shows as itself). */
export function describeColor(palette: PaletteInfo, id: string | undefined): { name: string; css: string | null } {
  if (id === undefined) return { name: "keine Farbe", css: null };
  const index = palette.colors.findIndex((c) => c.id === id);
  if (index < 0) return { name: id, css: null };
  return { name: colorName(palette.colors[index], index), css: palette.css[index] ?? null };
}

/** A round colour dot; hollow and dashed for an unknown colour. */
export function Swatch({ css, size = "md" }: { css: string | null; size?: "sm" | "md" }) {
  return (
    <span
      className={`swatch swatch-${size}${css === null ? " is-unknown" : ""}`}
      style={css === null ? undefined : { background: css }}
      aria-hidden="true"
    />
  );
}

/** Close a popover on a press outside `root` or on Escape (focus goes back to `toggle`). */
function usePopoverDismiss(open: boolean, root: React.RefObject<HTMLElement | null>, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, root]);
}

/** A button that opens a small popover dialog below it. */
function PopoverButton({
  label,
  title,
  className,
  buttonContent,
  dialogLabel,
  popoverClass = "",
  children,
  align = "left",
}: {
  label: string;
  title?: string;
  className: string;
  buttonContent: ReactNode;
  dialogLabel: string;
  popoverClass?: string;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  usePopoverDismiss(open, wrap, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    // First control of the popover takes the focus (the chosen colour if there is one).
    const dialog = wrap.current?.querySelector<HTMLElement>("[role='dialog']");
    const target =
      dialog?.querySelector<HTMLElement>("[data-autofocus]") ?? dialog?.querySelector<HTMLElement>("button, input, select");
    target?.focus();
  }, [open]);
  return (
    <span className="popover-anchor" ref={wrap}>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {buttonContent}
      </button>
      {open && (
        <div
          className={`popover color-popover${align === "right" ? " popover-right" : ""} ${popoverClass}`}
          role="dialog"
          aria-label={dialogLabel}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          {children(close)}
        </div>
      )}
    </span>
  );
}

/**
 * Palette swatches to pick a colour change from, plus "no change". `current`: the change set
 * here (null: none); `inherited`: the colour the work is in without it.
 */
function ColorChoices({
  current,
  inherited,
  noneLabel,
  onPick,
}: {
  current: string | null;
  inherited: string | undefined;
  noneLabel: string;
  onPick: (id: string | null) => void;
}) {
  const palette = usePalette();
  const inheritedInfo = describeColor(palette, inherited);
  return (
    <>
      <div className="color-choices" role="group" aria-label="Farben">
        {palette.colors.map((c, i) => {
          const chosen = current === c.id;
          return (
            <button
              key={c.id}
              type="button"
              className="color-choice"
              aria-pressed={chosen}
              data-autofocus={chosen ? "" : undefined}
              onClick={() => onPick(c.id)}
            >
              <Swatch css={palette.css[i] ?? null} />
              <span>{colorName(c, i)}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="btn btn-small btn-quiet color-none"
        aria-pressed={current === null}
        onClick={() => onPick(null)}
      >
        {noneLabel}
        {inherited !== undefined && <span className="muted"> (weiter in {inheritedInfo.name})</span>}
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Row card chip and stitch button
// ---------------------------------------------------------------------------

/**
 * The colour at the start of a row: emphasised where the row changes colour, muted where it
 * carries on in the colour before. A click picks "Farbwechsel ab dieser Runde".
 */
export function RowColorChip({
  title,
  word,
  start,
  inherited,
  own,
  onSet,
}: {
  /** "Runde 5" (accessible names). */
  title: string;
  /** "Runde" or "Reihe". */
  word: string;
  /** The colour at the start of the row. */
  start: RowColor;
  /** The colour before the row (what "no change" means). */
  inherited: string | undefined;
  /** `Row.color` (the change set here). */
  own: string | undefined;
  onSet: (color: string | null) => void;
}) {
  const palette = usePalette();
  if (palette.colors.length === 0 && own === undefined) return null;
  const shown = describeColor(palette, start.unknown ? own : start.id);
  const state = start.unknown ? "unbekannte Farbe" : start.changed ? "Farbwechsel" : "weiter";
  return (
    <PopoverButton
      className={`color-chip${start.changed ? " is-change" : " is-inherited"}${start.unknown ? " is-unknown" : ""}`}
      label={`Farbe von ${title}: ${shown.name} (${state})`}
      title={
        start.unknown
          ? `„${own}“ steht nicht in der Farbpalette – Farbe wählen`
          : start.changed
            ? `Farbwechsel zu ${shown.name} ab dieser ${word} – ändern oder entfernen`
            : `Weiter in ${shown.name} – Klick setzt einen Farbwechsel ab dieser ${word}`
      }
      dialogLabel={`Farbwechsel ab ${title}`}
      buttonContent={
        <>
          <Swatch css={shown.css} size="sm" />
          <span className="color-chip-name">{shown.name}</span>
        </>
      }
    >
      {(close) => (
        <>
          <p className="popover-title">Farbwechsel ab dieser {word}</p>
          <ColorChoices
            current={own ?? null}
            inherited={inherited}
            noneLabel="Kein Farbwechsel"
            onPick={(id) => {
              onSet(id);
              close();
            }}
          />
        </>
      )}
    </PopoverButton>
  );
}

/** Colour change at a stitch ("ab dieser Masche"): a small swatch button in the op editor. */
export function OpColorButton({ name, color, onSet }: { name: string; color: string | undefined; onSet: (color: string | null) => void }) {
  const palette = usePalette();
  if (palette.colors.length === 0 && color === undefined) return null;
  const info = describeColor(palette, color);
  return (
    <PopoverButton
      className={`btn btn-small btn-quiet op-color${color !== undefined ? " is-set" : ""}`}
      label={color === undefined ? `Farbwechsel, ${name}` : `Farbwechsel zu ${info.name}, ${name}`}
      title={color === undefined ? "Farbwechsel ab dieser Masche" : `Ab dieser Masche in ${info.name} – ändern oder entfernen`}
      dialogLabel={`Farbwechsel ab ${name}`}
      buttonContent={
        color === undefined ? (
          <span className="swatch swatch-sm is-empty" aria-hidden="true" />
        ) : (
          <>
            <Swatch css={info.css} size="sm" />
            <span>{info.name}</span>
          </>
        )
      }
    >
      {(close) => (
        <>
          <p className="popover-title">Farbwechsel ab dieser Masche</p>
          <ColorChoices
            current={color ?? null}
            inherited={undefined}
            noneLabel="Kein Farbwechsel"
            onPick={(id) => {
              onSet(id);
              close();
            }}
          />
        </>
      )}
    </PopoverButton>
  );
}

// ---------------------------------------------------------------------------
// Adding and editing colours
// ---------------------------------------------------------------------------

/** "+ Farbe": built-in colours with one click, or an own name and colour. */
function AddColorForm({ doc, dispatch, onDone }: { doc: BuilderDoc; dispatch: Dispatch<EditorAction>; onDone: () => void }) {
  const palette = doc.overview.colors ?? [];
  const used = new Set(palette.map((c) => c.name.trim().toLowerCase()));
  const offers = COLOR_SUGGESTIONS.filter((s) => !used.has(s.name.toLowerCase()));
  const [name, setName] = useState("");
  const [hex, setHex] = useState<string | null>(null);
  const nameId = useId();
  const shownHex = hex ?? suggestionFor(name)?.hex ?? "#e7b48f";
  const add = (colorNameText: string, colorHex: string) => {
    const trimmed = colorNameText.trim();
    dispatch({ type: "addColor", color: { id: newColorId(trimmed, doc), name: trimmed, hex: colorHex } });
    onDone();
  };
  return (
    <>
      {offers.length > 0 && (
        <div className="color-choices" role="group" aria-label="Vorschläge">
          {offers.map((s) => (
            <button key={s.name} type="button" className="color-choice" onClick={() => add(s.name, s.hex)}>
              <Swatch css={s.hex} />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      )}
      <form
        className="color-custom"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add(name, shownHex);
        }}
      >
        <label htmlFor={nameId} className="muted small">
          Eigene Farbe
        </label>
        <input
          id={nameId}
          className="color-name-input"
          placeholder="Name, z. B. Altrosa"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="color"
          className="color-hex-input"
          aria-label="Farbton der eigenen Farbe"
          value={shownHex}
          onChange={(e) => setHex(e.target.value)}
        />
        <button type="submit" className="btn btn-small btn-primary" disabled={!name.trim()}>
          Hinzufügen
        </button>
      </form>
    </>
  );
}

/** "+ Farbe" with its popover (parts bar and "Material & Hinweise"). */
export function AddColorButton({ doc, dispatch, compact = false }: { doc: BuilderDoc; dispatch: Dispatch<EditorAction>; compact?: boolean }) {
  return (
    <PopoverButton
      className={compact ? "btn btn-small btn-quiet palette-add" : "btn btn-small palette-add"}
      label="Farbe hinzufügen"
      title="Farbe zur Palette hinzufügen – Vorschlag anklicken oder eigene Farbe anlegen"
      dialogLabel="Farbe hinzufügen"
      popoverClass="add-color-popover"
      buttonContent="+ Farbe"
    >
      {(close) => (
        <>
          <p className="popover-title">Farbe hinzufügen</p>
          <AddColorForm doc={doc} dispatch={dispatch} onDone={close} />
        </>
      )}
    </PopoverButton>
  );
}

/**
 * Delete a colour; when rows use it, first ask what they switch to instead (another colour,
 * or no colour change).
 */
function DeleteColor({
  doc,
  color,
  dispatch,
  onDeleted,
}: {
  doc: BuilderDoc;
  color: PaletteColor;
  dispatch: Dispatch<EditorAction>;
  onDeleted?: () => void;
}) {
  const palette = doc.overview.colors ?? [];
  const index = palette.findIndex((c) => c.id === color.id);
  const others = palette.filter((c) => c.id !== color.id);
  const usage = colorUsage(doc, color.id);
  const [asking, setAsking] = useState(false);
  const [replacement, setReplacement] = useState<string>(others[0]?.id ?? "");
  const name = colorName(color, index);
  const remove = (with_?: string) => {
    dispatch(with_ ? { type: "removeColor", id: color.id, replacement: with_ } : { type: "removeColor", id: color.id });
    onDeleted?.();
  };
  if (!asking) {
    return (
      <button
        type="button"
        className="btn btn-small btn-quiet btn-danger"
        aria-label={`${name} löschen`}
        title={usage > 0 ? `In ${usage} ${usage === 1 ? "Zeile" : "Zeilen"} verwendet` : "Farbe löschen (rückgängig machbar)"}
        onClick={() => (usage > 0 ? setAsking(true) : remove())}
      >
        Löschen
      </button>
    );
  }
  return (
    <div className="color-delete" role="group" aria-label={`${name} löschen`}>
      <p className="color-delete-warning">
        {name} wird in {usage} {usage === 1 ? "Zeile" : "Zeilen"} verwendet.
      </p>
      <label className="inline-field">
        <span>Stattdessen</span>
        <select aria-label={`Ersatz für ${name}`} value={replacement} onChange={(e) => setReplacement(e.target.value)}>
          {others.map((c) => (
            <option key={c.id} value={c.id}>
              {colorName(c, palette.indexOf(c))}
            </option>
          ))}
          <option value="">kein Farbwechsel</option>
        </select>
      </label>
      <span className="color-delete-actions">
        <button type="button" className="btn btn-small btn-danger" onClick={() => remove(replacement || undefined)}>
          Löschen und ersetzen
        </button>
        <button type="button" className="btn btn-small btn-quiet" onClick={() => setAsking(false)}>
          Abbrechen
        </button>
      </span>
    </div>
  );
}

/** Name, colour, "Anfangsfarbe" and delete for one palette entry. */
function ColorFields({
  doc,
  color,
  index,
  dispatch,
  onDeleted,
}: {
  doc: BuilderDoc;
  color: PaletteColor;
  index: number;
  dispatch: Dispatch<EditorAction>;
  onDeleted?: () => void;
}) {
  const name = colorName(color, index);
  return (
    <>
      <span className="color-fields">
        <input
          type="color"
          className="color-hex-input"
          aria-label={`Farbton von ${name}`}
          value={colorCss(color, index)}
          onChange={(e) => dispatch({ type: "updateColor", id: color.id, patch: { hex: e.target.value } })}
        />
        <input
          className="color-name-input"
          aria-label={`Name von Farbe ${index + 1}`}
          placeholder={`Farbe ${index + 1}`}
          maxLength={40}
          value={color.name}
          onChange={(e) => dispatch({ type: "updateColor", id: color.id, patch: { name: e.target.value } })}
        />
        {index === 0 ? (
          <span className="color-start-badge" title="Mit dieser Farbe beginnt jedes Teil, bis eine Runde die Farbe wechselt">
            Anfangsfarbe
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-small btn-quiet"
            title="Jedes Teil beginnt in dieser Farbe, bis eine Runde die Farbe wechselt"
            aria-label={`${name} als Anfangsfarbe`}
            onClick={() => dispatch({ type: "moveColor", id: color.id, to: 0 })}
          >
            Als Anfangsfarbe
          </button>
        )}
      </span>
      <DeleteColor doc={doc} color={color} dispatch={dispatch} {...(onDeleted ? { onDeleted } : {})} />
    </>
  );
}

/**
 * The palette in the editor of the current part: swatches with names (a click edits the
 * colour) and "+ Farbe".
 */
export function PaletteStrip({ doc, dispatch }: { doc: BuilderDoc; dispatch: Dispatch<EditorAction> }) {
  const palette = usePalette();
  return (
    <span className="palette-strip" role="group" aria-label="Farbpalette">
      <span className="part-tools-label" aria-hidden="true">
        Farben
      </span>
      {palette.colors.map((c, i) => {
        const name = colorName(c, i);
        return (
          <PopoverButton
            key={c.id}
            className="palette-swatch"
            label={`${name} bearbeiten${i === 0 ? " (Anfangsfarbe)" : ""}`}
            title={`${name}${i === 0 ? " – Anfangsfarbe" : ""} – Klick bearbeitet`}
            dialogLabel={`${name} bearbeiten`}
            popoverClass="edit-color-popover"
            buttonContent={
              <>
                <Swatch css={palette.css[i] ?? null} size="sm" />
                <span className="palette-swatch-name">{name}</span>
              </>
            }
          >
            {(close) => <ColorFields doc={doc} color={c} index={i} dispatch={dispatch} onDeleted={close} />}
          </PopoverButton>
        );
      })}
      <AddColorButton doc={doc} dispatch={dispatch} compact={palette.colors.length > 0} />
    </span>
  );
}

/**
 * "Farben" in "Material & Hinweise": every palette entry with its fields, "+ Farbe" and
 * taking the colours over into the yarn of the material list.
 */
export function PaletteEditor({ doc, dispatch }: { doc: BuilderDoc; dispatch: Dispatch<EditorAction> }) {
  const colors = doc.overview.colors ?? [];
  const adopt = yarnAdoption(doc);
  return (
    <div className="palette-editor">
      <h2 className="section-title">Farben</h2>
      {colors.length === 0 ? (
        <p className="muted small">
          Noch keine Farben. Mit Farben zeigt das 3D-Modell Farbwechsel, und jede Runde kann die Farbe wechseln.
        </p>
      ) : (
        <ul className="palette-list">
          {colors.map((c, i) => (
            <li key={c.id} className="palette-row">
              <ColorFields doc={doc} color={c} index={i} dispatch={dispatch} />
            </li>
          ))}
        </ul>
      )}
      <span className="palette-editor-actions">
        <AddColorButton doc={doc} dispatch={dispatch} />
        {adopt && (
          <button
            type="button"
            className="btn btn-small btn-quiet"
            title={adopt.title}
            onClick={() => dispatch(adopt.action)}
          >
            Als Garn in die Materialliste übernehmen
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Palette names missing from the yarn of the material list, as one edit: added to the first
 * yarn's colours, or a new yarn "Garn" with them. Null when every name is already listed.
 */
export function yarnAdoption(doc: BuilderDoc): { action: EditorAction; title: string } | null {
  const names = (doc.overview.colors ?? []).map((c, i) => colorName(c, i));
  const materials = doc.overview.materials ?? [];
  const listed = new Set(
    materials.filter((m) => m.kind === "yarn").flatMap((m) => (m.colors ?? []).map((c) => c.trim().toLowerCase())),
  );
  const missing = names.filter((n) => !listed.has(n.toLowerCase()));
  if (missing.length === 0) return null;
  const yarnIndex = materials.findIndex((m) => m.kind === "yarn");
  const yarn = materials[yarnIndex];
  if (yarn) {
    return {
      action: { type: "updateMaterial", index: yarnIndex, material: { ...yarn, colors: [...(yarn.colors ?? []), ...missing] } },
      title: `${missing.join(", ")} bei „${yarn.label.trim() || "Garn"}“ als Farben eintragen`,
    };
  }
  return {
    action: { type: "addMaterial", material: { kind: "yarn", label: "Garn", colors: missing } },
    title: `Garn mit den Farben ${missing.join(", ")} in die Materialliste eintragen`,
  };
}
