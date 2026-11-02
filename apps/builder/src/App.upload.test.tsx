// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App.js";
import { BuilderExportSchema } from "@crochetbuilder/engine";
import { demoDocument } from "./state/document.js";
import { LS_KEY, resetStorageConnection } from "./state/storage.js";
import { fakeTmcServices, MAIL, NOW, sessionFor, target } from "./test/fakeTmc.js";
import { markRedirect } from "./tmc/redirect.js";
import { TMC_STORAGE_KEY } from "./tmc/client.js";
import { GOOGLE_FAILED_LINE, NEW_ACCOUNT_LINE, SELF_CREATED_LABEL, SIGN_UP_LEGAL_LINE, SUCCESS_LINE } from "./tmc/texts.js";

vi.mock("./three/modelView.js", async () => (await import("./test/fakeModelView.js")).fakeModule);

type Fake = ReturnType<typeof fakeTmcServices>;

function ids(prefix: string) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

async function renderApp(fake: Fake | null, exportActions = {}) {
  render(<App tmc={fake?.services ?? null} exportActions={exportActions} />);
  await screen.findByLabelText("Maschen von Runde 1 als Text");
}

async function loadBall() {
  fireEvent.click(screen.getByRole("button", { name: "Weitere Demos" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^Ball/ }));
  await screen.findByLabelText("Maschen von Runde 11 als Text");
}

const openMenu = () => {
  fireEvent.click(screen.getByRole("button", { name: /Exportieren/ }));
  return screen.getByRole("dialog", { name: "Exportieren" });
};
const openUpload = () => {
  fireEvent.click(within(openMenu()).getByRole("button", { name: "Zu TellmeCrochet hochladen" }));
  return screen.getByRole("dialog", { name: "Zu TellmeCrochet hochladen" });
};
const stored = () => JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as Record<string, unknown> & { doc: { parts: Array<{ id?: string }> } };

