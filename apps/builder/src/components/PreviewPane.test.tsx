// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { validate, type PartContent, type Row } from "@crochetbuilder/engine";
import { fakeViews } from "../test/fakeModelView.js";
import { PreviewClient, type BackendFactory } from "../preview/protocol.js";
import { PreviewPane, ViewLoadError, type PreviewPaneProps } from "./PreviewPane.js";

vi.mock("../three/modelView.js", async () => (await import("../test/fakeModelView.js")).fakeModule);

const round = (id: string, ops: Row["ops"], target: number): Row => ({ id, type: "round", ops, stitchCountTarget: target });
const DISC: PartContent = {
  schemaVersion: 1,
  rows: [
    round("r1", [{ kind: "stitch", code: "MR", count: 1 }, { kind: "stitch", code: "SC", count: 6 }], 6),
    round("r2", [{ kind: "stitch", code: "INC", count: 6 }], 12),
  ],
};
const EMPTY: PartContent = { schemaVersion: 1, rows: [round("e", [], 0)] };

function renderPane(props: Partial<PreviewPaneProps> = {}) {
  const content = props.content ?? DISC;
  const all: PreviewPaneProps = {
    content,
    gauge: undefined,
    findings: validate(content),
    selectedRowId: null,
    onSelectRow: () => {},
    previewOptions: { debounceMs: 0 },
    ...props,
  };
  const view = render(<PreviewPane {...all} />);
  return { ...view, rerenderWith: (next: Partial<PreviewPaneProps>) => view.rerender(<PreviewPane {...all} {...next} />) };
}

const status = () => screen.getByRole("status").textContent;

/** React and jsdom report errors caught by an error boundary; keep the expected ones quiet. */
function silenceExpectedErrors(): () => void {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const onError = (e: ErrorEvent) => e.preventDefault();
  window.addEventListener("error", onError);
  return () => {
    window.removeEventListener("error", onError);
    spy.mockRestore();
  };
}

beforeEach(() => {
  fakeViews.reset();
  localStorage.clear();
});
afterEach(() => cleanup());

