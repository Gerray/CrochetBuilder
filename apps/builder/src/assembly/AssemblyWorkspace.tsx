/**
 * "Montage" mode of the preview pane: the assembled 3D view plus the placement list.
 *
 * Creating a placement takes two clicks: "+ Annähen" (the part shown in the editor is
 * preselected) or "+ Augen", then a click on the target in the 3D view — the round where the
 * placement will land lights up, the click sets target, row and angle. Without a mouse the
 * small form under the buttons does the same (Zielteil, Runde, Winkel, "Setzen"). Escape
 * cancels. Every edit goes through the editor reducer (one undo step); small fields
 * fine-tune target, row, angle, spacing and size afterwards.
 *
 * Placements always sit on copy 1 of their target (the format has no copy field): a click on
 * a further copy lands on copy 1 — highlighted there, mirrored when the copy is a mirror.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import type { AssemblyFinding, MeshStyle, Placement } from "@crochetbuilder/engine";
import { ViewBoundary, ViewError, ViewLoadError } from "../components/PreviewPane.js";
import { NumberField } from "../components/fields.js";
import { nextPlacementId, type AssemblyAction } from "../state/assembly.js";
import type { BuilderDoc } from "../state/document.js";
import type { EditorAction } from "../state/editor.js";
import { paletteColors } from "../state/palette.js";
import { partName } from "../state/parts.js";
import type { PickResult } from "../three/mapping.js";
import type { AssemblyCanvasProps } from "./AssemblyCanvas.js";
import { rowKey, scenePick, sceneSize, type CombinedScene, type ScenePick } from "./combine.js";
import type { UnjoinedComponent } from "./compute.js";
import { useAssemblyScene, type AssemblySceneOptions } from "./useAssemblyScene.js";
import { partIndexById, placementText, rowPositionText, rowWord } from "./wording.js";
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

/** What a click in the 3D view will set (parts by index, resolved at the moment of use). */
export type PlacingMode =
  | { kind: "attach"; part: number }
  | { kind: "eyes" }
  | { kind: "embroidery" }
  /** Set an existing placement anew (target, row, angle). */
  | { kind: "move"; id: string };

/**
 * The placing state as the component keeps it: the part being attached by its id, or — for a
 * part without an id yet — by the part object, never by its index (parts may move meanwhile).
 */
type PlacingState =
  | { kind: "attach"; partId: string | undefined; partRef: BuilderDoc["parts"][number] }
  | Exclude<PlacingMode, { kind: "attach" }>;

/** Index of the part a placing state attaches, or -1 when it is gone. */
export function attachedIndex(doc: BuilderDoc, state: { partId: string | undefined; partRef: BuilderDoc["parts"][number] }): number {
  if (state.partId !== undefined) return doc.parts.findIndex((p) => p.id === state.partId);
  return doc.parts.indexOf(state.partRef);
}

function attachState(doc: BuilderDoc, index: number): PlacingState {
  const part = doc.parts[index]!;
  return { kind: "attach", partId: part.id, partRef: part };
}

/** The mode of a placing state for the current document (null when its part is gone). */
function modeOf(doc: BuilderDoc, state: PlacingState): PlacingMode | null {
  if (state.kind !== "attach") return state;
  const part = attachedIndex(doc, state);
  return part < 0 ? null : { kind: "attach", part };
}

export interface AssemblyWorkspaceProps {
  doc: BuilderDoc;
  dispatch: (action: EditorAction) => void;
  /** Part shown in the editor: preselected for "+ Annähen". */
  selectedPart: number;
  style: MeshStyle;
  showGrid: boolean;
  backing: number;
  resetToken: number;
  /** Read-only (the viewer): only the assembled view, no list and no placing. */
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
      return "Diese Teile sind im Kreis aneinander genäht – eines muss frei bleiben. Sie stehen daneben.";
    case "NO_MODEL":
      return "Für das Teil gibt es kein Modell in der Montage (keine Maschen, zu viele, oder über der Grenze der Montage).";
    case "EXTRA_PLACEMENT":
      return "Mehr Platzierungen als Teile – diese wird nicht gezeigt.";
    case "MIRROR_OVERLAP":
      return "Beide Kopien landen an derselben Stelle (0°, 180° oder mittig auf dem Ende) – Winkel ändern oder für jede Kopie eine eigene Platzierung anlegen.";
    case "JOINED":
      return "Das Teil wird beim Häkeln mit einem anderen verbunden – dort sitzt es; diese Platzierung wird nicht verwendet.";
  }
}

