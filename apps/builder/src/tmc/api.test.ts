import { describe, expect, it, vi } from "vitest";
import { toTmcEnvelope, type TmcDraft } from "@crochetbuilder/engine";
import { BUILDER_UPLOAD_PATH, createTmcApi, TmcApiError, type FetchLike, type TmcErrorCode } from "./api.js";
import { target } from "../test/fakeTmc.js";

const draft: TmcDraft = {
  schemaVersion: 1,
  title: "Ball",
  materials: [],
  parts: [{ name: "Ball", quantity: 1, content: { schemaVersion: 1, rows: [] }, stitchCheck: [] }],
};
const payload = { envelope: toTmcEnvelope(draft, "imported"), partKeys: ["ball"] };

function make(status: number, body: unknown, options: { token?: string | null; header?: string; rejects?: Error } = {}) {
  const fetch = vi.fn<FetchLike>(async () => {
    if (options.rejects) throw options.rejects;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body === undefined) throw new SyntaxError("not json");
        return body;
      },
      headers: { get: (name) => (name === "Retry-After" ? (options.header ?? null) : null) },
    };
  });
  const token = options.token === undefined ? "session-token" : options.token;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: token ? { access_token: token, user: {} } : null }, error: null }),
    },
  } as never;
  const api = createTmcApi({ client, fetch, config: { url: "https://tmc.test", anonKey: "public-key" } });
  return { api, fetch };
}

const sent = (fetch: ReturnType<typeof make>["fetch"]) => JSON.parse(fetch.mock.calls[0]![1].body) as Record<string, unknown>;

describe("the builder-upload client", () => {
  it("posts JSON to the endpoint with the session and the public key", async () => {
    const { api, fetch } = make(200, { projects: [] });
    await api.list();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`https://tmc.test${BUILDER_UPLOAD_PATH}`);
    expect(url).toBe("https://tmc.test/functions/v1/builder-upload");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer session-token", apikey: "public-key" });
  });

  it("list", async () => {
    const { api, fetch } = make(200, { projects: [target()] });
    expect(await api.list()).toEqual({ projects: [target()] });
    expect(sent(fetch)).toEqual({ action: "list" });
  });

  it("check", async () => {
    const answer = {
      target: target({ shared: true }),
      changedInApp: true,
      impact: { progressMoved: 1, markersDropped: 2, partsDropped: 3 },
      baseToken: "token-1",
    };
    const { api, fetch } = make(200, answer);
    expect(await api.check("p1", payload)).toEqual(answer);
    expect(sent(fetch)).toEqual({ action: "check", patternId: "p1", envelope: payload.envelope, partKeys: ["ball"] });
  });

  it("create", async () => {
    const { api, fetch } = make(200, { target: target() });
    expect(await api.create("key-9", "imported", payload)).toEqual({ target: target() });
    expect(sent(fetch)).toEqual({ action: "create", builderKey: "key-9", origin: "imported", envelope: payload.envelope, partKeys: ["ball"] });
  });

  it("update", async () => {
    const { api, fetch } = make(200, { target: target() });
    expect(await api.update("p1", "token-1", payload)).toEqual({ target: target() });
    expect(sent(fetch)).toEqual({ action: "update", patternId: "p1", baseToken: "token-1", envelope: payload.envelope, partKeys: ["ball"] });
  });

  it("share", async () => {
    const { api, fetch } = make(200, { target: target(), version: 4 });
    expect(await api.share("p1")).toEqual({ target: target(), version: 4 });
    expect(sent(fetch)).toEqual({ action: "share", patternId: "p1" });
  });
});

describe("errors of the client", () => {
  const failure = async (promise: Promise<unknown>) => {
    const err = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TmcApiError);
    return err as TmcApiError;
  };

  const CONTRACT: Array<[number, TmcErrorCode]> = [
    [400, "invalid"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not-found"],
    [409, "conflict"],
    [409, "key-in-use"],
    [413, "too-large"],
    [429, "rate-limited"],
  ];

  it.each(CONTRACT)("%i %s comes through as that code", async (status, code) => {
    const { api } = make(status, { error: { code, message: "details" } });
    const err = await failure(api.update("p1", "t", payload));
    expect(err.code).toBe(code);
    expect(err.message).toBe("details");
  });

  it("rate-limited carries the waiting time, from the body or else the header", async () => {
    expect((await failure(make(429, { error: { code: "rate-limited", retryAfterSeconds: 90 } }).api.share("p"))).retryAfterSeconds).toBe(90);
    expect((await failure(make(429, null, { header: "120" }).api.share("p"))).retryAfterSeconds).toBe(120);
    expect((await failure(make(429, { error: { code: "rate-limited" } }).api.share("p"))).retryAfterSeconds).toBeUndefined();
  });

  it("an answer without our body goes by its status (a gateway in front of the endpoint)", async () => {
    expect((await failure(make(401, { code: 401, message: "Invalid JWT" }).api.share("p"))).code).toBe("unauthorized");
    expect((await failure(make(413, undefined).api.share("p"))).code).toBe("too-large");
    expect((await failure(make(500, undefined).api.share("p"))).code).toBe("server");
    expect((await failure(make(418, { error: { code: "something-new" } }).api.share("p"))).code).toBe("server");
  });

  it("no answer at all is a network failure", async () => {
    const { api } = make(200, {}, { rejects: new TypeError("Failed to fetch") });
    expect((await failure(api.list())).code).toBe("network");
  });

  it("a missing session never reaches the endpoint", async () => {
    const { api, fetch } = make(200, {}, { token: null });
    expect((await failure(api.list())).code).toBe("unauthorized");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a missing endpoint is not a missing project", async () => {
    expect((await failure(make(404, { code: "NOT_FOUND" }).api.list())).code).toBe("server");
  });

  it("an answer outside the contract is reported, not passed on", async () => {
    expect((await failure(make(200, undefined).api.list())).code).toBe("server");
    expect((await failure(make(200, { projects: "x" }).api.list())).code).toBe("server");
    expect((await failure(make(200, { projects: [{ patternId: "p" }] }).api.list())).code).toBe("server");
    expect((await failure(make(200, { target: target({ origin: "bought" as never }) }).api.update("p", "t", payload))).code).toBe("server");
    expect((await failure(make(200, { target: target() }).api.share("p"))).code).toBe("server");
    const check = { target: target(), changedInApp: false, impact: { progressMoved: 0, markersDropped: -1, partsDropped: 0 }, baseToken: "t" };
    expect((await failure(make(200, check).api.check("p", payload))).code).toBe("server");
    expect((await failure(make(200, { ...check, impact: undefined }).api.check("p", payload))).code).toBe("server");
  });
});