async function uploadNew() {
  const dialog = openUpload();
  await within(dialog).findByRole("button", { name: "Hochladen" });
  fireEvent.click(within(dialog).getByRole("radio", { name: SELF_CREATED_LABEL }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Hochladen" }));
  await within(dialog).findByText(SUCCESS_LINE);
  fireEvent.click(within(dialog).getByRole("button", { name: "Fertig" }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetStorageConnection();
  history.replaceState(null, "", "/");
});
afterEach(() => cleanup());

describe("the upload in the builder", () => {
  it("without configuration: no button, no account line, nothing loaded; the file can still be saved", async () => {
    await renderApp(null);
    const panel = openMenu();
    expect(within(panel).queryByRole("button", { name: "Zu TellmeCrochet hochladen" })).toBeNull();
    expect(within(panel).getByRole("button", { name: "Für TellmeCrochet speichern (.json)" })).toBeTruthy();
    expect(screen.queryByText(/Angemeldet als/)).toBeNull();
  });

  it("with configuration the file can be saved all the same, and nothing loads before it is needed", async () => {
    const fake = fakeTmcServices({ session: null });
    await renderApp(fake);
    const panel = openMenu();
    expect(within(panel).getByRole("button", { name: "Für TellmeCrochet speichern (.json)" })).toBeTruthy();
    expect(fake.loadClient).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "Zu TellmeCrochet hochladen" }));
    await waitFor(() => expect(fake.loadClient).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: "Mit Google anmelden" });
  });

  it("the app behind the dialog is inert and ignores shortcuts; the focus returns to „Exportieren“", async () => {
    const fake = fakeTmcServices({ session: null });
    await renderApp(fake);
    await loadBall();
    const app = document.querySelector(".app")!;
    const dialog = openUpload();
    await screen.findByRole("button", { name: "Mit Google anmelden" });
    expect(app.hasAttribute("inert")).toBe(true);
    const title = (screen.getByLabelText("Titel der Anleitung", { selector: "input" }) as HTMLInputElement).value;
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect((screen.getByLabelText("Titel der Anleitung", { selector: "input" }) as HTMLInputElement).value).toBe(title);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Zu TellmeCrochet hochladen" })).toBeNull();
    expect(app.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Exportieren/ }));
  });

  it("after an upload: key and time stored next to the document, parts have ids, the menu says when", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW + 60_000);
    try {
      const fake = fakeTmcServices();
      await renderApp(fake);
      await loadBall();
      expect(within(openMenu()).queryByText(/Zuletzt hochgeladen/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Exportieren/ })); // close

      await uploadNew();
      await waitFor(() => expect(stored().builderKey).toBe("new-key-1"));
      expect(stored().lastUpload).toEqual({ patternId: "pattern-new", at: NOW, origin: "self_created" });
      expect(stored().doc).not.toHaveProperty("builderKey");
      expect(stored().doc.parts.map((p) => p.id)).toEqual(["ball"]);

      expect(within(openMenu()).getByText(/^Zuletzt hochgeladen: heute, \d\d:32$/)).toBeTruthy();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("uploading again goes straight to the same project, across a reload; what is exported stays free of it", async () => {
    const fake = fakeTmcServices();
    const json: unknown[] = [];
    await renderApp(fake, { downloadJson: (doc: unknown) => json.push(doc) });
    await loadBall();
    await uploadNew();
    await waitFor(() => expect(stored().builderKey).toBe("new-key-1"));
    cleanup();

    resetStorageConnection();
    const again = fakeTmcServices({ projects: [target({ patternId: "pattern-new", builderKey: "new-key-1" })] });
    await renderApp(again, { downloadJson: (doc: unknown) => json.push(doc) });
    await screen.findByLabelText("Maschen von Runde 11 als Text");
    const dialog = openUpload();
    await within(dialog).findByRole("button", { name: "Aktualisieren" });
    expect(again.server.of("list")).toHaveLength(0);
    expect(again.server.of("check")[0]!.patternId).toBe("pattern-new");
    expect(again.server.of("check")[0]!.partKeys).toEqual(["ball"]);
    fireEvent.keyDown(dialog, { key: "Escape" });

    fireEvent.click(within(openMenu()).getByRole("button", { name: "JSON herunterladen" }));
    await waitFor(() => expect(json).toHaveLength(1));
    const exported = BuilderExportSchema.parse(json[0]);
    expect(JSON.stringify(exported)).not.toMatch(/builderKey|lastUpload|new-key-1/);
  });

  it("„Neu“ leaves the project behind; „Rückgängig“ brings the document back with it", async () => {
    const fake = fakeTmcServices();
    await renderApp(fake);
    await loadBall();
    await uploadNew();
    await waitFor(() => expect(stored().builderKey).toBe("new-key-1"));
    fireEvent.click(screen.getByRole("button", { name: /^Neu$/ }));
    await waitFor(() => expect(stored()).not.toHaveProperty("builderKey"));
    expect(within(openMenu()).queryByText(/Zuletzt hochgeladen/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Exportieren/ }));
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    await waitFor(() => expect(stored().builderKey).toBe("new-key-1"));
    expect(within(openMenu()).getByText(/Zuletzt hochgeladen/)).toBeTruthy();
  });

  it("an opened file has no project until it is uploaded", async () => {
    const fake = fakeTmcServices({ projects: [target({ title: "Amigurumi-Ball", patternId: "from-list", builderKey: "key-list" })] });
    await renderApp(fake, { confirm: () => true });
    await loadBall();
    await uploadNewOrUpdate();
    const panel = openMenu();
    const exported = demoDocument(ids("x"), "ball");
    fireEvent.change(screen.getByTestId("json-file-input"), {
      target: { files: [new File([JSON.stringify(exported)], "ball.json", { type: "application/json" })] },
    });
    await within(panel).findByText("„ball.json“ geöffnet.");
    await waitFor(() => expect(stored()).not.toHaveProperty("builderKey"));
    fireEvent.click(within(panel).getByRole("button", { name: "Zu TellmeCrochet hochladen" }));
    // Back through the list, which finds the project by its title.
    await screen.findByRole("group", { name: "Wohin?" });
    expect(fake.server.of("list")).toHaveLength(2);
  });

  it("the header shows the account while signed in; „Abmelden“ ends this browser's session only", async () => {
    localStorage.setItem(TMC_STORAGE_KEY, "{}");
    const fake = fakeTmcServices();
    await renderApp(fake);
    await screen.findByText(`Angemeldet als ${MAIL}`);
    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    await waitFor(() => expect(screen.queryByText(/Angemeldet als/)).toBeNull());
    expect(fake.auth.calls.signOut).toHaveBeenCalledWith({ scope: "local" });
    const dialog = openUpload();
    await within(dialog).findByRole("button", { name: "Mit Google anmelden" });
    // Signing out on purpose is no expired session.
    expect(within(dialog).queryByText(/abgelaufen/)).toBeNull();
  });
});

async function uploadNewOrUpdate() {
  const dialog = openUpload();
  fireEvent.click(await within(dialog).findByRole("button", { name: "Aktualisieren" }));
  await within(dialog).findByText(SUCCESS_LINE);
  fireEvent.click(within(dialog).getByRole("button", { name: "Fertig" }));
  await waitFor(() => expect(stored().builderKey).toBe("key-list"));
}

