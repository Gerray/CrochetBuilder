/// <reference types="vite/client" />

/**
 * Where the TellmeCrochet account lives. Both values come in at build time; without both the
 * upload is simply not offered (see CONTRIBUTING.md, "Upload to TellmeCrochet").
 */

export interface TmcConfig {
  url: string;
  /** Public key of the project, made for browsers. */
  anonKey: string;
}

export interface TmcEnv {
  VITE_TMC_SUPABASE_URL?: unknown;
  VITE_TMC_SUPABASE_ANON_KEY?: unknown;
}

const buildEnv: TmcEnv = {
  VITE_TMC_SUPABASE_URL: import.meta.env.VITE_TMC_SUPABASE_URL,
  VITE_TMC_SUPABASE_ANON_KEY: import.meta.env.VITE_TMC_SUPABASE_ANON_KEY,
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The configuration of this build, or null when a value is missing (an unset variable is empty). */
export function readTmcConfig(env: TmcEnv = buildEnv): TmcConfig | null {
  const url = text(env.VITE_TMC_SUPABASE_URL).replace(/\/+$/, "");
  const anonKey = text(env.VITE_TMC_SUPABASE_ANON_KEY);
  return url && anonKey ? { url, anonKey } : null;
}
