import { useState, type Dispatch } from "react";
import type { Gauge, Material, MaterialKind, YarnWeight } from "@crochetbuilder/engine";
import type { BuilderDoc } from "../state/document.js";
import type { EditorAction } from "../state/editor.js";
import type { SaveStatus } from "../state/usePersistence.js";
import { ListField, NumberField } from "./fields.js";

const YARN_WEIGHTS: Array<[YarnWeight, string]> = [
  ["lace", "Lace (sehr fein)"],
  ["fingering", "Fingering / Sockengarn"],
  ["sport", "Sport (fein)"],
  ["dk", "DK (leicht)"],
  ["worsted", "Worsted (mittel)"],
  ["aran", "Aran (mitteldick)"],
  ["bulky", "Bulky (dick)"],
  ["jumbo", "Jumbo (sehr dick)"],
];

const MATERIAL_KINDS: Array<[MaterialKind, string]> = [
  ["yarn", "Garn"],
  ["hook", "Nadel"],
  ["accessory", "Zubehör"],
];

const STATUS_TEXT: Record<SaveStatus, string> = {
  loading: "Lade …",
  idle: "",
  saving: "Speichert …",
  saved: "Lokal gespeichert",
  error: "Speichern fehlgeschlagen",
};

interface TopBarProps {
  doc: BuilderDoc;
  dispatch: Dispatch<EditorAction>;
  canUndo: boolean;
  canRedo: boolean;
  status: SaveStatus;
  onNew: () => void;
  onDemo: () => void;
}

export function TopBar({ doc, dispatch, canUndo, canRedo, status, onNew, onDemo }: TopBarProps) {
  const [overviewOpen, setOverviewOpen] = useState(false);
  const materialCount = doc.overview.materials?.length ?? 0;

  return (
    <header className="topbar">
      <div className="topbar-main">
        <span className="brand" aria-hidden="true">
          CrochetBuilder
        </span>
        <input
          className="title-input"
          aria-label="Titel der Anleitung"
          placeholder="Titel der Anleitung"
          value={doc.title}
          onChange={(e) => dispatch({ type: "setTitle", title: e.target.value })}
        />
        <GaugeEditor gauge={doc.overview.gauge} dispatch={dispatch} />
        <div className="toolbar" role="toolbar" aria-label="Dokument">
          <button
            type="button"
            className="btn"
            aria-expanded={overviewOpen}
            aria-controls="overview-panel"
            onClick={() => setOverviewOpen((o) => !o)}
          >
            Material & Hinweise{materialCount > 0 ? ` (${materialCount})` : ""}
          </button>
          <span className="toolbar-sep" aria-hidden="true" />
          <button type="button" className="btn" onClick={onNew} title="Neue, leere Anleitung (rückgängig machbar)">
            Neu
          </button>
          <button type="button" className="btn" onClick={onDemo} title="Beispiel: Amigurumi-Kugel laden">
            Demo laden
          </button>
          <span className="toolbar-sep" aria-hidden="true" />
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => dispatch({ type: "undo" })}
            disabled={!canUndo}
            aria-label="Rückgängig"
            title="Rückgängig (Strg+Z)"
          >
            ↶
          </button>
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => dispatch({ type: "redo" })}
            disabled={!canRedo}
            aria-label="Wiederholen"
            title="Wiederholen (Strg+Y)"
          >
            ↷
          </button>
          <span className={`save-status save-${status}`} role="status">
            {STATUS_TEXT[status]}
          </span>
        </div>
      </div>
      {overviewOpen && <OverviewPanel doc={doc} dispatch={dispatch} />}
    </header>
  );
}

// ---------------------------------------------------------------------------

