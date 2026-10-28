// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App.js";

// No WebGL in jsdom: the 3D view is replaced by a recording fake.
vi.mock("./three/modelView.js", async () => (await import("./test/fakeModelView.js")).fakeModule);

const field = (label: string) => screen.getByLabelText(`Maschen von ${label} als Text`) as HTMLInputElement;
const findField = async (label: string) => (await screen.findByLabelText(`Maschen von ${label} als Text`)) as HTMLInputElement;
const soll = (label: string) => screen.getByLabelText(`Soll-Maschenzahl von ${label}`) as HTMLInputElement;
const ist = (label: string) => screen.getByLabelText(`Ist-Maschenzahl von ${label}`).textContent;
const card = (label: string) => screen.getByRole("article", { name: label });
const cardNames = () => screen.getAllByRole("article").map((a) => a.getAttribute("aria-labelledby") && a.querySelector("h3")?.textContent);

async function renderApp() {
  render(<App />);
  await findField("Runde 1");
}

async function loadBall() {
  fireEvent.click(screen.getByRole("button", { name: "Weitere Demos" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Ball/ }));
  await findField("Runde 11");
}

const enter = (input: HTMLElement) => fireEvent.keyDown(input, { key: "Enter" });
const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("Enter flow with suggestions", () => {
  it("offers the next round, Enter takes it and moves on", async () => {
    await renderApp();
    const first = field("Runde 1");
    act(() => first.focus());
    expect(first.value).toBe("1 MR, 6 fM");
    expect(screen.getByText(/Vorschlag: ergibt/).textContent).toContain("6 M");

    enter(first);
    let next = await findField("Runde 2");
    await waitFor(() => expect(document.activeElement).toBe(next));
    expect(next.value).toBe("6 Zun");
    enter(next);
    next = await findField("Runde 3");
    await waitFor(() => expect(document.activeElement).toBe(next));
    expect(next.value).toBe("6× (1 fM, 1 Zun)");
    expect(screen.getByText(/Vorschlag: ergibt/).textContent).toContain("18 M");
    enter(next);
    next = await findField("Runde 4");
    await waitFor(() => expect(document.activeElement).toBe(next));

    expect([ist("Runde 1"), ist("Runde 2"), ist("Runde 3")]).toEqual(["6", "12", "18"]);
    expect(screen.getByText(/Keine Befunde/)).toBeTruthy();

    // Leaving without touching the suggestion leaves the round empty.
    expect(next.value).toBe("6× (2 fM, 1 Zun)");
    fireEvent.blur(next);
    expect(field("Runde 4").value).toBe("");
    expect(ist("Runde 4")).toBe("0");
  });

  it("typing replaces the suggestion; Tab takes it and stays", async () => {
    await renderApp();
    const first = field("Runde 1");
    act(() => first.focus());
    type(first, "1 MR, 8 fM");
    enter(first);
    const second = await findField("Runde 2");
    await waitFor(() => expect(second.value).toBe("8 Zun"));
    fireEvent.keyDown(second, { key: "Tab" });
    expect(ist("Runde 2")).toBe("16");
    await waitFor(() => expect(document.activeElement).toBe(field("Runde 2")));
    expect(screen.queryByText(/Vorschlag: ergibt/)).toBeNull();
    // Escape drops a suggestion.
    fireEvent.click(screen.getByRole("button", { name: "+ Runde" }));
    const third = await findField("Runde 3");
    await waitFor(() => expect(third.value).toBe("8× (1 fM, 1 Zun)"));
    fireEvent.keyDown(third, { key: "Escape" });
    expect(third.value).toBe("");
  });

  it("knows the previous round: 'fM rundherum' and '(…)*'", async () => {
    await renderApp();
    const first = field("Runde 1");
    act(() => first.focus());
    enter(first);
    const second = await findField("Runde 2");
    type(second, "(1 fM, 1 Zun)*");
    enter(second);
    expect(field("Runde 2").value).toBe("3× (1 fM, 1 Zun)");
    const third = await findField("Runde 3");
    type(third, "fM rundherum");
    fireEvent.blur(third);
    expect(field("Runde 3").value).toBe("9 fM");
  });

  it("'(4 Runden)' makes four rounds in one undo step, and parser guesses are shown", async () => {
    await renderApp();
    const first = field("Runde 1");
    act(() => first.focus());
    enter(first);
    const second = await findField("Runde 2");
    type(second, "6 fM (4 Runden)");
    enter(second);
    expect(await findField("Runde 2–5")).toBeTruthy();
    expect(within(card("Runde 2–5")).getByText("4 Runden")).toBeTruthy();
    // Enter went on to a new round after the group.
    await waitFor(() => expect(document.activeElement).toBe(field("Runde 6")));
    // Two steps: the new round after the group, then the four rounds.
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    await waitFor(() => expect(screen.queryByLabelText("Maschen von Runde 2–5 als Text")).toBeNull());

    const r = field("Runde 2");
    type(r, "fM, Zun x6");
    fireEvent.blur(r);
    expect(field("Runde 2").value).toBe("1 fM, 6 Zun");
    expect(screen.getByText(/„×n“ ist mehrdeutig/)).toBeTruthy();
  });
});

