// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReducer } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { buildModel } from "@crochetbuilder/engine";
import { fakeViews } from "../test/fakeModelView.js";
import { mainThreadBackend, PreviewClient } from "../preview/protocol.js";
import { demoDocument, type BuilderDoc } from "../state/document.js";
import { editorReducer, initEditorState } from "../state/editor.js";
import { AssemblyWorkspace, parseAngle, placementForPick } from "./AssemblyWorkspace.js";
import { AssemblyComputer, type AssemblyRequest, type AssemblyResult } from "./compute.js";

vi.mock("../three/modelView.js", async () => (await import("../test/fakeModelView.js")).fakeModule);

let n = 0;
/** The bunny without eyes and nose. */
function bunny(): BuilderDoc {
  const doc = demoDocument(() => `t${++n}`, "bunny");
  return { ...doc, assembly: doc.assembly!.filter((p) => p.kind === "attach") };
}

const sceneOptions = {
  debounceMs: 0,
  createClient: () => new PreviewClient<AssemblyRequest, AssemblyResult>(mainThreadBackend<AssemblyRequest, AssemblyResult>(new AssemblyComputer())),
};

let latest: BuilderDoc | null = null;
let dispatchRef: ((a: Parameters<typeof editorReducer>[1]) => void) | null = null;
function Harness({ doc }: { doc: BuilderDoc }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => initEditorState(doc));
  latest = state.doc;
  dispatchRef = dispatch;
  return (
    <AssemblyWorkspace
      doc={state.doc}
      dispatch={dispatch}
      selectedPart={2}
      style="surface"
      showGrid
      backing={0}
      resetToken={0}
      sceneOptions={sceneOptions}
    />
  );
}

beforeEach(() => {
  fakeViews.reset();
  latest = null;
});
afterEach(cleanup);

const list = () => screen.getByRole("list");

describe("AssemblyWorkspace", () => {
  it("shows the assembled parts and lists the placements in words", async () => {
    render(<Harness doc={bunny()} />);
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    // Kopf, Körper, Ohr ×2, Arm ×2, Bein ×2 in one mesh.
    expect(new Set(fakeViews.last!.mesh!.rowIds.map((id) => id.split("|")[0])).size).toBe(8);
    expect(within(list()).getAllByRole("listitem").map((li) => li.querySelector(".placement-text")!.textContent)).toEqual([
      "Kopf an Körper, auf Runde 14 (Ende)",
      "Ohr ×2 an Kopf, zwischen Runde 4 und 5, ±45° – flach annähen",
      "Arm ×2 an Körper, zwischen Runde 11 und 12, ±80°",
      "Bein ×2 an Körper, zwischen Runde 3 und 4, ±35°",
    ]);
    expect(screen.getByLabelText("Maße der Montage").textContent).toMatch(/Zusammengesetzt B × H × T \d+,\d × \d+,\d × \d+,\d cm/);
  });

  it("sets eyes with a click on the head, highlights the round under the pointer, and fine-tunes them", async () => {
    const doc = bunny();
    render(<Harness doc={doc} />);
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ Augen" }));
    expect(screen.getByText(/Klicke im 3D-Bild auf die Stelle zwischen den Augen/)).toBeTruthy();

    // The head is the first instance: its nodes come first in the combined mesh.
    const graph = buildModel(doc.parts[0]!.content, doc.overview.gauge).graph;
    const row9 = doc.parts[0]!.content.rows[8]!.id;
    const node = graph.nodes.find((x) => x.rowId === row9 && x.offset === 15)!.id;
    const host = screen.getByRole("img", { name: /Montage – klicke/ });
    fakeViews.last!.nextPick = { rowId: `0|${row9}`, node };
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    fireEvent.pointerMove(host, { clientX: 5, clientY: 5 });
    raf.mockRestore();
    await waitFor(() => expect(fakeViews.last!.highlight).toEqual([`0|${row9}`]));
    const hint = document.querySelector(".assembly-hint")!;
    expect(hint.textContent).toMatch(/Kopf: zwischen Runde 9 und 10/);
    // The hint follows the pointer quietly: it is no live region.
    expect(hint.closest("[role=status], [aria-live]")).toBeNull();

    fireEvent.pointerDown(host, { clientX: 5, clientY: 5, button: 0 });
    fireEvent.pointerUp(host, { clientX: 5, clientY: 5, button: 0 });
    await waitFor(() => expect(latest!.assembly).toHaveLength(5));
    const eyes = latest!.assembly![4]!;
    expect(eyes).toMatchObject({ id: "augen", kind: "eyes", target: "kopf", row: row9, spacing: 6, size: 10 });
    expect(screen.getByText(/^Augen 10 mm an Kopf, zwischen Runde 9 und 10, 6 M Abstand/)).toBeTruthy();
    expect(screen.queryByText(/Klicke im 3D-Bild/)).toBeNull();
    expect(document.querySelector(".sr-only")!.textContent).toBe("Platzierung gesetzt.");
    await waitFor(() => expect(fakeViews.last!.spheres).toHaveLength(2));

    // The fields of the new placement are open.
    fireEvent.change(screen.getByLabelText("Größe (mm)"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Runde"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Winkel °"), { target: { value: "−10" } });
    expect(screen.getByText(/^Augen 12 mm an Kopf, zwischen Runde 8 und 9, 6 M Abstand, −10°/)).toBeTruthy();

    // Undo (the reducer's) takes the edits back one by one, then the eyes.
    act(() => dispatchRef!({ type: "undo" }));
    act(() => dispatchRef!({ type: "undo" }));
    act(() => dispatchRef!({ type: "undo" }));
    expect(latest!.assembly![4]).toEqual(eyes);
    act(() => dispatchRef!({ type: "undo" }));
    expect(latest!.assembly).toHaveLength(4);
  });

  it("attaches the part shown in the editor; Escape cancels; a click on the part itself is ignored", async () => {
    render(<Harness doc={{ ...bunny(), assembly: [] }} />);
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ Annähen" }));
    expect((screen.getByLabelText("Welches Teil wird angenäht?") as HTMLSelectElement).value).toBe("2");
    expect(screen.getByText(/an die Ohr genäht wird/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText(/genäht wird/)).toBeNull();
    expect(screen.getByRole("button", { name: "+ Annähen" })).toBeTruthy();
  });

  it("removes a placement", async () => {
    render(<Harness doc={bunny()} />);
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Entfernen: Arm ×2/ }));
    expect(latest!.assembly!.map((p) => p.id)).toEqual(["kopf", "ohren", "beine"]);
  });
});

