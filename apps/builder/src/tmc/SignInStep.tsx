import { useId, useRef, useState, type FormEvent } from "react";
import type { TmcAuth } from "./useTmcAuth.js";
import type { TmcAuthClient, TmcAuthError } from "./client.js";
import { clearRedirectMark, markRedirect, redirectTarget, type UploadResume } from "./redirect.js";
import { APP_STORE_URL, CODE_HINT, CODE_REJECTED_LINE, EXPIRED_LINE, GOOGLE_FAILED_LINE, IMPRINT_URL, NO_ACCOUNT_LINE, PRIVACY_URL } from "./texts.js";

const CODE_LENGTH = 6;

interface SignInStepProps {
  client: TmcAuthClient;
  auth: Pick<TmcAuth, "expired" | "redirectError" | "refresh">;
  /** What the dialog had chosen, kept across the trip to Google. */
  resume: UploadResume;
  now: () => number;
  /** Tests: the page address. */
  href?: string;
}

/** Whether the server refused the code because the address has no account (no sign-ups here). */
function noAccount(error: TmcAuthError): boolean {
  return error.code === "otp_disabled" || error.code === "user_not_found" || /signups? not allowed|user not found/i.test(error.message);
}

function sendErrorLine(error: TmcAuthError): string {
  if (error.status === 429 || /rate.?limit/i.test(error.code ?? "")) return "Zu viele Versuche. Warte kurz und versuche es dann noch einmal.";
  return "Der Code konnte nicht verschickt werden. Prüfe die Adresse und versuche es noch einmal.";
}

/**
 * "Mit Google anmelden" or a 6-digit code by mail. No sign-up here, except that Google cannot be
 * limited to existing accounts (the dialog says so afterwards).
 */
export function SignInStep({ client, auth, resume, now, href = globalThis.location?.href ?? "" }: SignInStepProps) {
  const [step, setStep] = useState<"address" | "code">("address");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const running = useRef(false);
  const emailId = useId();
  const codeId = useId();

  const guarded = async (task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setMissing(false);
    try {
      await task();
    } catch (err) {
      console.warn(err);
      setError("Keine Verbindung zu TellmeCrochet. Prüfe deine Internetverbindung und versuche es noch einmal.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const google = () =>
    guarded(async () => {
      markRedirect(resume, now());
      try {
        const { error: failed } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTarget(href) } });
        if (!failed) return;
        console.warn(failed.message);
        setError(GOOGLE_FAILED_LINE);
      } catch (err) {
        clearRedirectMark();
        throw err;
      }
      clearRedirectMark();
    });

  const send = () =>
    guarded(async () => {
      const address = email.trim();
      const { error: failed } = await client.auth.signInWithOtp({ email: address, options: { shouldCreateUser: false } });
      if (failed) {
        if (noAccount(failed)) setMissing(true);
        else setError(sendErrorLine(failed));
        return;
      }
      setCode("");
      setStep("code");
    });

  const verify = () =>
    guarded(async () => {
      const { error: failed } = await client.auth.verifyOtp({ email: email.trim(), token: code, type: "email" });
      if (failed) {
        console.warn(failed.message);
        setError(CODE_REJECTED_LINE);
        return;
      }
      await auth.refresh();
    });

  const onSendSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim()) void send();
  };
  const onCodeSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === CODE_LENGTH) void verify();
  };

  return (
    <div className="upload-signin">
      {auth.expired && <p className="upload-notice">{EXPIRED_LINE}</p>}
      {auth.redirectError && !error && (
        <p className="upload-error" role="alert">
          {auth.redirectError}
        </p>
      )}
      {step === "address" ? (
        <>
          <p className="muted small upload-lead">Melde dich mit deinem TellmeCrochet-Konto an.</p>
          <button type="button" className="btn upload-google" disabled={busy} onClick={() => void google()}>
            Mit Google anmelden
          </button>
          <p className="upload-or muted small">oder mit einem Code per E-Mail</p>
          <form className="upload-form" onSubmit={onSendSubmit}>
            <label htmlFor={emailId} className="small">
              E-Mail-Adresse
            </label>
            <div className="upload-form-row">
              <input
                id={emailId}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" className="btn" disabled={busy || !email.trim()}>
                Code senden
              </button>
            </div>
          </form>
        </>
      ) : (
        <form className="upload-form" onSubmit={onCodeSubmit}>
          <p className="small upload-lead">
            Wir haben einen 6-stelligen Code an <strong>{email.trim()}</strong> geschickt.
          </p>
          <p className="muted small upload-lead">{CODE_HINT}</p>
          <label htmlFor={codeId} className="small">
            Code aus der E-Mail
          </label>
          <div className="upload-form-row">
            <input
              id={codeId}
              className="upload-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || code.length !== CODE_LENGTH}>
              Anmelden
            </button>
          </div>
          <div className="upload-links">
            <button type="button" className="btn btn-small btn-quiet" disabled={busy} onClick={() => void send()}>
              Neuen Code senden
            </button>
            <button
              type="button"
              className="btn btn-small btn-quiet"
              disabled={busy}
              onClick={() => {
                setStep("address");
                setError(null);
              }}
            >
              Andere Adresse
            </button>
          </div>
        </form>
      )}
      {missing && (
        <p className="upload-notice" role="alert">
          {NO_ACCOUNT_LINE}{" "}
          <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
            TellmeCrochet bei Google Play
          </a>
        </p>
      )}
      {error && (
        <p className="upload-error" role="alert">
          {error}
        </p>
      )}
      <p className="upload-legal small">
        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
          Datenschutz
        </a>
        <a href={IMPRINT_URL} target="_blank" rel="noopener noreferrer">
          Impressum
        </a>
      </p>
    </div>
  );
}