describe("the return from signing in with Google", () => {
  const back = (search: string, hash = "") => {
    markRedirect({ choice: "new", origin: "imported" }, NOW);
    history.replaceState(null, "", `/${search}${hash}`);
  };

  it("exchanges the code, cleans the address, opens the dialog with what was chosen", async () => {
    const stateDoc = demoDocument(ids("s"), "ball");
    localStorage.setItem(LS_KEY, JSON.stringify({ doc: stateDoc, pinned: [], savedAt: Date.now() }));
    back("?code=abc");
    const fake = fakeTmcServices({ session: null });
    fake.auth.exchangeSession = sessionFor();
    await renderApp(fake);
    expect(location.search).toBe("");
    const dialog = await screen.findByRole("dialog", { name: "Zu TellmeCrochet hochladen" });
    expect(fake.auth.calls.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(fake.auth.calls.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    await within(dialog).findByRole("button", { name: "Hochladen" });
    expect((within(dialog).getByRole("radio", { name: /Nicht selbst entworfen/ }) as HTMLInputElement).checked).toBe(true);
    // The document came back from its autosave, an old account gets no note.
    expect((screen.getByLabelText("Titel der Anleitung", { selector: "input" }) as HTMLInputElement).value).toBe("Amigurumi-Ball");
    expect(within(dialog).queryByText(NEW_ACCOUNT_LINE, { exact: false })).toBeNull();
    // Used up: closing and reloading does not open it again.
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Zu TellmeCrochet hochladen" })).toBeNull();
    cleanup();
    resetStorageConnection();
    await renderApp(fakeTmcServices({ session: null }));
    expect(screen.queryByRole("dialog", { name: "Zu TellmeCrochet hochladen" })).toBeNull();
  });

  it("an account created in the last minute: an honest note and the legal line", async () => {
    back("?code=abc");
    const fake = fakeTmcServices({ session: null });
    fake.auth.exchangeSession = sessionFor(MAIL, new Date(NOW - 20_000).toISOString());
    await renderApp(fake);
    const dialog = await screen.findByRole("dialog", { name: "Zu TellmeCrochet hochladen" });
    await within(dialog).findByText(NEW_ACCOUNT_LINE, { exact: false });
    const legal = within(dialog).getByRole("link", { name: SIGN_UP_LEGAL_LINE }) as HTMLAnchorElement;
    expect(legal.href).toBe("https://tellmecrochet.vercel.app/datenschutz");
  });

  it("an account older than that gets no note", async () => {
    back("?code=abc");
    const fake = fakeTmcServices({ session: null });
    fake.auth.exchangeSession = sessionFor(MAIL, new Date(NOW - 61_000).toISOString());
    await renderApp(fake);
    const dialog = await screen.findByRole("dialog", { name: "Zu TellmeCrochet hochladen" });
    await within(dialog).findByRole("button", { name: "Hochladen" });
    expect(within(dialog).queryByText(NEW_ACCOUNT_LINE, { exact: false })).toBeNull();
  });

  it("a refused or failed return says so, in the dialog and with a clean address", async () => {
    back("?error=access_denied&error_description=nope");
    const fake = fakeTmcServices({ session: null });
    await renderApp(fake);
    expect(location.search).toBe("");
    const dialog = await screen.findByRole("dialog", { name: "Zu TellmeCrochet hochladen" });
    expect((await within(dialog).findByRole("alert")).textContent).toBe(GOOGLE_FAILED_LINE);
    expect(fake.auth.calls.exchangeCodeForSession).not.toHaveBeenCalled();
    cleanup();

    back("?code=abc");
    const failing = fakeTmcServices({ session: null });
    failing.auth.exchangeError = { message: "invalid flow state" };
    await renderApp(failing);
    const second = await screen.findByRole("dialog", { name: "Zu TellmeCrochet hochladen" });
    expect((await within(second).findByRole("alert")).textContent).toBe(GOOGLE_FAILED_LINE);
  });

  it("a share link in the fragment stays with the share handling", async () => {
    back("?code=abc", "#other=1");
    const fake = fakeTmcServices({ session: null });
    await renderApp(fake);
    await screen.findByRole("dialog", { name: "Zu TellmeCrochet hochladen" });
    expect(location.search).toBe("");
    expect(location.hash).toBe("#other=1");
  });

  it("a `?code=` without the mark of a sign-in is none of this: not used, not touched", async () => {
    history.replaceState(null, "", "/?code=somebody-elses");
    const fake = fakeTmcServices({ session: null });
    await renderApp(fake);
    expect(location.search).toBe("?code=somebody-elses");
    expect(fake.loadClient).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Zu TellmeCrochet hochladen" })).toBeNull();
  });
});
