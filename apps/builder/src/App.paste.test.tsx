// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App, pasteNotice } from "./App.js";
import { lineRange, PasteDialog } from "./components/PasteDialog.js";
import { registerPendingEdit } from "./components/pendingEdits.js";
import { MAX_PASTE_CHARS, workerParser, type PasteParser } from "./paste/client.js";
import { buildPastePreview, type LocaleChoice, type PastePreview } from "./paste/preview.js";
import { demoDocument, emptyDocument, type BuilderDoc } from "./state/document.js";
import { MAX_PARTS } from "./state/editor.js";
import { SAMPLE_LINES, SAMPLE_PATTERN } from "./test/samplePattern.js";

// No WebGL in jsdom: the 3D view is replaced by a recording fake.
vi.mock("./three/modelView.js", async () => (await import("./test/fakeModelView.js")).fakeModule);

const SUMMARY = "3 Teile, 19 Runden, 1 Hinweis – 2 Stellen konnten nicht gelesen werden";

const tabNames = () => screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label")!.split(",")[0]);
const selectedTab = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")!;
const dialog = () => screen.getByRole("dialog", { name: "Anleitung einfügen" });
const textArea = () => screen.getByRole("textbox", { name: "Text der Anleitung" }) as HTMLTextAreaElement;

async function renderApp() {
  render(<App pastePreviewOptions={{ debounceMs: 0 }} />);
  await screen.findByLabelText("Maschen von Runde 1 als Text");
}

async function openWith(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Anleitung einfügen…" }));
  fireEvent.change(textArea(), { target: { value: text } });
  await screen.findByText(SUMMARY);
}