describe("placement helpers", () => {
  const doc = bunny();
  it("turns a pick into the action of the mode", () => {
    const pick = { instance: 0, part: 0, copy: 0, rowId: doc.parts[0]!.content.rows[5]!.id, angleDeg: 20 };
    expect(placementForPick(doc, { kind: "attach", part: 0 }, pick)).toBeNull(); // onto itself
    expect(placementForPick(doc, { kind: "attach", part: 3 }, pick)).toMatchObject({
      type: "addPlacement",
      placement: { id: "arm", kind: "attach", part: 3, target: 0, angle: 20 },
    });
    expect(placementForPick(doc, { kind: "move", id: "ohren" }, pick)).toEqual({
      type: "updatePlacement",
      id: "ohren",
      patch: { target: 0, row: pick.rowId, angle: 20 },
    });
    expect(placementForPick(doc, { kind: "embroidery" }, pick)).toMatchObject({ placement: { kind: "embroidery", size: 4 } });
  });

  it("reads angles with either minus sign", () => {
    expect([parseAngle("−30"), parseAngle("-30°"), parseAngle("45"), parseAngle("200"), parseAngle("x")]).toEqual([-30, -30, 45, null, null]);
  });
});

/** A node of the combined mesh on instance `instance` (instances: part order, copies in order). */
function nodeOn(instance: number, offset = 30): { node: number; rowKey: string } {
  const mesh = fakeViews.last!.mesh!;
  let seen = 0;
  for (let n = 0; n < mesh.nodeRow.length; n++) {
    const key = mesh.rowIds[mesh.nodeRow[n]!]!;
    if (key.startsWith(`${instance}|`) && seen++ === offset) return { node: n, rowKey: key };
  }
  throw new Error("no such node");
}

function hoverNode(node: number, rowKey: string) {
  const host = screen.getByRole("img", { name: /Montage – klicke/ });
  fakeViews.last!.nextPick = { rowId: rowKey, node };
  const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0;
  });
  fireEvent.pointerMove(host, { clientX: 5, clientY: 5 });
  raf.mockRestore();
  return host;
}

