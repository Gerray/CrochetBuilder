/**
 * The part of the Supabase client the builder uses, and its lazy loader: the library is only
 * downloaded by people who sign in. The session is kept under a key of its own, in the browser.
 */

import type { TmcConfig } from "./config.js";

export const TMC_STORAGE_KEY = "crochetbuilder:tmc-auth";

export interface TmcUser {
  email?: string | undefined;
  created_at?: string | undefined;
}

export interface TmcSession {
  access_token: string;
  user: TmcUser;
}

export interface TmcAuthError {
  message: string;
  code?: string | undefined;
  status?: number | undefined;
}

interface AuthResult {
  data: { session: TmcSession | null };
  error: TmcAuthError | null;
}

/** Structural subset of `SupabaseClient`; tests hand in a fake. */
export interface TmcAuthClient {
  auth: {
    getSession(): Promise<AuthResult>;
    onAuthStateChange(callback: (event: string, session: TmcSession | null) => void): unknown;
    signInWithOAuth(credentials: { provider: "google"; options: { redirectTo: string } }): Promise<{ error: TmcAuthError | null }>;
    signInWithOtp(credentials: { email: string; options: { shouldCreateUser: boolean } }): Promise<{ error: TmcAuthError | null }>;
    verifyOtp(params: { email: string; token: string; type: "email" }): Promise<{ error: TmcAuthError | null }>;
    exchangeCodeForSession(code: string): Promise<{ data: { session: TmcSession | null }; error: TmcAuthError | null }>;
    signOut(options: { scope: "local" }): Promise<{ error: TmcAuthError | null }>;
  };
}

/** The real client. Only this function touches the library; rejects when it cannot be loaded. */
export async function loadSupabaseClient(config: TmcConfig): Promise<TmcAuthClient> {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(config.url, config.anonKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      storageKey: TMC_STORAGE_KEY,
      // The return from Google is handled in `useTmcAuth`: one place that reads the address bar,
      // and never the fragment, which belongs to the share links.
      detectSessionInUrl: false,
    },
  });
}

/** Whether a session was stored by an earlier visit (then the library is worth loading). */
export function hasStoredSession(): boolean {
  try {
    return globalThis.localStorage?.getItem(TMC_STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

export function forgetStoredSession(): void {
  try {
    globalThis.localStorage?.removeItem(TMC_STORAGE_KEY);
  } catch {
    // nothing stored then
  }
}
