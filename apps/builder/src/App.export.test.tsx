// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  decodeTmcPayload,
  encodeShare,
  readShareFragment,
  TmcEnvelopeSchema,
  type BuilderExport,
  type TmcOriginHint,
} from "@crochetbuilder/engine";
import { App } from "./App.js";
import type { ExportActions } from "./components/ExportMenu.js";
import { REPLACE_FROM_FILE_QUESTION, TMC_PENDING_NOTE } from "./components/ExportMenu.js";
import { prepareExport } from "./export/prepare.js";
import { REPLACE_FROM_LINK_QUESTION } from "./export/useFragmentImport.js";
import { demoDocument, type BuilderDoc } from "./state/document.js";
import { LS_KEY, resetStorageConnection } from "./state/storage.js";

vi.mock("./three/modelView.js", async () => (await import("./test/fakeModelView.js")).fakeModule);

function ids(prefix: string) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

interface Recorded {
  pdf: BuilderDoc[];
  json: BuilderDoc[];
  tmc: Array<{ doc: BuilderDoc; originHint: TmcOriginHint }>;
  copied: string[];
  questions: string[];
  answer: boolean;
}

function fakeActions(): { actions: Partial<ExportActions>; rec: Recorded } {
  const rec: Recorded = { pdf: [], json: [], tmc: [], copied: [], questions: [], answer: true };
  return {
    rec,
    actions: {
      savePdf: async (doc) => {
        rec.pdf.push(doc);
        return "amigurumi-ball.pdf";
      },
      downloadJson: (doc) => {
        rec.json.push(doc);
      },
      downloadTmcJson: (doc, originHint) => {
        rec.tmc.push({ doc, originHint });
      },
      copy: async (text) => {
        rec.copied.push(text);
      },
      confirm: (q) => {
        rec.questions.push(q);
        return rec.answer;
      },
    },
  };
}

async function renderApp(actions?: Partial<ExportActions>) {
  render(<App {...(actions ? { exportActions: actions } : {})} />);
  await screen.findByLabelText("Maschen von Runde 1 als Text");
}

async function loadBall() {
  fireEvent.click(screen.getByRole("button", { name: "Weitere Demos" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Ball/ }));
  await screen.findByLabelText("Maschen von Runde 11 als Text");
}

async function openExport() {
  fireEvent.click(screen.getByRole("button", { name: /Exportieren/ }));
  const panel = screen.getByRole("dialog", { name: "Exportieren" });
  await within(panel).findByRole("link", { name: "In TellmeCrochet öffnen" });
  return panel;
}

const title = () => (screen.getByLabelText("Titel der Anleitung") as HTMLInputElement).value;

beforeEach(() => {
  localStorage.clear();
  resetStorageConnection();
  history.replaceState(null, "", "/");
});
afterEach(() => cleanup());

