// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App.js";
import { PartsBar } from "./components/PartsBar.js";
import { emptyDocument } from "./state/document.js";
import { MAX_PART_QUANTITY, type EditorAction } from "./state/editor.js";
import { LS_KEY, PART_KEY } from "./state/storage.js";
import { SAVE_DELAY_MS } from "./state/usePersistence.js";

// No WebGL in jsdom: the 3D view is replaced by a recording fake.
vi.mock("./three/modelView.js", async () => (await import("./test/fakeModelView.js")).fakeModule);

const textField = (n: number) => screen.findByLabelText(`Maschen von Runde ${n} als Text`);
const tabs = () => screen.getAllByRole("tab");
const tabNames = () => tabs().map((t) => t.getAttribute("aria-label")!.split(",")[0]);
const selectedTab = () => tabs().find((t) => t.getAttribute("aria-selected") === "true")!;
const nameField = () => screen.getByRole("textbox", { name: "Name des Teils" }) as HTMLInputElement;
const total = () => document.querySelector(".parts-total")?.textContent;

async function renderApp() {
  render(<App />);
  await textField(1);
}

async function typeRound(n: number, text: string) {
  const input = await textField(n);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
}

async function loadBunny() {
  fireEvent.click(screen.getByRole("button", { name: "Weitere Demos" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Hase/ }));
  await waitFor(() => expect(tabs()).toHaveLength(5));
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("Parts bar", () => {
  it("starts with one part; '+ Teil' adds 'Teil 2', shows it and focuses its name", async () => {
    await renderApp();
    expect(tabNames()).toEqual(["Teil 1"]);
    expect(screen.getByRole("button", { name: "Teil löschen" })).toHaveProperty("disabled", true);
    await typeRound(1, "1 MR, 6 fM");

    fireEvent.click(screen.getByRole("button", { name: "+ Teil" }));
    expect(tabNames()).toEqual(["Teil 1", "Teil 2"]);
    expect(selectedTab().getAttribute("aria-label")).toMatch(/^Teil 2, 0 Maschen/);
    await waitFor(() => expect(document.activeElement).toBe(nameField()));
    // The new part has one empty round of its own.
    expect((await textField(1)) as HTMLInputElement).toHaveProperty("value", "");

    // Inline rename: Enter keeps the name, the tab follows.
    fireEvent.change(nameField(), { target: { value: "Ohr" } });
    fireEvent.keyDown(nameField(), { key: "Enter" });
    expect(tabNames()).toEqual(["Teil 1", "Ohr"]);
    // Escape restores; an empty name keeps the old one.
    fireEvent.change(nameField(), { target: { value: "Quatsch" } });
    fireEvent.keyDown(nameField(), { key: "Escape" });
    expect(nameField().value).toBe("Ohr");
    fireEvent.change(nameField(), { target: { value: "  " } });
    fireEvent.blur(nameField());
    expect(tabNames()).toEqual(["Teil 1", "Ohr"]);

    // The rows shown belong to the selected part.
    fireEvent.click(screen.getByRole("tab", { name: /^Teil 1/ }));
    expect((await textField(1)) as HTMLInputElement).toHaveProperty("value", "1 MR, 6 fM");
    expect(nameField().value).toBe("Teil 1");
  });

  it("shows name, quantity, stitch count and a validation light per part, plus the total", async () => {
    await renderApp();
    await loadBunny();
    const ear = screen.getByRole("tab", { name: /^Ohr/ });
    expect(ear.getAttribute("aria-label")).toBe("Ohr, 2-mal, 138 Maschen, in Ordnung");
    expect(ear.textContent).toBe("Ohr×2138");
    expect(ear.className).toContain("part-ok");
    expect(total()).toBe("Gesamt: 1.140 Maschen, 8 Teile zu häkeln");

    // A wrong Soll turns the light red; the stats and the 3D view show the selected part.
    fireEvent.click(ear);
    expect(screen.getByText("Maschen", { selector: "dt" }).nextElementSibling?.textContent).toBe("138");
    fireEvent.change(screen.getByLabelText("Soll-Maschenzahl von Runde 1"), { target: { value: "7" } });
    expect(screen.getByRole("tab", { name: /^Ohr/ }).className).toContain("part-error");
    expect(screen.getByRole("tab", { name: /^Ohr/ }).getAttribute("aria-label")).toMatch(/1 Fehler$/);
    expect(screen.getByRole("tab", { name: /^Kopf/ }).className).toContain("part-ok");
  });

  it("sets the quantity with the stepper and the field; the total follows", async () => {
    await renderApp();
    await typeRound(1, "1 MR, 6 fM");
    expect(total()).toBe("Gesamt: 6 Maschen, 1 Teil zu häkeln");
    const less = screen.getByRole("button", { name: "Anzahl verringern" });
    expect(less).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Anzahl erhöhen" }));
    expect(screen.getByRole("textbox", { name: "Anzahl des Teils" })).toHaveProperty("value", "2");
    expect(selectedTab().textContent).toBe("Teil 1×26");
    expect(total()).toBe("Gesamt: 12 Maschen, 2 Teile zu häkeln");
    fireEvent.change(screen.getByRole("textbox", { name: "Anzahl des Teils" }), { target: { value: "4" } });
    expect(total()).toBe("Gesamt: 24 Maschen, 4 Teile zu häkeln");
    // 0 is no quantity: refused.
    fireEvent.change(screen.getByRole("textbox", { name: "Anzahl des Teils" }), { target: { value: "0" } });
    expect(total()).toBe("Gesamt: 24 Maschen, 4 Teile zu häkeln");
    fireEvent.click(less);
    expect(total()).toBe("Gesamt: 18 Maschen, 3 Teile zu häkeln");
  });

  it("duplicates, moves and deletes parts; deleting is undone from the notice", async () => {
    await renderApp();
    await loadBunny();
    fireEvent.click(screen.getByRole("tab", { name: /^Bein/ }));
    fireEvent.click(screen.getByRole("button", { name: "Teil duplizieren" }));
    expect(tabNames()).toEqual(["Kopf", "Körper", "Ohr", "Arm", "Bein", "Bein (Kopie)"]);
    expect(nameField().value).toBe("Bein (Kopie)");

    fireEvent.click(screen.getByRole("button", { name: "Teil nach vorne verschieben" }));
    expect(tabNames()).toEqual(["Kopf", "Körper", "Ohr", "Arm", "Bein (Kopie)", "Bein"]);
    expect(nameField().value).toBe("Bein (Kopie)");

    fireEvent.click(screen.getByRole("tab", { name: /^Ohr/ }));
    fireEvent.click(screen.getByRole("button", { name: "Teil löschen" }));
    expect(tabNames()).toEqual(["Kopf", "Körper", "Arm", "Bein (Kopie)", "Bein"]);
    expect(nameField().value).toBe("Arm");
    const notice = screen.getByText("„Ohr“ gelöscht.").parentElement!;
    fireEvent.click(within(notice).getByRole("button", { name: "Löschen von „Ohr“ rückgängig machen" }));
    expect(tabNames()).toEqual(["Kopf", "Körper", "Ohr", "Arm", "Bein (Kopie)", "Bein"]);
    expect(nameField().value).toBe("Ohr");
    expect(screen.queryByText("„Ohr“ gelöscht.")).toBeNull();
  });

  it("the delete notice disappears with the next change", async () => {
    await renderApp();
    await loadBunny();
    fireEvent.click(screen.getByRole("button", { name: "Teil löschen" }));
    expect(screen.getByText("„Kopf“ gelöscht.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Titel der Anleitung" }), { target: { value: "Hasi" } });
    expect(screen.queryByText("„Kopf“ gelöscht.")).toBeNull();
  });

  it("Alt+↑/↓ switches parts and wraps around; undo shows the part that changed", async () => {
    await renderApp();
    await loadBunny();
    expect(nameField().value).toBe("Kopf");
    fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown", altKey: true });
    expect(nameField().value).toBe("Körper");
    fireEvent.keyDown(window, { key: "ArrowUp", code: "ArrowUp", altKey: true });
    fireEvent.keyDown(window, { key: "ArrowUp", code: "ArrowUp", altKey: true });
    expect(nameField().value).toBe("Bein");
    expect(selectedTab().title).toContain("Alt+↑ / Alt+↓");

    // An edit in "Bein", then off to "Kopf": undo brings "Bein" back into view.
    await typeRound(1, "1 MR, 7 fM");
    fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown", altKey: true });
    expect(nameField().value).toBe("Kopf");
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(nameField().value).toBe("Bein");
    expect((await textField(1)) as HTMLInputElement).toHaveProperty("value", "1 MR, 6 fM");
  });

  it("a typed but uncommitted round is kept when Alt+↓ switches parts", async () => {
    await renderApp();
    await loadBunny();
    const input = await textField(1);
    input.focus();
    fireEvent.change(input, { target: { value: "1 MR, 8 fM" } });
    fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown", altKey: true });
    expect(nameField().value).toBe("Körper");
    // Focus follows to the new tab instead of falling back to the page.
    await waitFor(() => expect(document.activeElement).toBe(selectedTab()));
    fireEvent.click(screen.getByRole("tab", { name: /^Kopf/ }));
    expect((await textField(1)) as HTMLInputElement).toHaveProperty("value", "1 MR, 8 fM");
  });

  it("unreadable text in a round stops the switch (Alt+↓ and tab click); the error and focus stay", async () => {
    await renderApp();
    await loadBunny();
    const input = (await textField(1)) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "6 xyz" } });

    fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown", altKey: true });
    expect(nameField().value).toBe("Kopf");
    expect(document.activeElement).toBe(input);
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByRole("alert").textContent).toMatch(/xyz/);

    // A click on another tab: focus leaves the field first (blur commits, fails), then the
    // click is refused and the focus goes back.
    const body = screen.getByRole("tab", { name: /^Körper/ });
    body.focus();
    fireEvent.click(body);
    expect(nameField().value).toBe("Kopf");
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("6 xyz");
    // "+ Teil" and "Duplizieren" wait as well.
    fireEvent.click(screen.getByRole("button", { name: "+ Teil" }));
    fireEvent.click(screen.getByRole("button", { name: "Teil duplizieren" }));
    expect(tabs()).toHaveLength(5);

    // Corrected, the switch goes through and keeps the round.
    fireEvent.change(input, { target: { value: "1 MR, 7 fM" } });
    fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown", altKey: true });
    expect(nameField().value).toBe("Körper");
    expect(screen.getByRole("tab", { name: /^Kopf/ }).getAttribute("aria-label")).toMatch(/^Kopf, 301 Maschen/);
  });

  it("Alt+↓ from the name field keeps the typed name and moves focus to the new tab", async () => {
    await renderApp();
    await loadBunny();
    nameField().focus();
    fireEvent.change(nameField(), { target: { value: "Kopf groß" } });
    fireEvent.keyDown(nameField(), { key: "ArrowDown", code: "ArrowDown", altKey: true });
    expect(nameField().value).toBe("Körper");
    expect(tabNames()[0]).toBe("Kopf groß");
    await waitFor(() => expect(document.activeElement).toBe(selectedTab()));
  });

  it("Alt+↓ is left alone while a menu is open, and inside text fields on macOS", async () => {
    await renderApp();
    await loadBunny();
    fireEvent.click(screen.getByRole("button", { name: "Weitere Demos" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown", altKey: true });
    expect(nameField().value).toBe("Kopf");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    try {
      const input = await textField(1);
      const event = fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown", altKey: true });
      expect(event).toBe(true); // not prevented: Option+↓ moves the caret
      expect(nameField().value).toBe("Kopf");
      // Outside text fields the shortcut works on macOS too.
      fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown", altKey: true });
      expect(nameField().value).toBe("Körper");
    } finally {
      platform.mockRestore();
    }
  });

  it("arrow keys move between tabs (ARIA tabs pattern)", async () => {
    await renderApp();
    await loadBunny();
    const first = screen.getByRole("tab", { name: /^Kopf/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(nameField().value).toBe("Körper");
    fireEvent.keyDown(selectedTab(), { key: "End" });
    expect(nameField().value).toBe("Bein");
    fireEvent.keyDown(selectedTab(), { key: "ArrowRight" });
    expect(nameField().value).toBe("Kopf");
    await act(async () => {
      fireEvent.keyDown(selectedTab(), { key: "F2" });
    });
    await waitFor(() => expect(document.activeElement).toBe(nameField()));
  });
});

describe("Parts and saving", () => {
  it("switching parts saves no document; the shown part is remembered separately", async () => {
    await renderApp();
    await loadBunny();
    await screen.findByText("Lokal gespeichert");
    const saved = localStorage.getItem(LS_KEY);
    fireEvent.click(screen.getByRole("tab", { name: /^Arm/ }));
    expect(localStorage.getItem(PART_KEY)).toBe("3");
    await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY_MS + 100));
    expect(screen.queryByText("Speichert …")).toBeNull();
    expect(screen.getByText("Lokal gespeichert")).toBeTruthy();
    expect(localStorage.getItem(LS_KEY)).toBe(saved);

    // A reload opens the same part.
    cleanup();
    await renderApp();
    expect(nameField().value).toBe("Arm");
  });
});

describe("PartsBar quantity stepper", () => {
  it("'−' brings a quantity above the limit back into range", () => {
    const doc = emptyDocument("r1");
    doc.parts[0]!.quantity = 1500;
    const actions: EditorAction[] = [];
    render(
      <PartsBar
        doc={doc}
        selected={0}
        dispatch={(a) => actions.push(a)}
        onSelect={() => true}
        onAdd={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        nameFocusToken={0}
        onRequestNameFocus={() => {}}
        deletedName={null}
        onUndoDelete={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Anzahl erhöhen" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Anzahl verringern" }));
    expect(actions).toEqual([{ type: "setPartQuantity", index: 0, quantity: MAX_PART_QUANTITY }]);
  });
});
