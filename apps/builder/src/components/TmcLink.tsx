import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import "./tmc.css";

export const TMC_LINK_LABEL = "In TellmeCrochet öffnen";
export const TMC_NOTICE_TITLE = "So kommt die Anleitung in TellmeCrochet an:";
export const TMC_CONTINUE_LABEL = "Weiter zu TellmeCrochet";

interface TmcLinkProps {
  /** The hand-off link; null while it is being made (or when it cannot be made). */
  href: string | null;
  /** What arrives differently in TellmeCrochet (German sentences). Empty: the link opens at once. */
  summary: readonly string[];
  /** Why there is no link (German); shown under the disabled button. */
  error?: string | null;
  className?: string;
  /** Where the notice appears: in the flow (export menu), or floating below / above the link. */
  placement?: "inline" | "below" | "above";
}

/**
 * "In TellmeCrochet öffnen". When something arrives differently (rows as text, assembly as an
 * extra part …), the first plain click shows that briefly with "Weiter zu TellmeCrochet" — one
 * more click, nothing to confirm. Middle and modifier clicks open the link directly. The notice
 * takes the focus on "Weiter"; Escape, "Abbrechen" or a click elsewhere close it and give the
 * focus back to the link.
 */
export function TmcLink({ href, summary, error, className, placement = "inline" }: TmcLinkProps) {
  const [asking, setAsking] = useState(false);
  const noticeId = useId();
  const root = useRef<HTMLDivElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const next = useRef<HTMLAnchorElement>(null);
  useEffect(() => setAsking(false), [href]);

  useEffect(() => {
    if (!asking) return;
    next.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setAsking(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [asking]);

  if (!href) {
    return (
      <div className={`tmc-link tmc-link-${placement}`}>
        <button type="button" className={className} disabled>
          {TMC_LINK_LABEL}
        </button>
        {error && (
          <p className="tmc-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  const dismiss = () => {
    setAsking(false);
    link.current?.focus();
  };

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (summary.length === 0 || asking || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setAsking(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || !asking) return;
    // Only the notice closes; a surrounding menu stays open.
    e.preventDefault();
    e.stopPropagation();
    dismiss();
  };

  return (
    <div className={`tmc-link tmc-link-${placement}`} ref={root} onKeyDown={onKeyDown}>
      <a
        ref={link}
        className={className}
        href={href}
        target="_blank"
        rel="noopener"
        onClick={onClick}
        aria-describedby={asking ? noticeId : undefined}
      >
        {TMC_LINK_LABEL}
      </a>
      {asking && (
        <div className="tmc-notice" id={noticeId} role="note" aria-label="Hinweis zu TellmeCrochet">
          <p className="tmc-notice-title">{TMC_NOTICE_TITLE}</p>
          <ul className="tmc-notice-list">
            {summary.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <div className="tmc-notice-actions">
            <a
              ref={next}
              className="btn btn-primary btn-small"
              href={href}
              target="_blank"
              rel="noopener"
              onClick={() => setAsking(false)}
            >
              {TMC_CONTINUE_LABEL}
            </a>
            <button type="button" className="btn btn-small" onClick={dismiss}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
