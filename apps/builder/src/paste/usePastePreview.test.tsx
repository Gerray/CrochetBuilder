// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { SupersededError, type PasteParser } from "./client.js";
import { buildPastePreview, type LocaleChoice, type PastePreview } from "./preview.js";
import { tooLongMessage, usePastePreview } from "./usePastePreview.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A parser whose answers are released by the test, in any order. */
function controlledParser(maxChars = 200_000) {
  const jobs: Array<{
    text: string;
    choice: LocaleChoice;
    resolve: (p: PastePreview) => void;
    reject: (e: unknown) => void;
  }> = [];
  const parser: PasteParser = {
    maxChars,
    parse: (text, choice) => new Promise((resolve, reject) => jobs.push({ text, choice, resolve, reject })),
    dispose: vi.fn(),
  };
  const release = async (index: number) => {
    const job = jobs[index]!;
    await act(async () => job.resolve(buildPastePreview(job.text, job.choice)));
  };
  const fail = async (index: number, err: unknown) => {
    await act(async () => jobs[index]!.reject(err));
  };
  return { parser, jobs, release, fail, create: () => parser };
}

const ONE = "Kopf\nRunde 1: 6 fM in den Fadenring (6)";
const TWO = `${ONE}\nRunde 2: 6 Zun (12)`;
const tick = () => act(async () => new Promise((r) => setTimeout(r, 0)));

describe("usePastePreview", () => {
  it("debounces typing, keeps the latest answer and drops stale ones", async () => {
    vi.useFakeTimers();
    const { jobs, release, create } = controlledParser();
    const { result, rerender } = renderHook(
      ({ text }) => usePastePreview(text, "auto", { debounceMs: 200, createParser: create }),
      { initialProps: { text: ONE } },
    );
    // The first text is read at once.
    await act(async () => vi.advanceTimersByTime(0));
    expect(jobs).toHaveLength(1);
    expect(result.current.computing).toBe(true);

    rerender({ text: TWO });
    await act(async () => vi.advanceTimersByTime(100));
    expect(jobs).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(100));
    expect(jobs).toHaveLength(2);

    await release(1);
    expect(result.current.preview?.counts.stitchRows).toBe(2);
    expect(result.current.text).toBe(TWO);
    expect(result.current.computing).toBe(false);
    // The older answer arrives late and is ignored.
    await release(0);
    expect(result.current.preview?.counts.stitchRows).toBe(2);
  });

  it("clears the preview for an empty text and disposes the parser", async () => {
    const { parser, release, create } = controlledParser();
    const { result, rerender, unmount } = renderHook(
      ({ text }) => usePastePreview(text, "auto", { debounceMs: 0, createParser: create }),
      { initialProps: { text: ONE } },
    );
    await tick();
    await release(0);
    expect(result.current.preview).not.toBeNull();
    rerender({ text: "  " });
    expect(result.current).toMatchObject({ preview: null, computing: false, error: null });
    unmount();
    expect(parser.dispose).toHaveBeenCalled();
  });

  it("drops the preview and reports a failure instead of keeping an outdated one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { release, fail, create } = controlledParser();
    const { result, rerender } = renderHook(
      ({ text }) => usePastePreview(text, "auto", { debounceMs: 0, createParser: create }),
      { initialProps: { text: ONE } },
    );
    await tick();
    await release(0);
    rerender({ text: TWO });
    await tick();
    await fail(1, new Error("Worker abgestürzt"));
    expect(result.current).toMatchObject({
      preview: null,
      computing: false,
      error: "Der Text konnte nicht gelesen werden: Worker abgestürzt",
    });
  });

  it("ignores a superseded request", async () => {
    const { fail, create } = controlledParser();
    const { result } = renderHook(() => usePastePreview(ONE, "auto", { debounceMs: 0, createParser: create }));
    await tick();
    await fail(0, new SupersededError());
    expect(result.current.error).toBeNull();
    expect(result.current.computing).toBe(true);
  });

  it("does not read a text over the parser's limit", async () => {
    const { jobs, create } = controlledParser(50);
    const long = `${ONE}\n${"Runde 2: 6 Zun (12)\n".repeat(5)}`;
    const { result } = renderHook(() => usePastePreview(long, "auto", { debounceMs: 0, createParser: create }));
    await tick();
    expect(jobs).toHaveLength(0);
    expect(result.current).toMatchObject({ preview: null, computing: false, error: tooLongMessage(long.length, 50) });
    expect(tooLongMessage(250_000, 200_000)).toBe(
      "Der Text ist zu lang (250 KB) – höchstens 200 KB auf einmal. Bitte die Anleitung in Teilen einfügen und mit „Teile hinzufügen“ ergänzen.",
    );
  });
});
