/**
 * A fake TellmeCrochet for tests: the auth client and the `builder-upload` endpoint, in memory.
 * Follows the contract by default; `server.next(action, …)` makes the next call of that action
 * answer otherwise.
 */

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

export const MAIL = "anna@example.org";
export const NOW = Date.UTC(2026, 10, 2, 13, 32);

export function target(extra: Partial<TmcTarget> = {}): TmcTarget {
  return {
    patternId: "pattern-1",
    builderKey: "key-1",
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
      getSession: async () => ({ data: { session }, error: null }),
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
    /** What `check` says about a project, until changed again. */
    checkResult: { changedInApp: false, impact: { progressMoved: 0, markersDropped: 0, partsDropped: 0 }, baseToken: "token-1" },
  };

  const answer = (req: FakeRequest): FakeResponse => {
    const find = (id?: string) => projects.find((p) => p.patternId === id);
    switch (req.action) {
      case "list":
        return { status: 200, body: { projects } };
      case "check": {
        const found = find(req.patternId);
        return found ? { status: 200, body: { target: found, ...server.checkResult } } : ERROR(404, "not-found");
      }
      case "create":
        return {
          status: 200,
          body: { target: target({ patternId: "pattern-new", builderKey: req.builderKey ?? "", origin: req.origin === "imported" ? "imported" : "self_created" }) },
        };
      case "update": {
        const found = find(req.patternId);
        return found ? { status: 200, body: { target: found } } : ERROR(404, "not-found");
      }
      case "share": {
        const found = find(req.patternId);
        return found ? { status: 200, body: { target: { ...found, hasUnsharedChanges: false }, version: 2 } } : ERROR(404, "not-found");
      }
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
    newKey: () => `new-key-${++keys}`,
    now: () => NOW,
  };
  return { services, server, auth, client, loadClient };
}
