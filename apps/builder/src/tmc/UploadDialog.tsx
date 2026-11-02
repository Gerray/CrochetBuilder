import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { TmcOriginHint } from "@crochetbuilder/engine";
import { trapTab } from "../components/focus.js";
import "../components/paste.css";
import { exportFailureText } from "../export/prepare.js";
import { tmcUpload, type TmcUpload } from "../export/tmc.js";
import type { BuilderDoc } from "../state/document.js";
import type { TmcOrigin, UploadLink } from "../state/uploadLink.js";
import { createTmcApi, TmcApiError, type TmcApi, type TmcCheck, type TmcTarget } from "./api.js";
import type { UploadResume } from "./redirect.js";
import type { TmcServices } from "./services.js";
import { SignInStep } from "./SignInStep.js";
import {
  CHANGED_IN_APP_LINE,
  CHANGES_LOST_LINE,
  errorLine,
  IMPORTED_HINT,
  IMPORTED_LABEL,
  impactLines,
  LIBRARY_FAILED_LINE,
  NEW_ACCOUNT_LINE,
  PRIVACY_LINE,
  PRIVACY_URL,
  SELF_CREATED_LABEL,
  SHARE_QUESTION,
  SHARED_LINE,
  SHARED_VERSION_KEPT_LINE,
  SIGN_UP_LEGAL_LINE,
  SUCCESS_LINE,
  SUMMARY_TITLE,
  uploadedWhen,
  UPLOAD_TITLE,
} from "./texts.js";
import type { TmcAuth } from "./useTmcAuth.js";
import "./upload.css";

const NEW = "new";

type Task = "list" | "check" | "upload" | "share";

interface Done {
  target: TmcTarget;
  shared: boolean;
}

export interface UploadDialogProps {
  doc: BuilderDoc;
  originHint: TmcOriginHint;
  /** The project this document already belongs to. */
  link: UploadLink | null;
  services: TmcServices;
  auth: TmcAuth;
  onUploaded: (link: UploadLink) => void;
  /** The project is gone (or someone else's): the document has none any more. */
  onForget: () => void;
  onClose: () => void;
}

const sameTitle = (a: string, b: string) => a.trim().toLocaleLowerCase("de") === b.trim().toLocaleLowerCase("de");
const isShared = (target: TmcTarget) => target.shared || target.listed;

/**
 * "Zu TellmeCrochet hochladen": signs in if needed, finds the project, says what will happen and
 * uploads. Steps show only when they apply; a failure keeps everything chosen so far. Modal: the
 * app behind it is made inert by the caller (see App.tsx), Tab stays inside.
 */
