// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App.js";

// No WebGL in jsdom: the 3D view is replaced by a recording fake.
vi.mock("./three/modelView.js", async () => (await import("./test/fakeModelView.js")).fakeModule);

const textField = (n: number) => screen.findByLabelText(`Maschen von Runde ${n} als Text`);
const tabs = () => screen.getAllByRole("tab");
const tabNames = () => tabs().map((t) => t.getAttribute("aria-label")!.split(",")[0]);
const selectedTab = () => tabs().find((t) => t.getAttribute("aria-selected") === "true")!;
const nameField = () => screen.getByRole("textbox", { name: "Name des Teils" }) as HTMLInputElement;
const total = () => screen.getByLabelText("Summe aller Teile").textContent;

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
    expect(total()).toBe("Gesamt: 1.140 Maschen in 8 Teilen");

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
    expect(total()).toBe("Gesamt: 6 Maschen in 1 Teil");
    const less = screen.getByRole("button", { name: "Anzahl verringern" });
    expect(less).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Anzahl erhöhen" }));
    expect(screen.getByRole("textbox", { name: "Anzahl" })).toHaveProperty("value", "2");
    expect(selectedTab().textContent).toBe("Teil 1×26");
    expect(total()).toBe("Gesamt: 12 Maschen in 2 Teilen");
    fireEvent.change(screen.getByRole("textbox", { name: "Anzahl" }), { target: { value: "4" } });
    expect(total()).toBe("Gesamt: 24 Maschen in 4 Teilen");
    // 0 is no quantity: refused.
    fireEvent.change(screen.getByRole("textbox", { name: "Anzahl" }), { target: { value: "0" } });
    expect(total()).toBe("Gesamt: 24 Maschen in 4 Teilen");
    fireEvent.click(less);
    expect(total()).toBe("Gesamt: 18 Maschen in 3 Teilen");
  });

  it("duplicates, moves and deletes parts; deleting is undone from the notice", async () => {
    await renderApp();
    await loadBunny();
    fireEvent.click(screen.getByRole("tab", { name: /^Bein/ }));
    fireEvent.click(screen.getByRole("button", { name: "Duplizieren" }));
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
    fireEvent.click(screen.getByRole("tab", { name: /^Kopf/ }));
    expect((await textField(1)) as HTMLInputElement).toHaveProperty("value", "1 MR, 8 fM");
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
