/**
 * "Montage" mode of the preview pane: the assembled 3D view plus the placement list.
 *
 * Creating a placement takes two clicks: "+ Annähen" (the part shown in the editor is
 * preselected) or "+ Augen", then a click on the target in the 3D view — the round under the
 * pointer lights up, the click sets target, row and angle. Escape cancels. Every edit goes
 * through the editor reducer (one undo step); small fields fine-tune row, angle, spacing and
 * size afterwards.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import type { AssemblyFinding, MeshStyle, Placement } from "@crochetbuilder/engine";
import { ViewBoundary, ViewError, ViewLoadError } from "../components/PreviewPane.js";
import { NumberField } from "../components/fields.js";
import { nextPlacementId, type AssemblyAction } from "../state/assembly.js";
import type { BuilderDoc } from "../state/document.js";
import type { EditorAction } from "../state/editor.js";
import { partName } from "../state/parts.js";
import type { PickResult } from "../three/mapping.js";
import type { AssemblyCanvasProps } from "./AssemblyCanvas.js";
import { rowKey, scenePick, sceneSize, type CombinedScene, type ScenePick } from "./combine.js";
import { useAssemblyScene, type AssemblySceneOptions } from "./useAssemblyScene.js";
import { partIndexById, placementText, rowPositionText } from "./wording.js";
import "./assembly.css";

export type AssemblyCanvasLoader = () => Promise<{ default: ComponentType<AssemblyCanvasProps> }>;

export const loadAssemblyCanvas: AssemblyCanvasLoader = () =>
  import("./AssemblyCanvas.js").catch((err: unknown) => {
    throw new ViewLoadError(err);
  });

/** Defaults of a new pair of safety eyes. */
export const DEFAULT_EYE_SIZE_MM = 10;
export const DEFAULT_EYE_SPACING = 6;
export const DEFAULT_MARK_SIZE_MM = 4;

/** What a click in the 3D view will set. */
export type PlacingMode =
  | { kind: "attach"; part: number }
  | { kind: "eyes" }
  | { kind: "embroidery" }
  /** Set an existing placement anew (target, row, angle). */
  | { kind: "move"; id: string };

export interface AssemblyWorkspaceProps {
  doc: BuilderDoc;
  dispatch: (action: EditorAction) => void;
  /** Part shown in the editor: preselected for "+ Annähen". */
  selectedPart: number;
  style: MeshStyle;
  showGrid: boolean;
  backing: number;
  resetToken: number;
  /** Read-only (the viewer): no list editing, no placing. */
  readOnly?: boolean;
  sceneOptions?: AssemblySceneOptions;
  loadCanvas?: AssemblyCanvasLoader;
}

const cm = (valueMm: number) => (valueMm / 10).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** German text of an assembly finding. */
export function assemblyFindingText(f: AssemblyFinding): string {
  switch (f.code) {
    case "UNKNOWN_TARGET":
      return "Das Zielteil gibt es nicht mehr.";
    case "UNKNOWN_PART":
      return "Das angenähte Teil gibt es nicht mehr.";
    case "MISSING_PART":
      return "Es fehlt, welches Teil angenäht wird.";
    case "UNKNOWN_ROW":
      return "Die Runde gibt es im Zielteil nicht (mehr).";
    case "SELF_ATTACH":
      return "Ein Teil kann nicht an sich selbst genäht werden.";
    case "CYCLE":
      return "Die Teile sind gegenseitig aneinander genäht – eines davon muss das Zielteil sein. Sie stehen daneben.";
    case "NO_MODEL":
      return "Für das Teil gibt es noch kein Modell (keine Maschen oder zu viele).";
    case "EXTRA_PLACEMENT":
      return "Mehr Platzierungen als Teile – diese wird nicht gezeigt.";
  }
}

