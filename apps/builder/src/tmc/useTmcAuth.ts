/**
 * The sign-in state of the builder. The library is loaded only when it can matter: a session
 * stored by an earlier visit, a return from Google, or the dialog being opened.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { forgetStoredSession, hasStoredSession, type TmcAuthClient, type TmcSession } from "./client.js";
import { cleanRedirectParams, readRedirectParams, takeRedirectMark, type UploadResume } from "./redirect.js";
import type { TmcServices } from "./services.js";
import { GOOGLE_FAILED_LINE } from "./texts.js";

/** An account this young was made by the sign-in itself (Google cannot be limited to existing ones). */
export const NEW_ACCOUNT_WINDOW_MS = 60 * 1000;

export type TmcAuthStatus =
  /** Nothing loaded: no session known, the dialog was not opened. */
  | "idle"
  | "loading"
  | "signedOut"
  | "signedIn"
  /** The library could not be loaded (offline). */
  | "unavailable";

export interface TmcAuth {
  status: TmcAuthStatus;
  email: string | null;
  client: TmcAuthClient | null;
  /** The session ended without the person signing out. */
  expired: boolean;
  /** The Google sign-in just created an account. */
  newAccount: boolean;
  /** Why the return from Google did not sign in (German). */
  redirectError: string | null;
  /** Non-null after a return from Google: the dialog opens again with this. */
  resume: UploadResume | null;
  /** The dialog closed: what the return from Google had to say is said. */
  clearReturn: () => void;
  /** Load the library, if that has not happened yet. */
  ensure: () => void;
  /** Read the session again (after signing in by code). */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** The server no longer accepts the session. */
  sessionExpired: () => void;
}

interface State {
  status: TmcAuthStatus;
  email: string | null;
  client: TmcAuthClient | null;
  expired: boolean;
  newAccount: boolean;
  redirectError: string | null;
  resume: UploadResume | null;
}

const IDLE: State = { status: "idle", email: null, client: null, expired: false, newAccount: false, redirectError: null, resume: null };

function isNewAccount(session: TmcSession | null, now: number): boolean {
  const created = Date.parse(session?.user.created_at ?? "");
  return Number.isFinite(created) && Math.abs(now - created) < NEW_ACCOUNT_WINDOW_MS;
}

export function useTmcAuth(services: TmcServices | null): TmcAuth {
  const [state, setState] = useState<State>(IDLE);
  const started = useRef(false);
  const clientRef = useRef<TmcAuthClient | null>(null);
  // Signing out on purpose is no expired session.
  const signingOut = useRef(false);

  const apply = useCallback((session: TmcSession | null) => {
    setState((s) => {
      if (session) return { ...s, status: "signedIn", email: session.user.email ?? null, expired: false };
      const expired = s.expired || (s.status === "signedIn" && !signingOut.current);
      return { ...s, status: "signedOut", email: null, expired };
    });
  }, []);

  const refresh = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const { data } = await client.auth.getSession();
    apply(data.session);
  }, [apply]);

  /** Load the library once; `first` runs before the session is read (the return from Google). */
  const start = useCallback(
    (first?: (client: TmcAuthClient) => Promise<void>) => {
      if (!services || started.current) return;
      started.current = true;
      setState((s) => ({ ...s, status: "loading" }));
      void services
        .loadClient()
        .then(async (client) => {
          clientRef.current = client;
          setState((s) => ({ ...s, client }));
          await first?.(client);
          client.auth.onAuthStateChange((_event, session) => apply(session));
          await refresh();
        })
        .catch((err: unknown) => {
          console.warn(err);
          started.current = false;
          setState((s) => ({ ...s, status: "unavailable" }));
        });
    },
    [services, apply, refresh],
  );

  useEffect(() => {
    if (!services) return;
    const resume = takeRedirectMark(services.now());
    if (!resume) {
      if (hasStoredSession()) start();
      return;
    }
    // Back from Google. The code is used up by the exchange and leaves the address bar at once.
    const { code, failed } = readRedirectParams(globalThis.location.search);
    cleanRedirectParams();
    setState((s) => ({ ...s, resume, redirectError: failed ? GOOGLE_FAILED_LINE : null }));
    start(async (client) => {
      if (!code) return;
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error) {
        console.warn(error.message);
        setState((s) => ({ ...s, redirectError: GOOGLE_FAILED_LINE }));
      } else {
        const newAccount = isNewAccount(data.session, services.now());
        setState((s) => ({ ...s, newAccount }));
      }
    });
  }, [services, start]);

  const ensure = useCallback(() => start(), [start]);
  const clearReturn = useCallback(() => setState((s) => ({ ...s, resume: null, newAccount: false, redirectError: null })), []);

  const signOut = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    signingOut.current = true;
    try {
      // Only this browser: the app on the phone stays signed in.
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) forgetStoredSession();
    } catch {
      forgetStoredSession();
    }
    apply(null);
    setState((s) => ({ ...s, expired: false, newAccount: false, redirectError: null }));
    signingOut.current = false;
  }, [apply]);

  const sessionExpired = useCallback(() => {
    apply(null);
    void clientRef.current?.auth.signOut({ scope: "local" }).catch(() => forgetStoredSession());
  }, [apply]);

  return { ...state, clearReturn, ensure, refresh, signOut, sessionExpired };
}
