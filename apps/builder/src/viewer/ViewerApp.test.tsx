// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { decodeTmcPayload, encodeShare, readShareFragment, type BuilderExport } from "@crochetbuilder/engine";
import { prepareExport } from "../export/prepare.js";
import { tmcLink } from "../export/tmc.js";
import { demoDocument } from "../state/document.js";
import { fakeViews } from "../test/fakeModelView.js";
import { isEmbed, loadViewerData } from "./load.js";
import { ViewerApp } from "./ViewerApp.js";

vi.mock("../three/modelView.js", async () => (await import("../test/fakeModelView.js")).fakeModule);

function ids() {
  let n = 0;
  return () => `row-${++n}`;
}

const ballExport = (): BuilderExport => prepareExport(demoDocument(ids(), "ball"));
const BASE = "https://gerray.github.io/CrochetBuilder/viewer/";

function at(search: string, hash: string) {
  return { href: `${BASE}${search}${hash}`, search, hash };
}

beforeEach(() => {
  fakeViews.reset();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("is-embed");
});


/** The TellmeCrochet link the viewer shows for `exp` (a shared link: "imported", E25). */
const tmcUrl = async (exp: BuilderExport) => (await tmcLink(exp, "imported")).url;

describe("loadViewerData", () => {
  it("missing, broken, invalid and valid fragments", async () => {
    expect(await loadViewerData("")).toEqual({ status: "missing" });
    expect(await loadViewerData("#other=1")).toEqual({ status: "missing" });
    expect(await loadViewerData("#data=v1.%%%")).toMatchObject({ status: "error", message: expect.stringMatching(/beschädigt/) });
    expect(await loadViewerData("#data=v9.abc")).toMatchObject({ status: "error" });
    const payload = await encodeShare(ballExport());
    const ok = await loadViewerData(`#data=${payload}`);
    expect(ok).toMatchObject({ status: "ready", payload });
    if (ok.status === "ready") expect(ok.exp).toEqual(ballExport());
  });

  it("embed flag", () => {
    expect(isEmbed("?embed=1")).toBe(true);
    expect(isEmbed("?x=2&embed=true")).toBe(true);
    expect(isEmbed("")).toBe(false);
    expect(isEmbed("?embed=0")).toBe(false);
  });
});

