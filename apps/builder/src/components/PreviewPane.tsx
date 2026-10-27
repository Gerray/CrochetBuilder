import { Component, lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import {
  computeRowStitches,
  resolveGauge,
  type Finding,
  type Gauge,
  type MeshStyle,
  type PartContent,
} from "@crochetbuilder/engine";
import { usePreviewModel, type PreviewOptions, type PreviewState } from "../preview/usePreviewModel.js";
import { displayRowLabels } from "../state/labels.js";
import { findingMessage } from "../state/messages.js";

// Three.js is large: load the 3D view after the editor has painted.
const ModelCanvas = lazy(() => import("../three/ModelCanvas.js"));

/**
 * Props of the right-hand pane: the live 3D preview of `content` (built off the main
 * thread), its real size, key figures and the findings list.
 */
export interface PreviewPaneProps {
  /** The part being edited (MVP: `parts[0].content`). */
  content: PartContent;
  /** Gauge from the document overview (may be empty → engine defaults). */
  gauge: Gauge | undefined;
  /** `validate(content)`, in document order. */
  findings: readonly Finding[];
  /** Row selected in the editor — highlighted in the model. */
  selectedRowId: string | null;
  /** Select and focus a row in the editor (finding click, stitch click in the model). */
  onSelectRow: (rowId: string) => void;
  /** Preview computation options (tests: a fake client, no debounce). */
  previewOptions?: PreviewOptions;
}

const mm = (value: number) => value.toLocaleString("de-DE", { maximumFractionDigits: 1 });
const cm = (valueMm: number) => (valueMm / 10).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const count = (value: number) => value.toLocaleString("de-DE");

const SOURCE_TEXT = {
  swatch: "aus der Maschenprobe",
  "yarn-weight": "geschätzt aus Garn und Nadel",
  default: "Standardwerte (DK, 4 mm) – Garn oder Maschenprobe angeben",
} as const;

const STYLES: Array<[MeshStyle, string, string]> = [
  ["surface", "Fläche", "Das Teil als geschlossene Fläche"],
  ["tube", "Garn", "Der Faden als Schlauch entlang des Arbeitswegs"],
  ["points", "Punkte", "Ein Punkt pro Masche"],
];

const STYLE_KEY = "crochetbuilder:preview-style";
const GRID_KEY = "crochetbuilder:preview-grid";

function readSetting<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeSetting(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // private mode: the setting just is not remembered
  }
}

/** Catches a failed lazy load or a crash inside the 3D view; the rest of the pane stays. */
class ViewBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function PreviewPane({ content, gauge, findings, selectedRowId, onSelectRow, previewOptions }: PreviewPaneProps) {
  const resolved = resolveGauge(gauge);
  const [style, setStyle] = useState<MeshStyle>(() =>
    readSetting<MeshStyle>(STYLE_KEY, ["surface", "tube", "points"], "tube"),
  );
  const [showGrid, setShowGrid] = useState(() => readSetting(GRID_KEY, ["on", "off"], "on") === "on");
  const [resetToken, setResetToken] = useState(0);
  const [webgl, setWebgl] = useState(true);
  const preview = usePreviewModel(content, gauge, style, previewOptions);

  const stats = useMemo(() => {
    const stitchRows = content.rows.filter((r) => r.ops.length > 0);
    return {
      rounds: stitchRows.filter((r) => r.type === "round").length,
      rows: stitchRows.filter((r) => r.type === "row").length,
      stitches: stitchRows.reduce((sum, r) => sum + computeRowStitches(r), 0),
    };
  }, [content]);
  const labels = useMemo(() => {
    const names = displayRowLabels(content.rows);
    return new Map(content.rows.map((r, i) => [r.id, names[i] ?? ""]));
  }, [content]);
  const rowsById = useMemo(() => new Map(content.rows.map((r) => [r.id, r])), [content]);
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;

  const onUnavailable = useCallback(() => setWebgl(false), []);
  const stale = preview.status === "overBudget" || preview.status === "error";
  const unavailable = <ModelMessage title="3D-Ansicht nicht verfügbar">Dein Browser kann hier kein WebGL anzeigen. Maße und Prüfung funktionieren trotzdem.</ModelMessage>;

