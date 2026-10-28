// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PasteParser } from "./client.js";
import { buildPastePreview, type LocaleChoice, type PastePreview } from "./preview.js";
import { usePastePreview } from "./usePastePreview.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A parser whose answers are released by the test, in any order. */
function controlledParser() {
  const jobs: Array<{ text: string; choice: LocaleChoice; resolve: (p: PastePreview) => void }> = [];
  const parser: PasteParser = {
    parse: (text, choice) => new Promise((resolve) => jobs.push({ text, choice, resolve })),
    dispose: vi.fn(),
  };
  const release = async (index: number) => {
    const job = jobs[index]!;
    await act(async () => job.resolve(buildPastePreview(job.text, job.choice)));
  };
  return { parser, jobs, release, create: () => parser };
}

const ONE = "Kopf\nRunde 1: 6 fM in den Fadenring (6)";
const TWO = `${ONE}\nRunde 2: 6 Zun (12)`;

describe("usePastePreview", () => {
  it("debounces typing, keeps the latest answer and drops stale ones", async () => {
    vi.useFakeTimers();
    const { jobs, release, create } = controlledParser();
    const { result, rerender } = renderHook(({ text }) => usePastePreview(text, "auto", { debounceMs: 200, createParser: create }), {
      initialProps: { text: ONE },
    });
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
    expect(result.current.computing).toBe(false);
    // The older answer arrives late and is ignored.
    await release(0);
    expect(result.current.preview?.counts.stitchRows).toBe(2);
  });

  it("clears the preview for an empty text and disposes the parser", async () => {
    const { parser, release, create } = controlledParser();
    const { result, rerender, unmount } = renderHook(({ text }) => usePastePreview(text, "auto", { debounceMs: 0, createParser: create }), {
      initialProps: { text: ONE },
    });
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    await release(0);
    expect(result.current.preview).not.toBeNull();
    rerender({ text: "  " });
    expect(result.current).toEqual({ preview: null, computing: false, error: null });
    unmount();
    expect(parser.dispose).toHaveBeenCalled();
  });
});