describe("ViewerApp", () => {
  it("without data: German message and a link to the builder", async () => {
    render(<ViewerApp location={at("", "")} />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading").textContent).toBe("Keine Anleitung im Link");
    expect((within(alert).getByRole("link", { name: "Zum CrochetBuilder" }) as HTMLAnchorElement).href).toBe(
      "https://gerray.github.io/CrochetBuilder/",
    );
  });

  it("lists the palette with swatches, shows colour changes in the rows and colours the model", async () => {
    const doc = demoDocument(ids(), "ball");
    doc.overview.colors = [
      { id: "weiss", name: "Weiß", hex: "#ffffff" },
      { id: "rosa", name: "Rosa", hex: "#f2aec3" },
    ];
    doc.parts[0]!.content.rows[4]!.color = "rosa";
    const payload = await encodeShare(prepareExport(doc));
    render(<ViewerApp location={at("", `#data=${payload}`)} />);
    const colors = await screen.findByRole("list", { name: "Farben" });
    const items = within(colors).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Weiß (Anfangsfarbe)", "Rosa"]);
    expect((items[1]!.querySelector(".swatch") as HTMLElement).style.background).toBe("rgb(242, 174, 195)");
    expect(screen.getByText("Runde 5: [Farbe: Rosa] 24 fM (24)")).toBeTruthy();
    await waitFor(() => expect(fakeViews.last?.mesh?.nodeColor).toBeDefined());
    expect(fakeViews.last!.style.colors).toEqual({ weiss: "#ffffff", rosa: "#f2aec3" });
    expect(fakeViews.last!.mesh!.paletteIds).toEqual(["weiss", "rosa"]);
  });

  it("with broken data: German error", async () => {
    render(<ViewerApp location={at("", "#data=v1.AAAAkaputt")} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Anleitung konnte nicht geöffnet werden/);
    expect(alert.textContent).toMatch(/beschädigt oder unvollständig/);
  });

  it("shows title, model, size, materials and all rows; links to TellmeCrochet and the builder", async () => {
    const payload = await encodeShare(ballExport());
    render(<ViewerApp location={at("", `#data=${payload}`)} />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Amigurumi-Ball");
    await waitFor(() => expect(fakeViews.last?.mesh?.rowIds).toHaveLength(11));
    expect(fakeViews.last?.style.showGrid).toBe(true);
    const rows = within(screen.getByRole("list", { name: "Reihen" })).getAllByRole("listitem");
    expect(rows).toHaveLength(11);
    expect(rows[2]!.textContent).toBe("Runde 3: 6× (1 fM, 1 Zun) (18)");
    expect(screen.getByText("Garn: Baumwollgarn DK (Weiß), ca. 10 g")).toBeTruthy();
    expect(screen.getByText("Garn: DK (leicht) · Nadel: 3 mm")).toBeTruthy();
    expect(screen.getByText("In Spiralrunden häkeln. Vor Runde 11 fest füllen.")).toBeTruthy();
    expect((await screen.findByLabelText("Maße")).textContent).toMatch(/\d+,\d × \d+,\d × \d+,\d cm \(B × H × T\), max\. Ø/);
    const tmc = (await screen.findByRole("link", { name: "In TellmeCrochet öffnen" })) as HTMLAnchorElement;
    // A TellmeCrochet draft; a shared link says nothing about its author: "imported" (E25).
    expect(tmc.href).toBe(await tmcUrl(ballExport()));
    expect((await decodeTmcPayload(readShareFragment(new URL(tmc.href).hash)!)).originHint).toBe("imported");
    const edit = screen.getByRole("link", { name: "Im Builder bearbeiten" }) as HTMLAnchorElement;
    expect(edit.href).toBe(`https://gerray.github.io/CrochetBuilder/#data=${payload}`);
    expect(document.title).toBe("Amigurumi-Ball – CrochetBuilder");
    // Read-only: nothing is stored.
    expect(localStorage.length).toBe(0);
  });

  it("the TellmeCrochet notice: focus on „Weiter“, closed by Escape or a click elsewhere", async () => {
    render(<ViewerApp location={at("", `#data=${await encodeShare(ballExport())}`)} />);
    // Let the page settle (model loaded) so nothing re-renders between the steps.
    await waitFor(() => expect(fakeViews.last?.mesh?.rowIds).toHaveLength(11));
    const link = await screen.findByRole("link", { name: "In TellmeCrochet öffnen" });
    const notice = () => screen.queryByRole("note", { name: "Hinweis zu TellmeCrochet" });
    expect(fireEvent.click(link)).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Weiter zu TellmeCrochet" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(notice()).toBeNull();
    expect(document.activeElement).toBe(link);
    fireEvent.click(link);
    expect(notice()).not.toBeNull();
    fireEvent.pointerDown(screen.getByRole("heading", { level: 1 }));
    expect(notice()).toBeNull();
  });

  it("forwards the canonical payload: whitespace and padding of the received link are not passed on", async () => {
    const payload = await encodeShare(ballExport());
    const pad = "=".repeat((4 - ((payload.length - 3) % 4)) % 4);
    render(<ViewerApp location={at("", `#data=%20${payload}${pad}%0A`)} />);
    await screen.findByRole("heading", { level: 1 });
    const tmc = (await screen.findByRole("link", { name: "In TellmeCrochet öffnen" })) as HTMLAnchorElement;
    expect(tmc.href).toBe(await tmcUrl(ballExport()));
    const edit = screen.getByRole("link", { name: "Im Builder bearbeiten" }) as HTMLAnchorElement;
    expect(edit.href).toBe(`https://gerray.github.io/CrochetBuilder/#data=${payload}`);
  });

  it("an old browser without DecompressionStream gets a German hint, not „beschädigt“", async () => {
    const payload = await encodeShare(ballExport());
    vi.stubGlobal("DecompressionStream", undefined);
    try {
      expect(await loadViewerData(`#data=${payload}`)).toEqual({
        status: "error",
        message: expect.stringMatching(/^Dein Browser ist zu alt für Teilen-Links/),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("embed mode: model, title and a small TellmeCrochet link — no rows, no toolbar", async () => {
    const payload = await encodeShare(ballExport());
    render(<ViewerApp location={at("?embed=1", `#data=${payload}`)} />);
    await waitFor(() => expect(fakeViews.last?.mesh?.rowIds).toHaveLength(11));
    expect(screen.getByText("Amigurumi-Ball")).toBeTruthy();
    const tmc = (await screen.findByRole("link", { name: "In TellmeCrochet öffnen" })) as HTMLAnchorElement;
    expect(tmc.target).toBe("_blank");
    expect(screen.queryByRole("list", { name: "Reihen" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Darstellung" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Im Builder bearbeiten" })).toBeNull();
    expect(fakeViews.last?.style.showGrid).toBe(false);
    expect(document.documentElement.classList.contains("is-embed")).toBe(true);
  });

  it("several parts: the text lists every part; tabs switch the model and scroll to the part", async () => {
    const exp = prepareExport(demoDocument(ids(), "bunny"));
    const payload = await encodeShare(exp);
    render(<ViewerApp location={at("", `#data=${payload}`)} />);
    const tablist = await screen.findByRole("tablist", { name: "Teile" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Kopf", "Körper", "Ohr ×2", "Arm ×2", "Bein ×2"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Gesamt: 1.140 Maschen, 8 Teile zu häkeln")).toBeTruthy();
    // Every part's rows are in the text (and in print), each under its own heading.
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Kopf",
      "Körper",
      "Ohr ×2",
      "Arm ×2",
      "Bein ×2",
    ]);
    for (const [i, part] of exp.parts.entries()) {
      const heading = tabs[i]!.textContent!;
      const list = screen.getByRole("list", { name: `Reihen von ${heading}` });
      expect(within(list).getAllByRole("listitem")).toHaveLength(part.content.rows.length);
    }
    // The tabs control the 3D model, which starts with the first part.
    const panel = screen.getByRole("tabpanel");
    expect(tabs.every((t) => t.getAttribute("aria-controls") === panel.id)).toBe(true);
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0]!.id);
    await waitFor(() => expect(fakeViews.last?.mesh?.rowIds).toHaveLength(14));

    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      fireEvent.click(tabs[2]!);
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
      Element.prototype.scrollIntoView = original;
    }
    expect(within(tablist).getByRole("tab", { name: "Ohr ×2" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[2]!.id);
    // Scrolled to the ear's rows, which are marked as the part in view.
    const earSection = screen.getByRole("list", { name: "Reihen von Ohr ×2" }).parentElement!;
    expect(scrolled).toEqual([earSection.id]);
    expect(earSection.className).toContain("is-current");
    expect(screen.getByRole("list", { name: "Reihen von Kopf" }).parentElement!.className).not.toContain("is-current");
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(5);
    await waitFor(() => expect(fakeViews.last?.mesh?.rowIds).toEqual(exp.parts[2]!.content.rows.map((r) => r.id)));

    // Arrow keys move between the tabs.
    fireEvent.keyDown(within(tablist).getByRole("tab", { name: "Ohr ×2" }), { key: "ArrowRight" });
    expect(within(tablist).getByRole("tab", { name: "Arm ×2" }).getAttribute("aria-selected")).toBe("true");

    const tmc = (await screen.findByRole("link", { name: "In TellmeCrochet öffnen" })) as HTMLAnchorElement;
    expect(tmc.href).toBe(await tmcUrl(exp));
  });

  it("a single part has no part tabs; an embed of several parts gets compact tabs", async () => {
    render(<ViewerApp location={at("", `#data=${await encodeShare(ballExport())}`)} />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("tablist")).toBeNull();
    cleanup();

    const payload = await encodeShare(prepareExport(demoDocument(ids(), "bunny")));
    render(<ViewerApp location={at("?embed=1", `#data=${payload}`)} />);
    const tablist = await screen.findByRole("tablist", { name: "Teile" });
    // Compact: floating over the model, without the total and without any rows.
    expect(tablist.parentElement!.className).toBe("viewer-parts viewer-parts-compact");
    expect(screen.queryByText(/^Gesamt:/)).toBeNull();
    expect(screen.queryAllByRole("list")).toHaveLength(0);
    fireEvent.click(within(tablist).getByRole("tab", { name: "Bein ×2" }));
    await waitFor(() => expect(fakeViews.last?.mesh?.rowIds).toHaveLength(8));
  });

  it("without WebGL the page still shows the pattern", async () => {
    fakeViews.webgl = false;
    const payload = await encodeShare(ballExport());
    render(<ViewerApp location={at("", `#data=${payload}`)} />);
    await screen.findByText("3D-Ansicht nicht verfügbar");
    expect(within(screen.getByRole("list", { name: "Reihen" })).getAllByRole("listitem")).toHaveLength(11);
  });
});

describe("ViewerApp: Montage", () => {
  it("lists the assembly and switches between the part and the assembled toy", async () => {
    const { AssemblyComputer } = await import("../assembly/compute.js");
    const { mainThreadBackend, PreviewClient } = await import("../preview/protocol.js");
    const sceneOptions = {
      debounceMs: 0,
      createClient: () => new PreviewClient(mainThreadBackend(new AssemblyComputer())) as never,
    };
    const exp = prepareExport(demoDocument(ids(), "bunny"));
    render(<ViewerApp location={at("", `#data=${await encodeShare(exp)}`)} assemblySceneOptions={sceneOptions} />);
    const heading = await screen.findByRole("heading", { level: 2, name: "Montage" });
    const section = heading.closest("section")!;
    expect(within(section).getAllByRole("listitem")[1]!.textContent).toBe("Ohr ×2 an Kopf, zwischen Runde 4 und 5, ±45° – flach annähen");

    const switcher = screen.getByRole("radiogroup", { name: "Ansicht" });
    fireEvent.click(within(switcher).getByRole("radio", { name: "Montage" }));
    await waitFor(() => expect(fakeViews.last?.mesh?.rowIds.some((id) => id.startsWith("7|"))).toBe(true), { timeout: 8000 });
    expect(fakeViews.last!.spheres.filter((s) => s.kind === "eye")).toHaveLength(2);
    // Read-only: nothing to place.
    expect(screen.queryByRole("button", { name: "+ Annähen" })).toBeNull();
    // A part tab goes back to that part.
    fireEvent.click(screen.getByRole("tab", { name: "Ohr ×2" }));
    expect(within(switcher).getByRole("radio", { name: "Teil" }).getAttribute("aria-checked")).toBe("true");
  });

  it("has no switch for a pattern without an assembly", async () => {
    render(<ViewerApp location={at("", `#data=${await encodeShare(ballExport())}`)} />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("radiogroup", { name: "Ansicht" })).toBeNull();
  });
});