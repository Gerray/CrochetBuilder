/**
 * Signing in with Google leaves the page and comes back. The document is safe in its autosave;
 * this flag brings the dialog back, with what was already chosen in it, and tells the return from
 * Google apart from any other address with a `?code=`.
 */

import type { TmcOrigin } from "../state/uploadLink.js";

const REDIRECT_KEY = "crochetbuilder:tmc-redirect";
/** An older flag is a sign-in that was given up on, not a return. */
const MAX_AGE_MS = 30 * 60 * 1000;

/** What the dialog had chosen before it left the page. */
export interface UploadResume {
  /** "new" or a project's id. */
  choice?: string;
  origin?: TmcOrigin;
}

export function markRedirect(resume: UploadResume, now: number): void {
  try {
    globalThis.sessionStorage?.setItem(REDIRECT_KEY, JSON.stringify({ ...resume, at: now }));
  } catch {
    // Without session storage the dialog just stays closed afterwards; the sign-in still counts.
  }
}

export function clearRedirectMark(): void {
  try {
    globalThis.sessionStorage?.removeItem(REDIRECT_KEY);
  } catch {
    // nothing stored then
  }
}

/** The flag of a redirect that just came back (it is used up by reading), or null. */
export function takeRedirectMark(now: number): UploadResume | null {
  let raw: string | null | undefined;
  try {
    raw = globalThis.sessionStorage?.getItem(REDIRECT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  clearRedirectMark();
  try {
    const { choice, origin, at } = JSON.parse(raw) as { choice?: unknown; origin?: unknown; at?: unknown };
    if (typeof at !== "number" || now - at > MAX_AGE_MS) return null;
    return {
      ...(typeof choice === "string" ? { choice } : {}),
      ...(origin === "self_created" || origin === "imported" ? { origin } : {}),
    };
  } catch {
    return null;
  }
}

/** Where Google sends the person back to: this page, without query and fragment. */
export function redirectTarget(href: string): string {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  return url.href;
}

/** What Google or the sign-in server left in the address bar. */
export function readRedirectParams(search: string): { code: string | null; failed: boolean } {
  const params = new URLSearchParams(search);
  return { code: params.get("code"), failed: params.has("error") || params.has("error_description") };
}

const SIGN_IN_PARAMS = ["code", "state", "error", "error_code", "error_description"];

/** The address without the sign-in's parameters; other parameters and the fragment stay. */
export function withoutRedirectParams(href: string): string {
  const url = new URL(href);
  for (const name of SIGN_IN_PARAMS) url.searchParams.delete(name);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function cleanRedirectParams(): void {
  try {
    globalThis.history.replaceState(globalThis.history.state, "", withoutRedirectParams(globalThis.location.href));
  } catch {
    // The address keeps the used-up code; nothing reads it again without the flag.
  }
}