/** The action of a pick in placing mode, or null when the pick does not fit the mode. */
export function placementForPick(doc: BuilderDoc, mode: PlacingMode, pick: ScenePick): EditorAction | null {
  if (mode.kind === "move") {
    const p = (doc.assembly ?? []).find((x) => x.id === mode.id);
    if (!p) return null;
    if (p.kind === "attach" && partIndexById(doc, p.part) === pick.part) return null;
    return { type: "updatePlacement", id: p.id, patch: { target: pick.part, row: pick.rowId, angle: pick.angleDeg } };
  }
  if (mode.kind === "attach") {
    if (pick.part === mode.part) return null;
    const name = partName(doc.parts[mode.part]?.name ?? "", mode.part);
    return {
      type: "addPlacement",
      placement: { id: nextPlacementId(doc, name), kind: "attach", part: mode.part, target: pick.part, row: pick.rowId, angle: pick.angleDeg },
    };
  }
  const eyes = mode.kind === "eyes";
  return {
    type: "addPlacement",
    placement: {
      id: nextPlacementId(doc, eyes ? "Augen" : "Stickerei"),
      kind: mode.kind,
      target: pick.part,
      row: pick.rowId,
      angle: pick.angleDeg,
      ...(eyes ? { spacing: DEFAULT_EYE_SPACING, size: DEFAULT_EYE_SIZE_MM } : { size: DEFAULT_MARK_SIZE_MM }),
    },
  };
}

/** The instruction shown while placing. */
function placingHint(doc: BuilderDoc, mode: PlacingMode): string {
  switch (mode.kind) {
    case "attach":
      return `Klicke im 3D-Bild auf die Stelle, an die ${partName(doc.parts[mode.part]?.name ?? "", mode.part)} genäht wird.`;
    case "eyes":
      return "Klicke im 3D-Bild auf die Stelle zwischen den Augen.";
    case "embroidery":
      return "Klicke im 3D-Bild auf die Stelle für die Stickerei.";
    case "move":
      return "Klicke im 3D-Bild auf die neue Stelle.";
  }
}

