// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { parseRowText } from "@crochetbuilder/engine";
import { App } from "./App.js";
import { emptyDocument } from "./state/document.js";
import { LS_KEY } from "./state/storage.js";
import { SAVE_DELAY_MS } from "./state/usePersistence.js";
import { fakeViews } from "./test/fakeModelView.js";
import { suggestionFor } from "./state/palette.js";

// No WebGL in jsdom: the 3D view is replaced by a recording fake.
vi.mock("./three/modelView.js", async () => (await import("./test/fakeModelView.js")).fakeModule);

const textField = (label: string) => screen.findByLabelText(`Maschen von ${label} als Text`) as Promise<HTMLInputElement>;
const chip = (label: string) => screen.getByRole("button", { name: new RegExp(`^Farbe von ${label}:`) });
const strip = () => screen.getByRole("group", { name: "Farbpalette" });

async function loadSphere() {
  render(<App />);
  await textField("Runde 1");
  fireEvent.click(screen.getByRole("button", { name: "Weitere Demos" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Kugel/ }));
  await textField("Runde 8");
}

/** "+ Farbe" in the parts bar, then a built-in suggestion. */
function addSuggested(name: string) {
  fireEvent.click(within(strip()).getByRole("button", { name: "Farbe hinzufügen" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Farbe hinzufügen" })).getByRole("button", { name }));
}

/** The stored document (after the autosave). */
async function storedDoc() {
  let doc: { overview: { colors?: unknown[]; materials?: unknown[] }; parts: Array<{ content: Record<string, unknown> & { rows: Array<Record<string, unknown>> } }> } | undefined;
  await waitFor(
    () => {
      const raw = localStorage.getItem(LS_KEY);
      expect(raw).not.toBeNull();
      doc = JSON.parse(raw!).doc;
    },
    { timeout: SAVE_DELAY_MS + 2000 },
  );
  return doc!;
}

beforeEach(() => {
  localStorage.clear();
  fakeViews.reset();
});
afterEach(() => cleanup());

describe("Palette in the parts bar", () => {
  it("adds colours with one click from the suggestions, or an own name and colour", async () => {
    await loadSphere();
    // No palette yet: no row chips.
    expect(screen.queryByRole("button", { name: /^Farbe von Runde 1:/ })).toBeNull();
    addSuggested("Weiß");
    addSuggested("Rosa");
    expect(within(strip()).getByRole("button", { name: "Weiß bearbeiten (Anfangsfarbe)" })).toBeTruthy();
    expect(within(strip()).getByRole("button", { name: "Rosa bearbeiten" })).toBeTruthy();
    // Used suggestions are not offered again.
    fireEvent.click(within(strip()).getByRole("button", { name: "Farbe hinzufügen" }));
    const dialog = screen.getByRole("dialog", { name: "Farbe hinzufügen" });
    expect(within(dialog).queryByRole("button", { name: "Weiß" })).toBeNull();
    fireEvent.change(within(dialog).getByPlaceholderText("Name, z. B. Altrosa"), { target: { value: "Altrosa" } });
    fireEvent.change(within(dialog).getByLabelText("Farbton der eigenen Farbe"), { target: { value: "#d99ab8" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hinzufügen" }));
    expect(screen.queryByRole("dialog", { name: "Farbe hinzufügen" })).toBeNull();
    const doc = await storedDoc();
    await waitFor(async () =>
      expect((await storedDoc()).overview.colors).toEqual([
        { id: "weiss", name: "Weiß", hex: suggestionFor("Weiß")!.hex },
        { id: "rosa", name: "Rosa", hex: suggestionFor("Rosa")!.hex },
        { id: "altrosa", name: "Altrosa", hex: "#d99ab8" },
      ]),
    );
    expect(doc).toBeTruthy();
    // Every row now shows the colour it starts in: the first colour, carried on.
    expect(chip("Runde 1").getAttribute("aria-label")).toBe("Farbe von Runde 1: Weiß (weiter)");
  });

  it("renames, recolours, makes a colour the start colour and deletes with a replacement", async () => {
    await loadSphere();
    addSuggested("Weiß");
    addSuggested("Rosa");
    fireEvent.click(chip("Runde 3"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Farbwechsel ab Runde 3" })).getByRole("button", { name: "Rosa" }));

    fireEvent.click(within(strip()).getByRole("button", { name: "Rosa bearbeiten" }));
    let dialog = screen.getByRole("dialog", { name: "Rosa bearbeiten" });
    fireEvent.change(within(dialog).getByLabelText("Name von Farbe 2"), { target: { value: "Pink" } });
    await waitFor(() => expect(chip("Runde 3").getAttribute("aria-label")).toBe("Farbe von Runde 3: Pink (Farbwechsel)"));
    // The text of the row follows the new name.
    expect((await textField("Runde 3")).value).toBe("[Farbe: Pink] 6× (1 fM, 1 Zun)");
    dialog = screen.getByRole("dialog", { name: "Pink bearbeiten" });
    fireEvent.change(within(dialog).getByLabelText("Farbton von Pink"), { target: { value: "#ff00aa" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Pink als Anfangsfarbe" }));
    expect(within(strip()).getByRole("button", { name: "Pink bearbeiten (Anfangsfarbe)" })).toBeTruthy();
    expect(chip("Runde 1").getAttribute("aria-label")).toBe("Farbe von Runde 1: Pink (weiter)");

    // Deleting a colour in use asks what the rows switch to instead (the popover is still open).
    dialog = screen.getByRole("dialog", { name: "Pink bearbeiten" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Pink löschen" }));
    expect(within(dialog).getByText("Pink wird in 1 Zeile verwendet.")).toBeTruthy();
    expect((within(dialog).getByLabelText("Ersatz für Pink") as HTMLSelectElement).value).toBe("weiss");
    fireEvent.click(within(dialog).getByRole("button", { name: "Löschen und ersetzen" }));
    expect(within(strip()).queryByRole("button", { name: /^Pink/ })).toBeNull();
    expect(chip("Runde 3").getAttribute("aria-label")).toBe("Farbe von Runde 3: Weiß (Farbwechsel)");
    expect((await textField("Runde 3")).value).toBe("[Farbe: Weiß] 6× (1 fM, 1 Zun)");

    // One undo brings colour and rows back.
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(chip("Runde 3").getAttribute("aria-label")).toBe("Farbe von Runde 3: Pink (Farbwechsel)");
  });

  it("deleting an unused colour needs no question; the last one removes the chips", async () => {
    await loadSphere();
    addSuggested("Gelb");
    fireEvent.click(within(strip()).getByRole("button", { name: "Gelb bearbeiten (Anfangsfarbe)" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Gelb bearbeiten" })).getByRole("button", { name: "Gelb löschen" }));
    expect(screen.queryByRole("button", { name: /^Farbe von Runde 1:/ })).toBeNull();
    const doc = await storedDoc();
    await waitFor(async () => expect((await storedDoc()).overview).not.toHaveProperty("colors"));
    expect(doc).toBeTruthy();
  });
});

describe("Row colour chip", () => {
  it("sets a colour change from a round on, shows inherited colours muted and clears it", async () => {
    await loadSphere();
    addSuggested("Weiß");
    addSuggested("Rosa");
    fireEvent.click(chip("Runde 5"));
    const dialog = screen.getByRole("dialog", { name: "Farbwechsel ab Runde 5" });
    // "No change" says which colour the work carries on in.
    expect(within(dialog).getByRole("button", { name: /^Kein Farbwechsel.*weiter in Weiß/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Rosa" }));
    expect(screen.queryByRole("dialog", { name: "Farbwechsel ab Runde 5" })).toBeNull();

    expect(chip("Runde 5").getAttribute("aria-label")).toBe("Farbe von Runde 5: Rosa (Farbwechsel)");
    expect(chip("Runde 5").className).toContain("is-change");
    expect(chip("Runde 6").getAttribute("aria-label")).toBe("Farbe von Runde 6: Rosa (weiter)");
    expect(chip("Runde 6").className).toContain("is-inherited");
    expect(chip("Runde 4").getAttribute("aria-label")).toBe("Farbe von Runde 4: Weiß (weiter)");
    expect((await textField("Runde 5")).value).toBe("[Farbe: Rosa] 24 fM");

    const doc = await storedDoc();
    await waitFor(async () => expect((await storedDoc()).parts[0]!.content.rows[4]!.color).toBe("rosa"));
    expect(doc).toBeTruthy();

    fireEvent.click(chip("Runde 5"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Farbwechsel ab Runde 5" })).getByRole("button", { name: /^Kein Farbwechsel/ }));
    expect(chip("Runde 5").getAttribute("aria-label")).toBe("Farbe von Runde 5: Weiß (weiter)");
    expect((await textField("Runde 5")).value).toBe("24 fM");
  });

  it("closes the popover with Escape and returns the focus to the chip", async () => {
    await loadSphere();
    addSuggested("Weiß");
    fireEvent.click(chip("Runde 2"));
    const dialog = screen.getByRole("dialog", { name: "Farbwechsel ab Runde 2" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Farbwechsel ab Runde 2" })).toBeNull();
    expect(document.activeElement).toBe(chip("Runde 2"));
  });
});

describe("Colours in the row text", () => {
  it("reads palette names back to ids: a leading mark is the row colour, later ones are stitch colours", async () => {
    await loadSphere();
    addSuggested("Weiß");
    addSuggested("Rosa");
    const field = await textField("Runde 5");
    fireEvent.change(field, { target: { value: "[Farbe: rosa] 12 fM, [Farbe: Weiß] 12 fM" } });
    fireEvent.blur(field);
    expect(chip("Runde 5").getAttribute("aria-label")).toBe("Farbe von Runde 5: Rosa (Farbwechsel)");
    // The row ended in Weiß: the next round carries on in it.
    expect(chip("Runde 6").getAttribute("aria-label")).toBe("Farbe von Runde 6: Weiß (weiter)");
    expect((await textField("Runde 5")).value).toBe("[Farbe: Rosa] 12 fM, [Farbe: Weiß] 12 fM");
    await waitFor(async () =>
      expect((await storedDoc()).parts[0]!.content.rows[4]).toMatchObject({
        color: "rosa",
        ops: [
          { kind: "stitch", code: "SC", count: 12 },
          { kind: "stitch", code: "SC", count: 12, color: "weiss" },
        ],
      }),
    );

    // Retyping without the mark removes the row's colour change.
    fireEvent.change(field, { target: { value: "24 fM" } });
    fireEvent.blur(field);
    expect(chip("Runde 5").getAttribute("aria-label")).toBe("Farbe von Runde 5: Weiß (weiter)");
  });

  it("a colour typed that the palette does not have joins it (one undo step)", async () => {
    await loadSphere();
    const field = await textField("Runde 2");
    fireEvent.change(field, { target: { value: "[Farbe: Mint] 6 Zun" } });
    fireEvent.blur(field);
    expect(within(strip()).getByRole("button", { name: "Mint bearbeiten (Anfangsfarbe)" })).toBeTruthy();
    expect(chip("Runde 2").getAttribute("aria-label")).toBe("Farbe von Runde 2: Mint (Farbwechsel)");
    expect((await textField("Runde 2")).value).toBe("[Farbe: Mint] 6 Zun");
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(within(strip()).queryByRole("button", { name: /^Mint/ })).toBeNull();
    expect((await textField("Runde 2")).value).toBe("6 Zun");
  });
});

describe("Colour of a stitch", () => {
  it("the op editor sets and removes a colour change from a stitch on", async () => {
    await loadSphere();
    addSuggested("Weiß");
    addSuggested("Rosa");
    const card = screen.getByRole("article", { name: "Runde 5" });
    fireEvent.click(within(card).getByRole("button", { name: "Farbwechsel, Masche 1 von Runde 5" }));
    const dialog = screen.getByRole("dialog", { name: "Farbwechsel ab Masche 1 von Runde 5" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rosa" }));
    expect(within(card).getByRole("button", { name: "Farbwechsel zu Rosa, Masche 1 von Runde 5" })).toBeTruthy();
    expect((await textField("Runde 5")).value).toBe("[Farbe: Rosa] 24 fM");
    // A stitch colour is no row colour: the chip of the round still says "weiter".
    expect(chip("Runde 5").getAttribute("aria-label")).toBe("Farbe von Runde 5: Weiß (weiter)");
    expect(chip("Runde 6").getAttribute("aria-label")).toBe("Farbe von Runde 6: Rosa (weiter)");

    fireEvent.click(within(card).getByRole("button", { name: "Farbwechsel zu Rosa, Masche 1 von Runde 5" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Farbwechsel ab Masche 1 von Runde 5" })).getByRole("button", { name: /^Kein Farbwechsel/ }),
    );
    expect((await textField("Runde 5")).value).toBe("24 fM");
  });
});

describe("Colours in the 3D preview", () => {
  it("sends the palette with the model and colours the view; no palette, one yarn colour", async () => {
    await loadSphere();
    await waitFor(() => expect(fakeViews.last?.mesh?.rowIds).toHaveLength(8));
    expect(fakeViews.last!.mesh!.nodeColor).toBeUndefined();
    expect(fakeViews.last!.style.palette ?? []).toEqual([]);

    addSuggested("Weiß");
    addSuggested("Rosa");
    fireEvent.click(chip("Runde 5"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Farbwechsel ab Runde 5" })).getByRole("button", { name: "Rosa" }));
    await waitFor(() => expect(fakeViews.last!.style.palette).toEqual([suggestionFor("Weiß")!.hex, suggestionFor("Rosa")!.hex]));
    await waitFor(() => {
      const mesh = fakeViews.last!.mesh!;
      expect(mesh.nodeColor).toBeDefined();
      // Rounds 1–4 in the first colour, 5–8 in the second.
      const rowOf = (node: number) => mesh.nodeRow[node]!;
      for (let node = 0; node < mesh.nodeRow.length; node++) expect(mesh.nodeColor![node]).toBe(rowOf(node) >= 4 ? 1 : 0);
    });

    // A new display colour reaches the view without a new model.
    const mesh = fakeViews.last!.mesh;
    fireEvent.click(within(strip()).getByRole("button", { name: "Rosa bearbeiten" }));
    fireEvent.change(screen.getByLabelText("Farbton von Rosa"), { target: { value: "#aa0000" } });
    await waitFor(() => expect(fakeViews.last!.style.palette).toEqual([suggestionFor("Weiß")!.hex, "#aa0000"]));
    expect(fakeViews.last!.mesh).toBe(mesh);
  });
});

describe("Palette in Material & Hinweise", () => {
  it("lists the colours and takes them over into the yarn of the material list", async () => {
    await loadSphere();
    addSuggested("Weiß");
    addSuggested("Rosa");
    fireEvent.click(screen.getByRole("button", { name: /^Material & Hinweise/ }));
    const panel = screen.getByRole("region", { name: "Material und Hinweise" });
    expect((within(panel).getByLabelText("Name von Farbe 1") as HTMLInputElement).value).toBe("Weiß");
    expect(within(panel).getByText("Anfangsfarbe")).toBeTruthy();
    // The demo's yarn lists "Weiß" already: only Rosa is added to it.
    fireEvent.click(within(panel).getByRole("button", { name: "Als Garn in die Materialliste übernehmen" }));
    expect((within(panel).getByLabelText("Farben von Material 1") as HTMLInputElement).value).toBe("Weiß, Rosa");
    expect(within(panel).queryByRole("button", { name: "Als Garn in die Materialliste übernehmen" })).toBeNull();
    // A colour added here shows in the parts bar, too.
    fireEvent.click(within(panel).getByRole("button", { name: "Farbe hinzufügen" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Farbe hinzufügen" })).getByRole("button", { name: "Blau" }));
    expect(within(strip()).getByRole("button", { name: "Blau bearbeiten" })).toBeTruthy();
  });
});

describe("Part finish and stuffing", () => {
  it("shows what the engine decides and sets finish and stuffing, one undo step each", async () => {
    await loadSphere();
    const finish = screen.getByRole("combobox", { name: "Abschluss des Teils" }) as HTMLSelectElement;
    const stuffing = screen.getByRole("combobox", { name: "Füllung des Teils" }) as HTMLSelectElement;
    // The sphere is a closed piece: gathered and stuffed firmly.
    expect(finish.value).toBe("");
    expect(finish.selectedOptions[0]!.textContent).toBe("Automatisch (Zusammengezogen)");
    expect(stuffing.selectedOptions[0]!.textContent).toBe("Automatisch (Fest)");
    const relaxes = fakeViews.last?.mesh;

    fireEvent.change(finish, { target: { value: "flat" } });
    expect(finish.value).toBe("flat");
    // A flat finish is not stuffed by itself.
    expect(stuffing.selectedOptions[0]!.textContent).toBe("Automatisch (Keine)");
    fireEvent.change(stuffing, { target: { value: "light" } });
    await waitFor(async () => expect((await storedDoc()).parts[0]!.content).toMatchObject({ finish: "flat", stuffing: "light" }));
    // The 3D model is built again.
    await waitFor(() => expect(fakeViews.last?.mesh).not.toBe(relaxes));

    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(stuffing.value).toBe("");
    expect(finish.value).toBe("flat");
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(finish.value).toBe("");
  });

  it("an open piece is automatically open and empty; a large gathered last round offers a flat finish", async () => {
    render(<App />);
    const field = await textField("Runde 1");
    fireEvent.change(field, { target: { value: "1 MR, 6 fM" } });
    fireEvent.blur(field);
    const finish = screen.getByRole("combobox", { name: "Abschluss des Teils" }) as HTMLSelectElement;
    expect(finish.selectedOptions[0]!.textContent).toBe("Automatisch (Offen)");
    expect(screen.queryByText(/flach zusammenhäkeln\?/)).toBeNull();

  });

  it("a large gathered last round offers to crochet it flat with one click", async () => {
    // Closed (up to 42 stitches, down to 18), so gathered automatically — 18 is a big hole.
    const texts = ["1 MR, 6 fM", "6 Zun", ...[1, 2, 3, 4, 5].map((n) => `6× (${n} fM, 1 Zun)`), ...[5, 4, 3, 2].map((n) => `6× (${n} fM, 1 Abn)`)];
    const doc = emptyDocument("r0");
    doc.parts[0]!.content.rows = texts.map((text, i) => {
      const parsed = parseRowText(text);
      if (!parsed.ok) throw new Error(text);
      return { id: `r${i}`, type: "round", ops: parsed.ops, stitchCountTarget: 0 };
    });
    localStorage.setItem(LS_KEY, JSON.stringify({ doc, pinned: [], savedAt: Date.now() }));
    render(<App />);
    await textField("Runde 11");
    const hint = await screen.findByText(/Zum Zusammenziehen ist die letzte Runde groß \(18 M\)/);
    const finish = screen.getByRole("combobox", { name: "Abschluss des Teils" }) as HTMLSelectElement;
    expect(finish.selectedOptions[0]!.textContent).toBe("Automatisch (Zusammengezogen)");
    fireEvent.click(within(hint.closest("p")!).getByRole("button", { name: "Flach zusammenhäkeln" }));
    expect(finish.value).toBe("flat");
    expect(screen.queryByText(/Zum Zusammenziehen ist die letzte Runde groß/)).toBeNull();
    // Gathering chosen on purpose is not questioned.
    fireEvent.change(finish, { target: { value: "gather" } });
    expect(screen.queryByText(/Zum Zusammenziehen ist die letzte Runde groß/)).toBeNull();
  });
});