  return (
    <aside className="preview-pane" aria-label="Vorschau">
      <section className="preview-slot model-panel" data-slot="3d-preview" aria-label="3D-Vorschau">
        <div className="model-toolbar">
          <div className="segmented segmented-small" role="radiogroup" aria-label="Darstellung">
            {STYLES.map(([value, label, title]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={style === value}
                title={title}
                onClick={() => {
                  setStyle(value);
                  writeSetting(STYLE_KEY, value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-small"
            aria-pressed={showGrid}
            title="1-cm-Raster zeigen oder ausblenden"
            onClick={() => {
              setShowGrid((g) => {
                writeSetting(GRID_KEY, g ? "off" : "on");
                return !g;
              });
            }}
          >
            1-cm-Raster
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={!preview.model || !webgl}
            onClick={() => setResetToken((t) => t + 1)}
          >
            Ansicht zurücksetzen
          </button>
          <span className="model-status" role="status" aria-live="polite">
            {preview.computing ? "berechne …" : ""}
          </span>
        </div>

        <div className={`model-stage${stale ? " is-stale" : ""}`}>
          {!webgl ? (
            unavailable
          ) : (
            preview.model && (
              <ViewBoundary fallback={unavailable}>
                <Suspense fallback={<ModelMessage>Lade 3D-Ansicht …</ModelMessage>}>
                  <ModelCanvas
                    mesh={preview.model}
                    highlightRowId={selectedRowId}
                    dimmed={stale}
                    showGrid={showGrid}
                    resetToken={resetToken}
                    onPickRow={onSelectRow}
                    onUnavailable={onUnavailable}
                  />
                </Suspense>
              </ViewBoundary>
            )
          )}
          <StageOverlay preview={preview} />
        </div>

        <Dimensions preview={preview} />
      </section>

      <section className="preview-section" aria-label="Kennzahlen">
        <dl className="stats">
          <div>
            <dt>Runden</dt>
            <dd>{stats.rounds}</dd>
          </div>
          <div>
            <dt>Reihen</dt>
            <dd>{stats.rows}</dd>
          </div>
          <div>
            <dt>Maschen</dt>
            <dd>{stats.stitches}</dd>
          </div>
          <div>
            <dt>Masche</dt>
            <dd>
              {mm(resolved.stitchWidthMm)} × {mm(resolved.stitchHeightMm)} mm
            </dd>
          </div>
        </dl>
        <p className="muted small">Maschengröße {SOURCE_TEXT[resolved.source]}.</p>
      </section>

      <section className="preview-section" aria-labelledby="findings-title">
        <h2 id="findings-title" className="section-title">
          Prüfung
          {findings.length > 0 && (
            <span className="badge">
              {errors > 0 && `${errors} Fehler`}
              {errors > 0 && warnings > 0 && " · "}
              {warnings > 0 && `${warnings} ${warnings === 1 ? "Hinweis" : "Hinweise"}`}
            </span>
          )}
        </h2>
        {findings.length === 0 ? (
          <p className="all-good">Keine Befunde – Maschenzahlen und Übergänge stimmen.</p>
        ) : (
          <ul className="finding-list">
            {findings.map((f, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={`finding-link finding-${f.severity}${f.rowId === selectedRowId ? " is-selected" : ""}`}
                  onClick={() => onSelectRow(f.rowId)}
                >
                  <strong>{labels.get(f.rowId) ?? "Zeile"}:</strong> {findingMessage(f, rowsById.get(f.rowId))}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function ModelMessage({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="model-message">
      {title && <span className="model-message-title">{title}</span>}
      <span>{children}</span>
    </div>
  );
}

/** Messages over the canvas: empty pattern, over budget, error, first computation. */
function StageOverlay({ preview }: { preview: PreviewState }) {
  switch (preview.status) {
    case "pending":
      return <ModelMessage>Modell wird berechnet …</ModelMessage>;
    case "empty":
      return (
        <ModelMessage title="Noch keine Maschen">
          Tippe links eine Runde ein, z. B. „1 MR, 6 fM“ – hier wächst das Modell mit.
        </ModelMessage>
      );
    case "overBudget": {
      const { stitchCount = 0, maxStitches = 0 } = preview.overBudget ?? {};
      return (
        <ModelMessage title="Zu viele Maschen für die 3D-Vorschau">
          Das Teil hat {count(stitchCount)} Maschen, die Vorschau zeigt höchstens {count(maxStitches)}.
          {preview.model ? " Zu sehen ist der letzte berechnete Stand." : ""}
        </ModelMessage>
      );
    }
    case "error":
      return (
        <ModelMessage title="Modell konnte nicht berechnet werden">
          {preview.model ? "Zu sehen ist der letzte berechnete Stand. " : ""}
          Details: {preview.error}
        </ModelMessage>
      );
    case "model":
      return null;
  }
}

/** Real size of the piece in cm. */
function Dimensions({ preview }: { preview: PreviewState }) {
  const model = preview.model;
  if (!model || preview.status === "empty") return null;
  const { width, height, depth } = model.size;
  return (
    <p className="model-dims" aria-label="Maße">
      <span>
        <span className="muted">B × H × T</span> {cm(width)} × {cm(height)} × {cm(depth)} cm
      </span>
      {model.maxDiameter > 0 && (
        <span>
          <span className="muted">max. Ø</span> {cm(model.maxDiameter)} cm
        </span>
      )}
      {model.estimated && (
        <span className="estimate-hint" title="Ohne Maschenprobe sind die Maße aus Garnstärke und Nadel geschätzt.">
          Maße geschätzt
        </span>
      )}
      {preview.status !== "model" && <span className="muted">(letzter Stand)</span>}
    </p>
  );
}