export function UploadDialog({ doc, originHint, link, services, auth, onUploaded, onForget, onClose }: UploadDialogProps) {
  const { client } = auth;
  const api = useMemo<TmcApi | null>(
    () => (client ? createTmcApi({ client, fetch: services.fetch, config: services.config }) : null),
    [client, services],
  );
  const handoff = useMemo<{ upload: TmcUpload } | { blocked: string }>(() => {
    try {
      return { upload: tmcUpload(doc, originHint) };
    } catch (err) {
      console.error(err);
      return { blocked: exportFailureText(err) };
    }
  }, [doc, originHint]);
  const upload = "upload" in handoff ? handoff.upload : null;

  // Where the upload goes: NEW, a project's id, or null while that is not known yet.
  const [choice, setChoice] = useState<string | null>(() => auth.resume?.choice ?? link?.lastUpload.patternId ?? null);
  const [origin, setOrigin] = useState<TmcOrigin | null>(auth.resume?.origin ?? null);
  const [projects, setProjects] = useState<TmcTarget[] | null>(null);
  const [checked, setChecked] = useState<TmcCheck | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const groupId = useId();
  // A double click starts one upload: state is too late for the second click.
  const running = useRef(false);
  // Only the latest list or check counts, when the choice changed meanwhile.
  const latestLoad = useRef(0);
  // The key of a new project stays the same through retries: a lost answer cannot make two.
  const pendingKey = useRef<string | null>(null);

  useEffect(() => {
    dialog.current?.focus();
  }, []);
  // Whatever step comes next, the focus stays inside the dialog.
  useEffect(() => {
    if (dialog.current && !dialog.current.contains(document.activeElement)) dialog.current.focus();
  });

  const fail = (err: unknown, again?: () => void) => {
    const failure = err instanceof TmcApiError ? err : new TmcApiError("server");
    if (!(err instanceof TmcApiError)) console.error(err);
    switch (failure.code) {
      case "unauthorized":
        // Back to the sign-in; everything chosen stays here.
        auth.sessionExpired();
        return;
      case "conflict":
        setError(errorLine("conflict"));
        if (checked) void runCheck(checked.target.patternId);
        return;
      case "not-found":
      case "forbidden":
        setError(errorLine(failure.code));
        onForget();
        setChecked(null);
        void runList(null);
        return;
      case "key-in-use": {
        setError(errorLine("key-in-use"));
        const key = pendingKey.current;
        pendingKey.current = null;
        void runList(key);
        return;
      }
      default:
        setError(errorLine(failure.code, failure.retryAfterSeconds));
        if (again) setRetry(() => again);
    }
  };

  /** What a project offers before it is overwritten. */
  const runCheck = async (patternId: string) => {
    if (!api || !upload) return;
    const load = ++latestLoad.current;
    setChecked(null);
    setRetry(null);
    setTask("check");
    try {
      const result = await api.check(patternId, { envelope: upload.envelope, partKeys: upload.partKeys });
      if (load === latestLoad.current) {
        setChecked(result);
        setTask(null);
      }
    } catch (err) {
      if (load === latestLoad.current) {
        setTask(null);
        fail(err, () => void runCheck(patternId));
      }
    }
  };

  /** The person's projects; a matching title (or `key`) is chosen for her, else a new project. */
  const runList = async (key: string | null) => {
    if (!api) return;
    const load = ++latestLoad.current;
    setRetry(null);
    setTask("list");
    try {
      const result = await api.list();
      if (load !== latestLoad.current) return;
      setProjects(result.projects);
      setTask(null);
      const wanted =
        (key !== null ? result.projects.find((p) => p.builderKey === key) : undefined) ??
        result.projects.find((p) => p.patternId === choice) ??
        (choice === NEW ? undefined : result.projects.find((p) => doc.title.trim() !== "" && sameTitle(p.title, doc.title)));
      setChoice(wanted?.patternId ?? NEW);
      if (wanted) await runCheck(wanted.patternId);
    } catch (err) {
      if (load === latestLoad.current) {
        setTask(null);
        fail(err, () => void runList(key));
      }
    }
  };

  // Signed in (also again, after a session ran out): find out where things stand.
  const signedIn = auth.status === "signedIn";
  const canLoad = signedIn && api !== null && upload !== null && done === null;
  useEffect(() => {
    if (!canLoad) return;
    if (choice !== null && choice !== NEW) void runCheck(choice);
    else void runList(null);
    // Only when the sign-in changes; later steps are started by the person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad]);

  const isNew = choice === NEW;
  const existing = checked && checked.target.patternId === choice ? checked : null;
  const impact = existing ? impactLines(existing.impact) : [];

  /** Run `work` once, whatever else gets clicked while it runs. */
  const once = async (name: Task, work: () => Promise<void>, again: () => void) => {
    if (running.current) return;
    running.current = true;
    setTask(name);
    setError(null);
    setRetry(null);
    let failure: unknown;
    let failed = false;
    try {
      await work();
    } catch (err) {
      failure = err;
      failed = true;
    }
    running.current = false;
    setTask(null);
    if (failed) fail(failure, again);
  };

  const send = () => {
    if (!api || !upload) return;
    const payload = { envelope: upload.envelope, partKeys: upload.partKeys };
    void once(
      "upload",
      async () => {
        let target: TmcTarget;
        if (isNew) {
          if (origin === null) return;
          pendingKey.current ??= services.newKey();
          target = (await api.create(pendingKey.current, origin, payload)).target;
          pendingKey.current = null;
        } else if (existing) {
          target = (await api.update(existing.target.patternId, existing.baseToken, payload)).target;
        } else {
          return;
        }
        onUploaded({
          builderKey: target.builderKey,
          lastUpload: { patternId: target.patternId, at: services.now(), origin: target.origin },
        });
        setDone({ target, shared: false });
      },
      send,
    );
  };

  const share = () => {
    if (!api || !done) return;
    void once(
      "share",
      async () => {
        const { target } = await api.share(done.target.patternId);
        setDone({ target, shared: true });
      },
      share,
    );
  };

  const choose = (next: string) => {
    if (next === choice) return;
    setError(null);
    setChoice(next);
    if (next === NEW) {
      latestLoad.current++;
      setChecked(null);
      setRetry(null);
      setTask(null);
    } else {
      void runCheck(next);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      // A running upload finishes first: its answer holds the project's key.
      if (!running.current) onClose();
      return;
    }
    if (dialog.current) trapTab(e, dialog.current);
  };

  const uploading = task === "upload" || task === "share";
  const showSignIn = upload !== null && !signedIn && client !== null && (auth.status === "signedOut" || auth.status === "unavailable");
  const offerShare = done !== null && !done.shared && isShared(done.target) && done.target.hasUnsharedChanges;

  return (
    <div
      className="modal-backdrop upload-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !running.current) onClose();
      }}
    >
      <div
        ref={dialog}
        className="upload-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="upload-head">
          <h2 id={titleId} className="paste-title">
            {UPLOAD_TITLE}
          </h2>
          <button
            type="button"
            className="btn btn-icon btn-quiet"
            aria-label="Schließen"
            title="Schließen (Esc)"
            disabled={uploading}
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="upload-body">
          {auth.newAccount && signedIn && (
            <p className="upload-notice">
              {NEW_ACCOUNT_LINE}{" "}
              <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                {SIGN_UP_LEGAL_LINE}
              </a>
            </p>
          )}

          {"blocked" in handoff ? (
            <p className="upload-error" role="alert">
              {handoff.blocked}
            </p>
          ) : auth.status === "unavailable" && client === null ? (
            <>
              <p className="upload-error" role="alert">
                {LIBRARY_FAILED_LINE}
              </p>
              <div>
                <button type="button" className="btn" onClick={auth.ensure}>
                  Erneut versuchen
                </button>
              </div>
            </>
          ) : showSignIn ? (
            <SignInStep
              client={client}
              auth={auth}
              resume={{ ...(choice !== null ? { choice } : {}), ...(origin ? { origin } : {}) }}
              now={services.now}
            />
          ) : !signedIn ? (
            <p className="muted" role="status">
              Prüfe die Anmeldung …
            </p>
          ) : done ? (
            <>
              <p className="upload-success" role="status">
                {SUCCESS_LINE}
              </p>
              {offerShare && <p>{SHARE_QUESTION}</p>}
              {done.shared && <p role="status">Die Bearbeitung ist jetzt geteilt.</p>}
            </>
          ) : (
            <>
              {projects !== null && projects.length > 0 && (
                <fieldset className="upload-group upload-projects">
                  <legend>Wohin?</legend>
                  <label className="upload-option">
                    <input type="radio" name={groupId} checked={isNew} disabled={uploading} onChange={() => choose(NEW)} />
                    <span>Neues Projekt</span>
                  </label>
                  {projects.map((p) => (
                    <label key={p.patternId} className="upload-option">
                      <input
                        type="radio"
                        name={groupId}
                        checked={choice === p.patternId}
                        disabled={uploading}
                        onChange={() => choose(p.patternId)}
                      />
                      <span>
                        {p.title.trim() || "Ohne Titel"}
                        <ProjectDate at={p.updatedAt} now={services.now()} />
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}

              {task === "list" && (
                <p className="muted" role="status">
                  Suche deine Projekte …
                </p>
              )}
              {task === "check" && (
                <p className="muted" role="status">
                  Prüfe das Projekt …
                </p>
              )}

              {isNew && (
                <fieldset className="upload-group">
                  <legend>Wer hat die Anleitung entworfen?</legend>
                  <label className="upload-option">
                    <input
                      type="radio"
                      name={`${groupId}-origin`}
                      checked={origin === "self_created"}
                      disabled={uploading}
                      onChange={() => setOrigin("self_created")}
                    />
                    <span>{SELF_CREATED_LABEL}</span>
                  </label>
                  <label className="upload-option">
                    <input
                      type="radio"
                      name={`${groupId}-origin`}
                      checked={origin === "imported"}
                      disabled={uploading}
                      onChange={() => setOrigin("imported")}
                    />
                    <span>
                      {IMPORTED_LABEL}
                      <span className="upload-sub muted small">{IMPORTED_HINT}</span>
                    </span>
                  </label>
                </fieldset>
              )}

              {existing && (
                <>
                  <p className="small">
                    Aktualisiert das Projekt <strong>{existing.target.title.trim() || "Ohne Titel"}</strong>.
                    <span className="upload-sub muted">
                      {existing.target.origin === "self_created"
                        ? "Rechte: selbst entworfen"
                        : `Rechte: nicht selbst entworfen. ${IMPORTED_HINT}.`}
                    </span>
                  </p>
                  {isShared(existing.target) && <p className="upload-notice">{SHARED_LINE}</p>}
                  {existing.changedInApp && (
                    <p className="upload-warning" role="alert">
                      {CHANGED_IN_APP_LINE} {isShared(existing.target) ? SHARED_VERSION_KEPT_LINE : CHANGES_LOST_LINE}.
                    </p>
                  )}
                  {impact.length > 0 && (
                    <ul className="upload-list upload-impact" aria-label="Folgen in der App">
                      {impact.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {upload && upload.summary.length > 0 && (
                <section className="upload-summary" aria-label={SUMMARY_TITLE}>
                  <p className="small upload-summary-title">{SUMMARY_TITLE}</p>
                  <ul className="upload-list small">
                    {upload.summary.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </section>
              )}

              <p className="muted small">
                {PRIVACY_LINE}{" "}
                <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                  Datenschutz
                </a>
              </p>
            </>
          )}

          {error && (signedIn || done) && (
            <p className="upload-error" role="alert">
              {error}
            </p>
          )}
          {task === "upload" && (
            <p className="muted" role="status">
              Lade hoch …
            </p>
          )}
        </div>

        <footer className="upload-foot">
          <Actions
            state={
              done
                ? offerShare
                  ? "share"
                  : "finished"
                : upload === null || !signedIn
                  ? "cancel"
                  : isNew
                    ? "new"
                    : existing?.changedInApp
                      ? "changed"
                      : impact.length > 0
                        ? "impact"
                        : "update"
            }
            ready={task === null && (isNew ? origin !== null : existing !== null)}
            busy={uploading}
            onSend={send}
            onShare={share}
            onNewProject={() => choose(NEW)}
            onClose={onClose}
          />
          {retry && !uploading && (
            <button type="button" className="btn" onClick={retry}>
              Erneut versuchen
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function ProjectDate({ at, now }: { at: string; now: number }) {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return null;
  return <span className="upload-sub muted small">zuletzt geändert {uploadedWhen(time, now)}</span>;
}

type ActionState = "cancel" | "new" | "update" | "changed" | "impact" | "share" | "finished";

function Actions({
  state,
  ready,
  busy,
  onSend,
  onShare,
  onNewProject,
  onClose,
}: {
  state: ActionState;
  ready: boolean;
  busy: boolean;
  onSend: () => void;
  onShare: () => void;
  onNewProject: () => void;
  onClose: () => void;
}) {
  const closeButton = (label: string) => (
    <button type="button" className="btn" disabled={busy} onClick={onClose}>
      {label}
    </button>
  );
  const sendButton = (label: string) => (
    <button type="button" className="btn btn-primary" disabled={!ready} onClick={onSend}>
      {label}
    </button>
  );
  switch (state) {
    case "cancel":
      return closeButton("Abbrechen");
    case "new":
      return (
        <>
          {closeButton("Abbrechen")}
          {sendButton("Hochladen")}
        </>
      );
    case "update":
      return (
        <>
          {closeButton("Abbrechen")}
          {sendButton("Aktualisieren")}
        </>
      );
    case "changed":
      return (
        <>
          {closeButton("Abbrechen")}
          <button type="button" className="btn" disabled={busy} onClick={onNewProject}>
            Als neues Projekt anlegen
          </button>
          {sendButton("Trotzdem aktualisieren")}
        </>
      );
    case "impact":
      return (
        <>
          {closeButton("Zurück")}
          {sendButton("Speichern")}
        </>
      );
    case "share":
      return (
        <>
          {closeButton("Später")}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onShare}>
            Jetzt teilen
          </button>
        </>
      );
    case "finished":
      return (
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Fertig
        </button>
      );
  }
}