function GaugeEditor({ gauge = {}, dispatch }: { gauge: Gauge | undefined; dispatch: Dispatch<EditorAction> }) {
  const hasSwatch = gauge.stitchesPer10cm !== undefined || gauge.rowsPer10cm !== undefined;
  const [mode, setMode] = useState<"yarn" | "swatch">(hasSwatch ? "swatch" : "yarn");
  const effective = hasSwatch ? "swatch" : mode;
  const set = (patch: Partial<Gauge>) => dispatch({ type: "setGauge", gauge: { ...gauge, ...patch } });

  return (
    <div className="gauge" role="group" aria-label="Größe">
      <div className="segmented" role="radiogroup" aria-label="Größenangabe">
        <button
          type="button"
          role="radio"
          aria-checked={effective === "yarn"}
          onClick={() => {
            setMode("yarn");
            if (hasSwatch) set({ stitchesPer10cm: undefined, rowsPer10cm: undefined });
          }}
        >
          Garn & Nadel
        </button>
        <button type="button" role="radio" aria-checked={effective === "swatch"} onClick={() => setMode("swatch")}>
          Maschenprobe
        </button>
      </div>
      {effective === "yarn" ? (
        <>
          <label className="inline-field">
            <span>Garn</span>
            <select
              value={gauge.yarnWeight ?? ""}
              onChange={(e) => set({ yarnWeight: (e.target.value || undefined) as YarnWeight | undefined })}
            >
              <option value="">– Garnstärke –</option>
              {YARN_WEIGHTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            <span>Nadel</span>
            <NumberField
              className="narrow"
              decimal
              allowEmpty
              min={0.5}
              step={0.25}
              value={gauge.hookMm}
              onValue={(hookMm) => set({ hookMm })}
              placeholder="4"
            />
            <span className="unit">mm</span>
          </label>
        </>
      ) : (
        <>
          <label className="inline-field">
            <span>Maschen</span>
            <NumberField
              className="narrow"
              decimal
              allowEmpty
              min={1}
              value={gauge.stitchesPer10cm}
              onValue={(stitchesPer10cm) => set({ stitchesPer10cm })}
              placeholder="20"
            />
          </label>
          <label className="inline-field">
            <span>Reihen</span>
            <NumberField
              className="narrow"
              decimal
              allowEmpty
              min={1}
              value={gauge.rowsPer10cm}
              onValue={(rowsPer10cm) => set({ rowsPer10cm })}
              placeholder="24"
            />
          </label>
          <span className="unit">pro 10 cm</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function OverviewPanel({ doc, dispatch }: { doc: BuilderDoc; dispatch: Dispatch<EditorAction> }) {
  const materials = doc.overview.materials ?? [];
  const update = (index: number, material: Material, patch: Partial<Material>) => {
    const next: Material = { ...material, ...patch };
    if (next.colors === undefined) delete next.colors;
    if (next.amount === undefined || next.amount === "") delete next.amount;
    dispatch({ type: "updateMaterial", index, material: next });
  };

  return (
    <section id="overview-panel" className="overview-panel" aria-label="Material und Hinweise">
      <div className="overview-col">
        <h2 className="section-title">Material</h2>
        {materials.length === 0 && <p className="muted">Noch kein Material eingetragen.</p>}
        <ul className="material-list">
          {materials.map((m, i) => (
            <li key={i} className="material-row">
              <select
                aria-label={`Art von Material ${i + 1}`}
                value={m.kind}
                onChange={(e) => update(i, m, { kind: e.target.value as MaterialKind })}
              >
                {MATERIAL_KINDS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Bezeichnung von Material ${i + 1}`}
                placeholder="z. B. Baumwollgarn DK"
                value={m.label}
                onChange={(e) => update(i, m, { label: e.target.value })}
              />
              <ListField
                aria-label={`Farben von Material ${i + 1}`}
                placeholder="Farben, mit Komma"
                value={m.colors}
                onList={(colors) => update(i, m, { colors })}
              />
              <input
                className="narrow-text"
                aria-label={`Menge von Material ${i + 1}`}
                placeholder="Menge"
                value={m.amount ?? ""}
                onChange={(e) => update(i, m, { amount: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-icon btn-quiet"
                aria-label={`Material ${i + 1} entfernen`}
                title="Entfernen"
                onClick={() => dispatch({ type: "removeMaterial", index: i })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn"
          onClick={() =>
            dispatch({ type: "addMaterial", material: { kind: materials.length === 0 ? "yarn" : "accessory", label: "" } })
          }
        >
          + Material
        </button>
      </div>
      <div className="overview-col">
        <h2 className="section-title">
          <label htmlFor="overview-notes">Hinweise zur Anleitung</label>
        </h2>
        <textarea
          id="overview-notes"
          rows={4}
          placeholder="z. B. In Spiralrunden häkeln, Anfang markieren."
          value={doc.overview.notes ?? ""}
          onChange={(e) => dispatch({ type: "setNotes", notes: e.target.value })}
        />
      </div>
    </section>
  );
}
