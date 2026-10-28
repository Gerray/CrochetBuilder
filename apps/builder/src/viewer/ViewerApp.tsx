import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { renderedRows, type BuilderExport, type MeshStyle, type PaletteColor } from "@crochetbuilder/engine";
import { loadModelCanvas, usePaletteColors, ViewBoundary, ViewError, type ViewLoader } from "../components/PreviewPane.js";
import { TmcLink } from "../components/TmcLink.js";
import { tmcLink, tmcLinkErrorMessage, type TmcLink as TmcLinkData } from "../export/tmc.js";
import { estimateNote, gaugeLine, materialLine, paletteEntries, partHeading, sizeLine } from "../export/labels.js";
import { partsTotal, totalText } from "../state/parts.js";
import { builderBaseUrl } from "../export/share.js";
import { usePreviewModel, type PreviewOptions } from "../preview/usePreviewModel.js";
import { isEmbed, loadViewerData, type ViewerData } from "./load.js";
import { AssemblyWorkspace } from "../assembly/AssemblyWorkspace.js";
import type { AssemblySceneOptions } from "../assembly/useAssemblyScene.js";
import { assemblyLines } from "../assembly/wording.js";

export interface ViewerAppProps {
  /** Page location (tests pass their own). */
  location?: Pick<Location, "hash" | "search" | "href">;
  previewOptions?: PreviewOptions;
  loadView?: ViewLoader;
  /** "Montage" computation options (tests: a main-thread client). */
  assemblySceneOptions?: AssemblySceneOptions;
}

const NO_COLORS: readonly PaletteColor[] = [];

const STYLES: Array<[MeshStyle, string]> = [
  ["stitches", "Maschen"],
  ["surface", "Fläche"],
  ["tube", "Garn"],
  ["points", "Punkte"],
];

/**
 * Read-only page for share links and embeds: title, 3D model, size, materials, rows. With
 * several parts, tabs pick the part whose model is shown and scroll to its rows; the text
 * always lists every part (so printing the page prints the whole pattern).
 */