/** Fire a paste event carrying `text` at `target`. */
function pasteInto(target: EventTarget, text: string): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? text : "") },
  });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("Anleitung einfügen", () => {
  it("opens from the top bar with the focus in the text and shows the live preview", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Anleitung einfügen…" }));
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(textArea());
    expect(within(dialog()).getByText(/Füge links eine Anleitung ein/)).toBeTruthy();

    fireEvent.change(textArea(), { target: { value: SAMPLE_PATTERN } });
    await screen.findByText(SUMMARY);
    const box = within(dialog());
    expect(box.getByRole("radio", { name: "Deutsch" }).getAttribute("aria-checked")).toBe("true");
    expect(box.getByText(/automatisch erkannt \(100 % sicher\)/)).toBeTruthy();
    expect(box.getAllByRole("textbox", { name: /^Name von Teil/ }).map((i) => (i as HTMLInputElement).value)).toEqual([
      "Kopf",
      "Körper",
      "Ohren",
    ]);
    expect((box.getByRole("textbox", { name: "Anzahl von Teil 3" }) as HTMLInputElement).value).toBe("2");
    expect(box.getByText("Maschenzahl stimmt nicht: Soll 20, Ist 18.")).toBeTruthy();
    expect(box.getByText("Runde 5–8:")).toBeTruthy();
    expect(box.getByText(/Material, Abkürzungen und Einleitung \(3 Zeilen\)/)).toBeTruthy();
  });

  it("selects the source line of a clicked row in the text", async () => {
    await renderApp();
    await openWith(SAMPLE_PATTERN);
    fireEvent.click(screen.getByRole("button", { name: /Runde 3: 6× \(1 fM, 1 Zun\) \(20\)/ }));
    const area = textArea();
    expect(document.activeElement).toBe(area);
    const [start, end] = lineRange(SAMPLE_PATTERN, SAMPLE_LINES.koerperMismatch);
    expect([area.selectionStart, area.selectionEnd]).toEqual([start, end]);
    expect(area.value.slice(start, end)).toBe("Runde 3: (1 fM, 1 Zun) x 6 (20)");
  });

  it("filters to the problem spots and updates when the text is fixed", async () => {
    await renderApp();
    await openWith(SAMPLE_PATTERN);
    fireEvent.click(screen.getByRole("checkbox", { name: "nur Problemstellen" }));
    const lines = () =>
      within(dialog())
        .getAllByRole("listitem")
        .map((li) => li.textContent);
    expect(lines()).toHaveLength(3);
    expect(within(dialog()).getByText("Alles gelesen.")).toBeTruthy();

    fireEvent.change(textArea(), { target: { value: SAMPLE_PATTERN.replace("x 6 (20)", "x 6 (18)") } });
    await screen.findByText("3 Teile, 19 Runden, 0 Hinweise – 2 Stellen konnten nicht gelesen werden");
    expect(lines()).toHaveLength(2);
  });

  it("imports as a new pattern with edited names, shows the first part and undoes in one step", async () => {
    await renderApp();
    await openWith(SAMPLE_PATTERN);
    fireEvent.change(screen.getByRole("textbox", { name: "Name von Teil 3" }), { target: { value: "Ohr" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Anzahl von Teil 3" }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Als neue Anleitung übernehmen" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tabNames()).toEqual(["Kopf", "Körper", "Ohr"]);
    expect(selectedTab().getAttribute("aria-label")).toMatch(/^Kopf,/);
    await waitFor(() => expect(document.activeElement).toBe(selectedTab()));
    expect((screen.getByRole("textbox", { name: "Titel der Anleitung" }) as HTMLInputElement).value).toBe(
      "Kleiner Igel",
    );
    expect(screen.getByText(pasteNotice({ mode: "replace", parts: 3, unread: 2 }))).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Ohr,/ }).textContent).toContain("×4");

    // Unread text is an instruction row with its label and the original text.
    fireEvent.click(screen.getByRole("tab", { name: /^Ohr,/ }));
    const unread = await screen.findByRole("article", { name: "Nicht gelesen" });
    expect(
      (within(unread).getByRole("textbox", { name: "Hinweistext von Nicht gelesen" }) as HTMLTextAreaElement).value,
    ).toBe("Runde 4: 10 fM, dann xq kringeln (10)");
    expect(screen.getByRole("article", { name: "Nicht unterstützt" })).toBeTruthy();

    // The wrong count of the author is reported in the editor.
    fireEvent.click(screen.getByRole("tab", { name: /^Körper,/ }));
    expect(await screen.findAllByText("Maschenzahl stimmt nicht: Soll 20, Ist 18.")).not.toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(tabNames()).toEqual(["Teil 1"]);
  });

  it("adds the parts to the current pattern and appends the preamble to its notes", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Demo laden" }));
    await waitFor(() => expect(tabNames()).toEqual(["Kugel"]));
    await openWith(SAMPLE_PATTERN);
    fireEvent.click(screen.getByRole("button", { name: "Teile hinzufügen" }));

    expect(tabNames()).toEqual(["Kugel", "Kopf", "Körper", "Ohren"]);
    expect(selectedTab().getAttribute("aria-label")).toMatch(/^Kopf,/);
    expect((screen.getByRole("textbox", { name: "Titel der Anleitung" }) as HTMLInputElement).value).toBe(
      "Amigurumi-Kugel",
    );
    fireEvent.click(screen.getByRole("button", { name: /^Material & Hinweise/ }));
    const notes = (screen.getByLabelText("Hinweise zur Anleitung") as HTMLTextAreaElement).value;
    expect(notes.startsWith("In Spiralrunden häkeln. Vor Runde 8 füllen.\n\nKleiner Igel\nMaterial: 50 g")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(tabNames()).toEqual(["Kugel"]);
  });

  it("leaves the notes alone when the preamble is unchecked", async () => {
    await renderApp();
    await openWith(SAMPLE_PATTERN);
    fireEvent.click(screen.getByRole("checkbox", { name: /Material und Einleitung in die Hinweise/ }));
    fireEvent.click(screen.getByRole("button", { name: "Als neue Anleitung übernehmen" }));
    fireEvent.click(screen.getByRole("button", { name: /^Material & Hinweise/ }));
    expect((screen.getByLabelText("Hinweise zur Anleitung") as HTMLTextAreaElement).value).toBe("");
  });

  it("asks to confirm a doubtful notation before importing", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Anleitung einfügen…" }));
    fireEvent.change(textArea(), {
      target: { value: "Body\n1. 6 dc in a magic ring (6)\n2. 6 inc (12)\n3. 18 dc (18)" },
    });
    await screen.findByText(/Nicht sicher erkannt/);
    const importButton = screen.getByRole("button", { name: "Als neue Anleitung übernehmen" }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe(
      "Bitte zuerst die Schreibweise bestätigen: Deutsch, US oder UK.",
    );
    expect(
      within(dialog())
        .getAllByRole("radio")
        .map((r) => r.getAttribute("aria-checked")),
    ).toEqual(["false", "false", "false"]);

    fireEvent.click(screen.getByRole("radio", { name: "US" }));
    await screen.findByText(/von dir gewählt · erkannt: UK/);
    expect(screen.getByRole("radio", { name: "US" }).getAttribute("aria-checked")).toBe("true");
    expect(importButton.disabled).toBe(false);
    expect(within(dialog()).getByText("Runde 3:").parentElement!.textContent).toBe("Runde 3: 18 Stb (18)");
  });

  it("shows the parts limit", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Anleitung einfügen…" }));
    const text = Array.from({ length: 51 }, (_, i) => `Teil ${i + 1}\nRunde 1: 6 fM in den Fadenring (6)`).join("\n\n");
    fireEvent.change(textArea(), { target: { value: text } });
    await screen.findByText(/^51 Teile/);
    expect(screen.getByRole("alert").textContent).toMatch(
      /^Der Text ergibt 51 Teile – der Builder bearbeitet höchstens 50/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Als neue Anleitung übernehmen" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(tabNames()).toEqual(["Teil 1"]);
  });

  it("closes with Escape, returns the focus and keeps the text as a draft", async () => {
    await renderApp();
    const opener = screen.getByRole("button", { name: "Anleitung einfügen…" });
    opener.focus();
    await openWith(SAMPLE_PATTERN);
    fireEvent.keyDown(textArea(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(tabNames()).toEqual(["Teil 1"]);

    fireEvent.click(opener);
    expect(textArea().value).toBe(SAMPLE_PATTERN);
    await screen.findByText(SUMMARY);
  });

  it("keeps Tab inside the dialog and the editor shortcuts away from the pattern behind it", async () => {
    await renderApp();
    await openWith(SAMPLE_PATTERN);
    const close = screen.getByRole("button", { name: "Schließen" });
    const last = screen.getByRole("button", { name: "Als neue Anleitung übernehmen" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    // Ctrl+Z on a dialog button does not undo anything behind it.
    fireEvent.keyDown(last, { key: "z", ctrlKey: true });
    fireEvent.keyDown(last, { key: "n", altKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("opens with the pasted text when a pattern is pasted outside a text field", async () => {
    await renderApp();
    const event = pasteInto(document.body, SAMPLE_PATTERN);
    expect(event.defaultPrevented).toBe(true);
    const area = (await screen.findByRole("textbox", { name: "Text der Anleitung" })) as HTMLTextAreaElement;
    expect(area.value).toBe(SAMPLE_PATTERN);
    await screen.findByText(SUMMARY);
  });

  it("ignores pastes into fields and pastes that are no pattern", async () => {
    await renderApp();
    const title = screen.getByRole("textbox", { name: "Titel der Anleitung" });
    expect(pasteInto(title, SAMPLE_PATTERN).defaultPrevented).toBe(false);
    expect(pasteInto(document.body, "Kleiner Igel").defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers the import in an empty pattern only", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Ganze Anleitung einfügen…" }));
    expect(dialog()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    fireEvent.click(screen.getByRole("button", { name: "Demo laden" }));
    await waitFor(() => expect(tabNames()).toEqual(["Kugel"]));
    expect(screen.queryByRole("button", { name: "Ganze Anleitung einfügen…" })).toBeNull();
  });
});

describe("Anleitung einfügen — review fixes", () => {
  it("adding parts to an empty pattern leaves no empty Teil 1 in front", async () => {
    await renderApp();
    await openWith(SAMPLE_PATTERN);
    fireEvent.click(screen.getByRole("button", { name: "Teile hinzufügen" }));
    expect(tabNames()).toEqual(["Kopf", "Körper", "Ohren"]);
    expect(selectedTab().getAttribute("aria-label")).toMatch(/^Kopf,/);
    expect(screen.getByText(pasteNotice({ mode: "replace", parts: 3, unread: 2 }))).toBeTruthy();
  });

  it("gives a new pattern without a title in the text an empty title", async () => {
    await renderApp();
    fireEvent.change(screen.getByRole("textbox", { name: "Titel der Anleitung" }), {
      target: { value: "Alter Titel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Anleitung einfügen…" }));
    fireEvent.change(textArea(), { target: { value: SAMPLE_PATTERN.split("\n").slice(4).join("\n") } });
    await screen.findByText(/^3 Teile/);
    fireEvent.click(screen.getByRole("button", { name: "Als neue Anleitung übernehmen" }));
    expect((screen.getByRole("textbox", { name: "Titel der Anleitung" }) as HTMLInputElement).value).toBe("");
  });

  it("makes the app behind the dialog inert and keeps Tab in the dialog from anywhere", async () => {
    await renderApp();
    const app = document.querySelector(".app")!;
    expect(app.hasAttribute("inert")).toBe(false);
    await openWith(SAMPLE_PATTERN);
    expect(app.hasAttribute("inert")).toBe(true);
    expect(app.contains(dialog())).toBe(false);
    // Focus left the dialog (a click on a non-focusable area): Tab brings it back in.
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(dialog(), { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Schließen" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Abbrechen" }), { key: "Escape" });
    expect(app.hasAttribute("inert")).toBe(false);
  });

  it("does not close on Escape that ends an input method composition", async () => {
    await renderApp();
    await openWith(SAMPLE_PATTERN);
    fireEvent.keyDown(textArea(), { key: "Escape", isComposing: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(textArea(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps an edited name only: a quantity changed in the text still comes through", async () => {
    await renderApp();
    await openWith(SAMPLE_PATTERN);
    fireEvent.change(screen.getByRole("textbox", { name: "Name von Teil 3" }), { target: { value: "Ohr" } });
    fireEvent.change(textArea(), { target: { value: SAMPLE_PATTERN.replace("Ohren (2x)", "Ohren (3x)") } });
    await waitFor(() =>
      expect((screen.getByRole("textbox", { name: "Anzahl von Teil 3" }) as HTMLInputElement).value).toBe("3"),
    );
    expect((screen.getByRole("textbox", { name: "Name von Teil 3" }) as HTMLInputElement).value).toBe("Ohr");
  });

  it("only takes over a paste when the dialog really opens", async () => {
    await renderApp();
    const unregister = registerPendingEdit({ commit: () => false, focus: () => {} });
    try {
      expect(pasteInto(document.body, SAMPLE_PATTERN).defaultPrevented).toBe(false);
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      unregister();
    }
    expect(pasteInto(document.body, "1. Milch\n2. Eier\n3. Brot\n4. Butter").defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names ⌘V on a Mac", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    try {
      await renderApp();
      expect(screen.getByText("oder ⌘V außerhalb eines Eingabefelds")).toBeTruthy();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("PasteDialog — guarding outdated previews", () => {
  /** A parser whose answers the test releases (or fails). */
  function controlledParser() {
    const jobs: Array<{
      text: string;
      choice: LocaleChoice;
      resolve: (p: PastePreview) => void;
      reject: (e: unknown) => void;
    }> = [];
    const parser: PasteParser = {
      maxChars: 200_000,
      parse: (text, choice) => new Promise((resolve, reject) => jobs.push({ text, choice, resolve, reject })),
      dispose: () => {},
    };
    const release = (i: number) => act(async () => jobs[i]!.resolve(buildPastePreview(jobs[i]!.text, jobs[i]!.choice)));
    return { jobs, release, create: () => parser };
  }

  function renderDialog(doc: BuilderDoc, create: () => PasteParser) {
    const onImport = vi.fn();
    render(
      <PasteDialog
        initialText={SAMPLE_PATTERN}
        doc={doc}
        onImport={onImport}
        onClose={() => {}}
        previewOptions={{ debounceMs: 0, createParser: create }}
      />,
    );
    return onImport;
  }
  const tick = () => act(async () => new Promise((r) => setTimeout(r, 0)));

  it("ignores line clicks and the import while a newer text is being read", async () => {
    const { jobs, release, create } = controlledParser();
    const onImport = renderDialog(emptyDocument("x"), create);
    await tick();
    await release(0);
    await screen.findByText(SUMMARY);

    fireEvent.change(textArea(), { target: { value: `${SAMPLE_PATTERN}\nRunde 5: 10 fM (10)` } });
    await tick();
    expect(jobs).toHaveLength(2);
    textArea().setSelectionRange(0, 0);
    const line = screen.getByRole("button", { name: /Runde 3: 6× \(1 fM, 1 Zun\) \(20\)/ }) as HTMLButtonElement;
    expect(line.disabled).toBe(true);
    fireEvent.click(line);
    expect([textArea().selectionStart, textArea().selectionEnd]).toEqual([0, 0]);
    const importButton = screen.getByRole("button", { name: "Als neue Anleitung übernehmen" }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);
    fireEvent.click(importButton);
    expect(onImport).not.toHaveBeenCalled();

    await release(1);
    expect(importButton.disabled).toBe(false);
    expect(line.disabled).toBe(false);
  });

  it("blocks the import and shows the error when the text cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { jobs, release, create } = controlledParser();
    renderDialog(emptyDocument("x"), create);
    await tick();
    await release(0);
    await screen.findByText(SUMMARY);
    fireEvent.change(textArea(), { target: { value: `${SAMPLE_PATTERN}\n` } });
    await tick();
    await act(async () => jobs[1]!.reject(new Error("Worker abgestürzt")));
    expect(screen.getByRole("alert").textContent).toBe("Der Text konnte nicht gelesen werden: Worker abgestürzt");
    expect((screen.getByRole("button", { name: "Als neue Anleitung übernehmen" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "Teile hinzufügen" }) as HTMLButtonElement).disabled).toBe(true);
    vi.restoreAllMocks();
  });

  it("says before any click why parts cannot be added", async () => {
    const base = demoDocument(() => "d", "sphere");
    const full: BuilderDoc = {
      ...base,
      parts: Array.from({ length: MAX_PARTS - 1 }, (_, i) => ({
        ...base.parts[0]!,
        content: { schemaVersion: 1, rows: [{ ...base.parts[0]!.content.rows[0]!, id: `r${i}` }] },
      })),
    };
    const { release, create } = controlledParser();
    renderDialog(full, create);
    await tick();
    await release(0);
    await screen.findByText(SUMMARY);
    const append = screen.getByRole("button", { name: "Teile hinzufügen" }) as HTMLButtonElement;
    expect(append.disabled).toBe(true);
    expect(append.title).toMatch(/^Die Anleitung hat schon 49 Teile/);
    expect((screen.getByRole("button", { name: "Als neue Anleitung übernehmen" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.getByRole("alert").textContent).toMatch(
      /^„Teile hinzufügen“ geht nicht: Die Anleitung hat schon 49 Teile/,
    );
  });

  it("refuses texts over 200 KB with a German message", async () => {
    render(
      <PasteDialog
        initialText={`${SAMPLE_PATTERN}\n${"x".repeat(MAX_PASTE_CHARS)}`}
        doc={emptyDocument("x")}
        onImport={() => {}}
        onClose={() => {}}
        previewOptions={{
          debounceMs: 0,
          createParser: () =>
            workerParser(() => {
              throw new Error("kein Worker");
            }),
        }}
      />,
    );
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/^Der Text ist zu lang/));
    expect((screen.getByRole("button", { name: "Als neue Anleitung übernehmen" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("pasteNotice", () => {
  it("says what happened and what to check", () => {
    expect(pasteNotice({ mode: "append", parts: 1, unread: 0 })).toBe(
      "1 Teil hinzugefügt. „Rückgängig“ holt den vorherigen Stand zurück.",
    );
    expect(pasteNotice({ mode: "replace", parts: 2, unread: 1 })).toBe(
      "Anleitung übernommen: 2 Teile. 1 Stelle blieb Text – markiert mit „Nicht gelesen“ oder „Nicht unterstützt“, bitte prüfen. „Rückgängig“ holt den vorherigen Stand zurück.",
    );
  });
});
