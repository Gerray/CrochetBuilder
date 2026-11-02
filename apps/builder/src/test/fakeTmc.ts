/**
 * A fake TellmeCrochet for tests: the auth client and the `builder-upload` endpoint, in memory.
 * Follows the contract by default; `server.next(action, …)` makes the next call of that action
 * answer otherwise.
 */

import { TmcEnvelopeSchema } from "@crochetbuilder/engine";
import { vi } from "vitest";
import type { FetchLike, TmcTarget } from "../tmc/api.js";
import type { TmcAuthClient, TmcAuthError, TmcSession } from "../tmc/client.js";
import type { TmcServices } from "../tmc/services.js";

export type Action = "list" | "check" | "create" | "update" | "share";

export interface FakeRequest {
  action: Action;
  patternId?: string;
  baseToken?: string;
  builderKey?: string;
  origin?: string;
  envelope?: { draft: { parts: unknown[] } };
  partKeys?: string[];
}

export interface FakeResponse {
  status: number;
  body: unknown;
}

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const PATTERN_1 = uuid(1);
export const KEY_1 = uuid(2);
/** The key of the first new project, and the id of the first project made. */
export const NEW_KEY_1 = uuid(101);
export const PATTERN_NEW = uuid(901);

export const MAIL = "anna@example.org";
export const NOW = Date.UTC(2026, 10, 2, 13, 32);

export function target(extra: Partial<TmcTarget> = {}): TmcTarget {
  return {
    patternId: PATTERN_1,
    builderKey: KEY_1,
    title: "Ball",
    origin: "self_created",
    shared: false,
    listed: false,
    hasUnsharedChanges: false,
    updatedAt: "2026-11-01T10:00:00.000Z",
    ...extra,
  };
}

export const ERROR = (status: number, code: string, extra: Record<string, unknown> = {}): FakeResponse => ({
  status,
  body: { error: { code, ...extra } },
});

export function sessionFor(email = MAIL, createdAt = "2025-01-01T00:00:00.000Z"): TmcSession {
  return { access_token: "session-token", user: { email, created_at: createdAt } };
}