export function AssemblyWorkspace({
  doc,
  dispatch,
  selectedPart,
  style,
  showGrid,
  backing,
  resetToken,
  readOnly = false,
  sceneOptions,
  loadCanvas = loadAssemblyCanvas,
}: AssemblyWorkspaceProps) {
  const scene = useAssemblyScene(doc, style, sceneOptions);
  const [placing, setPlacing] = useState<PlacingMode | null>(null);
  const [hover, setHover] = useState<ScenePick | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [webgl, setWebgl] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const Canvas = useMemo(() => lazy(loadCanvas), [loadCanvas, attempt]);
  const combined = scene.combined;

  const cancel = useCallback(() => {
    setPlacing(null);
    setHover(null);
  }, []);
  useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing, cancel]);

  const valid = useCallback(
    (pick: ScenePick | null): pick is ScenePick => {
      if (!pick || !placing) return false;
      return placementForPick(doc, placing, pick) !== null;
    },
    [doc, placing],
  );
  const onHover = useCallback(
    (hit: PickResult | null) => {
      const pick = hit && combined ? scenePick(combined, hit) : null;
      setHover(valid(pick) ? pick : null);
    },
    [combined, valid],
  );
  const onPick = useCallback(
    (hit: PickResult) => {
      if (!placing || !combined) return;
      const pick = scenePick(combined, hit);
      if (!pick) return;
      const action = placementForPick(doc, placing, pick);
      if (!action) return;
      dispatch(action);
      setEditing(action.type === "addPlacement" ? action.placement.id : (action as Extract<AssemblyAction, { type: "updatePlacement" }>).id);
      cancel();
    },
    [placing, combined, doc, dispatch, cancel],
  );

  const highlight = hover ? [rowKey(hover.instance, hover.rowId)] : [];
  const size = combined ? sceneSize(combined) : null;
  const findingsOf = (id: string) => scene.scene?.findings.filter((f) => f.placementId === id) ?? [];
  const parts = doc.parts;

  let overlay: ReactNode = null;
  if (!webgl) overlay = <Message title="3D-Ansicht nicht verfügbar">Dein Browser kann hier kein WebGL anzeigen.</Message>;
  else if (scene.status === "pending") overlay = <Message>Montage wird berechnet …</Message>;
  else if (scene.status === "error") overlay = <Message title="Montage konnte nicht berechnet werden">{scene.error}</Message>;
  else if (!combined) overlay = <Message title="Noch nichts zu zeigen">Die Teile haben noch keine Maschen.</Message>;

  return (
    <div className="assembly-workspace">
      <div className={`model-stage${placing ? " is-placing" : ""}`} data-testid="assembly-stage">
        {webgl && combined && (
          <ViewBoundary key={attempt} fallback={(error) => <ViewError error={error} onRetry={() => setAttempt((a) => a + 1)} />}>
            <Suspense fallback={<Message>Lade 3D-Ansicht …</Message>}>
              <Canvas
                combined={combined}
                highlight={highlight}
                showGrid={showGrid}
                backing={backing}
                resetToken={resetToken}
                picking={placing !== null}
                onHover={onHover}
                onPick={onPick}
                onUnavailable={() => setWebgl(false)}
              />
            </Suspense>
          </ViewBoundary>
        )}
        {overlay}
        {placing && (
          <div className="assembly-hint" role="status">
            <span>
              {placingHint(doc, placing)}
              {hover && <strong> {rowPositionText(doc, parts[hover.part]?.id ?? "", hover.rowId).replace(/^auf /, "")}</strong>}
              {hover && <span className="muted"> · {hover.angleDeg}°</span>}
            </span>
            <button type="button" className="btn btn-small" onClick={cancel}>
              Abbrechen <span className="muted">(Esc)</span>
            </button>
          </div>
        )}
      </div>
      <p className="model-dims" aria-label="Maße der Montage">
        {size ? (
          <span>
            <span className="muted">Zusammengesetzt B × H × T</span> {cm(size.width)} × {cm(size.height)} × {cm(size.depth)} cm
          </span>
        ) : (
          <span className="muted">Montage aller Teile</span>
        )}
        {scene.computing && <span className="muted">berechne …</span>}
      </p>

      <section className="assembly-list" aria-labelledby="assembly-title">
        <h2 id="assembly-title" className="section-title">
          Montage
        </h2>
        {!readOnly && (
          <div className="assembly-actions">
            {placing?.kind === "attach" ? (
              <label className="assembly-part-pick">
                Teil
                <select
                  value={placing.part}
                  onChange={(e) => setPlacing({ kind: "attach", part: Number(e.target.value) })}
                  aria-label="Welches Teil wird angenäht?"
                >
                  {parts.map((p, i) => (
                    <option key={i} value={i}>
                      {partName(p.name, i)}
                      {p.quantity > 1 ? ` ×${p.quantity}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <button
                type="button"
                className="btn btn-small"
                disabled={parts.length < 2}
                title={parts.length < 2 ? "Erst ein zweites Teil anlegen" : "Ein Teil an ein anderes nähen: Teil wählen, dann im 3D-Bild auf die Stelle klicken"}
                onClick={() => setPlacing({ kind: "attach", part: Math.min(selectedPart, parts.length - 1) })}
              >
                + Annähen
              </button>
            )}
            <button
              type="button"
              className="btn btn-small"
              aria-pressed={placing?.kind === "eyes"}
              onClick={() => setPlacing(placing?.kind === "eyes" ? null : { kind: "eyes" })}
            >
              + Augen
            </button>
            <button
              type="button"
              className="btn btn-small"
              aria-pressed={placing?.kind === "embroidery"}
              onClick={() => setPlacing(placing?.kind === "embroidery" ? null : { kind: "embroidery" })}
            >
              + Stickerei
            </button>
          </div>
        )}
        {(doc.assembly ?? []).length === 0 ? (
          <p className="muted small">
            Noch keine Montage. „+ Annähen“ setzt ein Teil an ein anderes (z. B. Ohren an den Kopf), „+ Augen“ die
            Sicherheitsaugen – jeweils mit einem Klick ins 3D-Bild.
          </p>
        ) : (
          <ul className="placement-list">
            {(doc.assembly ?? []).map((p) => (
              <PlacementItem
                key={p.id}
                doc={doc}
                placement={p}
                findings={findingsOf(p.id)}
                readOnly={readOnly}
                open={editing === p.id}
                moving={placing?.kind === "move" && placing.id === p.id}
                onToggle={() => setEditing((e) => (e === p.id ? null : p.id))}
                onMove={() => setPlacing({ kind: "move", id: p.id })}
                dispatch={dispatch}
              />
            ))}
          </ul>
        )}
        {(doc.assembly ?? []).length > 0 && (
          <p className="muted small">
            Zwei gleiche Teile mit einer Platzierung werden gespiegelt angenäht (Winkel ±). Winkel 0° ist vorne, positiv nach
            rechts (von vorne gesehen).
          </p>
        )}
      </section>
    </div>
  );
}

function Message({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="model-message">
      {title && <span className="model-message-title">{title}</span>}
      <span>{children}</span>
    </div>
  );
}

/** Stitch rows of a part (the "Runde" field counts these). */
function stitchRows(doc: BuilderDoc, partIndex: number) {
  return (doc.parts[partIndex]?.content.rows ?? []).filter((r) => r.ops.length > 0);
}

interface PlacementItemProps {
  doc: BuilderDoc;
  placement: Placement;
  findings: readonly AssemblyFinding[];
  readOnly: boolean;
  open: boolean;
  moving: boolean;
  onToggle: () => void;
  onMove: () => void;
  dispatch: (action: EditorAction) => void;
}

function PlacementItem({ doc, placement: p, findings, readOnly, open, moving, onToggle, onMove, dispatch }: PlacementItemProps) {
  const target = partIndexById(doc, p.target);
  const rows = target < 0 ? [] : stitchRows(doc, target);
  const round = rows.findIndex((r) => r.id === p.row) + 1;
  const update = (patch: Extract<AssemblyAction, { type: "updatePlacement" }>["patch"]) =>
    dispatch({ type: "updatePlacement", id: p.id, patch });
  const label = placementText(doc, p);
  const fieldId = (name: string) => `placement-${p.id}-${name}`;
  return (
    <li className={`placement-item${moving ? " is-moving" : ""}`} data-placement={p.id}>
      <div className="placement-line">
        <span className="placement-text">{label}</span>
        {!readOnly && (
          <span className="placement-tools">
            <button type="button" className="btn btn-small btn-quiet" aria-expanded={open} onClick={onToggle} aria-label={`Ändern: ${label}`}>
              Ändern
            </button>
            <button
              type="button"
              className="btn btn-small btn-quiet btn-danger"
              onClick={() => dispatch({ type: "removePlacement", id: p.id })}
              aria-label={`Entfernen: ${label}`}
            >
              Entfernen
            </button>
          </span>
        )}
      </div>
      {findings.map((f, i) => (
        <p key={i} className="placement-finding" role="note">
          {assemblyFindingText(f)}
        </p>
      ))}
      {open && !readOnly && (
        <div className="placement-fields">
          <label htmlFor={fieldId("round")}>
            Runde
            <NumberField
              id={fieldId("round")}
              className="placement-number"
              value={round > 0 ? round : undefined}
              min={1}
              max={Math.max(1, rows.length)}
              onValue={(n) => {
                const row = n === undefined ? undefined : rows[n - 1];
                if (row) update({ row: row.id });
              }}
            />
          </label>
          <label htmlFor={fieldId("angle")}>
            Winkel °
            <AngleField id={fieldId("angle")} value={p.angle} onValue={(angle) => update({ angle })} />
          </label>
          {p.kind === "eyes" && (
            <label htmlFor={fieldId("spacing")}>
              Abstand (M)
              <NumberField
                id={fieldId("spacing")}
                className="placement-number"
                value={p.spacing ?? 0}
                min={0}
                max={99}
                decimal
                onValue={(n) => update({ spacing: n === undefined || n === 0 ? null : n })}
              />
            </label>
          )}
          {p.kind !== "attach" && (
            <label htmlFor={fieldId("size")}>
              Größe (mm)
              <NumberField
                id={fieldId("size")}
                className="placement-number"
                value={p.size}
                min={1}
                max={100}
                decimal
                allowEmpty
                onValue={(n) => update({ size: n ?? null })}
              />
            </label>
          )}
          <label htmlFor={fieldId("note")} className="placement-note">
            Hinweis
            <input id={fieldId("note")} type="text" value={p.note ?? ""} placeholder="z. B. flach annähen" onChange={(e) => update({ note: e.target.value })} />
          </label>
          <button type="button" className="btn btn-small" onClick={onMove} aria-pressed={moving}>
            Im 3D-Bild neu setzen
          </button>
        </div>
      )}
    </li>
  );
}

/** Whole degrees, negative allowed ("−30" with a typographic minus too); ↑/↓ step 5°. */
export function parseAngle(text: string): number | null {
  const t = text.trim().replace("−", "-").replace(",", ".").replace(/°$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= -180 && n <= 180 ? n : null;
}

function AngleField({ id, value, onValue }: { id: string; value: number; onValue: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft !== null && parseAngle(draft) !== value ? draft : String(value);
  const invalid = draft !== null && draft.trim() !== "" && draft.trim() !== "-" && parseAngle(draft) === null;
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className="number-field placement-number"
      aria-invalid={invalid || undefined}
      title="−180 bis 180; 0 = vorne, positiv nach rechts"
      value={draft ?? shown}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parseAngle(e.target.value);
        if (n !== null) onValue(n);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        let next = value + (e.key === "ArrowUp" ? 5 : -5);
        if (next > 180) next -= 360;
        if (next <= -180) next += 360;
        setDraft(null);
        onValue(next);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export type { CombinedScene };