describe("automatic Soll", () => {
  it("follows the Ist until typed; an emptied Soll follows again", async () => {
    await renderApp();
    const first = field("Runde 1");
    type(first, "1 MR, 6 fM");
    fireEvent.blur(first);
    expect(soll("Runde 1").value).toBe("6");
    expect(soll("Runde 1").dataset.auto).toBe("true");
    type(field("Runde 1"), "1 MR, 7 fM");
    fireEvent.blur(field("Runde 1"));
    expect(soll("Runde 1").value).toBe("7");

    // A typed Soll is explicit and checked.
    fireEvent.change(soll("Runde 1"), { target: { value: "8" } });
    expect(soll("Runde 1").dataset.auto).toBeUndefined();
    expect(within(card("Runde 1")).getByText("Maschenzahl stimmt nicht: Soll 8, Ist 7.")).toBeTruthy();

    // Emptying it hands it back to the Ist.
    fireEvent.change(soll("Runde 1"), { target: { value: "" } });
    fireEvent.blur(soll("Runde 1"));
    expect(soll("Runde 1").value).toBe("7");
    expect(soll("Runde 1").dataset.auto).toBe("true");
  });
});

describe("groups of identical rounds", () => {
  it("shows identical rounds as one card; editing it edits all; aufteilen splits it", async () => {
    await renderApp();
    await loadBall();
    expect(cardNames()).toContain("Runde 5–8");
    expect(screen.queryByRole("article", { name: "Runde 6" })).toBeNull();
    const group = card("Runde 5–8");
    expect(within(group).getByText("4 Runden")).toBeTruthy();

    const text = field("Runde 5–8");
    type(text, "24 hStb");
    fireEvent.blur(text);
    expect(field("Runde 5–8").value).toBe("24 hStb");
    // One undo step brings all four back.
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(field("Runde 5–8").value).toBe("24 fM");

    fireEvent.click(within(group).getByRole("button", { name: "Runde 5–8 aufteilen" }));
    for (const n of [5, 6, 7, 8]) expect(field(`Runde ${n}`).value).toBe("24 fM");
  });

  it("Runde ×N sets how often a round is worked, as one undo step", async () => {
    await renderApp();
    await loadBall();
    fireEvent.click(screen.getByRole("button", { name: "Runde 5–8 wiederholen" }));
    const dialog = screen.getByRole("dialog", { name: "Runde 5–8 wiederholen" });
    const times = within(dialog).getByLabelText("Wie oft Runde 5–8 insgesamt");
    fireEvent.change(times, { target: { value: "6" } });
    fireEvent.keyDown(times, { key: "Enter" });
    expect(await findField("Runde 5–10")).toBeTruthy();
    expect(field("Runde 13").value).toBe("6 Abn");
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(await findField("Runde 5–8")).toBeTruthy();

    // A single round ×3: two copies follow it. Worked into 12 stitches they leave 6 free, so
    // they share a card of their own, apart from the original.
    fireEvent.click(screen.getByRole("button", { name: "Runde 2 wiederholen" }));
    const single = screen.getByRole("dialog", { name: "Runde 2 wiederholen" });
    fireEvent.change(within(single).getByLabelText("Wie oft Runde 2 insgesamt"), { target: { value: "3" } });
    fireEvent.click(within(single).getByRole("button", { name: "Übernehmen" }));
    expect(await findField("Runde 3–4")).toBeTruthy();
    expect(field("Runde 2").value).toBe("6 Zun");
    expect(within(card("Runde 3–4")).getByText(/Wird nur in 6 von 12 Maschen gearbeitet/)).toBeTruthy();
  });

  it("a finding inside a run splits the row off, so it names the right round", async () => {
    await renderApp();
    await loadBall();
    // Round 4 now ends at 30: round 5 (24 fM) leaves stitches free, rounds 6–8 are fine.
    const r4 = field("Runde 4");
    type(r4, "6× (3 fM, 1 Zun) (30)");
    fireEvent.blur(r4);
    expect(cardNames()).toEqual(expect.arrayContaining(["Runde 5", "Runde 6–8"]));
    expect(within(card("Runde 5")).getByText(/Wird nur in 24 von 30 Maschen gearbeitet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Runde 5:.*24 von 30/ })).toBeTruthy();
  });
});

