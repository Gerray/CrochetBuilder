// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { MeshStyle, PartContent } from "@crochetbuilder/engine";
import { PreviewClient, type BackendFactory, type PreviewModel, type PreviewRequest } from "./protocol.js";
import { usePreviewModel, type PreviewOptions, type PreviewState } from "./usePreviewModel.js";

const content = (tag: string): PartContent => ({ schemaVersion: 1, rows: [{ id: tag, type: "round", ops: [], stitchCountTarget: 0 }] });
const tagOf = (state: PreviewState | null) => (state?.model as unknown as { tag: string } | null)?.tag;

/** Answers after `delay(req)` ms with a model tagged "<row id>:<style>". */
function delayedBackend(delay: (req: PreviewRequest) => number) {
  const stats = { created: 0, disposed: 0, posts: [] as string[] };
  const factory: BackendFactory = (onResult) => {
    stats.created++;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    return {
      post(req) {
        const tag = `${req.content.rows[0]!.id}:${req.style}`;
        stats.posts.push(tag);
        const t = setTimeout(() => {
          timers.delete(t);
          onResult({ id: req.id, kind: "model", model: { tag } as unknown as PreviewModel });
        }, delay(req));
        timers.add(t);
      },
      dispose() {
        stats.disposed++;
        timers.forEach(clearTimeout);
      },
    };
  };
  return { factory, stats };
}

let latest: PreviewState | null = null;
function Probe({ c, style, options }: { c: PartContent; style: MeshStyle; options: PreviewOptions }) {
  latest = usePreviewModel(c, undefined, style, options);
  return null;
}

afterEach(() => {
  cleanup();
  latest = null;
  vi.useRealTimers();
});

describe("usePreviewModel", () => {
  it("computes the first model at once and debounces edits", async () => {
    vi.useFakeTimers();
    const { factory, stats } = delayedBackend(() => 10);
    const options: PreviewOptions = { debounceMs: 200, createClient: () => new PreviewClient(factory) };
    const { rerender } = render(<Probe c={content("a")} style="tube" options={options} />);
    expect(latest!.computing).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(tagOf(latest)).toBe("a:tube");
    expect(latest!.computing).toBe(false);

    // Three quick edits: only the last one is computed, 200 ms after it.
    const d = content("d");
    for (const c of [content("b"), content("c"), d]) {
      rerender(<Probe c={c} style="tube" options={options} />);
      await act(async () => vi.advanceTimersByTimeAsync(50));
    }
    expect(latest!.computing).toBe(true);
    expect(stats.posts).toEqual(["a:tube"]);
    await act(async () => vi.advanceTimersByTimeAsync(150));
    expect(stats.posts).toEqual(["a:tube", "d:tube"]);
    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(tagOf(latest)).toBe("d:tube");
    expect(latest!.computing).toBe(false);

    // A style switch (same content) is not debounced.
    rerender(<Probe c={d} style="points" options={options} />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(stats.posts.at(-1)).toBe("d:points");
  });

  it("never shows a stale result, even when an older answer arrives last", async () => {
    vi.useFakeTimers();
    // The first request is slow, the second fast — the client still keeps one in flight.
    const { factory } = delayedBackend((req) => (req.content.rows[0]!.id === "slow" ? 500 : 5));
    const options: PreviewOptions = { debounceMs: 0, createClient: () => new PreviewClient(factory) };
    const { rerender } = render(<Probe c={content("slow")} style="tube" options={options} />);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    rerender(<Probe c={content("fast")} style="tube" options={options} />);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(latest!.model).toBeNull();
    expect(latest!.computing).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(tagOf(latest)).toBe("fast:tube");
    expect(latest!.computing).toBe(false);
  });

  it("under StrictMode with racing edits ends on the newest content and style, and disposes every client", async () => {
    const { factory, stats } = delayedBackend(() => 5 + Math.random() * 40);
    const options: PreviewOptions = { debounceMs: 20, createClient: () => new PreviewClient(factory) };
    const view = (c: PartContent, style: MeshStyle) => (
      <StrictMode>
        <Probe c={c} style={style} options={options} />
      </StrictMode>
    );
    const { rerender, unmount } = render(view(content("c0"), "tube"));
    for (let i = 1; i <= 20; i++) {
      await act(async () => {
        rerender(view(content(`c${i}`), i % 7 === 0 ? "surface" : "tube"));
        await new Promise((r) => setTimeout(r, Math.random() * 30));
      });
    }
    await act(async () => {
      rerender(view(content("final"), "surface"));
    });
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(latest!.computing).toBe(false);
    expect(tagOf(latest)).toBe("final:surface");
    unmount();
    expect(stats.disposed).toBe(stats.created);
  });

  it("reports main-thread mode", async () => {
    const { factory } = delayedBackend(() => 1);
    const options: PreviewOptions = {
      debounceMs: 0,
      createClient: () => new PreviewClient(factory, { mainThread: true, maxStitches: 5000 }),
    };
    render(<Probe c={content("a")} style="tube" options={options} />);
    // Waits for the client instead of a fixed 20 ms, which was too short on a busy machine.
    await waitFor(() => expect(latest!.mainThread).toBe(true));
  });
});
