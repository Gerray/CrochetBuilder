import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { importFile } from "../export/import.js";
import { downloadJson, isDocumentEmpty } from "../export/prepare.js";
import { embedSnippet, LONG_URL_CHARS, shareLinks, type ShareLinks } from "../export/share.js";
import type { BuilderDoc } from "../state/document.js";
import "./export.css";

export const TMC_PENDING_NOTE = "Import in TellmeCrochet folgt – du kannst die Anleitung auch als JSON speichern.";
export const REPLACE_FROM_FILE_QUESTION =
  "Die aktuelle Anleitung wird durch die Datei ersetzt (mit „Rückgängig“ zurückholbar). Fortfahren?";

/** Side effects of the menu; tests replace them. */
export interface ExportActions {
  savePdf: (doc: BuilderDoc) => Promise<string>;
  downloadJson: (doc: BuilderDoc) => void;
  copy: (text: string) => Promise<void>;
  confirm: (question: string) => boolean;
}

const defaultActions: ExportActions = {
  // jsPDF and the snapshot code load only when a PDF is made.
  savePdf: async (doc) => (await import("../export/pdf.js")).savePdf(doc),
  downloadJson,
  copy: async (text) => {
    if (!globalThis.navigator?.clipboard) throw new Error("Keine Zwischenablage");
    await globalThis.navigator.clipboard.writeText(text);
  },
  confirm: (question) => globalThis.confirm(question),
};

interface ExportMenuProps {
  doc: BuilderDoc;
  /** Replace the document (undoable) with an imported one. */
  onReplace: (doc: BuilderDoc, pinned: string[]) => void;
  actions?: Partial<ExportActions>;
}

type Status = { kind: "info" | "ok" | "error"; text: string } | null;
type View = "share" | "embed" | null;

const count = (n: number) => n.toLocaleString("de-DE");

/** "Exportieren": TellmeCrochet, PDF, JSON (save / open), share link and embed code. */
export function ExportMenu({ doc, onReplace, actions: overrides }: ExportMenuProps) {
  const actions = { ...defaultActions, ...overrides };
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<ShareLinks | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [view, setView] = useState<View>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const panelId = useId();

  // Links are computed while the panel is open, so the buttons are real links / instant copies
  // (popup blockers and the clipboard want the user's click, not a promise after it).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLinkError(null);
    shareLinks(doc).then(
      (next) => {
        if (!cancelled) setLinks(next);
      },
      (err: unknown) => {
        if (cancelled) return;
        console.error(err);
        setLinks(null);
        setLinkError("Die Anleitung konnte nicht verpackt werden. Speichere sie als JSON.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, doc]);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>(".export-panel a, .export-panel button")?.focus();
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

  const run = async (task: () => Promise<Status> | Status) => {
    setBusy(true);
    try {
      setStatus(await task());
    } catch (err) {
      console.error(err);
      setStatus({ kind: "error", text: `Das hat nicht geklappt: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, what: string): Promise<Status> => {
    try {
      await actions.copy(text);
      return { kind: "ok", text: `${what} kopiert.` };
    } catch {
      return { kind: "info", text: `Kopieren ging nicht automatisch – markiere den ${what} im Feld und kopiere ihn selbst.` };
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    await run(async () => {
      const result = await importFile(file);
      if (!result.ok) return { kind: "error", text: result.message };
      if (!isDocumentEmpty(doc) && !actions.confirm(REPLACE_FROM_FILE_QUESTION)) return null;
      onReplace(result.doc, result.pinned);
      return { kind: "ok", text: `„${file.name}“ geöffnet.` };
    });
  };

  const tmcLong = links !== null && links.tmc.length > LONG_URL_CHARS;

  return (
    <div className="export-menu" ref={root}>
      <button
        ref={toggle}
        type="button"
        className="btn btn-primary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        Exportieren ▾
      </button>
      {open && (
        <div
          id={panelId}
          className="export-panel"
          role="dialog"
          aria-label="Exportieren"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        >
          <div className="export-primary">
            {links ? (
              <a className="btn btn-primary btn-large" href={links.tmc} target="_blank" rel="noopener">
                In TellmeCrochet öffnen
              </a>
            ) : (
              <button type="button" className="btn btn-primary btn-large" disabled>
                In TellmeCrochet öffnen
              </button>
            )}
            <p className="muted small export-note">{TMC_PENDING_NOTE}</p>
            {tmcLong && <LongUrlWarning length={links.tmc.length} />}
          </div>

          <div className="export-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => run(async () => {
              setStatus({ kind: "info", text: "PDF wird erstellt …" });
              const name = await actions.savePdf(doc);
              return { kind: "ok", text: `PDF „${name}“ gespeichert.` };
            })}>
              Als PDF speichern
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => run(() => {
              actions.downloadJson(doc);
              return { kind: "ok", text: "JSON-Datei gespeichert." };
            })}>
              JSON herunterladen
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
              JSON öffnen…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              data-testid="json-file-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                void onFile(file);
              }}
            />
            <button
              type="button"
              className="btn"
              aria-pressed={view === "share"}
              disabled={!links}
              onClick={() => {
                setView("share");
                if (links) void run(() => copy(links.viewer, "Link"));
              }}
            >
              Link teilen
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={view === "embed"}
              disabled={!links}
              onClick={() => {
                setView("embed");
                setStatus(null);
              }}
            >
              Einbetten
            </button>
          </div>

          {linkError && (
            <p className="export-status export-error" role="alert">
              {linkError}
            </p>
          )}

          {links && view === "share" && (
            <ExportField label="Link zur 3D-Ansicht" value={links.viewer}>
              <button type="button" className="btn btn-small" onClick={() => run(() => copy(links.viewer, "Link"))}>
                Kopieren
              </button>
              <a className="btn btn-small" href={links.viewer} target="_blank" rel="noopener">
                Öffnen
              </a>
            </ExportField>
          )}
          {links && view === "share" && links.viewer.length > LONG_URL_CHARS && <LongUrlWarning length={links.viewer.length} />}

          {links && view === "embed" && (
            <ExportField label="Code zum Einbetten (Blog, Shop)" value={embedSnippet(links.embed, doc.title)} multiline>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => run(() => copy(embedSnippet(links.embed, doc.title), "Code"))}
              >
                Code kopieren
              </button>
              <a className="btn btn-small" href={links.embed} target="_blank" rel="noopener">
                Vorschau
              </a>
            </ExportField>
          )}
          {links && view === "embed" && links.embed.length > LONG_URL_CHARS && <LongUrlWarning length={links.embed.length} />}

          {status && (
            <p className={`export-status export-${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
              {status.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function LongUrlWarning({ length }: { length: number }) {
  return (
    <p className="export-status export-warning" role="note">
      Der Link ist sehr lang ({count(length)} Zeichen). Manche Programme kürzen so lange Links – speichere die Anleitung
      zur Sicherheit auch als JSON.
    </p>
  );
}

function ExportField({
  label,
  value,
  multiline,
  children,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="export-field">
      <label htmlFor={id} className="small muted">
        {label}
      </label>
      {multiline ? (
        <textarea id={id} readOnly rows={4} value={value} onFocus={(e) => e.currentTarget.select()} />
      ) : (
        <input id={id} type="text" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
      )}
      <div className="export-field-actions">{children}</div>
    </div>
  );
}
