// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App.js";
import { fakeViews } from "./test/fakeModelView.js";

vi.mock("./three/modelView.js", async () => (await import("./test/fakeModelView.js")).fakeModule);

beforeEach(() => {
  localStorage.clear();
  fakeViews.reset();
});
afterEach(() => cleanup());

async function loadDemo(label: string) {
  render(<App />);
  await screen.findByLabelText("Maschen von Runde 1 als Text");
  fireEvent.click(screen.getByRole("button", { name: "Weitere Demos" }));
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(`^${label}`) }));
}

describe("3D preview in the builder", () => {
  it("the demo menu loads the ball; the preview shows its 11 rounds", async () => {
    await loadDemo("Ball");
    await screen.findByLabelText("Maschen von Runde 11 als Text");
    await waitFor(() => expect(fakeViews.last?.mesh?.rowIds).toHaveLength(11));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("clicking a stitch selects its round and focuses it in the editor", async () => {
    await loadDemo("Ball");
    await waitFor(() => expect(fakeViews.last?.mesh?.rowIds).toHaveLength(11));
    const view = fakeViews.last!;
    view.nextPick = { rowId: view.mesh!.rowIds[6]!, node: 100 };
    const host = screen.getByRole("img", { name: /3D-Modell/ });
    fireEvent.pointerDown(host, { clientX: 5, clientY: 5, button: 0 });
    fireEvent.pointerUp(host, { clientX: 5, clientY: 5, button: 0 });
    // Rounds 5–8 are identical ("24 fM") and share one card: it gets the focus, and all four
    // rounds light up in the model.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Maschen von Runde 5–8 als Text")));
    expect(view.highlight).toEqual(view.mesh!.rowIds.slice(4, 8));
  });

  it("the potholder demo is a flat piece in rows", async () => {
    await loadDemo("Topflappen");
    await screen.findByLabelText("Maschen von Reihe 2–21 als Text");
    await waitFor(() => expect(fakeViews.last?.mesh?.rowIds).toHaveLength(21));
    expect(screen.queryByText(/max\. Ø/)).toBeNull();
  });

  it("the demo menu closes with Escape", async () => {
    render(<App />);
    await screen.findByLabelText("Maschen von Runde 1 als Text");
    const toggle = screen.getByRole("button", { name: "Weitere Demos" });
    fireEvent.click(toggle);
    const menu = screen.getByRole("menu");
    await waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("menuitem"));
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });
});
