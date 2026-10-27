// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./modelView.js", async () => (await import("../test/fakeModelView.js")).fakeModule);
const { themeColors, watchTheme } = await import("./ModelCanvas.js");

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
});

describe("themeColors", () => {
  it("reads the --c-model-* tokens and skips missing ones", () => {
    const root = document.documentElement;
    root.style.setProperty("--c-model-bg", " #161619");
    root.style.setProperty("--c-model-highlight", "#3cb6ad");
    expect(themeColors(root)).toEqual({ background: "#161619", highlight: "#3cb6ad" });
  });
});

describe("watchTheme", () => {
  it("fires when data-theme on <html> changes, until unsubscribed", async () => {
    const onChange = vi.fn();
    const stop = watchTheme(onChange);
    document.documentElement.setAttribute("data-theme", "light");
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledTimes(1);
    document.documentElement.setAttribute("class", "unrelated");
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    document.documentElement.setAttribute("data-theme", "dark");
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledTimes(1);
    document.documentElement.removeAttribute("class");
  });

  it("follows the system colour scheme", () => {
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => {
      expect(query).toBe("(prefers-color-scheme: dark)");
      return {
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      };
    });
    const onChange = vi.fn();
    const stop = watchTheme(onChange);
    for (const fn of listeners) fn();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners.size).toBe(0);
  });
});
