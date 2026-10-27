// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App.js";
import { demoDocument } from "./state/document.js";
import { BACKUP_KEY, LS_KEY } from "./state/storage.js";

// No WebGL in jsdom: the 3D view is replaced by a recording fake.
vi.mock("./three/modelView.js", async () => (await import("./test/fakeModelView.js")).fakeModule);

const textField = (n: number) => screen.findByLabelText(`Maschen von Runde ${n} als Text`) as Promise<HTMLInputElement>;
const stored = () => JSON.parse(localStorage.getItem(LS_KEY) ?? "null") as { doc: { title: string } } | null;
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

async function renderApp() {
  const view = render(<App />);
  await screen.findByLabelText("Titel der Anleitung");
  return view;
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("unreadable stored document", () => {
  it("is not overwritten until the person decides, and is offered as a backup", async () => {
    const doc = demoDocument() as unknown as { title: string; parts: Array<{ content: { rows: Array<Record<string, unknown>> } }> };
    doc.title = "Mein Teddy";
    doc.parts[0]!.content.rows[0]!.color = "rot";
    const raw = JSON.stringify({ doc, pinned: [] });
    localStorage.setItem(LS_KEY, raw);

    await renderApp();
    const notice = screen.getByRole("alertdialog");
    expect(within(notice).getByText("Gespeicherte Anleitung konnte nicht gelesen werden.")).toBeTruthy();
    expect(within(notice).getByRole("button", { name: "Sicherung herunterladen" })).toBeTruthy();
    expect(screen.getByText("Nicht gespeichert")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Titel der Anleitung"), { target: { value: "x" } });
    await wait(600);
    fireEvent(window, new Event("pagehide"));
    expect(localStorage.getItem(LS_KEY)).toBe(raw);
    expect(JSON.parse(localStorage.getItem(BACKUP_KEY)!).raw.doc.title).toBe("Mein Teddy");

    fireEvent.click(within(notice).getByRole("button", { name: "Neu beginnen" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(stored()?.doc.title).toBe("x"), { timeout: 2000 });
    expect(JSON.parse(localStorage.getItem(BACKUP_KEY)!).raw.doc.title).toBe("Mein Teddy");
  });
});

describe("autosave flush", () => {
  it("saves immediately when the page is hidden or closed", async () => {
    await renderApp();
    fireEvent.change(screen.getByLabelText("Titel der Anleitung"), { target: { value: "Schnell" } });
    expect(stored()?.doc.title).not.toBe("Schnell"); // still debounced
    fireEvent(window, new Event("pagehide"));
    expect(stored()?.doc.title).toBe("Schnell");

    fireEvent.change(screen.getByLabelText("Titel der Anleitung"), { target: { value: "Schneller" } });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    expect(stored()?.doc.title).toBe("Schneller");
  });
});

describe("keyboard shortcuts by key, not position", () => {
  it("QWERTZ: Ctrl+Z (code KeyY) undoes, Ctrl+Y (code KeyZ) and Ctrl+Shift+Z redo", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Demo laden" }));
    await textField(8);
    fireEvent.keyDown(document.body, { key: "z", code: "KeyY", ctrlKey: true });
    expect(screen.queryByLabelText("Maschen von Runde 8 als Text")).toBeNull();
    fireEvent.keyDown(document.body, { key: "y", code: "KeyZ", ctrlKey: true });
    expect(screen.getByLabelText("Maschen von Runde 8 als Text")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "z", code: "KeyY", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "Z", code: "KeyY", ctrlKey: true, shiftKey: true });
    expect(screen.getByLabelText("Maschen von Runde 8 als Text")).toBeTruthy();
  });
});

describe("free-text draft vs. other edits", () => {
  it("drops an invalid draft when the row is changed by the structured editor or undo", async () => {
    await renderApp();
    const input = await textField(1);
    fireEvent.change(input, { target: { value: "1 MR, 6 fM" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "1 MR, 6 fMx" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert").textContent).toContain("fMx");

    fireEvent.click(screen.getByRole("button", { name: "Masche hinzufügen in Runde 1" }));
    expect(input.value).toBe("1 MR, 6 fM, 1 fM");
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(input, { target: { value: "Quatsch" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(input.value).toBe("1 MR, 6 fM");
    expect(screen.queryByRole("alert")).toBeNull();
    // A later blur must not resurrect the stale text.
    fireEvent.blur(input);
    expect(input.value).toBe("1 MR, 6 fM");
  });
});

describe("rows with a note and no stitches", () => {
  it("can get stitches back after clearing them", async () => {
    await renderApp();
    const input = await textField(1);
    fireEvent.change(input, { target: { value: "1 MR, 6 fM" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "+ Notiz" }));
    fireEvent.change(screen.getByLabelText("Notiz zu Runde 1"), { target: { value: "Markierer setzen" } });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    const note = screen.getByLabelText("Hinweistext von Hinweis") as HTMLTextAreaElement;
    expect(note.value).toBe("Markierer setzen");
    fireEvent.click(screen.getByRole("button", { name: "+ Maschen hinzufügen" }));
    const back = await textField(1);
    expect(back.value).toBe("1 fM");
    expect((screen.getByLabelText("Notiz zu Runde 1") as HTMLInputElement).value).toBe("Markierer setzen");
  });
});

describe("limits in the editor", () => {
  it("rejects too large numbers in the text and in number fields", async () => {
    await renderApp();
    const input = await textField(1);
    fireEvent.change(input, { target: { value: "1000 fM" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe("Zahl zu groß – höchstens 999.");

    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.change(input, { target: { value: "6 fM" } });
    fireEvent.blur(input);
    const count = screen.getByLabelText("Anzahl, Masche 1 von Runde 1");
    for (const value of ["1000", "1e9"]) {
      fireEvent.change(count, { target: { value } });
      expect(count.getAttribute("aria-invalid")).toBe("true");
      expect(input.value).toBe("6 fM");
    }
    fireEvent.change(count, { target: { value: "999" } });
    expect(input.value).toBe("999 fM");
  });
});

describe("labels, accessibility and focus", () => {
  it("names a row the same in the list and in the preview", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Demo laden" }));
    await textField(8);
    fireEvent.click(screen.getByRole("button", { name: "Neue Zeile nach Runde 2" }));
    fireEvent.change(screen.getByLabelText("Soll-Maschenzahl von Runde 4"), { target: { value: "99" } });
    expect(screen.getByRole("button", { name: /^Runde 4: Maschenzahl stimmt nicht: Soll 99/ })).toBeTruthy();
  });

  it("gives every op control a unique name", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Demo laden" }));
    await textField(8);
    const names = screen
      .getAllByRole("button")
      .concat(screen.getAllByRole("textbox"), screen.getAllByRole("combobox"))
      .map((el) => el.getAttribute("aria-label") ?? el.textContent ?? "");
    const opNames = names.filter((n) => / von Runde \d/.test(n));
    expect(opNames.length).toBeGreaterThan(50);
    expect(new Set(opNames).size).toBe(opNames.length);
    expect(screen.getByRole("button", { name: "Masche 1.1 von Runde 3 in Wiederholung setzen" })).toBeTruthy();
  });

  it("moves focus to a neighbour after deleting or moving to the edge", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Demo laden" }));
    await textField(8);

    fireEvent.click(screen.getByRole("button", { name: "Runde 2 löschen" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Maschen von Runde 2 als Text")));

    fireEvent.click(screen.getByRole("button", { name: "Runde 2 nach oben" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Runde 1 nach unten" })));

    // Runde 2 is now "1 MR, 6 fM".
    fireEvent.click(screen.getByRole("button", { name: "Masche 2 von Runde 2 entfernen" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Anzahl, Masche 1 von Runde 2")),
    );
    fireEvent.click(screen.getByRole("button", { name: "Masche 1 von Runde 2 entfernen" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Masche hinzufügen in Runde 2" })),
    );
  });
});