export function fakeTmcServices(options: { session?: TmcSession | null; projects?: TmcTarget[] } = {}) {
  let session = options.session === undefined ? sessionFor() : options.session;
  const listeners: Array<(event: string, s: TmcSession | null) => void> = [];
  const setSession = (next: TmcSession | null) => {
    session = next;
    for (const listener of listeners) listener(next ? "SIGNED_IN" : "SIGNED_OUT", next);
  };

  const auth = {
    otpError: null as TmcAuthError | null,
    verifyError: null as TmcAuthError | null,
    oauthError: null as TmcAuthError | null,
    exchangeSession: sessionFor() as TmcSession | null,
    exchangeError: null as TmcAuthError | null,
    /** `getSession` could not tell (offline with an expired token). */
    sessionError: null as TmcAuthError | null,
    calls: {
      signInWithOAuth: vi.fn(),
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      signOut: vi.fn(),
    },
    setSession,
  };

  const client: TmcAuthClient = {
    auth: {
      getSession: async () => (auth.sessionError ? { data: { session: null }, error: auth.sessionError } : { data: { session }, error: null }),
      onAuthStateChange: (callback) => {
        listeners.push(callback);
        return {};
      },
      signInWithOAuth: async (credentials) => {
        auth.calls.signInWithOAuth(credentials);
        return { error: auth.oauthError };
      },
      signInWithOtp: async (credentials) => {
        auth.calls.signInWithOtp(credentials);
        return { error: auth.otpError };
      },
      verifyOtp: async (params) => {
        auth.calls.verifyOtp(params);
        if (auth.verifyError) return { error: auth.verifyError };
        setSession(sessionFor(params.email));
        return { error: null };
      },
      exchangeCodeForSession: async (code) => {
        auth.calls.exchangeCodeForSession(code);
        if (auth.exchangeError) return { data: { session: null }, error: auth.exchangeError };
        session = auth.exchangeSession;
        return { data: { session }, error: null };
      },
      signOut: async (opts) => {
        auth.calls.signOut(opts);
        setSession(null);
        return { error: null };
      },
    },
  };

  const projects = options.projects ?? [];
  const requests: FakeRequest[] = [];
  const queued = new Map<Action, Array<FakeResponse | (() => Promise<FakeResponse>)>>();
  const server = {
    projects,
    requests,
    /** Requests of `action` so far. */
    of: (action: Action) => requests.filter((r) => r.action === action),
    /** The next call of `action` gets this answer. */
    next(action: Action, response: FakeResponse | (() => Promise<FakeResponse>)) {
      queued.set(action, [...(queued.get(action) ?? []), response]);
    },
    /** What `check` says about a project, until changed again. Each check has its own token. */
    checkResult: { changedInApp: false, impact: { progressMoved: 0, markersDropped: 0, partsDropped: 0 } },
    /** What `update` says about the materials. */
    materialsKept: false,
  };

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const ILL_FORMED = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const isUuid = (value: unknown) => typeof value === "string" && UUID.test(value);
  let projectsMade = 0;
  let lastToken: string | null = null;

  /** The endpoint is as strict as the real one: all of this is a 400. */
  const refused = (req: FakeRequest): boolean => {
    const payload = ["envelope", "partKeys"];
    const fields: Record<Action, string[]> = {
      list: ["action"],
      check: ["action", "patternId", ...payload],
      create: ["action", "builderKey", "origin", ...payload],
      update: ["action", "patternId", "baseToken", ...payload],
      share: ["action", "patternId"],
    };
    if (!fields[req.action]) return true;
    if (Object.keys(req).sort().join() !== [...fields[req.action]].sort().join()) return true;
    if ("patternId" in req && !isUuid(req.patternId)) return true;
    if (req.action === "create" && (!isUuid(req.builderKey) || (req.origin !== "self_created" && req.origin !== "imported"))) return true;
    if (req.action === "update" && (typeof req.baseToken !== "string" || req.baseToken === "")) return true;
    if (!("envelope" in req)) return false;
    const envelope = TmcEnvelopeSchema.safeParse(req.envelope);
    if (!envelope.success) return true;
    const { parts } = envelope.data.draft;
    if (parts.some((p) => p.name.trim() === "") || parts.every((p) => p.content.rows.length === 0)) return true;
    const keys = req.partKeys;
    if (!Array.isArray(keys) || keys.length !== parts.length || new Set(keys).size !== keys.length) return true;
    if (keys.some((k) => typeof k !== "string" || k === "" || k.length > 200)) return true;
    return ILL_FORMED.test(JSON.stringify(req.envelope, (_key, value: unknown) => value)) || keys.some((k) => ILL_FORMED.test(k));
  };

  const answer = (req: FakeRequest): FakeResponse => {
    if (refused(req)) return ERROR(400, "invalid");
    const find = (id?: string) => projects.find((p) => p.patternId === id);
    switch (req.action) {
      case "list":
        return { status: 200, body: { projects } };
      case "check": {
        const found = find(req.patternId);
        if (!found) return ERROR(404, "not-found");
        lastToken = `token-${server.of("check").length}`;
        return { status: 200, body: { target: found, ...server.checkResult, baseToken: lastToken } };
      }
      case "create": {
        if (projects.some((p) => p.builderKey === req.builderKey)) return ERROR(409, "key-in-use");
        const made = target({ patternId: uuid(900 + ++projectsMade), builderKey: req.builderKey ?? "", origin: req.origin === "imported" ? "imported" : "self_created" });
        projects.push(made);
        return { status: 200, body: { target: made } };
      }
      case "update": {
        const found = find(req.patternId);
        if (!found) return ERROR(404, "not-found");
        if (req.baseToken !== lastToken) return ERROR(409, "conflict");
        return { status: 200, body: { target: found, materialsKept: server.materialsKept } };
      }
      case "share": {
        const found = find(req.patternId);
        if (!found) return ERROR(404, "not-found");
        if (!found.shared) return ERROR(400, "invalid");
        return { status: 200, body: { target: { ...found, hasUnsharedChanges: false }, version: 2 } };
      }
      default:
        return ERROR(400, "invalid");
    }
  };

  const fetch: FetchLike = async (_url, init) => {
    const req = JSON.parse(init.body) as FakeRequest;
    requests.push(req);
    const next = queued.get(req.action)?.shift();
    const response = next === undefined ? answer(req) : typeof next === "function" ? await next() : next;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
    };
  };

  let keys = 0;
  const loadClient = vi.fn(async () => client);
  const services: TmcServices = {
    config: { url: "https://tmc.test", anonKey: "public-key" },
    loadClient,
    fetch,
    newKey: () => uuid(100 + ++keys),
    now: () => NOW,
  };
  return { services, server, auth, client, loadClient };
}
