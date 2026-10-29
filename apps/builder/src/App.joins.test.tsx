// @vitest-environment jsdom
/** Joining while crocheting in the editor: row text, the picker, findings and the preview hint. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Op, Row } from "@crochetbuilder/engine";
import { App } from "./App.js";
import type { BuilderDoc } from "./state/document.js";
import { LS_KEY } from "./state/storage.js";
import { SAVE_DELAY_MS } from "./state/usePersistence.js";

// No WebGL in jsdom: the 3D view is replaced by a recording fake.
vi.mock("./three/modelView.js", async () => (await import("./test/fakeModelView.js")).fakeModule);

const textField = (label: string) => screen.findByLabelText(`Maschen von ${label} als Text`) as Promise<HTMLInputElement>;
const sc = (count: number): Op => ({ kind: "stitch", code: "SC", count });
const rnd = (id: string, ops: Op[], t: number): Row => ({ id, type: "round", ops, stitchCountTarget: t });

/** "Körper" (shown, one empty round) and "Bein" ×2 (no ids yet). */
function seed() {
  const doc: BuilderDoc = {
    schemaVersion: 2,
    title: "Beine",
    overview: {},
    parts: [
      { name: "Körper", quantity: 1, content: { schemaVersion: 2, rows: [rnd("b1", [], 0)] } },
      {
        name: "Bein",
        quantity: 2,
        content: { schemaVersion: 2, rows: [rnd("l1", [{ kind: "stitch", code: "MR", count: 1 }, sc(6)], 6), rnd("l2", [{ kind: "stitch", code: "INC", count: 6 }], 12)] },
      },
    ],
  };
  localStorage.setItem(LS_KEY, JSON.stringify({ doc, pinned: [], savedAt: Date.now() }));
}

async function storedDoc(check: (doc: BuilderDoc) => void) {
  await waitFor(
    () => {
      const raw = localStorage.getItem(LS_KEY);
      check(JSON.parse(raw!).doc as BuilderDoc);
    },
    { timeout: SAVE_DELAY_MS + 2000 },
  );
}

beforeEach(() => {
  localStorage.clear();
  seed();
});
afterEach(() => cleanup());

describe("Joins in the row editor", () => {
  it("reads “um Bein 1” in the row text, shows it as “aus Teil Bein 1” and gives the leg part an id", async () => {
    render(<App />);
    const input = await textField("Runde 1");
    fireEvent.change(input, { target: { value: "12 fM um Bein 1, 4 fM" } });
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe("12 fM aus Teil Bein 1, 4 fM"));
    await storedDoc((doc) => {
      expect(doc.parts[1]!.id).toBe("bein");
      expect(doc.parts[0]!.content.rows[0]!.ops[0]).toEqual({ kind: "stitch", code: "SC", count: 12, from: { part: "bein", copy: 1 } });
    });
    // The preview says the part is joined; the leg's 12 stitches are all taken: no finding.
    expect(await screen.findByText(/Wird beim Häkeln mit Bein verbunden/)).toBeTruthy();
    expect(screen.queryByText(/bleiben frei/)).toBeNull();
  });

  it("sets “zusammen mit Teil …” with the picker and shows what is left free", async () => {
    render(<App />);
    const input = await textField("Runde 1");
    fireEvent.change(input, { target: { value: "6 fM, 4 fM" } });
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe("6 fM, 4 fM"));
    fireEvent.click(screen.getByRole("button", { name: "Mit anderem Teil verbinden, Masche 2 von Runde 1" }));
    const dialog = screen.getByRole("dialog", { name: "Verbindung von Masche 2 von Runde 1" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "zusammen mit Teil" }));
    fireEvent.change(within(dialog).getByLabelText("Kopie"), { target: { value: "2" } });
    expect((within(dialog).getByLabelText("Ab Masche") as HTMLInputElement).placeholder).toBe("nächste freie (1)");
    fireEvent.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    await waitFor(() => expect(input.value).toBe("6 fM, 4 fM zusammen mit Teil Bein 2 (ab M 1)"));
    // The picker stores the first stitch it showed, so moving parts later cannot shift it.
    await storedDoc((doc) => expect(doc.parts[0]!.content.rows[0]!.ops[1]).toMatchObject({ through: { part: "bein", copy: 2, start: 0 } }));
    expect(screen.getByRole("button", { name: /^Verbindung mit Bein 2 \(ab M 1\), Masche 2 von Runde 1/})).toBeTruthy();
    // A round of 12 offers 6 places (pairs); 4 are taken.
    // On the row card and in the findings panel.
    expect((await screen.findAllByText(/Von 6 Maschen des anderen Teils werden nur 4 verbunden – 2 bleiben frei/)).length).toBeGreaterThanOrEqual(1);
  });
});