describe("quick fixes", () => {
  it("fixes a wrong repeat count with one click, undoable", async () => {
    await renderApp();
    await loadBall();
    const r9 = field("Runde 9");
    type(r9, "4× (2 fM, 1 Abn) (18)");
    fireEvent.blur(r9);
    const row = card("Runde 9");
    expect(within(row).getByText("Maschenzahl stimmt nicht: Soll 18, Ist 12.")).toBeTruthy();
    fireEvent.click(within(row).getAllByRole("button", { name: "Wiederholung auf ×6 ändern" })[0]!);
    expect(field("Runde 9").value).toBe("6× (2 fM, 1 Abn)");
    expect(screen.getByText(/Keine Befunde/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(field("Runde 9").value).toBe("4× (2 fM, 1 Abn)");
  });

  it("offers fixes in the findings panel too", async () => {
    await renderApp();
    await loadBall();
    const r9 = field("Runde 9");
    type(r9, "6× (2 fM, 1 Abn), 3 fM");
    fireEvent.blur(r9);
    const panel = screen.getByRole("region", { name: /^Prüfung/ });
    fireEvent.click(within(panel).getByRole("button", { name: "Soll auf Ist setzen" }));
    expect(soll("Runde 9").value).toBe("21");
    // Now round 10 works into 18 of 21: fill the rest.
    fireEvent.click(within(panel).getByRole("button", { name: "Rest mit 3 fM auffüllen" }));
    expect(field("Runde 10").value).toBe("6× (1 fM, 1 Abn), 3 fM");
  });
});

describe("snippets", () => {
  it("inserts a ball start into a new pattern as one undo step", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "+ Baustein" }));
    const dialog = screen.getByRole("dialog", { name: "Baustein einfügen" });
    expect(within(dialog).getByRole("radio", { name: "Kugelanfang" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "24" }));
    expect(within(dialog).getByRole("status").textContent).toBe("4 Runden: 6 → 24 M · am Ende");
    fireEvent.click(within(dialog).getByRole("button", { name: "Einfügen" }));

    expect(["1", "2", "3", "4"].map((n) => ist(`Runde ${n}`))).toEqual(["6", "12", "18", "24"]);
    expect(screen.queryByLabelText("Maschen von Runde 5 als Text")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(field("Runde 4")));

    // Even rounds and decreases follow the current count.
    fireEvent.click(screen.getByRole("button", { name: "+ Baustein" }));
    fireEvent.click(screen.getByRole("radio", { name: "Abnehmen bis" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Einfügen" }));
    expect(["5", "6", "7"].map((n) => ist(`Runde ${n}`))).toEqual(["18", "12", "6"]);
    expect(screen.getByText(/Keine Befunde/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(screen.queryByLabelText("Maschen von Runde 5 als Text")).toBeNull();
  });

  it("explains why a snippet does not fit", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "+ Baustein" }));
    fireEvent.click(screen.getByRole("radio", { name: "Gerade Runden" }));
    const dialog = screen.getByRole("dialog", { name: "Baustein einfügen" });
    expect(within(dialog).getByRole("status").textContent).toMatch(/Erst eine Runde mit Maschen anlegen/);
    expect((within(dialog).getByRole("button", { name: "Einfügen" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