describe("AssemblyWorkspace: review fixes", () => {
  it("lands a pick on copy 2 of a target on copy 1 and says so", async () => {
    render(<Harness doc={bunny()} />);
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ Augen" }));
    // Instances: Kopf 0, Körper 1, Ohr 2/3, Arm 4/5, Bein 6/7. Point at the second arm.
    const { node, rowKey } = nodeOn(5);
    hoverNode(node, rowKey);
    const rowId = rowKey.split("|")[1]!;
    await waitFor(() => expect(fakeViews.last!.highlight).toEqual([`4|${rowId}`]));
    expect(document.querySelector(".assembly-hint > span")!.textContent).toMatch(/Arm: .* – wird an Kopie 1 gesetzt$/);
  });

  it("highlights both copies when the attached part comes twice", async () => {
    const base = bunny();
    render(<Harness doc={{ ...base, assembly: base.assembly!.filter((p) => p.id !== "arme") }} />);
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ Annähen" }));
    fireEvent.change(screen.getByLabelText("Welches Teil wird angenäht?"), { target: { value: "3" } });
    // Instances now: Kopf 0, Körper 1, Ohr 2/3, Arm 4 (beside), Bein 5/6. Point at the second leg.
    const { node, rowKey } = nodeOn(6);
    hoverNode(node, rowKey);
    const rowId = rowKey.split("|")[1]!;
    await waitFor(() => expect(fakeViews.last!.highlight).toEqual([`5|${rowId}`, `6|${rowId}`]));
    expect(document.querySelector(".assembly-hint > span")!.textContent).toMatch(/wird an Kopie 1 gesetzt, die zweite wird gespiegelt$/);
  });

  it("places without a mouse: Zielteil, Runde, Winkel, Setzen", async () => {
    render(<Harness doc={bunny()} />);
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ Augen" }));
    const form = screen.getByRole("form", { name: "Platzierung ohne Maus setzen" });
    fireEvent.change(within(form).getByLabelText("Zielteil"), { target: { value: "0" } });
    fireEvent.change(within(form).getByLabelText("Runde"), { target: { value: "8" } });
    fireEvent.change(within(form).getByLabelText("Winkel °"), { target: { value: "-10" } });
    fireEvent.click(within(form).getByRole("button", { name: "Setzen" }));
    expect(latest!.assembly![4]).toMatchObject({ kind: "eyes", target: "kopf", row: latest!.parts[0]!.content.rows[7]!.id, angle: -10 });
    expect(screen.queryByRole("form", { name: "Platzierung ohne Maus setzen" })).toBeNull();
  });

  it("keeps the attached part when parts move while placing", async () => {
    render(<Harness doc={{ ...bunny(), assembly: [] }} />);
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ Annähen" })); // Ohr (index 2)
    act(() => dispatchRef!({ type: "movePart", index: 2, delta: -2 }));
    expect((screen.getByLabelText("Welches Teil wird angenäht?") as HTMLSelectElement).value).toBe("0");
    const form = screen.getByRole("form", { name: "Platzierung ohne Maus setzen" });
    fireEvent.click(within(form).getByRole("button", { name: "Setzen" }));
    expect(latest!.assembly![0]).toMatchObject({ kind: "attach", part: "ohr" });
  });

  it("ignores clicks while the scene is being recomputed", async () => {
    render(<Harness doc={bunny()} />);
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+ Augen" }));
    const { node, rowKey } = nodeOn(0);
    act(() => dispatchRef!({ type: "updatePlacement", id: "arme", patch: { angle: 70 } }));
    const host = screen.getByRole("img", { name: /Montage – klicke/ });
    fakeViews.last!.nextPick = { rowId: rowKey, node };
    fireEvent.pointerDown(host, { clientX: 5, clientY: 5, button: 0 });
    fireEvent.pointerUp(host, { clientX: 5, clientY: 5, button: 0 });
    expect(latest!.assembly).toHaveLength(4);
    expect(screen.getByText(/wird gerade neu berechnet/)).toBeTruthy();
  });

  it("moves a placement to another target with the Zielteil field; labels follow the target's rows", async () => {
    render(<Harness doc={bunny()} />);
    await waitFor(() => expect(fakeViews.last?.mesh).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Ändern: Bein ×2/ }));
    const field = document.getElementById("placement-beine-target") as HTMLSelectElement;
    fireEvent.change(field, { target: { value: "0" } });
    expect(latest!.assembly!.find((p) => p.id === "beine")).toMatchObject({ target: "kopf", row: latest!.parts[0]!.content.rows[2]!.id });
    expect(document.querySelector("label[for='placement-beine-round']")!.textContent).toMatch(/^Runde/);
  });

  it("warns about a mirrored pair at 0° and reports parts left out of the Montage", async () => {
    const options = {
      debounceMs: 0,
      createClient: () =>
        new PreviewClient<AssemblyRequest, AssemblyResult>(mainThreadBackend<AssemblyRequest, AssemblyResult>(new AssemblyComputer(buildModel, 600))),
    };
    const doc = bunny();
    doc.assembly = doc.assembly!.map((p) => (p.id === "arme" ? { ...p, angle: 0 } : p));
    render(<AssemblyWorkspace doc={doc} dispatch={() => {}} selectedPart={0} style="surface" showGrid backing={0} resetToken={0} sceneOptions={options} />);
    await waitFor(() =>
      expect(document.querySelector(".assembly-skipped")?.textContent).toBe(
        "Zu viele Maschen für die Montage – nicht gezeigt: Ohr, Bein (höchstens 600 Maschen zusammen).",
      ),
    );
    expect(screen.getByText(/Beide Kopien landen an derselben Stelle/)).toBeTruthy();
  });
});