export function ViewerApp({
  location = globalThis.location,
  previewOptions,
  loadView = loadModelCanvas,
  assemblySceneOptions,
}: ViewerAppProps) {
  const [data, setData] = useState<ViewerData>({ status: "loading" });
  const [part, setPart] = useState(0);
  // "Montage": all parts put together (patterns with an assembly).
  const [montage, setMontage] = useState(false);
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
      if (cancelled) return;
      setData(next);
      setPart(0);
    });
    return () => {
      cancelled = true;
    };
  }, [hash]);

  const tmc = useTmcLink(data.status === "ready" ? data.exp : null);

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

  const editUrl = `${builderUrl}#data=${data.payload}`;
  const title = data.exp.title.trim() || "Häkelanleitung";
  const shown = Math.min(part, data.exp.parts.length - 1);
  const hasAssembly = (data.exp.assembly ?? []).length > 0;
  const model = (
    <ViewerModel
      exp={data.exp}
      part={shown}
      embed={embed}
      previewOptions={previewOptions}
      loadView={loadView}
      montage={hasAssembly && montage}
      onMontage={hasAssembly && !embed ? setMontage : undefined}
      {...(assemblySceneOptions ? { assemblySceneOptions } : {})}
    />
  );
  const selectPart = (index: number) => {
    setPart(index);
    setMontage(false);
    // The text lists every part: bring the chosen one's rows into view (no text in embeds).
    if (!embed) {
      setTimeout(() => {
        document.getElementById(partSectionId(index))?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      }, 0);
    }
  };
  const switcher = <PartSwitcher exp={data.exp} selected={shown} onSelect={selectPart} compact={embed} />;

  if (embed) {
    return (
      <div className="viewer viewer-embed">
        {model}
        {switcher}
        <div className="viewer-embed-bar">
          <span className="viewer-embed-title" title={title}>
            {title}
          </span>
          <TmcLink href={tmc.link?.url ?? null} summary={tmc.link?.summary ?? []} error={tmc.error} placement="above" />
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
          <TmcLink
            className="btn btn-primary"
            href={tmc.link?.url ?? null}
            summary={tmc.link?.summary ?? []}
            error={tmc.error}
            placement="below"
          />
          <a className="btn" href={editUrl}>
            Im Builder bearbeiten
          </a>
        </div>
      </header>
      {switcher}
      <main className="viewer-main">
        <section className="viewer-model-panel" aria-label="3D-Modell">
          {model}
        </section>
        <PatternText exp={data.exp} part={shown} />
      </main>
      <footer className="viewer-footer muted small">
        Erstellt mit <a href={builderUrl}>CrochetBuilder</a> – Anleitungen mit 3D-Vorschau bauen, kostenlos und ohne
        Konto.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The TellmeCrochet link of a shown export, made in the background (null until ready or when
 * it cannot be made). A shared link says nothing about who wrote the pattern, so the viewer
 * reports it as "imported" (E25); TellmeCrochet asks the person.
 */
function useTmcLink(exp: BuilderExport | null): { link: TmcLinkData | null; error: string | null } {
  const [state, setState] = useState<{ link: TmcLinkData | null; error: string | null }>({ link: null, error: null });
  useEffect(() => {
    setState({ link: null, error: null });
    if (!exp) return;
    let cancelled = false;
    tmcLink(exp, "imported").then(
      (link) => {
        if (!cancelled) setState({ link, error: null });
      },
      (err: unknown) => {
        console.error(err);
        if (!cancelled) setState({ link: null, error: tmcLinkErrorMessage(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [exp]);
  return state;
}

/** Ids of the part tabs, of the panel they control (the 3D model) and of each part's rows. */
const VIEWER_PART_TAB = (index: number) => `viewer-part-${index}`;
const VIEWER_MODEL_PANEL = "viewer-model";
const partSectionId = (index: number) => `viewer-part-rows-${index}`;

/** Tabs to pick a part ("Kopf", "Ohr ×2"); nothing for a single part. */
function PartSwitcher({
  exp,
  selected,
  onSelect,
  compact,
}: {
  exp: BuilderExport;
  selected: number;
  onSelect: (index: number) => void;
  compact: boolean;
}) {
  const count = exp.parts.length;
  if (count < 2) return null;
  const go = (index: number) => {
    onSelect(index);
    setTimeout(() => document.getElementById(VIEWER_PART_TAB(index))?.focus(), 0);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") go((selected + 1) % count);
    else if (e.key === "ArrowLeft") go((selected - 1 + count) % count);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(count - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div className={`viewer-parts${compact ? " viewer-parts-compact" : ""}`}>
      <div className="segmented" role="tablist" aria-label="Teile" onKeyDown={onKey}>
        {exp.parts.map((p, i) => (
          <button
            key={i}
            id={VIEWER_PART_TAB(i)}
            type="button"
            role="tab"
            aria-selected={i === selected}
            aria-controls={VIEWER_MODEL_PANEL}
            tabIndex={i === selected ? 0 : -1}
            onClick={() => onSelect(i)}
          >
            {partHeading(p.name, p.quantity, i)}
          </button>
        ))}
      </div>
      {!compact && <span className="muted small">{totalText(partsTotal(exp))}</span>}
    </div>
  );
}

function ViewerModel({
  exp,
  part: index,
  embed,
  previewOptions,
  loadView,
  montage,
  onMontage,
  assemblySceneOptions,
}: {
  exp: BuilderExport;
  part: number;
  embed: boolean;
  previewOptions: PreviewOptions | undefined;
  loadView: ViewLoader;
  /** Show all parts assembled instead of the part. */
  montage: boolean;
  /** Offer the "Teil | Montage" switch (patterns with an assembly). */
  onMontage: ((montage: boolean) => void) | undefined;
  assemblySceneOptions?: AssemblySceneOptions;
}) {
  const [style, setStyle] = useState<MeshStyle>("stitches");
  const [resetToken, setResetToken] = useState(0);
  const [webgl, setWebgl] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const ModelCanvas = useMemo(() => lazy(loadView), [loadView, attempt]);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const onUnavailable = useCallback(() => setWebgl(false), []);
  const ignorePick = useCallback(() => {}, []);
  const part = exp.parts[index]!;
  const palette = usePaletteColors(exp.overview.colors ?? NO_COLORS);
  const preview = usePreviewModel(part.content, exp.overview.gauge, style, { ...previewOptions, paused: montage }, palette.ids);
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

  const tabbed = exp.parts.length > 1;
  return (
    <div
      className="viewer-model"
      id={VIEWER_MODEL_PANEL}
      role={tabbed ? "tabpanel" : undefined}
      aria-labelledby={tabbed ? VIEWER_PART_TAB(index) : undefined}
    >
      {!embed && (
        <div className="model-toolbar">
          {onMontage && (
            <div className="segmented segmented-small" role="radiogroup" aria-label="Ansicht">
              <button type="button" role="radio" aria-checked={!montage} onClick={() => onMontage(false)}>
                Teil
              </button>
              <button type="button" role="radio" aria-checked={montage} onClick={() => onMontage(true)}>
                Montage
              </button>
            </div>
          )}
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
      {montage ? (
        <AssemblyWorkspace
          doc={exp}
          dispatch={ignoreEdit}
          selectedPart={0}
          style={style}
          showGrid={!embed}
          backing={0}
          resetToken={resetToken}
          readOnly
          {...(assemblySceneOptions ? { sceneOptions: assemblySceneOptions } : {})}
        />
      ) : (
        <>
      <div className="viewer-stage">
        {webgl && preview.model && (
          <ViewBoundary key={attempt} fallback={(error) => <ViewError error={error} onRetry={retry} />}>
            <Suspense fallback={<Message>Lade 3D-Ansicht …</Message>}>
              <ModelCanvas
                mesh={preview.model}
                highlightRowId={null}
                dimmed={false}
                showGrid={!embed}
                colors={palette.colors}
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
        </>
      )}
    </div>
  );
}

/** The viewer is read-only: the assembly view never edits. */
const ignoreEdit = () => {};

function Message({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="model-message">
      {title && <span className="model-message-title">{title}</span>}
      <span>{children}</span>
    </div>
  );
}

function PatternText({ exp, part: index }: { exp: BuilderExport; part: number }) {
  const materials = (exp.overview.materials ?? []).map(materialLine).filter(Boolean);
  const colors = paletteEntries(exp.overview.colors ?? []);
  const estimate = estimateNote(exp.overview.gauge);
  const notes = exp.overview.notes?.trim();
  const several = exp.parts.length > 1;
  const assembly = assemblyLines(exp);
  return (
    <div className="viewer-text">
      {(materials.length > 0 || colors.length > 0) && (
        <section aria-labelledby="viewer-materials">
          <h2 id="viewer-materials" className="section-title">
            Material
          </h2>
          {materials.length > 0 && (
            <ul className="viewer-list">
              {materials.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
          {colors.length > 0 && (
            <ul className="viewer-colors" aria-label="Farben">
              {colors.map((c, i) => (
                <li key={i}>
                  <span className="swatch swatch-md" style={{ background: c.css }} aria-hidden="true" />
                  {c.name}
                  {i === 0 && colors.length > 1 && <span className="muted small"> (Anfangsfarbe)</span>}
                </li>
              ))}
            </ul>
          )}
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
          const rows = renderedRows(part.content, "de", exp.overview.colors ?? []);
          const heading = partHeading(part.name, part.quantity, i);
          // The part whose model is shown is marked (several parts only).
          const current = several && i === index;
          return (
            <div key={i} id={partSectionId(i)} className={`viewer-part${current ? " is-current" : ""}`}>
              {(several || part.quantity > 1) && <h3>{heading}</h3>}
              {rows.length === 0 ? (
                <p className="muted">Noch keine Reihen.</p>
              ) : (
                <ol className="viewer-rows" aria-label={several ? `Reihen von ${heading}` : "Reihen"}>
                  {rows.map((row, k) => (
                    <li key={k}>{row}</li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </section>
      {assembly.length > 0 && (
        <section aria-labelledby="viewer-assembly">
          <h2 id="viewer-assembly" className="section-title">
            Montage
          </h2>
          <ul className="viewer-list">
            {assembly.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
