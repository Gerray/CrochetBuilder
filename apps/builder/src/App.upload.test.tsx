// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "./App.js";
import { BuilderExportSchema, encodeShare } from "@crochetbuilder/engine";
import { prepareExport } from "./export/prepare.js";
import { demoDocument, type BuilderDoc } from "./state/document.js";
import { documentIdentity, type UploadLink } from "./state/uploadLink.js";
import { LS_KEY, resetStorageConnection } from "./state/storage.js";
import { ERROR, fakeTmcServices, KEY_1, MAIL, NEW_KEY_1, NOW, PATTERN_1, PATTERN_NEW, sessionFor, target, uuid } from "./test/fakeTmc.js";
import { markRedirect, type UploadResume } from "./tmc/redirect.js";
import { TMC_STORAGE_KEY } from "./tmc/client.js";
import { GOOGLE_FAILED_LINE, LIBRARY_FAILED_LINE, NEW_ACCOUNT_LINE, SELF_CREATED_LABEL, STALE_CODE_LINE, SUCCESS_LINE } from "./tmc/texts.js";

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
  it("a build without configuration offers nothing and touches nothing, even with a session and a code around", async () => {
    localStorage.setItem(TMC_STORAGE_KEY, "{}");
    localStorage.setItem(`${TMC_STORAGE_KEY}-code-verifier`, "v");
    history.replaceState(null, "", "/?code=abc");
    const network = vi.spyOn(globalThis, "fetch");
    try {
      // No `tmc`: the build's own configuration, which has no values in tests.
      render(<App />);
      await screen.findByLabelText("Maschen von Runde 1 als Text");
      const panel = openMenu();
      expect(within(panel).queryByRole("button", { name: "Zu TellmeCrochet hochladen" })).toBeNull();
      expect(within(panel).getByRole("button", { name: "Für TellmeCrochet speichern (.json)" })).toBeTruthy();
      expect(screen.queryByText(/Angemeldet als/)).toBeNull();
      expect(location.search).toBe("?code=abc");
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });

  it("with configuration the file can be saved all the same, and nothing loads before it is needed", async () => {
    const fake = fakeTmcServices({ session: null });
    await renderApp(fake);
    await loadBall();
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
      await waitFor(() => expect(stored().builderKey).toBe(NEW_KEY_1));
      expect(stored().lastUpload).toEqual({ patternId: PATTERN_NEW, at: NOW, origin: "self_created" });
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
    await waitFor(() => expect(stored().builderKey).toBe(NEW_KEY_1));
    cleanup();

    resetStorageConnection();
    const again = fakeTmcServices({ projects: [target({ patternId: PATTERN_NEW, builderKey: NEW_KEY_1 })] });
    await renderApp(again, { downloadJson: (doc: unknown) => json.push(doc) });
    await screen.findByLabelText("Maschen von Runde 11 als Text");
    const dialog = openUpload();
    await within(dialog).findByRole("button", { name: "Aktualisieren" });
    expect(again.server.of("list")).toHaveLength(0);
    expect(again.server.of("check")[0]!.patternId).toBe(PATTERN_NEW);
    expect(again.server.of("check")[0]!.partKeys).toEqual(["ball"]);
    fireEvent.keyDown(dialog, { key: "Escape" });

    fireEvent.click(within(openMenu()).getByRole("button", { name: "JSON herunterladen" }));
    await waitFor(() => expect(json).toHaveLength(1));
    const exported = BuilderExportSchema.parse(json[0]);
    expect(JSON.stringify(exported)).not.toMatch(new RegExp(`builderKey|lastUpload|${NEW_KEY_1}`));
  });

  it("„Neu“ leaves the project behind; „Rückgängig“ brings the document back with it", async () => {
    const fake = fakeTmcServices();
    await renderApp(fake);
    await loadBall();
    await uploadNew();
    await waitFor(() => expect(stored().builderKey).toBe(NEW_KEY_1));
    fireEvent.click(screen.getByRole("button", { name: /^Neu$/ }));
    await waitFor(() => expect(stored()).not.toHaveProperty("builderKey"));
    expect(within(openMenu()).queryByText(/Zuletzt hochgeladen/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Exportieren/ }));
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    await waitFor(() => expect(stored().builderKey).toBe(NEW_KEY_1));
    expect(within(openMenu()).getByText(/Zuletzt hochgeladen/)).toBeTruthy();
  });

  it("an opened file has no project until it is uploaded", async () => {
    const fake = fakeTmcServices({ projects: [target({ title: "Amigurumi-Ball", patternId: uuid(15), builderKey: uuid(16) })] });
    await renderApp(fake, { confirm: () => true });
    await loadBall();
    // A demo chooses for itself, among the projects.
    const first = openUpload();
    await within(first).findByRole("button", { name: "Hochladen" });
    expect((within(first).getByRole("radio", { name: "Neues Projekt" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(first).getByRole("radio", { name: /Amigurumi-Ball/ }));
    fireEvent.click(await within(first).findByRole("button", { name: "Aktualisieren" }));
    await within(first).findByText(SUCCESS_LINE);
    fireEvent.click(within(first).getByRole("button", { name: "Fertig" }));
    await waitFor(() => expect(stored().builderKey).toBe(uuid(16)));

    const panel = openMenu();
    const exported = demoDocument(ids("x"), "ball");
    fireEvent.change(screen.getByTestId("json-file-input"), {
      target: { files: [new File([JSON.stringify(exported)], "ball.json", { type: "application/json" })] },
    });
    await within(panel).findByText("„ball.json“ geöffnet.");
    await waitFor(() => expect(stored()).not.toHaveProperty("builderKey"));
    fireEvent.click(within(panel).getByRole("button", { name: "Zu TellmeCrochet hochladen" }));
    // Back through the list, which finds the project by its title: this one is from a file.
    const group = await screen.findByRole("group", { name: "Wohin?" });
    expect(fake.server.of("list")).toHaveLength(2);
    await waitFor(() => expect((within(group).getByRole("radio", { name: /Amigurumi-Ball/ }) as HTMLInputElement).checked).toBe(true));
  });

  it("a first upload whose answer got lost: the key is stored already, reopening links the project made", async () => {
    const fake = fakeTmcServices();
    await renderApp(fake);
    await loadBall();
    const dialog = openUpload();
    await within(dialog).findByRole("button", { name: "Hochladen" });
    // The server takes it; the answer never arrives.
    fake.server.next("create", async () => {
      fake.server.projects.push(target({ builderKey: NEW_KEY_1, patternId: uuid(70), title: "Amigurumi-Ball" }));
      throw new TypeError("Failed to fetch");
    });
    fireEvent.click(within(dialog).getByRole("radio", { name: SELF_CREATED_LABEL }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Hochladen" }));
    await within(dialog).findByText(/Keine Verbindung/);
    await waitFor(() => expect(stored().builderKey).toBe(NEW_KEY_1));
    expect(stored()).not.toHaveProperty("lastUpload");
    cleanup();

    resetStorageConnection();
    const again = fakeTmcServices({ projects: fake.server.projects });
    await renderApp(again);
    const reopened = openUpload();
    await within(reopened).findByRole("button", { name: "Aktualisieren" });
    expect(again.server.of("create")).toHaveLength(0);
    expect(again.server.of("check")[0]!.patternId).toBe(uuid(70));
  });

  it("a retry after a lost answer gets key-in-use and links the existing project", async () => {
    const fake = fakeTmcServices();
    await renderApp(fake);
    await loadBall();
    const dialog = openUpload();
    await within(dialog).findByRole("button", { name: "Hochladen" });
    fake.server.next("create", async () => {
      fake.server.projects.push(target({ builderKey: NEW_KEY_1, patternId: uuid(70), title: "Anderer Titel" }));
      throw new TypeError("Failed to fetch");
    });
    fireEvent.click(within(dialog).getByRole("radio", { name: SELF_CREATED_LABEL }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Hochladen" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Erneut versuchen" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Aktualisieren" }));
    await within(dialog).findByText(SUCCESS_LINE);
    expect(fake.server.of("create").map((r) => r.builderKey)).toEqual([NEW_KEY_1, NEW_KEY_1]);
    await waitFor(() => expect(stored().lastUpload).toMatchObject({ patternId: uuid(70) }));
  });

  it("an upload of a live project going to a new project keeps the old link until that exists", async () => {
    const fake = fakeTmcServices();
    await renderApp(fake);
    await loadBall();
    await uploadNew();
    await waitFor(() => expect(stored().builderKey).toBe(NEW_KEY_1));
    fake.server.checkResult.changedInApp = true;
    const dialog = openUpload();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Als neues Projekt anlegen" }));
    fake.server.next("create", { status: 500, body: null });
    fireEvent.click(within(dialog).getByRole("radio", { name: SELF_CREATED_LABEL }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Hochladen" }));
    await within(dialog).findByRole("alert");
    expect(stored().builderKey).toBe(NEW_KEY_1);
    expect(stored().lastUpload).toMatchObject({ patternId: PATTERN_NEW });
  });

  it("a project deleted in the app: key stays stored, the last upload goes, a new project takes the key", async () => {
    const fake = fakeTmcServices();
    await renderApp(fake);
    await loadBall();
    await uploadNew();
    await waitFor(() => expect(stored().builderKey).toBe(NEW_KEY_1));
    // Deleted in the app meanwhile.
    fake.server.projects.length = 0;
    const dialog = openUpload();
    const create = await within(dialog).findByRole("button", { name: "Als neues Projekt anlegen" });
    await waitFor(() => expect(stored()).not.toHaveProperty("lastUpload"));
    expect(stored().builderKey).toBe(NEW_KEY_1);
    fireEvent.click(within(dialog).getByRole("radio", { name: SELF_CREATED_LABEL }));
    fireEvent.click(create);
    await within(dialog).findByText(SUCCESS_LINE);
    expect(fake.server.of("create").map((r) => r.builderKey)).toEqual([NEW_KEY_1, NEW_KEY_1]);
    await waitFor(() => expect(stored().lastUpload).toMatchObject({ patternId: uuid(902) }));
  });

  it("the header shows the account while signed in; „Abmelden“ ends this browser's session only", async () => {
    localStorage.setItem(TMC_STORAGE_KEY, "{}");
    const fake = fakeTmcServices();
    await renderApp(fake);
    await screen.findByText(`Angemeldet als ${MAIL}`);
    await loadBall();
    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    await waitFor(() => expect(screen.queryByText(/Angemeldet als/)).toBeNull());
    expect(fake.auth.calls.signOut).toHaveBeenCalledWith({ scope: "local" });
    const dialog = openUpload();
    await within(dialog).findByRole("button", { name: "Mit Google anmelden" });
    // Signing out on purpose is no expired session.
    expect(within(dialog).queryByText(/abgelaufen/)).toBeNull();
  });
});

describe("another document taking over while the dialog is open", () => {
  const shareLink = async () => `#data=${await encodeShare(prepareExport(demoDocument(ids("k"), "sphere")))}`;
  const follow = async (hash: string) => {
    history.replaceState(null, "", `/${hash}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  async function uploaded() {
    const fake = fakeTmcServices();
    await renderApp(fake);
    await loadBall();
    await uploadNew();
    await waitFor(() => expect(stored().builderKey).toBe(NEW_KEY_1));
    return fake;
  }

  it("a share link closes the dialog: its project is not the new document's", async () => {
    const fake = await uploaded();
    const dialog = openUpload();
    const update = await within(dialog).findByRole("button", { name: "Aktualisieren" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      await follow(await shareLink());
      await waitFor(() => expect((screen.getByLabelText("Titel der Anleitung", { selector: "input" }) as HTMLInputElement).value).toBe("Amigurumi-Kugel"));
      expect(screen.queryByRole("dialog", { name: "Zu TellmeCrochet hochladen" })).toBeNull();
      expect(update.isConnected).toBe(false);
      expect(document.querySelector(".app")!.hasAttribute("inert")).toBe(false);
      expect(fake.server.of("update")).toHaveLength(0);
      await waitFor(() => expect(stored()).not.toHaveProperty("builderKey"));
    } finally {
      confirm.mockRestore();
    }
  });

  it("an upload on its way is dropped: nothing lands on the new document", async () => {
    const fake = await uploaded();
    const dialog = openUpload();
    const update = await within(dialog).findByRole("button", { name: "Aktualisieren" });
    let release = (_: { status: number; body: unknown }) => {};
    fake.server.next("update", () => new Promise((resolve) => (release = resolve)));
    fireEvent.click(update);
    await waitFor(() => expect(fake.server.of("update")).toHaveLength(1));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      await follow(await shareLink());
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Zu TellmeCrochet hochladen" })).toBeNull());
      release({ status: 200, body: { target: target({ builderKey: NEW_KEY_1, patternId: PATTERN_NEW }), materialsKept: false } });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(stored()).not.toHaveProperty("builderKey");
      expect(stored()).not.toHaveProperty("lastUpload");
      expect(stored().doc.parts.every((p) => p.id === undefined)).toBe(true);
      expect(within(openMenu()).queryByText(/Zuletzt hochgeladen/)).toBeNull();
    } finally {
      confirm.mockRestore();
    }
  });

  it("a failure on its way is dropped as well: the new document's key survives", async () => {
    const fake = await uploaded();
    const dialog = openUpload();
    const update = await within(dialog).findByRole("button", { name: "Aktualisieren" });
    let release = (_: { status: number; body: unknown }) => {};
    fake.server.next("update", () => new Promise((resolve) => (release = resolve)));
    fireEvent.click(update);
    await waitFor(() => expect(fake.server.of("update")).toHaveLength(1));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      await follow(await shareLink());
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Zu TellmeCrochet hochladen" })).toBeNull());
      const before = fake.server.requests.length;
      release(ERROR(404, "not-found"));
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Neither a forgotten project nor a new list.
      expect(fake.server.requests).toHaveLength(before);
    } finally {
      confirm.mockRestore();
    }
  });

  it("declining the link changes nothing: the dialog stays with its project", async () => {
    await uploaded();
    const dialog = openUpload();
    const update = await within(dialog).findByRole("button", { name: "Aktualisieren" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      await follow(await shareLink());
      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(update.isConnected).toBe(true);
      expect(stored().builderKey).toBe(NEW_KEY_1);
    } finally {
      confirm.mockRestore();
    }
  });
});

describe("the return from signing in with Google", () => {
  const verifier = () => localStorage.setItem(`${TMC_STORAGE_KEY}-code-verifier`, "v");
  const ball = () => demoDocument(ids("s"), "ball");
  /** The autosave as it is when the page comes back. */
  const autosaved = (doc: BuilderDoc, link: UploadLink | null = null) =>
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ doc, pinned: [], savedAt: NOW, ...(link ? { builderKey: link.builderKey, lastUpload: link.lastUpload } : {}) }),
    );
  const at = (search: string, hash = "") => history.replaceState(null, "", `/${search}${hash}`);
  const back = (search: string, hash = "") => {
    const doc = ball();
    autosaved(doc);
    verifier();
    markRedirect({ document: documentIdentity(doc, null), choice: "new", origin: "imported" }, NOW);
    at(search, hash);
  };

  describe("to a document other than the one it left", () => {
    const LINK: UploadLink = { builderKey: KEY_1, lastUpload: { patternId: PATTERN_1, at: 1, origin: "self_created" } };

    async function returned(mark: UploadResume, fake: Fake) {
      verifier();
      markRedirect(mark, NOW);
      at("?code=abc");
      await renderApp(fake);
      return screen.findByRole("dialog", { name: "Zu TellmeCrochet hochladen" });
    }

    it("another tab loaded „Ball“ meanwhile: project „Kugel“ is not offered for it, nothing to overwrite in one click", async () => {
      const kugel = demoDocument(ids("k"), "sphere");
      autosaved(ball());
      const fake = fakeTmcServices({ session: null, projects: [target({ title: "Amigurumi-Kugel" })] });
      const dialog = await returned({ document: documentIdentity(kugel, LINK), choice: PATTERN_1 }, fake);
      await within(dialog).findByRole("button", { name: "Hochladen" });
      expect((screen.getByLabelText("Titel der Anleitung", { selector: "input" }) as HTMLInputElement).value).toBe("Amigurumi-Ball");
      expect(fake.server.of("check")).toHaveLength(0);
      expect(within(dialog).queryByRole("button", { name: "Aktualisieren" })).toBeNull();
      expect((within(dialog).getByRole("radio", { name: "Neues Projekt" }) as HTMLInputElement).checked).toBe(true);
    });

    it("the rights chosen for the other document do not carry over", async () => {
      const kugel = demoDocument(ids("k"), "sphere");
      autosaved(ball());
      const fake = fakeTmcServices({ session: null });
      const dialog = await returned({ document: documentIdentity(kugel, null), choice: "new", origin: "imported" }, fake);
      const upload = (await within(dialog).findByRole("button", { name: "Hochladen" })) as HTMLButtonElement;
      for (const r of within(dialog).getAllByRole("radio") as HTMLInputElement[]) expect(r.checked).toBe(false);
      expect(upload.disabled).toBe(true);
    });

    it("a mark that names no document counts for none", async () => {
      autosaved(ball());
      const fake = fakeTmcServices({ session: null });
      const dialog = await returned({ choice: "new", origin: "imported" }, fake);
      await within(dialog).findByRole("button", { name: "Hochladen" });
      expect((within(dialog).getByRole("radio", { name: /Nicht selbst entworfen/ }) as HTMLInputElement).checked).toBe(false);
    });

    it("the mark is used up, match or not", async () => {
      autosaved(ball());
      await returned({ document: "doc:another", choice: "new", origin: "imported" }, fakeTmcServices({ session: null }));
      expect(sessionStorage.length).toBe(0);
    });

    it("the same document with its project: goes on with that project", async () => {
      const doc = ball();
      autosaved(doc, LINK);
      const fake = fakeTmcServices({ session: null, projects: [target()] });
      const dialog = await returned({ document: documentIdentity(doc, LINK), choice: PATTERN_1 }, fake);
      await within(dialog).findByRole("button", { name: "Aktualisieren" });
      expect(fake.server.of("check")[0]!.patternId).toBe(PATTERN_1);
    });

    it("the whole way: the rights stay through a real trip, for the document saved by the app", async () => {
      const fake = fakeTmcServices();
      fake.server.next("create", ERROR(401, "unauthorized"));
      await renderApp(fake);
      await loadBall();
      const dialog = openUpload();
      await within(dialog).findByRole("button", { name: "Hochladen" });
      fireEvent.click(within(dialog).getByRole("radio", { name: /Nicht selbst entworfen/ }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Hochladen" }));
      fireEvent.click(await within(dialog).findByRole("button", { name: "Mit Google anmelden" }));
      await waitFor(() => expect(fake.auth.calls.signInWithOAuth).toHaveBeenCalled());
      await waitFor(() => expect(stored().builderKey).toBe(NEW_KEY_1));
      cleanup();

      resetStorageConnection();
      verifier();
      at("?code=abc");
      await renderApp(fakeTmcServices({ session: null }));
      const again = await screen.findByRole("dialog", { name: "Zu TellmeCrochet hochladen" });
      const radio = (await within(again).findByRole("radio", { name: /Nicht selbst entworfen/ })) as HTMLInputElement;
      expect(radio.checked).toBe(true);
    });
  });

  describe("a mark left over", () => {
    it("without a return (given up, back through the history): no dialog on the next load", async () => {
      autosaved(ball());
      markRedirect({ choice: "new", origin: "imported" }, NOW);
      await renderApp(fakeTmcServices({ session: null }));
      await screen.findByLabelText("Maschen von Runde 11 als Text");
      expect(screen.queryByRole("dialog", { name: "Zu TellmeCrochet hochladen" })).toBeNull();
      expect(sessionStorage.length).toBe(0);
    });

    it("the page restored from the browser's cache forgets it", async () => {
      await renderApp(fakeTmcServices({ session: null }));
      markRedirect({ choice: "new", origin: "imported" }, NOW);
      const show = new Event("pageshow");
      Object.defineProperty(show, "persisted", { value: true });
      window.dispatchEvent(show);
      expect(sessionStorage.length).toBe(0);
    });
  });

  it("exchanges the code, cleans the address, opens the dialog with what was chosen", async () => {
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

  it("an account created in the last minute: an honest note", async () => {
    back("?code=abc");
    const fake = fakeTmcServices({ session: null });
    fake.auth.exchangeSession = sessionFor(MAIL, new Date(NOW - 20_000).toISOString());
    await renderApp(fake);
    const dialog = await screen.findByRole("dialog", { name: "Zu TellmeCrochet hochladen" });
    // Only the note: an account needs nothing further from here.
    expect((await within(dialog).findByText(NEW_ACCOUNT_LINE)).querySelector("a")).toBeNull();
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

  it("a share link in the fragment stays with the share handling, and its document ends the dialog", async () => {
    back("?code=abc", `#data=${await encodeShare(prepareExport(demoDocument(ids("k"), "sphere")))}`);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const fake = fakeTmcServices({ session: null });
      await renderApp(fake);
      expect(location.search).toBe("");
      await waitFor(() => expect((screen.getByLabelText("Titel der Anleitung", { selector: "input" }) as HTMLInputElement).value).toBe("Amigurumi-Kugel"));
      expect(location.hash).toBe("");
      expect(fake.auth.calls.exchangeCodeForSession).toHaveBeenCalledWith("abc");
      expect(screen.queryByRole("dialog", { name: "Zu TellmeCrochet hochladen" })).toBeNull();
    } finally {
      confirm.mockRestore();
    }
  });

  describe("a code without the mark", () => {
    it("with its verifier (late return, new tab, no session storage): is redeemed, without opening the dialog", async () => {
      autosaved(ball());
      verifier();
      at("?code=late");
      const fake = fakeTmcServices({ session: null });
      await renderApp(fake);
      await screen.findByText(`Angemeldet als ${MAIL}`);
      expect(fake.auth.calls.exchangeCodeForSession).toHaveBeenCalledTimes(1);
      expect(fake.auth.calls.exchangeCodeForSession).toHaveBeenCalledWith("late");
      expect(location.search).toBe("");
      expect(screen.queryByRole("dialog", { name: "Zu TellmeCrochet hochladen" })).toBeNull();
    });

    it("an account made that way still gets its note", async () => {
      autosaved(ball());
      verifier();
      at("?code=late");
      const fake = fakeTmcServices({ session: null });
      fake.auth.exchangeSession = sessionFor(MAIL, new Date(NOW - 20_000).toISOString());
      await renderApp(fake);
      await screen.findByText(NEW_ACCOUNT_LINE);
    });

    it("without a verifier: cleaned from the address with an honest message, nothing loaded", async () => {
      at("?code=somebody-elses");
      const fake = fakeTmcServices({ session: null });
      await renderApp(fake);
      expect(location.search).toBe("");
      const notice = await screen.findByRole("alert");
      expect(notice.textContent).toContain(STALE_CODE_LINE);
      expect(fake.loadClient).not.toHaveBeenCalled();
      expect(fake.auth.calls.exchangeCodeForSession).not.toHaveBeenCalled();
      fireEvent.click(within(notice).getByRole("button", { name: "Schließen" }));
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("the library fails to load: the code waits for „Erneut versuchen“", async () => {
      autosaved(ball());
      verifier();
      at("?code=late");
      const fake = fakeTmcServices({ session: null });
      // Once on the way in, once more when the dialog opens.
      fake.loadClient.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
      await renderApp(fake);
      await waitFor(() => expect(fake.loadClient).toHaveBeenCalledTimes(1));
      expect(location.search).toBe("");
      // The first failure has landed before the dialog opens.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const dialog = openUpload();
      await within(dialog).findByText(LIBRARY_FAILED_LINE);
      fireEvent.click(within(dialog).getByRole("button", { name: "Erneut versuchen" }));
      await waitFor(() => expect(fake.auth.calls.exchangeCodeForSession).toHaveBeenCalledWith("late"));
      await within(dialog).findByRole("button", { name: "Hochladen" });
    });

    it("a redirect with a mark and without a verifier says so in the dialog", async () => {
      autosaved(ball());
      markRedirect({ choice: "new" }, NOW);
      at("?code=abc");
      const fake = fakeTmcServices({ session: null });
      await renderApp(fake);
      const dialog = await screen.findByRole("dialog", { name: "Zu TellmeCrochet hochladen" });
      expect((await within(dialog).findByRole("alert")).textContent).toBe(STALE_CODE_LINE);
      expect(fake.auth.calls.exchangeCodeForSession).not.toHaveBeenCalled();
    });
  });
});