describe("PreviewPane", () => {
  it("shows a friendly empty state for a pattern without stitches", async () => {
    renderPane({ content: EMPTY });
    expect(await screen.findByText("Noch keine Maschen")).toBeTruthy();
    expect(fakeViews.created).toHaveLength(0);
    expect(screen.queryByLabelText("Maße")).toBeNull();
    expect((screen.getByRole("button", { name: "Ansicht zurücksetzen" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says 'berechne …' while the model is computed", () => {
    const never: BackendFactory = () => ({ post: () => {}, dispose: () => {} });
    renderPane({ previewOptions: { createClient: () => new PreviewClient(never) } });
    expect(status()).toBe("berechne …");
    expect(screen.getByText("Modell wird berechnet …")).toBeTruthy();
  });

  it("renders the model, its size in cm and the estimate hint", async () => {
    renderPane();
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    expect(fakeViews.last!.mesh!.rowIds).toEqual(["r1", "r2"]);
    const dims = screen.getByLabelText("Maße");
    expect(dims.textContent).toMatch(/B × H × T \d+,\d × \d+,\d × \d+,\d cm/);
    expect(dims.textContent).toMatch(/max\. Ø \d+,\d cm/);
    expect(screen.getByText("Maße geschätzt")).toBeTruthy();
    expect(status()).toBe("");
  });

  it("has no estimate hint with a swatch", async () => {
    renderPane({ gauge: { stitchesPer10cm: 20, rowsPer10cm: 22 } });
    await screen.findByLabelText("Maße");
    expect(screen.queryByText("Maße geschätzt")).toBeNull();
  });

  it("highlights the selected row and selects the row of a clicked stitch", async () => {
    const onSelectRow = vi.fn();
    const { rerenderWith } = renderPane({ onSelectRow, selectedRowId: "r1" });
    await waitFor(() => expect(fakeViews.last?.highlight).toBe("r1"));
    rerenderWith({ onSelectRow, selectedRowId: "r2" });
    expect(fakeViews.last!.highlight).toBe("r2");

    const host = screen.getByRole("img", { name: /3D-Modell/ });
    fakeViews.last!.nextPick = { rowId: "r2", node: 9 };
    fireEvent.pointerDown(host, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerUp(host, { clientX: 11, clientY: 11, button: 0 });
    expect(onSelectRow).toHaveBeenCalledWith("r2");

    // A drag is an orbit, not a click.
    fireEvent.pointerDown(host, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerUp(host, { clientX: 60, clientY: 10, button: 0 });
    expect(onSelectRow).toHaveBeenCalledTimes(1);
  });

  it("switches the mesh style, toggles the grid and resets the view", async () => {
    renderPane();
    await waitFor(() => expect(fakeViews.last?.mesh?.primitive).toBe("triangles"));
    fireEvent.click(screen.getByRole("radio", { name: "Punkte" }));
    await waitFor(() => expect(fakeViews.last!.mesh!.primitive).toBe("points"));
    expect(localStorage.getItem("crochetbuilder:preview-style")).toBe("points");

    expect(fakeViews.last!.style.showGrid).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "1-cm-Raster" }));
    expect(fakeViews.last!.style.showGrid).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Ansicht zurücksetzen" }));
    expect(fakeViews.last!.resets).toBe(1);
  });

  it("over the stitch budget: message, last model greyed out", async () => {
    const { rerenderWith } = renderPane();
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    const huge: PartContent = {
      schemaVersion: 1,
      rows: [
        ...DISC.rows,
        ...Array.from({ length: 3 }, (_, i) => round(`h${i}`, [{ kind: "stitch", code: "SC", count: 999 }, { kind: "repeat", times: 9, ops: [{ kind: "stitch", code: "SC", count: 999 }] }], 9990)),
      ],
    };
    rerenderWith({ content: huge, findings: validate(huge, { maxStitches: 20000 }) });
    expect(await screen.findByText("Zu viele Maschen für die 3D-Vorschau")).toBeTruthy();
    // jsdom has no Worker: the main-thread budget (5,000) applies and is explained.
    expect(screen.getByText(/Das Teil hat 29\.983 Maschen, die Vorschau zeigt höchstens 5\.000/)).toBeTruthy();
    expect(screen.getByText(/ohne Hintergrund-Thread – höchstens 5\.000 Maschen/)).toBeTruthy();
    expect(fakeViews.last!.style.dimmed).toBe(true);
    expect(fakeViews.last!.mesh!.rowIds).toEqual(["r1", "r2"]);
    expect(screen.getByText("(letzter Stand)")).toBeTruthy();
    // The finding is listed and jumps to its row.
    expect(screen.getByRole("button", { name: /Das Teil hat 29\.983 Maschen/ })).toBeTruthy();
  });

  it("falls back to a message without WebGL", async () => {
    fakeViews.webgl = false;
    renderPane();
    expect(await screen.findByText("3D-Ansicht nicht verfügbar")).toBeTruthy();
    // Size and findings still work.
    expect(screen.getByLabelText("Maße")).toBeTruthy();
    expect(screen.getByText(/Keine Befunde/)).toBeTruthy();
  });

  it("a failed chunk load offers a retry and a reload, not the no-WebGL message", async () => {
    const quiet = silenceExpectedErrors();
    let calls = 0;
    const loadView: PreviewPaneProps["loadView"] = async () => {
      calls++;
      if (calls === 1) throw new ViewLoadError(new TypeError("Failed to fetch dynamically imported module"));
      return import("../three/ModelCanvas.js");
    };
    renderPane({ loadView });
    expect(await screen.findByText("3D-Ansicht konnte nicht geladen werden")).toBeTruthy();
    expect(screen.getByText(/Lade die Seite neu/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Seite neu laden" })).toBeTruthy();
    expect(screen.queryByText("3D-Ansicht nicht verfügbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    expect(calls).toBe(2);
    expect(screen.queryByText("3D-Ansicht konnte nicht geladen werden")).toBeNull();
    quiet();
  });

  it("a crash while starting the view is an error with retry, not missing WebGL", async () => {
    const quiet = silenceExpectedErrors();
    fakeViews.failWith = new Error("kaputt");
    renderPane();
    expect(await screen.findByText("Fehler: kaputt")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Seite neu laden" })).toBeNull();
    fakeViews.failWith = null;
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    quiet();
  });

  it("disposes the view on unmount", async () => {
    const { unmount } = renderPane();
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    const view = fakeViews.last!;
    unmount();
    expect(view.disposed).toBe(true);
  });

  it("keeps the findings list: a click selects the row", () => {
    const onSelectRow = vi.fn();
    const content: PartContent = { schemaVersion: 1, rows: [DISC.rows[0]!, round("bad", [{ kind: "stitch", code: "INC", count: 6 }], 13)] };
    renderPane({ content, findings: validate(content), onSelectRow });
    fireEvent.click(screen.getByRole("button", { name: /Maschenzahl stimmt nicht: Soll 13, Ist 12/ }));
    expect(onSelectRow).toHaveBeenCalledWith("bad");
  });
});
