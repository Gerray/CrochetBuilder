import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { NotationLocale } from "@crochetbuilder/engine";
import { applyPaste, partEdit, pasteBlocker, type PartEdit, type PasteMode, type PasteResult } from "../paste/apply.js";
import { summaryText, type LineStatus, type PastePreview, type PreviewLine, type LocaleChoice } from "../paste/preview.js";
import { usePastePreview, type PastePreviewOptions } from "../paste/usePastePreview.js";
import type { BuilderDoc } from "../state/document.js";
import { MAX_PART_QUANTITY } from "../state/editor.js";
import { localeName } from "../state/import-messages.js";
import { NumberField } from "./fields.js";
import "./paste.css";

/** Lines shown in the preview at most (the rest is imported all the same). */
export const MAX_PREVIEW_LINES = 400;
/** Parts shown in the preview at most (more cannot be imported anyway). */
export const MAX_PREVIEW_PARTS = 60;

const LOCALES: readonly NotationLocale[] = ["de", "en_us", "en_uk"];

const STATUS: Record<LineStatus, { icon: string; label: string }> = {
  ok: { icon: "✓", label: "gelesen" },
  info: { icon: "i", label: "Hinweis" },
  mismatch: { icon: "!", label: "bitte prüfen" },
  unread: { icon: "?", label: "nicht gelesen" },
};

export type PasteImport = Extract<PasteResult, { ok: true }> & { mode: PasteMode };

export interface PasteDialogProps {
  /** Text to start with (pasted, or the draft of the last time). */
  initialText: string;
  doc: BuilderDoc;
  onImport: (result: PasteImport) => void;
  /** Closed without importing; `text` is kept as a draft. */
  onClose: (text: string) => void;
  /** Tests: parser and debounce. */
  previewOptions?: PastePreviewOptions;
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), textarea, select, summary, a[href]";

/** Text offset of the start and end of 1-based `line`. */
export function lineRange(text: string, line: number): [number, number] {
  const lines = text.split("\n");
  let start = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) start += lines[i]!.length + 1;
  return [start, start + (lines[line - 1]?.length ?? 0)];
}

/** Scroll a (soft-wrapping) text area so that `offset` sits in its upper third. */
function scrollToOffset(area: HTMLTextAreaElement, offset: number): void {
  const style = getComputedStyle(area);
  const mirror = document.createElement("div");
  for (const prop of ["font", "letterSpacing", "lineHeight", "padding", "border", "boxSizing", "tabSize"] as const) {
    mirror.style[prop] = style[prop];
  }
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    width: `${area.clientWidth}px`,
    left: "-9999px",
    top: "0",
  });
  mirror.textContent = area.value.slice(0, offset) + "​";
  document.body.appendChild(mirror);
  const top = mirror.scrollHeight;
  mirror.remove();
  area.scrollTop = Math.max(0, top - area.clientHeight / 3);
}

