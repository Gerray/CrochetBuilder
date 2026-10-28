import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_MAIN_THREAD_PASTE_CHARS,
  MAX_PASTE_CHARS,
  SupersededError,
  mainThreadParser,
  workerParser,
  type PasteRequest,
  type PasteResponse,
} from "./client.js";
import { buildPastePreview } from "./preview.js";

const TEXT = "Kopf\nRunde 1: 6 fM in den Fadenring (6)\nRunde 2: 6 Zun (12)";
const text = (rounds: number) =>
  [TEXT, ...Array.from({ length: rounds - 2 }, (_, i) => `Runde ${i + 3}: 12 fM (12)`)].join("\n");

afterEach(() => {
  vi.useRealTimers();
});

/** A worker stand-in that answers requests when told to. */
class FakeWorker {
  onmessage: ((e: MessageEvent<PasteResponse>) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  requests: PasteRequest[] = [];
  terminated = false;
  postMessage(message: PasteRequest) {
    this.requests.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  answer(request: PasteRequest) {
    this.onmessage?.({
      data: { id: request.id, preview: buildPastePreview(request.text, request.choice) },
    } as MessageEvent<PasteResponse>);
  }
}

/** Settle state of a promise, for assertions without awaiting it. */
function track<T>(promise: Promise<T>) {
  const state: { value?: T; error?: unknown; settled: boolean } = { settled: false };
  promise.then(
    (value) => Object.assign(state, { value, settled: true }),
    (error: unknown) => Object.assign(state, { error, settled: true }),
  );
  return state;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("paste parser in a worker", () => {
  it("runs one job at a time and keeps only the latest waiting one", async () => {
    const fake = new FakeWorker();
    const parser = workerParser(() => fake);
    expect(parser.maxChars).toBe(MAX_PASTE_CHARS);
    const first = track(parser.parse(text(2), "auto"));
    const second = track(parser.parse(text(3), "auto"));
    const third = track(parser.parse(text(4), "auto"));
    // Only the first job went to the worker; the second was overtaken by the third.
    expect(fake.requests.map((r) => r.text)).toEqual([text(2)]);
    await flush();
    expect(second.error).toBeInstanceOf(SupersededError);

    fake.answer(fake.requests[0]!);
    await flush();
    expect(first.value?.counts.stitchRows).toBe(2);
    // The latest text starts as soon as the worker is free.
    expect(fake.requests.map((r) => r.text)).toEqual([text(2), text(4)]);
    fake.answer(fake.requests[1]!);
    await flush();
    expect(third.value?.counts.stitchRows).toBe(4);
    parser.dispose();
    expect(fake.terminated).toBe(true);
  });

  it("ignores answers to requests it no longer waits for", async () => {
    const fake = new FakeWorker();
    const parser = workerParser(() => fake);
    const first = track(parser.parse(text(2), "auto"));
    fake.onmessage?.({ data: { id: 99, error: "fremd" } } as MessageEvent<PasteResponse>);
    await flush();
    expect(first.settled).toBe(false);
    fake.answer(fake.requests[0]!);
    await flush();
    expect(first.value?.counts.stitchRows).toBe(2);
  });

  it("reports a parse error of the worker", async () => {
    const fake = new FakeWorker();
    const parser = workerParser(() => fake);
    const job = parser.parse(TEXT, "auto");
    fake.onmessage?.({ data: { id: fake.requests[0]!.id, error: "kaputt" } } as MessageEvent<PasteResponse>);
    await expect(job).rejects.toThrow("kaputt");
  });

  it("falls back to the main thread when the worker fails, with the smaller size limit", async () => {
    const fake = new FakeWorker();
    const parser = workerParser(() => fake);
    const pending = parser.parse(TEXT, "auto");
    const waiting = parser.parse(text(3), "auto");
    fake.onerror?.(new Event("error"));
    expect((await pending).parts).toHaveLength(1);
    expect((await waiting).counts.stitchRows).toBe(3);
    expect(fake.terminated).toBe(true);
    expect(parser.maxChars).toBe(MAX_MAIN_THREAD_PASTE_CHARS);
    // Later requests do not try the worker again.
    await parser.parse(TEXT, "auto");
    expect(fake.requests).toHaveLength(1);
  });

  it("falls back when the worker cannot be created", async () => {
    const parser = workerParser(() => {
      throw new Error("CSP");
    });
    expect((await parser.parse(TEXT, "auto")).parts).toHaveLength(1);
  });
});

describe("paste parser on the main thread", () => {
  it("reads a smaller size and does not build up a backlog", async () => {
    vi.useFakeTimers();
    const parser = mainThreadParser();
    expect(parser.maxChars).toBe(MAX_MAIN_THREAD_PASTE_CHARS);
    const first = track(parser.parse(text(2), "auto"));
    const stale = track(parser.parse(text(3), "auto"));
    const latest = track(parser.parse(text(4), "auto"));
    await vi.advanceTimersByTimeAsync(0);
    expect(first.value?.counts.stitchRows).toBe(2);
    expect(stale.error).toBeInstanceOf(SupersededError);
    expect(latest.settled).toBe(false);
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(latest.value?.counts.stitchRows).toBe(4);
  });

  it("drops the waiting job on dispose", async () => {
    vi.useFakeTimers();
    const parser = mainThreadParser();
    track(parser.parse(TEXT, "auto"));
    const waiting = track(parser.parse(text(3), "auto"));
    parser.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(waiting.error).toBeInstanceOf(SupersededError);
  });
});
