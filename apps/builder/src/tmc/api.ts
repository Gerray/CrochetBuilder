/**
 * Typed client of the `builder-upload` endpoint: the only thing the builder talks to. It knows
 * nothing about the UI; every failure is a `TmcApiError` with one of the contract's codes (plus
 * `network` and `server` for what never reached it or came back unreadable).
 */

import type { TmcEnvelope } from "@crochetbuilder/engine";
import type { TmcOrigin } from "../state/uploadLink.js";
import type { TmcAuthClient } from "./client.js";
import type { TmcConfig } from "./config.js";

export const BUILDER_UPLOAD_PATH = "/functions/v1/builder-upload";

export interface TmcTarget {
  patternId: string;
  builderKey: string;
  title: string;
  origin: TmcOrigin;
  shared: boolean;
  listed: boolean;
  hasUnsharedChanges: boolean;
  updatedAt: string;
}

export interface TmcImpact {
  progressMoved: number;
  markersDropped: number;
  partsDropped: number;
}

export interface TmcCheck {
  target: TmcTarget;
  changedInApp: boolean;
  impact: TmcImpact;
  baseToken: string;
}

export interface UploadPayload {
  envelope: TmcEnvelope;
  /** One key per entry of `envelope.draft.parts`. */
  partKeys: string[];
}

export type TmcErrorCode =
  | "invalid"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "key-in-use"
  | "too-large"
  | "rate-limited"
  /** The request never got an answer. */
  | "network"
  /** An answer outside the contract. */
  | "server";

export class TmcApiError extends Error {
  readonly code: TmcErrorCode;
  readonly retryAfterSeconds: number | undefined;
  constructor(code: TmcErrorCode, message?: string, retryAfterSeconds?: number) {
    super(message ?? code);
    this.name = "TmcApiError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type FetchLike = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; headers?: { get(name: string): string | null } }>;

export interface TmcApi {
  list(): Promise<{ projects: TmcTarget[] }>;
  check(patternId: string, payload: UploadPayload): Promise<TmcCheck>;
  create(builderKey: string, origin: TmcOrigin, payload: UploadPayload): Promise<{ target: TmcTarget }>;
  update(patternId: string, baseToken: string, payload: UploadPayload): Promise<{ target: TmcTarget }>;
  share(patternId: string): Promise<{ target: TmcTarget; version: number }>;
}

const CODES: ReadonlySet<string> = new Set<TmcErrorCode>([
  "invalid",
  "unauthorized",
  "forbidden",
  "not-found",
  "conflict",
  "key-in-use",
  "too-large",
  "rate-limited",
]);

const STATUS_CODES: Readonly<Record<number, TmcErrorCode>> = {
  400: "invalid",
  401: "unauthorized",
  403: "forbidden",
  404: "not-found",
  409: "conflict",
  413: "too-large",
  429: "rate-limited",
};

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const seconds = (value: unknown): number | undefined => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** The error of a failed response: by the code in its body, else by its status (a gateway has no body of ours). */
function errorOf(status: number, body: unknown, retryAfterHeader: string | null | undefined): TmcApiError {
  const error = record(record(body)?.error);
  const named = typeof error?.code === "string" && CODES.has(error.code) ? (error.code as TmcErrorCode) : undefined;
  const code = named ?? STATUS_CODES[status] ?? "server";
  const message = typeof error?.message === "string" ? error.message : undefined;
  return new TmcApiError(code, message, seconds(error?.retryAfterSeconds) ?? seconds(retryAfterHeader));
}

function target(value: unknown): TmcTarget {
  const t = record(value);
  const valid =
    t &&
    typeof t.patternId === "string" &&
    typeof t.builderKey === "string" &&
    typeof t.title === "string" &&
    (t.origin === "self_created" || t.origin === "imported") &&
    typeof t.shared === "boolean" &&
    typeof t.listed === "boolean" &&
    typeof t.hasUnsharedChanges === "boolean" &&
    typeof t.updatedAt === "string";
  if (!valid) throw new TmcApiError("server", "Unexpected target in the response.");
  return t as unknown as TmcTarget;
}

const count = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TmcApiError("server", "Unexpected impact in the response.");
  }
  return value;
};

export interface TmcApiOptions {
  /** Hands out the current session (refreshing it when due). */
  client: Pick<TmcAuthClient, "auth">;
  fetch: FetchLike;
  config: TmcConfig;
}

export function createTmcApi({ client, fetch, config }: TmcApiOptions): TmcApi {
  const endpoint = `${config.url}${BUILDER_UPLOAD_PATH}`;

  const call = async (request: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new TmcApiError("unauthorized", "No session.");
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: config.anonKey },
        body: JSON.stringify(request),
      });
    } catch (err) {
      throw new TmcApiError("network", err instanceof Error ? err.message : undefined);
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // A gateway's HTML page: the status says enough on failure, success needs the body.
    }
    if (!response.ok) throw errorOf(response.status, body, response.headers?.get("Retry-After"));
    const out = record(body);
    if (!out) throw new TmcApiError("server", "The response is not JSON.");
    return out;
  };

  return {
    async list() {
      try {
        const out = await call({ action: "list" });
        if (!Array.isArray(out.projects)) throw new TmcApiError("server", "Unexpected list in the response.");
        return { projects: out.projects.map(target) };
      } catch (err) {
        // There is no project to miss here: a missing endpoint, not a missing project.
        if (err instanceof TmcApiError && err.code === "not-found") throw new TmcApiError("server", err.message);
        throw err;
      }
    },
    async check(patternId, payload) {
      const out = await call({ action: "check", patternId, ...payload });
      const impact = record(out.impact);
      if (typeof out.changedInApp !== "boolean" || typeof out.baseToken !== "string" || !impact) {
        throw new TmcApiError("server", "Unexpected check in the response.");
      }
      return {
        target: target(out.target),
        changedInApp: out.changedInApp,
        impact: {
          progressMoved: count(impact.progressMoved),
          markersDropped: count(impact.markersDropped),
          partsDropped: count(impact.partsDropped),
        },
        baseToken: out.baseToken,
      };
    },
    async create(builderKey, origin, payload) {
      return { target: target((await call({ action: "create", builderKey, origin, ...payload })).target) };
    },
    async update(patternId, baseToken, payload) {
      return { target: target((await call({ action: "update", patternId, baseToken, ...payload })).target) };
    },
    async share(patternId) {
      const out = await call({ action: "share", patternId });
      if (typeof out.version !== "number") throw new TmcApiError("server", "Unexpected version in the response.");
      return { target: target(out.target), version: out.version };
    },
  };
}