/** "Anleitung einfügen": pasted text on the left, live preview of the import on the right. */
export function PasteDialog({ initialText, doc, onImport, onClose, previewOptions }: PasteDialogProps) {
  const [text, setText] = useState(() => initialText.replace(/\r\n?/g, "\n"));
  const [choice, setChoice] = useState<LocaleChoice>("auto");
  const [edits, setEdits] = useState<ReadonlyMap<string, PartEdit>>(new Map());
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [includePreamble, setIncludePreamble] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { preview, computing, error: readError } = usePastePreview(text, choice, previewOptions);
  const dialog = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const helpId = useId();
  const areaId = useId();

  // Focus starts in the text; on close it returns to where it was.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    area.current?.focus();
    area.current?.setSelectionRange(0, 0);
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  // Edited names and quantities belong to a part as read from the text (index and name), so a
  // changed text never carries an edit over to another part.
  const indexEdits = useMemo(() => {
    const map = new Map<number, PartEdit>();
    preview?.parts.forEach((part, i) => {
      const edit = edits.get(`${i}:${part.name}`);
      if (edit) map.set(i, edit);
    });
    return map;
  }, [preview, edits]);
  // Stable callbacks: the preview (hundreds of lines) is not re-rendered on every keystroke.
  const editState = useRef({ preview, indexEdits });
  editState.current = { preview, indexEdits };
  const setEdit = useCallback((index: number, patch: Partial<PartEdit>) => {
    const { preview: current, indexEdits: known } = editState.current;
    const part = current?.parts[index];
    if (!current || !part) return;
    const edit = partEdit(current, index, known);
    setEdits((m) => new Map(m).set(`${index}:${part.name}`, { ...edit, ...patch }));
    setError(null);
  }, []);
  const changeChoice = useCallback((next: LocaleChoice) => {
    setChoice(next);
    setError(null);
  }, []);

  const close = () => onClose(text);
  const blocker = useMemo(
    () => (preview ? pasteBlocker(preview, { mode: "replace", edits: indexEdits, includePreamble }, doc) : null),
    [preview, indexEdits, includePreamble, doc],
  );

  const submit = (mode: PasteMode) => {
    if (!preview || computing) return;
    const result = applyPaste(preview, doc, { mode, edits: indexEdits, includePreamble });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onImport({ ...result, mode });
  };

  const selectLine = useCallback((line: number | undefined) => {
    const el = area.current;
    if (!el || line === undefined) return;
    const [start, end] = lineRange(el.value, line);
    el.focus();
    el.setSelectionRange(start, end);
    scrollToOffset(el, start);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab" || !dialog.current) return;
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const lineCount = text === "" ? 0 : text.split("\n").length;
  const ready = preview !== null && !computing;
  const disabled = !ready || preview.parts.length === 0 || preview.localeUncertain;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        className="paste-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={helpId}
        onKeyDown={onKeyDown}
      >
        <header className="paste-head">
          <div>
            <h2 id={titleId} className="paste-title">
              Anleitung einfügen
            </h2>
            <p id={helpId} className="muted small">
              Text aus PDF oder Webseite einfügen. Teile, Runden und Hinweise werden erkannt – prüfe rechts die Vorschau
              und korrigiere links den Text; ein Klick auf eine Zeile markiert sie im Text.
            </p>
          </div>
          <button type="button" className="btn btn-icon btn-quiet" aria-label="Schließen" title="Schließen (Esc)" onClick={close}>
            ✕
          </button>
        </header>

        <div className="paste-body">
          <div className="paste-source">
            <label htmlFor={areaId} className="paste-source-label">
              Text der Anleitung
            </label>
            <textarea
              id={areaId}
              ref={area}
              className="paste-text"
              spellCheck={false}
              placeholder={"Anleitung hier einfügen (Strg+V), z. B.\n\nKopf\nRunde 1: 6 fM in den Fadenring (6)\nRunde 2: 6 Zun (12)\n…"}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
            />
            <p className="muted small">
              {lineCount.toLocaleString("de-DE")} {lineCount === 1 ? "Zeile" : "Zeilen"}
            </p>
          </div>

          <section className="paste-preview" aria-label="Vorschau des Imports" aria-busy={computing}>
            {preview === null ? (
              <p className="paste-empty muted">
                {computing
                  ? "Lese den Text …"
                  : readError
                    ? `Der Text konnte nicht gelesen werden: ${readError}`
                    : "Füge links eine Anleitung ein – hier siehst du sofort, welche Teile und Runden erkannt werden."}
              </p>
            ) : (
              <PreviewContent
                preview={preview}
                computing={computing}
                choice={choice}
                onChoice={changeChoice}
                onlyProblems={onlyProblems}
                onOnlyProblems={setOnlyProblems}
                edits={indexEdits}
                onEdit={setEdit}
                onSelectLine={selectLine}
              />
            )}
          </section>
        </div>

        <footer className="paste-foot">
          <p className="paste-error" role="alert">
            {error ?? (ready && blocker && preview.parts.length > 0 ? blocker : "")}
          </p>
          <label className="paste-check">
            <input type="checkbox" checked={includePreamble} onChange={(e) => setIncludePreamble(e.target.checked)} />
            Material und Einleitung in die Hinweise der Anleitung übernehmen
          </label>
          <div className="paste-actions">
            <button type="button" className="btn" onClick={close}>
              Abbrechen
            </button>
            <button
              type="button"
              className="btn"
              disabled={disabled}
              title="Die erkannten Teile hinten an die aktuelle Anleitung anhängen"
              onClick={() => submit("append")}
            >
              Teile hinzufügen
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={disabled}
              title="Die aktuelle Anleitung ersetzen (mit „Rückgängig“ zurückholbar)"
              onClick={() => submit("replace")}
            >
              Als neue Anleitung übernehmen
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface PreviewContentProps {
  preview: PastePreview;
  computing: boolean;
  choice: LocaleChoice;
  onChoice: (choice: LocaleChoice) => void;
  onlyProblems: boolean;
  onOnlyProblems: (on: boolean) => void;
  edits: ReadonlyMap<number, PartEdit>;
  onEdit: (index: number, patch: Partial<PartEdit>) => void;
  onSelectLine: (line: number | undefined) => void;
}

const percent = (confidence: number) => `${Math.round(confidence * 100)} %`;

const PreviewContent = memo(function PreviewContent(props: PreviewContentProps) {
  const { preview, computing, choice, onChoice, onlyProblems, onOnlyProblems, edits, onEdit, onSelectLine } = props;
  // The notation has its own box above; skipped lines are no problem.
  const general = preview.general.filter(
    (g) => g.code !== "LOCALE_UNCERTAIN" && (!onlyProblems || g.code !== "IGNORED"),
  );
  let budget = MAX_PREVIEW_LINES;

  return (
    <div className={`paste-preview-inner${computing ? " is-stale" : ""}`}>
      <LocaleSwitch preview={preview} choice={choice} onChoice={onChoice} />

      <div className="paste-summary">
        <p className="paste-summary-text" role="status">
          {preview.parts.length === 0 ? "Noch keine Runden erkannt." : summaryText(preview.counts)}
        </p>
        <label className="paste-check">
          <input type="checkbox" checked={onlyProblems} onChange={(e) => onOnlyProblems(e.target.checked)} />
          nur Problemstellen
        </label>
      </div>

      {general.length > 0 && (
        <ul className="paste-general" aria-label="Allgemeine Hinweise">
          {general.map((g, i) => (
            <li key={i}>
              <button
                type="button"
                className={`paste-line is-${g.severity === "warning" ? "mismatch" : "info"}`}
                onClick={() => onSelectLine(g.line)}
              >
                <StatusIcon status={g.severity === "warning" ? "mismatch" : "info"} />
                <span className="paste-line-main">
                  <span className="paste-line-text">{g.message}</span>
                  <span className="paste-quote">„{g.text}“</span>
                </span>
                <span className="paste-lineno">Z. {g.line}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {preview.parts.slice(0, MAX_PREVIEW_PARTS).map((part, index) => {
        const lines = onlyProblems ? part.lines.filter((l) => l.status !== "ok") : part.lines;
        const shown = lines.slice(0, Math.max(0, budget));
        budget -= shown.length;
        const hidden = lines.length - shown.length;
        const { name, quantity } = partEdit(preview, index, edits);
        return (
          <section key={index} className="paste-part" aria-label={`Teil ${index + 1}: ${name}`}>
            <div className="paste-part-head">
              <input
                className="paste-part-name"
                aria-label={`Name von Teil ${index + 1}`}
                value={name}
                onChange={(e) => onEdit(index, { name: e.target.value })}
              />
              <label className="inline-field">
                <span>Anzahl</span>
                <NumberField
                  className="narrow"
                  aria-label={`Anzahl von Teil ${index + 1}`}
                  min={1}
                  max={MAX_PART_QUANTITY}
                  value={quantity}
                  onValue={(q) => q !== undefined && onEdit(index, { quantity: q })}
                />
              </label>
              <span className="muted small">
                {part.stitchRows} {part.stitchRows === 1 ? "Runde" : "Runden"}
              </span>
            </div>
            {shown.length > 0 && (
              <ol className="paste-lines">
                {shown.map((line) => (
                  <li key={line.first}>
                    <LineView line={line} onSelectLine={onSelectLine} />
                  </li>
                ))}
              </ol>
            )}
            {onlyProblems && lines.length === 0 && <p className="muted small paste-part-ok">Alles gelesen.</p>}
            {hidden > 0 && (
              <p className="muted small">
                … {hidden.toLocaleString("de-DE")} weitere Zeilen (werden vollständig übernommen).
              </p>
            )}
          </section>
        );
      })}

      {preview.parts.length > MAX_PREVIEW_PARTS && (
        <p className="muted small">
          … und {(preview.parts.length - MAX_PREVIEW_PARTS).toLocaleString("de-DE")} weitere Teile.
        </p>
      )}

      {preview.preamble.length > 0 && (
        <details className="paste-preamble">
          <summary>
            Material, Abkürzungen und Einleitung ({preview.preamble.length}{" "}
            {preview.preamble.length === 1 ? "Zeile" : "Zeilen"})
          </summary>
          <pre>{preview.preamble.join("\n")}</pre>
        </details>
      )}
    </div>
  );
});

function StatusIcon({ status }: { status: LineStatus }) {
  return (
    <span className={`paste-status is-${status}`} role="img" aria-label={STATUS[status].label}>
      {STATUS[status].icon}
    </span>
  );
}

function LineView({ line, onSelectLine }: { line: PreviewLine; onSelectLine: (line: number | undefined) => void }) {
  const body = (
    <>
      <StatusIcon status={line.status} />
      <span className="paste-line-main">
        <span className="paste-line-text">
          <strong>{line.label}:</strong> {line.text}
        </span>
        {line.messages.map((m, i) => (
          <span key={i} className={`paste-message is-${m.severity}`}>
            {m.text}
          </span>
        ))}
      </span>
      {line.source !== undefined && <span className="paste-lineno">Z. {line.source}</span>}
    </>
  );
  if (line.source === undefined) return <div className={`paste-line is-${line.status}`}>{body}</div>;
  return (
    <button
      type="button"
      className={`paste-line is-${line.status}`}
      title={`Zeile ${line.source} im Text markieren`}
      onClick={() => onSelectLine(line.source)}
    >
      {body}
    </button>
  );
}

function LocaleSwitch({
  preview,
  choice,
  onChoice,
}: {
  preview: PastePreview;
  choice: LocaleChoice;
  onChoice: (choice: LocaleChoice) => void;
}) {
  const labelId = useId();
  const { detected } = preview;
  const uncertain = preview.localeUncertain;
  let status: string;
  if (uncertain) {
    status = `Nicht sicher erkannt (${percent(detected.confidence)}) – bitte wählen, welche Begriffe die Anleitung nutzt.`;
  } else if (choice === "auto") {
    status = `automatisch erkannt (${percent(detected.confidence)} sicher)`;
  } else {
    status = `von dir gewählt · erkannt: ${localeName(detected.locale)} (${percent(detected.confidence)})`;
  }
  return (
    <div className={`paste-locale${uncertain ? " is-uncertain" : ""}`}>
      <span id={labelId} className="paste-locale-label">
        Schreibweise
      </span>
      <div className="segmented segmented-small" role="radiogroup" aria-labelledby={labelId}>
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            role="radio"
            aria-checked={!uncertain && preview.locale === locale}
            className={uncertain && preview.locale === locale ? "is-guess" : undefined}
            onClick={() => onChoice(locale)}
          >
            {locale === "de" ? "Deutsch" : localeName(locale)}
          </button>
        ))}
      </div>
      <span className={uncertain ? "paste-locale-status is-warning" : "paste-locale-status muted small"}>{status}</span>
      <span className="paste-locale-hint muted small">fM = US „sc“ = UK „dc“</span>
    </div>
  );
}
