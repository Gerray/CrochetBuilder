import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { buildTmcImportUrl, renderedRows, type BuilderExport, type MeshStyle } from "@crochetbuilder/engine";
import { loadModelCanvas, ViewBoundary, ViewError, type ViewLoader } from "../components/PreviewPane.js";
import { estimateNote, gaugeLine, materialLine, sizeLine } from "../export/labels.js";
import { builderBaseUrl } from "../export/share.js";
import { usePreviewModel, type PreviewOptions } from "../preview/usePreviewModel.js";
import { isEmbed, loadViewerData, type ViewerData } from "./load.js";

export interface ViewerAppProps {
  /** Page location (tests pass their own). */
  location?: Pick<Location, "hash" | "search" | "href">;
  previewOptions?: PreviewOptions;
  loadView?: ViewLoader;
}

const STYLES: Array<[MeshStyle, string]> = [
  ["tube", "Garn"],
  ["surface", "Fläche"],
  ["points", "Punkte"],
];

/** Read-only page for share links and embeds: title, 3D model, size, materials, rows. */
export function ViewerApp({ location = globalThis.location, previewOptions, loadView = loadModelCanvas }: ViewerAppProps) {
  const [data, setData] = useState<ViewerData>({ status: "loading" });
  const [hash, setHash] = useState(location.hash);
  const embed = isEmbed(location.search);
  const builderUrl = builderBaseUrl(location.href);

  useEffect(() => {
    const onHash = () => setHash(globalThis.location.hash);
    globalThis.addEventListener("hashchange", onHash);
    return () => globalThis.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData({ status: "loading" });
    void loadViewerData(hash).then((next) => {
      if (!cancelled) setData(next);
    });
    return () => {
      cancelled = true;
    };
  }, [hash]);

  useEffect(() => {
    document.documentElement.classList.toggle("is-embed", embed);
  }, [embed]);

  useEffect(() => {
    const title = data.status === "ready" ? data.exp.title.trim() : "";
    document.title = title ? `${title} – CrochetBuilder` : "CrochetBuilder – Ansicht";
  }, [data]);

  if (data.status === "loading") {
    return (
      <div className="viewer-message" role="status">
        Lade Anleitung …
      </div>
    );
  }
  if (data.status !== "ready") {
    return (
      <div className="viewer-message" role="alert">
        <h1>{data.status === "missing" ? "Keine Anleitung im Link" : "Anleitung konnte nicht geöffnet werden"}</h1>
        <p>
          {data.status === "missing"
            ? "Dieser Link enthält keine Anleitung. Öffne einen geteilten Link aus dem CrochetBuilder – oder bau selbst eine."
            : data.message}
        </p>
        <a className="btn btn-primary" href={builderUrl} target={embed ? "_blank" : undefined} rel="noopener">
          Zum CrochetBuilder
        </a>
      </div>
    );
  }

  const tmcUrl = buildTmcImportUrl(data.payload);
  const editUrl = `${builderUrl}#data=${data.payload}`;
  const title = data.exp.title.trim() || "Häkelanleitung";
  const model = (
    <ViewerModel exp={data.exp} embed={embed} previewOptions={previewOptions} loadView={loadView} />
  );

  if (embed) {
    return (
      <div className="viewer viewer-embed">
        {model}
        <div className="viewer-embed-bar">
          <span className="viewer-embed-title" title={title}>
            {title}
          </span>
          <a href={tmcUrl} target="_blank" rel="noopener">
            In TellmeCrochet öffnen
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer">
      <header className="viewer-header">
        <a className="brand" href={builderUrl}>
          CrochetBuilder
        </a>
        <h1>{title}</h1>
        <div className="viewer-actions">
          <a className="btn btn-primary" href={tmcUrl} target="_blank" rel="noopener">
            In TellmeCrochet öffnen
          </a>
          <a className="btn" href={editUrl}>
            Im Builder bearbeiten
          </a>
        </div>
      </header>
      <main className="viewer-main">
        <section className="viewer-model-panel" aria-label="3D-Modell">
          {model}
        </section>
        <PatternText exp={data.exp} />
      </main>
      <footer className="viewer-footer muted small">
        Erstellt mit <a href={builderUrl}>CrochetBuilder</a> – Anleitungen mit 3D-Vorschau bauen, kostenlos und ohne
        Konto.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ViewerModel({
  exp,
  embed,
  previewOptions,
  loadView,
}: {
  exp: BuilderExport;
  embed: boolean;
  previewOptions: PreviewOptions | undefined;
  loadView: ViewLoader;
}) {
  const [style, setStyle] = useState<MeshStyle>("tube");
  const [resetToken, setResetToken] = useState(0);
  const [webgl, setWebgl] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const ModelCanvas = useMemo(() => lazy(loadView), [loadView, attempt]);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const onUnavailable = useCallback(() => setWebgl(false), []);
  const ignorePick = useCallback(() => {}, []);
  const part = exp.parts[0]!;
  const preview = usePreviewModel(part.content, exp.overview.gauge, style, previewOptions);
  const size = preview.model;

  let overlay: ReactNode = null;
  if (!webgl) overlay = <Message title="3D-Ansicht nicht verfügbar">Dein Browser kann hier kein WebGL anzeigen.</Message>;
  else if (preview.status === "pending") overlay = <Message>Modell wird berechnet …</Message>;
  else if (preview.status === "empty") overlay = <Message title="Kein Modell">Diese Anleitung hat noch keine Maschen.</Message>;
  else if (preview.status === "overBudget") {
    overlay = <Message title="Zu viele Maschen für die 3D-Ansicht">Die Anleitung ist zu groß für die Vorschau.</Message>;
  } else if (preview.status === "error") {
    overlay = <Message title="Modell konnte nicht berechnet werden">{preview.error}</Message>;
  }

  return (
    <div className="viewer-model">
      {!embed && (
        <div className="model-toolbar">
          <div className="segmented segmented-small" role="radiogroup" aria-label="Darstellung">
            {STYLES.map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={style === value} onClick={() => setStyle(value)}>
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-small"
            disabled={!preview.model || !webgl}
            onClick={() => setResetToken((t) => t + 1)}
          >
            Ansicht zurücksetzen
          </button>
        </div>
      )}
      <div className="viewer-stage">
        {webgl && preview.model && (
          <ViewBoundary key={attempt} fallback={(error) => <ViewError error={error} onRetry={retry} />}>
            <Suspense fallback={<Message>Lade 3D-Ansicht …</Message>}>
              <ModelCanvas
                mesh={preview.model}
                highlightRowId={null}
                dimmed={false}
                showGrid={!embed}
                resetToken={resetToken}
                onPickRow={ignorePick}
                onUnavailable={onUnavailable}
              />
            </Suspense>
          </ViewBoundary>
        )}
        {overlay}
      </div>
      {!embed && size && preview.status === "model" && (
        <p className="model-dims" aria-label="Maße">
          <span>
            <span className="muted">Größe</span> {sizeLine({ ...size.size, maxDiameter: size.maxDiameter })}
          </span>
          {size.estimated && <span className="estimate-hint">geschätzt</span>}
        </p>
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

function PatternText({ exp }: { exp: BuilderExport }) {
  const materials = (exp.overview.materials ?? []).map(materialLine).filter(Boolean);
  const estimate = estimateNote(exp.overview.gauge);
  const notes = exp.overview.notes?.trim();
  const several = exp.parts.length > 1;
  return (
    <div className="viewer-text">
      {materials.length > 0 && (
        <section aria-labelledby="viewer-materials">
          <h2 id="viewer-materials" className="section-title">
            Material
          </h2>
          <ul className="viewer-list">
            {materials.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="viewer-gauge">
        <h2 id="viewer-gauge" className="section-title">
          Größe
        </h2>
        <p>{gaugeLine(exp.overview.gauge)}</p>
        {estimate && <p className="muted small">{estimate}</p>}
      </section>
      {notes && (
        <section aria-labelledby="viewer-notes">
          <h2 id="viewer-notes" className="section-title">
            Hinweise
          </h2>
          <p className="viewer-notes">{notes}</p>
        </section>
      )}
      <section aria-labelledby="viewer-rows">
        <h2 id="viewer-rows" className="section-title">
          Anleitung
        </h2>
        {exp.parts.map((part, i) => {
          const rows = renderedRows(part.content, "de");
          return (
            <div key={i} className="viewer-part">
              {(several || part.quantity > 1) && (
                <h3>
                  {part.name.trim() || `Teil ${i + 1}`}
                  {part.quantity > 1 ? ` (${part.quantity}×)` : ""}
                </h3>
              )}
              {rows.length === 0 ? (
                <p className="muted">Noch keine Reihen.</p>
              ) : (
                <ol className="viewer-rows" aria-label={several ? `Reihen von ${part.name}` : "Reihen"}>
                  {rows.map((row, k) => (
                    <li key={k}>{row}</li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
