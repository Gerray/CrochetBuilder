// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App.js";

// No WebGL in jsdom: the 3D view is replaced by a recording fake.
vi.mock("./three/modelView.js", async () => (await import("./test/fakeModelView.js")).fakeModule);

const SPHERE_LINES = [
  "1 MR, 6 fM",
  "6 Zun",
  "6× (1 fM, 1 Zun)",
  "6x (2 fM, 1 Zun)",
  "24 fM",
  "6 * (2 fM, 1 Abn)",
  "6× (fm, abn)",
  "6 Abn",
];

const textField = (n: number) => screen.findByLabelText(`Maschen von Runde ${n} als Text`);

async function renderApp() {
  const view = render(<App />);
  await textField(1);
  return view;
}

function stat(name: string): string {
  const term = screen.getByText(name, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? "";
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("Builder editor", () => {
  it("lets the amigurumi sphere be typed as free-text rounds", async () => {
    await renderApp();
    for (const [i, line] of SPHERE_LINES.entries()) {
      const input = await textField(i + 1);
      fireEvent.change(input, { target: { value: line } });
      if (i < SPHERE_LINES.length - 1) fireEvent.keyDown(input, { key: "Enter" });
      else {
        // The last round is exactly the suggestion ("6 Abn" after 12): Tab takes it.
        fireEvent.keyDown(input, { key: "Tab" });
        fireEvent.blur(input);
      }
    }

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(8);
    expect(stat("Runden")).toBe("8");
    expect(stat("Maschen")).toBe(String(6 + 12 + 18 + 24 + 24 + 18 + 12 + 6));
    expect(screen.getByText(/Keine Befunde/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    // Soll/Ist per round, and the text shows the canonical rendering.
    const expected = [6, 12, 18, 24, 24, 18, 12, 6];
    expected.forEach((n, i) => {
      expect(screen.getByLabelText(`Ist-Maschenzahl von Runde ${i + 1}`).textContent).toBe(String(n));
      expect((screen.getByLabelText(`Soll-Maschenzahl von Runde ${i + 1}`) as HTMLInputElement).value).toBe(String(n));
    });
    expect((screen.getByLabelText("Maschen von Runde 7 als Text") as HTMLInputElement).value).toBe("6× (1 fM, 1 Abn)");
  });

  it("Enter moves on to a new round and focuses it", async () => {
    await renderApp();
    const first = await textField(1);
    fireEvent.change(first, { target: { value: "1 MR, 6 fM" } });
    fireEvent.keyDown(first, { key: "Enter" });
    const second = await textField(2);
    await waitFor(() => expect(document.activeElement).toBe(second));
  });

  it("shows an inline error for an unknown term and keeps the text", async () => {
    await renderApp();
    const input = await textField(1);
    fireEvent.change(input, { target: { value: "6 Quatsch" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole("alert").textContent).toBe("Unbekannter Begriff: „Quatsch“");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect((input as HTMLInputElement).value).toBe("6 Quatsch");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByLabelText("Ist-Maschenzahl von Runde 1").textContent).toBe("0");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("reports a Soll/Ist mismatch and adopts the Ist on request", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Demo laden" }));
    await textField(8);
    expect(screen.getByText(/Keine Befunde/)).toBeTruthy();

    const soll = screen.getByLabelText("Soll-Maschenzahl von Runde 2");
    fireEvent.change(soll, { target: { value: "13" } });
    const card = screen.getByRole("article", { name: "Runde 2" });
    expect(within(card).getByText("Maschenzahl stimmt nicht: Soll 13, Ist 12.")).toBeTruthy();

    fireEvent.click(within(card).getByRole("button", { name: "Soll übernehmen" }));
    expect((soll as HTMLInputElement).value).toBe("12");
    expect(screen.getByText(/Keine Befunde/)).toBeTruthy();
  });

  it("flags a round that works into more stitches than the previous one has", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Demo laden" }));
    const input = await textField(3);
    fireEvent.change(input, { target: { value: "6× (2 fM, 1 Zun) (24)" } });
    fireEvent.blur(input);
    const card = screen.getByRole("article", { name: "Runde 3" });
    expect(within(card).getByText("Wird in 18 Maschen gearbeitet, aber die Vorrunde hat nur 12.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Runde 3:.*Vorrunde hat nur 12/ })).toBeTruthy();
  });

  it("builds a round with the structured editor", async () => {
    await renderApp();
    const card = screen.getByRole("article", { name: "Runde 1" });
    fireEvent.click(within(card).getByRole("button", { name: "Masche hinzufügen in Runde 1" }));
    fireEvent.click(within(card).getByRole("button", { name: "Masche hinzufügen in Runde 1" }));
    fireEvent.change(within(card).getByLabelText("Maschenart, Masche 2 von Runde 1"), { target: { value: "INC" } });
    fireEvent.click(within(card).getByRole("button", { name: "Alle Maschen von Runde 1 wiederholen" }));
    fireEvent.change(within(card).getByLabelText("Anzahl Wiederholungen, Wiederholung 1 von Runde 1"), {
      target: { value: "6" },
    });
    const text = screen.getByLabelText("Maschen von Runde 1 als Text") as HTMLInputElement;
    expect(text.value).toBe("6× (1 fM, 1 Zun)");
    expect(screen.getByLabelText("Ist-Maschenzahl von Runde 1").textContent).toBe("18");

    fireEvent.click(within(card).getByRole("button", { name: "hMG, Masche 1.1 von Runde 1", pressed: false }));
    expect(text.value).toBe("6× (1 fM (hMG), 1 Zun)");

    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(text.value).toBe("6× (1 fM, 1 Zun)");
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(text.value).toBe("6× (1 fM (hMG), 1 Zun)");
  });

  it("autosaves locally and restores on reload", async () => {
    const view = await renderApp();
    fireEvent.change(screen.getByLabelText("Titel der Anleitung"), { target: { value: "Meine Kugel" } });
    const input = await textField(1);
    fireEvent.change(input, { target: { value: "1 MR, 6 fM" } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByText("Lokal gespeichert")).toBeTruthy(), { timeout: 3000 });
    view.unmount();

    render(<App />);
    expect(((await screen.findByLabelText("Titel der Anleitung")) as HTMLInputElement).value).toBe("Meine Kugel");
    expect((screen.getByLabelText("Maschen von Runde 1 als Text") as HTMLInputElement).value).toBe("1 MR, 6 fM");
  });
});
