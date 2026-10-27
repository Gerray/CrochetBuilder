import { useEffect, useRef, useState, type Dispatch } from "react";
import type { Material, MaterialKind } from "@crochetbuilder/engine";
import { MATERIAL_KINDS } from "../export/labels.js";
import { DEMOS, type BuilderDoc, type DemoKind } from "../state/document.js";
import type { EditorAction } from "../state/editor.js";
import type { SaveStatus } from "../state/usePersistence.js";
import { ExportMenu, type ExportActions } from "./ExportMenu.js";
import { ListField } from "./fields.js";
import { GaugeEditor } from "./GaugeEditor.js";

const STATUS_TEXT: Record<SaveStatus, string> = {
  loading: "Lade …",
  idle: "",
  saving: "Speichert …",
  saved: "Lokal gespeichert",
  error: "Speichern fehlgeschlagen",
  suspended: "Nicht gespeichert",
};

interface TopBarProps {
  doc: BuilderDoc;
  dispatch: Dispatch<EditorAction>;
  canUndo: boolean;
  canRedo: boolean;
  status: SaveStatus;
  onNew: () => void;
  /** Load a demo pattern (the button itself loads the sphere). */
  onDemo: (kind: DemoKind) => void;
  /** Replace the document with an imported one ("JSON öffnen…"). */
  onReplace: (doc: BuilderDoc, pinned: string[]) => void;
  /** Export side effects (tests). */
  exportActions?: Partial<ExportActions>;
}

export function TopBar({ doc, dispatch, canUndo, canRedo, status, onNew, onDemo, onReplace, exportActions }: TopBarProps) {
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
          <DemoMenu onDemo={onDemo} />
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
          <ExportMenu doc={doc} onReplace={onReplace} {...(exportActions ? { actions: exportActions } : {})} />
        </div>
      </div>
      {overviewOpen && <OverviewPanel doc={doc} dispatch={dispatch} />}
    </header>
  );
}

// ---------------------------------------------------------------------------

/** "Demo laden" (the sphere) plus a small menu with all demos. */
function DemoMenu({ onDemo }: { onDemo: (kind: DemoKind) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };

  return (
    <div className="split-button" ref={root}>
      <button type="button" className="btn" onClick={() => onDemo("sphere")} title="Beispiel: Amigurumi-Kugel laden">
        Demo laden
      </button>
      <button
        ref={toggle}
        type="button"
        className="btn btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Weitere Demos"
        title="Weitere Demos"
        onClick={() => setOpen((o) => !o)}
      >
        ▾
      </button>
      {open && (
        <div
          className="menu"
          role="menu"
          aria-label="Demos"
          onKeyDown={(e) => {
            const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role='menuitem']"));
            const index = items.indexOf(document.activeElement as HTMLElement);
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              items[(index + step + items.length) % items.length]?.focus();
            }
          }}
        >
          {DEMOS.map((demo) => (
            <button
              key={demo.kind}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                onDemo(demo.kind);
                close();
              }}
            >
              <span>{demo.label}</span>
              <span className="muted small">{demo.description}</span>
            </button>
          ))}
        </div>
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
