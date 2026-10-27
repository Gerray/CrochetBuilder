import { describe, expect, it, vi } from "vitest";
import { CameraFollow, DRAG_SLOP, snapshotSize, watchPixelRatio } from "./viewport.js";

describe("CameraFollow", () => {
  it("frames the first mesh, and later ones while following", () => {
    const f = new CameraFollow();
    expect(f.shouldFrame(false, false)).toBe(true);
    expect(f.shouldFrame(true, true)).toBe(true);
  });

  it("a click (no travel) keeps following, a drag stops it", () => {
    const f = new CameraFollow();
    f.pointerDown(100, 100);
    expect(f.pointerMove(100 + DRAG_SLOP, 100)).toBe(false);
    f.pointerUp();
    expect(f.following).toBe(true);
    // Moving without a pressed pointer (hover) is no drag either.
    expect(f.pointerMove(300, 300)).toBe(false);
    f.pointerDown(100, 100);
    expect(f.pointerMove(110, 100)).toBe(true);
    expect(f.following).toBe(false);
    expect(f.pointerMove(130, 100)).toBe(false); // reported once
  });

  it("the wheel stops following; reset resumes it", () => {
    const f = new CameraFollow();
    f.wheel();
    expect(f.following).toBe(false);
    expect(f.shouldFrame(true, true)).toBe(false);
    expect(f.shouldFrame(true, false)).toBe(true); // the piece left the view
    f.reset();
    expect(f.following).toBe(true);
  });
});

describe("watchPixelRatio", () => {
  function fakeHost() {
    const queries: Array<{ media: string; listeners: Set<() => void> }> = [];
    const host = {
      devicePixelRatio: 1,
      matchMedia(media: string) {
        const q = { media, listeners: new Set<() => void>() };
        queries.push(q);
        return {
          media,
          addEventListener: (_: string, fn: () => void) => q.listeners.add(fn),
          removeEventListener: (_: string, fn: () => void) => q.listeners.delete(fn),
        } as unknown as MediaQueryList;
      },
    };
    return { host, queries };
  }

  it("fires on a change and re-arms for the new ratio", () => {
    const { host, queries } = fakeHost();
    const onChange = vi.fn();
    const stop = watchPixelRatio(onChange, host);
    expect(queries[0]!.media).toBe("(resolution: 1dppx)");
    host.devicePixelRatio = 2;
    queries[0]!.listeners.forEach((fn) => fn());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(queries[0]!.listeners.size).toBe(0);
    expect(queries[1]!.media).toBe("(resolution: 2dppx)");
    stop();
    expect(queries[1]!.listeners.size).toBe(0);
  });

  it("does nothing without matchMedia", () => {
    expect(() => watchPixelRatio(() => {}, { devicePixelRatio: 1 })()).not.toThrow();
  });
});

describe("snapshotSize", () => {
  const current = { width: 800, height: 400 };
  it("keeps the canvas without a size", () => {
    expect(snapshotSize({}, current)).toBeNull();
    expect(snapshotSize({ type: "image/jpeg" }, current)).toBeNull();
  });
  it("derives the missing side from the view's aspect", () => {
    expect(snapshotSize({ width: 1200 }, current)).toEqual({ width: 1200, height: 600 });
    expect(snapshotSize({ height: 300 }, current)).toEqual({ width: 600, height: 300 });
    expect(snapshotSize({ width: 500, height: 500 }, current)).toEqual({ width: 500, height: 500 });
  });
  it("clamps to the drawing-buffer limits", () => {
    expect(snapshotSize({ width: 10000 }, current)).toEqual({ width: 4096, height: 4096 });
    expect(snapshotSize({ width: 0.2, height: Number.NaN }, current)).toEqual({ width: 1, height: 1 });
    expect(snapshotSize({ width: 100 }, { width: 0, height: 0 })).toEqual({ width: 100, height: 100 });
  });
});