describe("Export menu", () => {
  it("„In TellmeCrochet öffnen“ is a link carrying a TellmeCrochet draft, with the interim note", async () => {
    await renderApp(fakeActions().actions);
    await loadBall();
    const panel = await openExport();
    const link = within(panel).getByRole("link", { name: "In TellmeCrochet öffnen" }) as HTMLAnchorElement;
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(link.href).toMatch(/^https:\/\/tellmecrochet\.de\/import#data=tmc1\./);
    const env = await decodeTmcPayload(readShareFragment(new URL(link.href).hash)!);
    expect(TmcEnvelopeSchema.safeParse(env).success).toBe(true);
    expect(env).toMatchObject({ format: "tmc-draft", version: 1, sourceNotation: "de", originHint: "self_created" });
    expect(env.draft.title).toBe("Amigurumi-Ball");
    expect(env.draft.parts[0]!.content.rows.filter((r) => r.ops.length > 0)).toHaveLength(11);
    expect(within(panel).getByText(TMC_PENDING_NOTE)).toBeTruthy();
  });

  it("what arrives differently is shown before opening; one more click continues", async () => {
    await renderApp(fakeActions().actions);
    await loadBall();
    const panel = await openExport();
    const link = within(panel).getByRole("link", { name: "In TellmeCrochet öffnen" }) as HTMLAnchorElement;
    // The ball has notes and a gauge: they become a step at the start of the first part.
    expect(fireEvent.click(link)).toBe(false); // default prevented: the notice comes first
    const notice = within(panel).getByRole("note", { name: "Hinweis zu TellmeCrochet" });
    expect(within(notice).getByText(/stehen als Schritt am Anfang des ersten Teils/)).toBeTruthy();
    const next = within(notice).getByRole("link", { name: "Weiter zu TellmeCrochet" }) as HTMLAnchorElement;
    expect(next.href).toBe(link.href);
    expect(next.target).toBe("_blank");
    expect(fireEvent.click(next)).toBe(true); // opens
    expect(within(panel).queryByRole("note", { name: "Hinweis zu TellmeCrochet" })).toBeNull();
    // "Abbrechen" closes the notice without opening anything.
    fireEvent.click(link);
    fireEvent.click(within(panel).getByRole("button", { name: "Abbrechen" }));
    expect(within(panel).queryByRole("note", { name: "Hinweis zu TellmeCrochet" })).toBeNull();
  });

  it("„Für TellmeCrochet speichern (.json)“ hands the document and its provenance to the action", async () => {
    const { actions, rec } = fakeActions();
    await renderApp(actions);
    await loadBall();
    const panel = await openExport();
    fireEvent.click(within(panel).getByRole("button", { name: "Für TellmeCrochet speichern (.json)" }));
    await within(panel).findByText("Datei für TellmeCrochet gespeichert.");
    expect(rec.tmc).toHaveLength(1);
    expect(rec.tmc[0]!.doc.title).toBe("Amigurumi-Ball");
    expect(rec.tmc[0]!.originHint).toBe("self_created");
  });

  it("PDF and JSON go through their actions with the current document", async () => {
    const { actions, rec } = fakeActions();
    await renderApp(actions);
    await loadBall();
    const panel = await openExport();
    fireEvent.click(within(panel).getByRole("button", { name: "Als PDF speichern" }));
    await within(panel).findByText("PDF „amigurumi-ball.pdf“ gespeichert.");
    fireEvent.click(within(panel).getByRole("button", { name: "JSON herunterladen" }));
    await within(panel).findByText("JSON-Datei gespeichert.");
    expect(rec.pdf[0]?.title).toBe("Amigurumi-Ball");
    expect(rec.json[0]?.parts[0]?.content.rows).toHaveLength(11);
  });

  it("„Link teilen“ copies the viewer link and shows it; „Einbetten“ shows an iframe", async () => {
    const { actions, rec } = fakeActions();
    await renderApp(actions);
    await loadBall();
    const panel = await openExport();
    fireEvent.click(within(panel).getByRole("button", { name: "Link teilen" }));
    await within(panel).findByText("Link kopiert.");
    const field = within(panel).getByLabelText("Link zur 3D-Ansicht") as HTMLInputElement;
    expect(field.value).toBe(rec.copied[0]);
    expect(field.value).toMatch(/^http:\/\/localhost(:\d+)?\/viewer\/#data=v1\./);
    expect(within(panel).queryByText(/sehr lang/)).toBeNull();

    fireEvent.click(within(panel).getByRole("button", { name: "Einbetten" }));
    const snippet = (within(panel).getByLabelText(/Code zum Einbetten/) as HTMLTextAreaElement).value;
    expect(snippet).toMatch(/^<iframe src="http:\/\/localhost(:\d+)?\/viewer\/\?embed=1#data=v1\.[\w.-]+" title="Amigurumi-Ball – 3D-Modell"/);
  });

  it("warns when the share link gets very long", async () => {
    await renderApp(fakeActions().actions);
    await loadBall();
    // Random notes do not compress: well above 8,000 characters in the link.
    let noise = "";
    let seed = 7;
    for (let i = 0; i < 9000; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      noise += String.fromCharCode(33 + (seed % 90));
    }
    fireEvent.click(screen.getByRole("button", { name: /Material & Hinweise/ }));
    fireEvent.change(screen.getByLabelText("Hinweise zur Anleitung"), { target: { value: noise } });
    const panel = await openExport();
    fireEvent.click(within(panel).getByRole("button", { name: "Link teilen" }));
    expect(await within(panel).findAllByText(/Der Link ist sehr lang \([\d.]+ Zeichen\)/)).not.toHaveLength(0);
  });

  it("a browser without CompressionStream is told it is too old for share links", async () => {
    await renderApp(fakeActions().actions);
    vi.stubGlobal("CompressionStream", undefined);
    try {
      fireEvent.click(screen.getByRole("button", { name: /Exportieren/ }));
      const panel = screen.getByRole("dialog", { name: "Exportieren" });
      const alert = await within(panel).findByRole("alert");
      expect(alert.textContent).toMatch(/^Dein Browser ist zu alt für Teilen-Links/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("closes with Escape", async () => {
    await renderApp(fakeActions().actions);
    const panel = await openExport();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Exportieren" })).toBeNull();
  });
});

describe("JSON öffnen…", () => {
  const fileInput = () => screen.getByTestId("json-file-input") as HTMLInputElement;
  const choose = (name: string, text: string) =>
    fireEvent.change(fileInput(), { target: { files: [new File([text], name, { type: "application/json" })] } });

  it("JSON export → import round-trips (into an empty document without asking)", async () => {
    const { actions, rec } = fakeActions();
    await renderApp(actions);
    const exported = prepareExport(demoDocument(ids("ball"), "ball"));
    const panel = await openExport();
    choose("amigurumi-ball.json", JSON.stringify(exported, null, 2));
    await within(panel).findByText("„amigurumi-ball.json“ geöffnet.");
    expect(rec.questions).toEqual([]);
    expect(title()).toBe("Amigurumi-Ball");
    await screen.findByLabelText("Maschen von Runde 11 als Text");
    expect((screen.getByLabelText("Maschen von Runde 3 als Text") as HTMLInputElement).value).toBe("6× (1 fM, 1 Zun)");
    // Exporting again gives the same export.
    rec.json.length = 0;
    fireEvent.click(within(panel).getByRole("button", { name: "JSON herunterladen" }));
    expect(prepareExport(rec.json[0]!)).toEqual(exported);
  });

  it("asks before replacing a non-empty document; „Abbrechen“ keeps it", async () => {
    const { actions, rec } = fakeActions();
    await renderApp(actions);
    await loadBall();
    const panel = await openExport();
    rec.answer = false;
    const content = demoDocument(ids("p"), "potholder").parts[0]!.content;
    choose("topflappen.json", JSON.stringify(content));
    await waitFor(() => expect(rec.questions).toEqual([REPLACE_FROM_FILE_QUESTION]));
    expect(title()).toBe("Amigurumi-Ball");

    rec.answer = true;
    choose("topflappen.json", JSON.stringify(content));
    await within(panel).findByText("„topflappen.json“ geöffnet.");
    expect(title()).toBe("topflappen");
    await screen.findByLabelText("Maschen von Reihe 2–21 als Text");
  });

  it("a file with several parts: opens all of them as tabs", async () => {
    const { actions } = fakeActions();
    await renderApp(actions);
    const exported = prepareExport(demoDocument(ids("ball"), "ball"));
    exported.parts.push({ name: "Ohr", quantity: 2, content: { schemaVersion: 1, rows: [] } });
    const panel = await openExport();
    choose("teile.json", JSON.stringify(exported));
    const status = await within(panel).findByText("„teile.json“ geöffnet.");
    expect(status.getAttribute("role")).toBe("status");
    expect(title()).toBe("Amigurumi-Ball");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Ball192", "Ohr×20"]);
  });

  it("shows a German error for an invalid file and keeps the document", async () => {
    await renderApp(fakeActions().actions);
    await loadBall();
    const panel = await openExport();
    choose("kaputt.json", '{"schemaVersion":1,"title":"x","overview":{},"parts":[{"name":"a","quantity":0}]}');
    const alert = await within(panel).findByRole("alert");
    expect(alert.textContent).toMatch(/^Die Anleitung in der Datei ist fehlerhaft \(bei „parts\.0\./);
    expect(title()).toBe("Amigurumi-Ball");
  });
});

describe("Opening a document from the builder URL (#data=)", () => {
  async function linkTo(exp: BuilderExport) {
    history.replaceState(null, "", `/#data=${await encodeShare(exp)}`);
  }

  it("opens the document into an empty builder and clears the fragment", async () => {
    await linkTo(prepareExport(demoDocument(ids("b"), "ball")));
    const confirm = vi.spyOn(window, "confirm");
    await renderApp();
    await screen.findByLabelText("Maschen von Runde 11 als Text");
    expect(title()).toBe("Amigurumi-Ball");
    expect(location.hash).toBe("");
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("asks before replacing a stored, non-empty document", async () => {
    const stored = demoDocument(ids("s"), "sphere");
    localStorage.setItem(LS_KEY, JSON.stringify({ doc: stored, pinned: [], savedAt: Date.now() }));
    await linkTo(prepareExport(demoDocument(ids("b"), "ball")));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(REPLACE_FROM_LINK_QUESTION));
    expect(title()).toBe("Amigurumi-Kugel");
    expect(location.hash).toBe("");

    confirm.mockReturnValue(true);
    await act(async () => {
      history.replaceState(null, "", `/#data=${await encodeShare(prepareExport(demoDocument(ids("c"), "ball")))}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(title()).toBe("Amigurumi-Ball"));
    // Undo brings the stored document back.
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    expect(title()).toBe("Amigurumi-Kugel");
    confirm.mockRestore();
  });

  it("a link with several parts opens them all, each one editable", async () => {
    const exp = prepareExport(demoDocument(ids("b"), "ball"));
    exp.parts.push({ name: "Ohr", quantity: 2, content: { schemaVersion: 1, rows: [] } });
    await linkTo(exp);
    const { actions, rec } = fakeActions();
    await renderApp(actions);
    await waitFor(() => expect(title()).toBe("Amigurumi-Ball"));
    expect(screen.queryByText(/bearbeitet bisher nur das erste/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /^Ohr/ }));
    expect(screen.getByRole("textbox", { name: "Name des Teils" })).toHaveProperty("value", "Ohr");
    // Both parts are exported.
    const panel = await openExport();
    fireEvent.click(within(panel).getByRole("button", { name: "JSON herunterladen" }));
    expect(rec.json[0]!.parts.map((p) => p.name)).toEqual(["Ball", "Ohr"]);
  });

  it("a broken link shows a German notice and changes nothing", async () => {
    history.replaceState(null, "", "/#data=v1.AAAAkaputt");
    await renderApp();
    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toMatch(/Anleitung aus dem Link konnte nicht geöffnet werden\..*beschädigt oder unvollständig/);
    expect(location.hash).toBe("");
    fireEvent.click(within(notice).getByRole("button", { name: "Schließen" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
