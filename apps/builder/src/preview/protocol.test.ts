import { describe, expect, it, vi } from "vitest";
import { buildModel, type PartContent, type Row } from "@crochetbuilder/engine";
import {
  geometryKey,
  mainThreadBackend,
  PreviewClient,
  PreviewComputer,
  transferablesOf,
  workerBackend,
  type BackendFactory,
  type PreviewRequest,
  type PreviewResult,
  type WorkerLike,
} from "./protocol.js";

const row = (id: string, ops: Row["ops"], target: number): Row => ({ id, type: "round", ops, stitchCountTarget: target });
const DISC: PartContent = {
  schemaVersion: 1,
  rows: [
    row("r1", [{ kind: "stitch", code: "MR", count: 1 }, { kind: "stitch", code: "SC", count: 6 }], 6),
    row("r2", [{ kind: "stitch", code: "INC", count: 6 }], 12),
  ],
};
const EMPTY: PartContent = { schemaVersion: 1, rows: [row("e", [], 0)] };
const req = (id: number, content: PartContent = DISC, style: PreviewRequest["style"] = "surface"): PreviewRequest => ({
  id,
  content,
  gauge: undefined,
  style,
});

describe("PreviewComputer", () => {
  it("builds a mesh with the row of every node", () => {
    const result = new PreviewComputer().compute(req(1));
    expect(result.kind).toBe("model");
    if (result.kind !== "model") return;
    const m = result.model;
    expect(result.id).toBe(1);
    expect(m.rowIds).toEqual(["r1", "r2"]);
    // MR + 6 SC in round 1, 6 INC in round 2.
    expect(Array.from(m.nodeRow)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
    expect(m.positions.length).toBe(3 * 13);
    expect(m.nodeIndex.length).toBe(13);
    expect(m.primitive).toBe("triangles");
    expect(m.size.width).toBeGreaterThan(0);
    expect(m.maxDiameter).toBeGreaterThan(0);
    expect(m.estimated).toBe(true);
    expect(m.stitchCount).toBe(13);
  });

  it("reports an empty pattern, the stitch budget and errors", () => {
    const c = new PreviewComputer();
    expect(c.compute(req(1, EMPTY))).toEqual({ id: 1, kind: "empty" });
    expect(c.compute({ ...req(2), maxStitches: 5 })).toEqual({ id: 2, kind: "overBudget", stitchCount: 13, maxStitches: 5 });
    const failing = new PreviewComputer(() => {
      throw new Error("kaputt");
    });
    expect(failing.compute(req(3))).toEqual({ id: 3, kind: "error", message: "kaputt" });
  });

  it("relaxes once per pattern: a style switch reuses the model", () => {
    const build = vi.fn(buildModel);
    const c = new PreviewComputer(build);
    const a = c.compute(req(1, DISC, "surface"));
    const b = c.compute(req(2, DISC, "tube"));
    const p = c.compute(req(3, DISC, "points"));
    expect(build).toHaveBeenCalledTimes(1);
    expect(a.kind === "model" && b.kind === "model" && p.kind === "model").toBe(true);
    if (b.kind === "model") expect(b.model.nodeIndex.length).toBeGreaterThan(13); // tube rings
    if (p.kind === "model") expect(p.model.primitive).toBe("points");
    c.compute(req(4, { ...DISC, rows: DISC.rows.slice(0, 1) }));
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("caches by geometry only: labels, notes and targets do not relax again", () => {
    const build = vi.fn(buildModel);
    const c = new PreviewComputer(build);
    c.compute(req(1));
    const relabelled: PartContent = {
      ...DISC,
      rows: DISC.rows.map((r) => ({ ...r, label: "Boden", note: "Faden markieren", stitchCountTarget: 99 })),
    };
    c.compute(req(2, relabelled));
    expect(build).toHaveBeenCalledTimes(1);
    c.compute({ ...req(3), gauge: { stitchesPer10cm: 18 } });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("geometryKey tells instruction rows from empty stitch rows and ignores texts", () => {
    const empty: PartContent = { schemaVersion: 1, rows: [row("x", [], 0)] };
    const note: PartContent = { schemaVersion: 1, rows: [{ ...row("x", [], 0), note: "Augen einsetzen" }] };
    const otherNote: PartContent = { schemaVersion: 1, rows: [{ ...row("x", [], 0), note: "Füllen" }] };
    expect(geometryKey(empty, undefined, 10)).not.toBe(geometryKey(note, undefined, 10));
    expect(geometryKey(note, undefined, 10)).toBe(geometryKey(otherNote, undefined, 10));
    expect(geometryKey(DISC, undefined, 10)).not.toBe(geometryKey(DISC, undefined, 11));
    const turned: PartContent = { ...DISC, rows: DISC.rows.map((r) => ({ ...r, type: "row" as const })) };
    expect(geometryKey(DISC, undefined, 10)).not.toBe(geometryKey(turned, undefined, 10));
  });

  it("lists every buffer of a model result for transfer, none otherwise", () => {
    const result = new PreviewComputer().compute(req(1));
    const buffers = transferablesOf(result);
    expect(buffers).toHaveLength(5);
    expect(new Set(buffers).size).toBe(5);
    expect(transferablesOf({ id: 1, kind: "empty" })).toEqual([]);
    // The stitch lattice carries its backing surface, also transferred.
    const stitches = transferablesOf(new PreviewComputer().compute(req(2, DISC, "stitches")));
    expect(stitches).toHaveLength(8);
    expect(new Set(stitches).size).toBe(8);
  });

  it("gives the stitch lattice a backing surface just behind the yarn, one vertex per stitch", () => {
    const c = new PreviewComputer();
    const r = c.compute(req(1, DISC, "stitches"));
    const s = c.compute(req(2, DISC, "surface"));
    if (r.kind !== "model" || s.kind !== "model") throw new Error("expected models");
    expect(r.model.style).toBe("stitches");
    expect(s.model.backing).toBeUndefined();
    const b = r.model.backing!;
    expect(b.positions.length).toBe(s.model.positions.length);
    expect(Array.from(b.indices)).toEqual(Array.from(s.model.indices));
    // Moved back along the fabric normal by less than a yarn diameter.
    for (let v = 0; v < b.positions.length / 3; v++) {
      let along = 0, off = 0;
      for (let k = 0; k < 3; k++) {
        const d = b.positions[3 * v + k]! - s.model.positions[3 * v + k]!;
        along += d * s.model.normals[3 * v + k]!;
        off += d * d;
      }
      expect(along).toBeLessThan(0);
      expect(Math.sqrt(off)).toBeLessThan(r.model.yarnDiameterMm);
    }
  });
});

/** A backend that answers only when the test says so. */
function manualBackend() {
  const posted: PreviewRequest[] = [];
  let answer: (r: PreviewResult) => void = () => {};
  let fail: (e: unknown) => void = () => {};
  let disposed = 0;
  const factory: BackendFactory = (onResult, onFailure) => {
    answer = onResult;
    fail = onFailure;
    return { post: (r) => posted.push(r), dispose: () => void disposed++ };
  };
  return {
    factory,
    posted,
    reply: (id: number) => answer({ id, kind: "empty" }),
    fail: (e: unknown) => fail(e),
    get disposed() {
      return disposed;
    },
  };
}

const input = { content: DISC, gauge: undefined, style: "surface" as const };

describe("PreviewClient", () => {
  it("resolves the newest request and drops stale ones", async () => {
    const backend = manualBackend();
    const client = new PreviewClient(backend.factory);
    const first = client.compute(input);
    const second = client.compute(input);
    const third = client.compute(input);
    // Only the first is in flight; the third replaced the second in the waiting slot.
    expect(backend.posted.map((r) => r.id)).toEqual([1]);
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    backend.reply(1); // stale result: ignored, the waiting request goes out
    expect(backend.posted.map((r) => r.id)).toEqual([1, 3]);
    expect(client.busy).toBe(true);
    backend.reply(3);
    expect(await third).toEqual({ id: 3, kind: "empty" });
    expect(client.busy).toBe(false);
  });

  it("ignores results for requests that are not in flight", async () => {
    const backend = manualBackend();
    const client = new PreviewClient(backend.factory);
    const p = client.compute(input);
    backend.reply(99);
    expect(client.busy).toBe(true);
    backend.reply(1);
    expect(await p).toEqual({ id: 1, kind: "empty" });
  });

  it("falls back once when the backend fails and re-sends the pending request with the smaller budget", async () => {
    const primary = manualBackend();
    const fallback = manualBackend();
    const onFallback = vi.fn();
    const client = new PreviewClient(primary.factory, {
      fallback: fallback.factory,
      fallbackMaxStitches: 5000,
      onFallback,
    });
    const p = client.compute(input);
    expect(primary.posted[0]!.maxStitches).toBeUndefined();
    expect(client.degraded).toBe(false);
    primary.fail(new Error("no worker"));
    expect(primary.disposed).toBe(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(client.degraded).toBe(true);
    expect(fallback.posted.map((r) => [r.id, r.maxStitches])).toEqual([[1, 5000]]);
    fallback.reply(1);
    expect(await p).toEqual({ id: 1, kind: "empty" });
    // Later requests keep the smaller budget (never raise a smaller requested one).
    void client.compute({ ...input, maxStitches: 100 });
    expect(fallback.posted[1]!.maxStitches).toBe(100);
  });

  it("a main-thread primary has its own budget and reports degraded mode", () => {
    const primary = manualBackend();
    const client = new PreviewClient(primary.factory, { maxStitches: 5000, mainThread: true });
    void client.compute(input);
    expect(primary.posted[0]!.maxStitches).toBe(5000);
    expect(client.degraded).toBe(true);
  });

  it("a throwing post (DataCloneError) fails over instead of wedging the client", async () => {
    const fallback = manualBackend();
    const throwing: BackendFactory = () => ({
      post() {
        throw new DOMException("could not be cloned", "DataCloneError");
      },
      dispose() {},
    });
    const client = new PreviewClient(throwing, { fallback: fallback.factory });
    const p = client.compute(input);
    expect(fallback.posted.map((r) => r.id)).toEqual([1]);
    fallback.reply(1);
    expect(await p).toEqual({ id: 1, kind: "empty" });
    expect(client.busy).toBe(false);
  });

  it("a throwing post without fallback resolves with an error, and the client stays usable", async () => {
    const throwing: BackendFactory = () => ({
      post() {
        throw new Error("could not be cloned");
      },
      dispose() {},
    });
    const client = new PreviewClient(throwing);
    expect(await client.compute(input)).toEqual({ id: 1, kind: "error", message: "could not be cloned" });
    expect(await client.compute(input)).toEqual({ id: 2, kind: "error", message: "could not be cloned" });
    expect(client.busy).toBe(false);
  });

  it("a backend that never answers is given up after the watchdog timeout", async () => {
    vi.useFakeTimers();
    try {
      const silent = manualBackend();
      const fallback = manualBackend();
      const client = new PreviewClient(silent.factory, { fallback: fallback.factory, watchdogMs: 1000 });
      const p = client.compute(input);
      vi.advanceTimersByTime(999);
      expect(fallback.posted).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(silent.disposed).toBe(1);
      expect(fallback.posted.map((r) => r.id)).toEqual([1]);
      fallback.reply(1);
      expect(await p).toEqual({ id: 1, kind: "empty" });
      // An answered request clears the watchdog: no failover of the fallback.
      vi.advanceTimersByTime(5000);
      expect(fallback.disposed).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the watchdog of a waiting request restarts when it is sent", () => {
    vi.useFakeTimers();
    try {
      const backend = manualBackend();
      const client = new PreviewClient(backend.factory, { watchdogMs: 1000 });
      void client.compute(input);
      void client.compute(input);
      vi.advanceTimersByTime(900);
      backend.reply(1); // sends request 2 and restarts the watchdog
      vi.advanceTimersByTime(900);
      expect(backend.disposed).toBe(0);
      vi.advanceTimersByTime(100);
      expect(backend.disposed).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("without a fallback, a failure answers with an error result", async () => {
    const primary = manualBackend();
    const client = new PreviewClient(primary.factory);
    const p = client.compute(input);
    primary.fail(new Error("no worker"));
    expect(await p).toEqual({ id: 1, kind: "error", message: "no worker" });
  });

  it("dispose resolves waiting requests with null and releases the backend", async () => {
    const backend = manualBackend();
    const client = new PreviewClient(backend.factory);
    const p = client.compute(input);
    client.dispose();
    expect(await p).toBeNull();
    expect(backend.disposed).toBe(1);
    expect(await client.compute(input)).toBeNull();
  });
});

describe("backends", () => {
  it("main thread: computes one macrotask later and only the latest request", async () => {
    const results: PreviewResult[] = [];
    const backend = mainThreadBackend()((r) => results.push(r), () => {});
    backend.post(req(1));
    backend.post(req(2, EMPTY));
    expect(results).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(results).toEqual([{ id: 2, kind: "empty" }]);
    backend.post(req(3));
    backend.dispose();
    await new Promise((r) => setTimeout(r, 0));
    expect(results).toHaveLength(1);
  });

  it("worker: posts requests, forwards results and reports load errors", () => {
    const fake: WorkerLike & { sent: unknown[]; terminated: boolean } = {
      sent: [],
      terminated: false,
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage(m) {
        this.sent.push(m);
      },
      terminate() {
        this.terminated = true;
      },
    };
    const results: PreviewResult[] = [];
    const failures: unknown[] = [];
    const backend = workerBackend(() => fake)((r) => results.push(r), (e) => failures.push(e));
    backend.post(req(7));
    expect(fake.sent).toEqual([req(7)]);
    fake.onmessage?.({ data: { id: 7, kind: "empty" } } as MessageEvent);
    expect(results).toEqual([{ id: 7, kind: "empty" }]);
    const preventDefault = vi.fn();
    fake.onerror?.({ message: "", preventDefault } as unknown as ErrorEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect((failures[0] as Error).message).toBe("Worker konnte nicht starten");
    fake.onmessageerror?.({} as MessageEvent);
    expect((failures[1] as Error).message).toBe("Antwort der Vorschau-Berechnung unlesbar");
    backend.dispose();
    expect(fake.terminated).toBe(true);
    expect(fake.onmessage).toBeNull();
    expect(fake.onmessageerror).toBeNull();
  });
});