/** Why parts crocheted together are shown without their joins. */
export function unjoinedText(reason: UnjoinedComponent["reason"]): string {
  switch (reason) {
    case "cycle":
      return "Diese Teile werden im Kreis ineinander gehäkelt";
    case "overBudget":
      return "Zu viele Maschen für die gemeinsame Form";
    case "empty":
      return "Ein verbundenes Teil hat noch keine Maschen";
    case "invalid":
      return "Die gemeinsame Form ließ sich nicht berechnen";
  }
}

/** The action of a pick in placing mode, or null when the pick does not fit the mode. */
export function placementForPick(doc: BuilderDoc, mode: PlacingMode, pick: Pick<ScenePick, "part" | "rowId" | "angleDeg">): EditorAction | null {
  if (mode.kind === "move") {
    const p = (doc.assembly ?? []).find((x) => x.id === mode.id);
    if (!p) return null;
    if (p.kind === "attach" && partIndexById(doc, p.part) === pick.part) return null;
    return { type: "updatePlacement", id: p.id, patch: { target: pick.part, row: pick.rowId, angle: pick.angleDeg } };
  }
  if (mode.kind === "attach") {
    if (pick.part === mode.part || !doc.parts[mode.part]) return null;
    const name = partName(doc.parts[mode.part]!.name, mode.part);
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

/** Whether the placement will be drawn twice, the second copy mirrored. */
function mirroredOnPlace(doc: BuilderDoc, mode: PlacingMode): boolean {
  if (mode.kind === "attach") return (doc.parts[mode.part]?.quantity ?? 1) >= 2;
  if (mode.kind === "move") {
    const p = (doc.assembly ?? []).find((x) => x.id === mode.id);
    const i = partIndexById(doc, p?.part);
    return p?.kind === "attach" && i >= 0 && doc.parts[i]!.quantity >= 2;
  }
  return false;
}

/**
 * Where a pick will really land, as combined row keys to highlight: the row on copy 1 of the
 * target, and on its copy 2 too when a mirrored second copy of the part goes there.
 */
export function landingKeys(combined: CombinedScene, pick: ScenePick, mirrored: boolean): string[] {
  const at = (copy: number) => combined.ranges.find((r) => r.part === pick.part && r.copy === copy);
  const first = at(0);
  if (!first) return [];
  const keys = [rowKey(first.instance, pick.rowId)];
  const second = mirrored ? at(1) : undefined;
  if (second) keys.push(rowKey(second.instance, pick.rowId));
  return keys;
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

/**
 * Where the pointer is, for the hint: rows as in the list. Parts without an id yet (nothing
 * placed on them so far) are looked up by index.
 */
function hoverPosition(doc: BuilderDoc, part: number, rowId: string): string {
  const p = doc.parts[part];
  if (!p) return "";
  const withId = p.id !== undefined ? doc : { ...doc, parts: doc.parts.map((q, i) => (i === part ? { ...q, id: "\u0000" } : q)) };
  return rowPositionText(withId, withId.parts[part]!.id!, rowId).replace(/^auf /, "");
}

/** Stitch rows of a part (the "Runde" fields count these). */
function stitchRows(doc: BuilderDoc, partIndex: number) {
  return (doc.parts[partIndex]?.content.rows ?? []).filter((r) => r.ops.length > 0);
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
  const [placingState, setPlacingState] = useState<PlacingState | null>(null);
  const [hover, setHover] = useState<ScenePick | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Read out once when a placement is set (the hover hint is not a live region). */
  const [announcement, setAnnouncement] = useState("");
  const [webgl, setWebgl] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const Canvas = useMemo(() => lazy(loadCanvas), [loadCanvas, attempt]);
  const combined = scene.combined;
  const placing = placingState ? modeOf(doc, placingState) : null;
  // Yarn colours by palette id, as in the part preview.
  const palette = doc.overview.colors;
  const colors = useMemo(() => paletteColors(palette ?? []), [palette]);

  const cancel = useCallback(() => {
    setPlacingState(null);
    setHover(null);
    setNotice(null);
  }, []);
  // The part being attached was deleted meanwhile: stop placing.
  useEffect(() => {
    if (placingState && !placing) cancel();
  }, [placingState, placing, cancel]);
  useEffect(() => {
    if (!placingState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placingState, cancel]);

  const apply = useCallback(
    (action: EditorAction) => {
      dispatch(action);
      const id = action.type === "addPlacement" ? action.placement.id : (action as Extract<AssemblyAction, { type: "updatePlacement" }>).id;
      setEditing(id);
      setAnnouncement(action.type === "addPlacement" ? "Platzierung gesetzt." : "Platzierung neu gesetzt.");
      cancel();
    },
    [dispatch, cancel],
  );

  const onHover = useCallback(
    (hit: PickResult | null) => {
      const pick = hit && combined ? scenePick(combined, hit) : null;
      setHover(pick && placing && placementForPick(doc, placing, pick) ? pick : null);
    },
    [combined, doc, placing],
  );
  const onPick = useCallback(
    (hit: PickResult) => {
      if (!placing || !combined) return;
      // The view may still show the document before the last edit: never place on it.
      if (scene.computing) {
        setNotice("Die Montage wird gerade neu berechnet – bitte gleich noch einmal klicken.");
        return;
      }
      const pick = scenePick(combined, hit);
      const action = pick ? placementForPick(doc, placing, pick) : null;
      if (action) apply(action);
    },
    [placing, combined, scene.computing, doc, apply],
  );

  const mirrored = placing ? mirroredOnPlace(doc, placing) : false;
  const highlight = hover && combined ? landingKeys(combined, hover, mirrored) : [];
  const size = combined ? sceneSize(combined) : null;
  const findingsOf = (id: string) => scene.scene?.findings.filter((f) => f.placementId === id) ?? [];
  const parts = doc.parts;
  const skipped = scene.parts.filter((p) => p.status === "skipped").map((p) => partName(parts[p.part]?.name ?? "", p.part));
  const unjoined = scene.unjoined.map((u) => ({ ...u, names: u.parts.map((i) => partName(parts[i]?.name ?? "", i)).join(", ") }));

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
                colors={colors}
              />
            </Suspense>
          </ViewBoundary>
        )}
        {overlay}
        {placing && (
          <div className="assembly-hint">
            <span>
              {notice ?? placingHint(doc, placing)}
              {hover && (
                <strong className="assembly-hover">
                  {" "}
                  {partName(parts[hover.part]?.name ?? "", hover.part)}: {hoverPosition(doc, hover.part, hover.rowId)}
                </strong>
              )}
              {hover && <span className="muted"> · {hover.angleDeg}°</span>}
              {hover && hover.copy > 0 && (
                <span className="assembly-copy-note">
                  {" "}
                  – wird an Kopie 1 gesetzt{mirrored ? ", die zweite wird gespiegelt" : ""}
                </span>
              )}
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
      {skipped.length > 0 && (
        <p className="model-note assembly-skipped" role="note">
          Zu viele Maschen für die Montage – nicht gezeigt: {skipped.join(", ")} (höchstens{" "}
          {scene.maxTotal.toLocaleString("de-DE")} Maschen zusammen).
        </p>
      )}
      {unjoined.map((u) => (
        <p key={u.parts.join(",")} className="model-note assembly-unjoined" role="note">
          {unjoinedText(u.reason)} – ohne Verbindung gezeigt: {u.names}.
        </p>
      ))}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {/* Read-only (the viewer) lists the placements with the pattern text instead. */}
      {!readOnly && (
        <section className="assembly-list" aria-labelledby="assembly-title">
          <h2 id="assembly-title" className="section-title">
            Montage
          </h2>
          <div className="assembly-actions">
            {placing?.kind === "attach" ? (
              <label className="assembly-part-pick">
                Teil
                <select
                  value={placing.part}
                  onChange={(e) => setPlacingState(attachState(doc, Number(e.target.value)))}
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
                onClick={() => setPlacingState(attachState(doc, Math.min(selectedPart, parts.length - 1)))}
              >
                + Annähen
              </button>
            )}
            <button
              type="button"
              className="btn btn-small"
              aria-pressed={placing?.kind === "eyes"}
              onClick={() => (placing?.kind === "eyes" ? cancel() : setPlacingState({ kind: "eyes" }))}
            >
              + Augen
            </button>
            <button
              type="button"
              className="btn btn-small"
              aria-pressed={placing?.kind === "embroidery"}
              onClick={() => (placing?.kind === "embroidery" ? cancel() : setPlacingState({ kind: "embroidery" }))}
            >
              + Stickerei
            </button>
          </div>
          {placing && <PlacingForm key={JSON.stringify(placing)} doc={doc} mode={placing} onSet={apply} />}
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
                  open={editing === p.id}
                  moving={placing?.kind === "move" && placing.id === p.id}
                  onToggle={() => setEditing((e) => (e === p.id ? null : p.id))}
                  onMove={() => setPlacingState({ kind: "move", id: p.id })}
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
      )}
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

/** Target parts a mode can place on (not the part being attached). */
function targetsFor(doc: BuilderDoc, mode: PlacingMode): number[] {
  let own = -1;
  if (mode.kind === "attach") own = mode.part;
  if (mode.kind === "move") {
    const p = (doc.assembly ?? []).find((x) => x.id === mode.id);
    if (p?.kind === "attach") own = partIndexById(doc, p.part);
  }
  return doc.parts.map((_, i) => i).filter((i) => i !== own && stitchRows(doc, i).length > 0);
}

/** The keyboard way to place: target, row and angle, then "Setzen". */
function PlacingForm({ doc, mode, onSet }: { doc: BuilderDoc; mode: PlacingMode; onSet: (action: EditorAction) => void }) {
  const targets = targetsFor(doc, mode);
  const [target, setTarget] = useState(targets[0] ?? -1);
  const rows = stitchRows(doc, target);
  const [round, setRound] = useState(Math.max(1, Math.ceil(rows.length / 2)));
  const [angle, setAngle] = useState(0);
  if (targets.length === 0) return null;
  const row = rows[Math.min(round, rows.length) - 1];
  const word = rowWord(doc, target);
  return (
    <form
      className="placement-fields placing-form"
      aria-label="Platzierung ohne Maus setzen"
      onSubmit={(e) => {
        e.preventDefault();
        if (!row) return;
        const action = placementForPick(doc, mode, { part: target, rowId: row.id, angleDeg: angle });
        if (action) onSet(action);
      }}
    >
      <label>
        Zielteil
        <select
          value={target}
          onChange={(e) => {
            const t = Number(e.target.value);
            setTarget(t);
            setRound((r) => Math.min(r, Math.max(1, stitchRows(doc, t).length)));
          }}
        >
          {targets.map((i) => (
            <option key={i} value={i}>
              {partName(doc.parts[i]!.name, i)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {word}
        <NumberField className="placement-number" value={round} min={1} max={Math.max(1, rows.length)} onValue={(n) => n !== undefined && setRound(n)} />
      </label>
      <label>
        Winkel °
        <AngleField value={angle} onValue={setAngle} />
      </label>
      <button type="submit" className="btn btn-small btn-primary">
        Setzen
      </button>
    </form>
  );
}

interface PlacementItemProps {
  doc: BuilderDoc;
  placement: Placement;
  findings: readonly AssemblyFinding[];
  open: boolean;
  moving: boolean;
  onToggle: () => void;
  onMove: () => void;
  dispatch: (action: EditorAction) => void;
}

function PlacementItem({ doc, placement: p, findings, open, moving, onToggle, onMove, dispatch }: PlacementItemProps) {
  const target = partIndexById(doc, p.target);
  const rows = target < 0 ? [] : stitchRows(doc, target);
  const round = rows.findIndex((r) => r.id === p.row) + 1;
  const update = (patch: Extract<AssemblyAction, { type: "updatePlacement" }>["patch"]) =>
    dispatch({ type: "updatePlacement", id: p.id, patch });
  const label = placementText(doc, p);
  const fieldId = (name: string) => `placement-${p.id}-${name}`;
  const own = p.kind === "attach" ? partIndexById(doc, p.part) : -1;
  const targets = doc.parts.map((_, i) => i).filter((i) => i !== own && stitchRows(doc, i).length > 0);
  return (
    <li className={`placement-item${moving ? " is-moving" : ""}`} data-placement={p.id}>
      <div className="placement-line">
        <span className="placement-text">{label}</span>
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
      </div>
      {findings.map((f, i) => (
        <p key={i} className="placement-finding" role="note">
          {assemblyFindingText(f)}
        </p>
      ))}
      {open && (
        <div className="placement-fields">
          <label htmlFor={fieldId("target")}>
            Zielteil
            <select
              id={fieldId("target")}
              value={target}
              onChange={(e) => {
                const t = Number(e.target.value);
                const next = stitchRows(doc, t);
                const row = next[Math.min(Math.max(round, 1), next.length) - 1];
                if (row) update({ target: t, row: row.id });
              }}
            >
              {target < 0 && <option value={-1}>?</option>}
              {targets.map((i) => (
                <option key={i} value={i}>
                  {partName(doc.parts[i]!.name, i)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={fieldId("round")}>
            {target < 0 ? "Runde" : rowWord(doc, target)}
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

function AngleField({ id, value, onValue }: { id?: string; value: number; onValue: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
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
      value={draft ?? String(value)}
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
