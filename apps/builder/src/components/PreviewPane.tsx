import { useMemo } from "react";
import {
  computeRowStitches,
  resolveGauge,
  type Finding,
  type Gauge,
  type PartContent,
} from "@crochetbuilder/engine";
import { displayRowLabels } from "../state/labels.js";
import { findingMessage } from "../state/messages.js";

/**
 * Props of the right-hand pane. This is the slot B4 fills with the 3D preview: build the
 * stitch graph from `content`, relax it with `gauge`, render the mesh, highlight
 * `selectedRowId`, and report clicks on a stitch through `onSelectRow`.
 */
export interface PreviewPaneProps {
  /** The part being edited (MVP: `parts[0].content`). */
  content: PartContent;
  /** Gauge from the document overview (may be empty → engine defaults). */
  gauge: Gauge | undefined;
  /** `validate(content)`, in document order. */
  findings: readonly Finding[];
  /** Row selected in the editor — B4 highlights it in the model. */
  selectedRowId: string | null;
  /** Select and focus a row in the editor (finding click now; stitch click in B4). */
  onSelectRow: (rowId: string) => void;
}

const mm = (value: number) => value.toLocaleString("de-DE", { maximumFractionDigits: 1 });

const SOURCE_TEXT = {
  swatch: "aus der Maschenprobe",
  "yarn-weight": "geschätzt aus Garn und Nadel",
  default: "Standardwerte (DK, 4 mm) – Garn oder Maschenprobe angeben",
} as const;

export function PreviewPane({ content, gauge, findings, selectedRowId, onSelectRow }: PreviewPaneProps) {
  const resolved = resolveGauge(gauge);
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

  return (
    <aside className="preview-pane" aria-label="Vorschau">
      {/* B4: 3D preview slot — replace this placeholder with the Three.js view. */}
      <div className="preview-slot" data-slot="3d-preview">
        <div className="preview-placeholder">
          <span className="preview-placeholder-title">3D-Vorschau folgt</span>
          <span className="muted">Hier wächst bald das Modell mit, während du links tippst.</span>
        </div>
      </div>

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
