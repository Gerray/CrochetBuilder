// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EMPTY_PATTERN_LINE } from "../export/tmc.js";
import { demoDocument, emptyDocument, type BuilderDoc } from "../state/document.js";
import type { UploadLink } from "../state/uploadLink.js";
import { ERROR, fakeTmcServices, MAIL, target } from "../test/fakeTmc.js";
import { TMC_STORAGE_KEY } from "./client.js";
import {
  APP_STORE_URL,
  CHANGED_IN_APP_LINE,
  CHANGES_LOST_LINE,
  CODE_REJECTED_LINE,
  EXPIRED_LINE,
  IMPORTED_HINT,
  IMPORTED_LABEL,
  IMPRINT_URL,
  NO_ACCOUNT_LINE,
  PRIVACY_LINE,
  PRIVACY_URL,
  SELF_CREATED_LABEL,
  SHARE_QUESTION,
  SHARED_LINE,
  SHARED_VERSION_KEPT_LINE,
  SUCCESS_LINE,
  UPDATE_SOURCE_LINE,
} from "./texts.js";
import { UploadDialog } from "./UploadDialog.js";
import { useTmcAuth } from "./useTmcAuth.js";

function ids() {
  let n = 0;
  return () => `row-${++n}`;
}

const ball = (): BuilderDoc => demoDocument(ids(), "ball");
const LINK: UploadLink = { builderKey: "key-1", lastUpload: { patternId: "pattern-1", at: 1000, origin: "self_created" } };

type Fake = ReturnType<typeof fakeTmcServices>;

interface Options {
  link?: UploadLink | null;
  doc?: BuilderDoc;
}

/** The dialog as App uses it, with what App does on its callbacks. */
function Harness({ fake, link: initialLink = null, doc = ball(), onEvents }: Options & { fake: Fake; onEvents: Events }) {
  const auth = useTmcAuth(fake.services);
  const [link, setLink] = useState(initialLink);
  const [open, setOpen] = useState(true);
  if (auth.status === "idle") auth.ensure();
  if (!open) return <p>geschlossen</p>;
  return (
    <UploadDialog
      doc={doc}
      originHint="self_created"
      link={link}
      services={fake.services}
      auth={auth}
      onUploaded={(next) => {
        onEvents.uploaded.push(next);
        setLink(next);
      }}
      onForget={(keepKey) => {
        onEvents.forgotten++;
        setLink((l) => (keepKey && l ? { builderKey: l.builderKey, lastUpload: null } : null));
      }}
      onClose={() => setOpen(false)}
    />
  );
}

interface Events {
  uploaded: UploadLink[];
  forgotten: number;
}

function show(fake: Fake, options: Options = {}): Events {
  const events: Events = { uploaded: [], forgotten: 0 };
  render(<Harness fake={fake} {...options} onEvents={events} />);
  return events;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const findButton = async (name: string | RegExp) => (await screen.findByRole("button", { name })) as HTMLButtonElement;
const radio = (name: string | RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;
const settled = async (fake: Fake) => {
  // Lets a running request answer, then its follow-up render.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return fake;
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => cleanup());

describe("a new project", () => {
  it("no projects yet: no picker, only the rights choice; upload stays disabled until chosen", async () => {
    const fake = fakeTmcServices();
    const events = show(fake);
    const upload = await findButton("Hochladen");
    expect(fake.server.of("list")).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "Wohin?" })).toBeNull();
    expect(radio(SELF_CREATED_LABEL).checked).toBe(false);
    expect(radio(new RegExp(IMPORTED_LABEL)).checked).toBe(false);
    expect(upload.disabled).toBe(true);
    expect(screen.getByText(IMPORTED_HINT)).toBeTruthy();
    fireEvent.click(radio(SELF_CREATED_LABEL));
    expect(upload.disabled).toBe(false);
    fireEvent.click(upload);
    await screen.findByText(SUCCESS_LINE);
    const [create] = fake.server.of("create");
    expect(create).toMatchObject({ builderKey: "new-key-1", origin: "self_created" });
    expect(create!.partKeys).toEqual(["ball"]);
    expect(create!.envelope!.draft.parts).toHaveLength(1);
    expect(events.uploaded).toEqual([
      { builderKey: "new-key-1", lastUpload: { patternId: "pattern-new", at: fake.services.now(), origin: "self_created" } },
    ]);
  });

  it("„Nicht selbst entworfen“ sends the origin imported", async () => {
    const fake = fakeTmcServices();
    show(fake);
    const upload = await findButton("Hochladen");
    fireEvent.click(radio(new RegExp(IMPORTED_LABEL)));
    fireEvent.click(upload);
    await screen.findByText(SUCCESS_LINE);
    expect(fake.server.of("create")[0]!.origin).toBe("imported");
    // Nothing shared here: no question about sharing, just done.
    expect(screen.queryByText(SHARE_QUESTION)).toBeNull();
    expect(button("Fertig")).toBeTruthy();
  });

  it("always says what arrives differently and where the pattern goes", async () => {
    const fake = fakeTmcServices();
    show(fake);
    await findButton("Hochladen");
    const summary = screen.getByRole("region", { name: /So kommt die Anleitung/ });
    // The ball has notes and a gauge: they become a step.
    expect(within(summary).getByText(/stehen als Schritt am Anfang des ersten Teils/)).toBeTruthy();
    expect(screen.getByText(new RegExp(PRIVACY_LINE))).toBeTruthy();
    expect((screen.getByRole("link", { name: "Datenschutz" }) as HTMLAnchorElement).href).toBe(PRIVACY_URL);
  });

  it("a double click uploads once; a lost answer retries with the same key", async () => {
    const fake = fakeTmcServices();
    fake.server.next("create", { status: 500, body: null });
    const events = show(fake);
    const upload = await findButton("Hochladen");
    fireEvent.click(radio(SELF_CREATED_LABEL));
    fireEvent.click(upload);
    fireEvent.click(upload);
    await screen.findByRole("alert");
    expect(fake.server.of("create")).toHaveLength(1);
    expect(events.uploaded).toEqual([]);
    // Nothing lost: the choice stands, one more click and the same key goes out.
    expect(radio(SELF_CREATED_LABEL).checked).toBe(true);
    fireEvent.click(await findButton("Hochladen"));
    await screen.findByText(SUCCESS_LINE);
    expect(fake.server.of("create").map((r) => r.builderKey)).toEqual(["new-key-1", "new-key-1"]);
  });

  it("a key already in use finds its project instead of making another", async () => {
    const existing = target({ builderKey: "new-key-1", patternId: "pattern-mine", title: "Anderer Titel" });
    const fake = fakeTmcServices();
    fake.server.next("create", ERROR(409, "key-in-use"));
    show(fake);
    const upload = await findButton("Hochladen");
    fireEvent.click(radio(SELF_CREATED_LABEL));
    fake.server.projects.push(existing);
    fireEvent.click(upload);
    expect((await screen.findByRole("alert")).textContent).toMatch(/schon ein Projekt/);
    await findButton("Aktualisieren");
    expect(radio(/Anderer Titel/).checked).toBe(true);
  });
});

describe("the project picker", () => {
  const projects = () => [target({ title: "Mütze", patternId: "p-a" }), target({ title: "  amigurumi-BALL ", patternId: "p-b", builderKey: "key-b" })];

  it("preselects the project with the same title and adopts its key on upload", async () => {
    const fake = fakeTmcServices({ projects: projects() });
    const events = show(fake);
    await findButton("Aktualisieren");
    expect(radio(/amigurumi-BALL/).checked).toBe(true);
    expect(radio("Neues Projekt").checked).toBe(false);
    expect(fake.server.of("check")[0]!.patternId).toBe("p-b");
    fireEvent.click(button("Aktualisieren"));
    await screen.findByText(SUCCESS_LINE);
    expect(events.uploaded[0]!.builderKey).toBe("key-b");
    expect(events.uploaded[0]!.lastUpload!.patternId).toBe("p-b");
    // One check for what the dialog showed, a fresh one right before the update.
    expect(fake.server.of("update")[0]).toMatchObject({ patternId: "p-b", baseToken: "token-2" });
  });

  it("without a matching title „Neues Projekt“ is chosen; another project can be picked and left again", async () => {
    const doc = ball();
    doc.title = "Etwas anderes";
    const fake = fakeTmcServices({ projects: projects() });
    show(fake, { doc });
    const upload = await findButton("Hochladen");
    expect(radio("Neues Projekt").checked).toBe(true);
    expect(upload.disabled).toBe(true);
    expect(fake.server.of("check")).toHaveLength(0);

    fireEvent.click(radio(/Mütze/));
    await findButton("Aktualisieren");
    expect(fake.server.of("check")[0]!.patternId).toBe("p-a");
    expect(screen.queryByRole("radio", { name: SELF_CREATED_LABEL })).toBeNull();

    fireEvent.click(radio("Neues Projekt"));
    expect(radio(SELF_CREATED_LABEL).checked).toBe(false);
    expect(button("Hochladen").disabled).toBe(true);
  });

  it("a late answer about a project no longer chosen changes nothing", async () => {
    const fake = fakeTmcServices({ projects: projects() });
    const doc = ball();
    doc.title = "Etwas anderes";
    let release = () => {};
    fake.server.next(
      "check",
      () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 200, body: { target: projects()[0], ...fake.server.checkResult, changedInApp: true, baseToken: "t" } });
        }),
    );
    show(fake, { doc });
    await findButton("Hochladen");
    fireEvent.click(radio(/Mütze/));
    fireEvent.click(radio("Neues Projekt"));
    await act(async () => release());
    expect(screen.queryByText(new RegExp(CHANGED_IN_APP_LINE))).toBeNull();
    expect(button("Hochladen")).toBeTruthy();
  });
});

describe("an existing project", () => {
  const withKey = (extra: Parameters<typeof target>[0] = {}) => fakeTmcServices({ projects: [target(extra)] });

  it("with a key: straight to check, no list, no picker, rights read-only", async () => {
    const fake = withKey();
    show(fake, { link: LINK });
    await findButton("Aktualisieren");
    expect(fake.server.of("list")).toHaveLength(0);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("Rechte: selbst entworfen")).toBeTruthy();
    expect(screen.getByText(UPDATE_SOURCE_LINE)).toBeTruthy();
    expect(screen.queryByText(SHARED_LINE)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("imported rights are shown as they are", async () => {
    const fake = withKey({ origin: "imported" });
    show(fake, { link: LINK });
    await findButton("Aktualisieren");
    expect(screen.getByText(`Rechte: nicht selbst entworfen. ${IMPORTED_HINT}.`)).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("shared or listed: the line about buyers shows", async () => {
    const shared = withKey({ shared: true });
    show(shared, { link: LINK });
    await screen.findByText(SHARED_LINE);
    cleanup();
    const listed = withKey({ listed: true });
    show(listed, { link: LINK });
    await screen.findByText(SHARED_LINE);
  });

  it("changed in the app, never shared: warns that the changes are lost", async () => {
    const fake = withKey();
    fake.server.checkResult.changedInApp = true;
    show(fake, { link: LINK });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(`${CHANGED_IN_APP_LINE} ${CHANGES_LOST_LINE}.`);
    expect(button("Trotzdem aktualisieren")).toBeTruthy();
    expect(button("Als neues Projekt anlegen")).toBeTruthy();
    expect(button("Abbrechen")).toBeTruthy();
    fireEvent.click(button("Trotzdem aktualisieren"));
    await screen.findByText(SUCCESS_LINE);
    expect(fake.server.of("update")).toHaveLength(1);
  });

  it("changed in the app, shared: says the shared version stays", async () => {
    const fake = withKey({ shared: true });
    fake.server.checkResult.changedInApp = true;
    show(fake, { link: LINK });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(`${CHANGED_IN_APP_LINE} ${SHARED_VERSION_KEPT_LINE}.`);
  });

  it("„Als neues Projekt anlegen“ asks for the rights and makes a new project with a new key", async () => {
    const fake = withKey();
    fake.server.checkResult.changedInApp = true;
    const events = show(fake, { link: LINK });
    fireEvent.click(await findButton("Als neues Projekt anlegen"));
    const upload = button("Hochladen");
    expect(upload.disabled).toBe(true);
    expect(screen.queryByText(new RegExp(CHANGED_IN_APP_LINE))).toBeNull();
    fireEvent.click(radio(SELF_CREATED_LABEL));
    fireEvent.click(upload);
    await screen.findByText(SUCCESS_LINE);
    expect(fake.server.of("update")).toHaveLength(0);
    expect(events.uploaded[0]!.builderKey).toBe("new-key-1");
  });

  it("what the update costs shows with „Speichern“ and „Zurück“, in singular and plural", async () => {
    const fake = withKey();
    fake.server.checkResult.impact = { progressMoved: 0, markersDropped: 3, partsDropped: 1 };
    show(fake, { link: LINK });
    fireEvent.click(await findButton("Speichern"));
    await screen.findByText(SUCCESS_LINE);
    expect(fake.server.of("update")).toHaveLength(1);
    cleanup();

    const again = withKey();
    again.server.checkResult.impact = { progressMoved: 1, markersDropped: 3, partsDropped: 1 };
    show(again, { link: LINK });
    await findButton("Speichern");
    const list = screen.getByRole("list", { name: "Folgen in der App" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "1 Fortschrittsposition wird verschoben oder gekürzt",
      "3 Markierungen entfallen",
      "Bei 1 Teil geht der Fortschritt verloren",
    ]);
    fireEvent.click(button("Zurück"));
    expect(screen.getByText("geschlossen")).toBeTruthy();
    expect(again.server.of("update")).toHaveLength(0);
  });

  it("every update goes out with the token of a check made right before it", async () => {
    const fake = withKey();
    show(fake, { link: LINK });
    fireEvent.click(await findButton("Aktualisieren"));
    await screen.findByText(SUCCESS_LINE);
    expect(fake.server.requests.map((r) => r.action)).toEqual(["check", "check", "update"]);
    expect(fake.server.of("update")[0]!.baseToken).toBe("token-2");
    expect(fake.server.of("update")[0]).not.toHaveProperty("origin");
    expect(fake.server.of("check")[0]).not.toHaveProperty("origin");
  });

  it("what the check right before the update finds is shown first, nothing is overwritten", async () => {
    const fake = withKey();
    show(fake, { link: LINK });
    const update = await findButton("Aktualisieren");
    fake.server.checkResult.changedInApp = true;
    fireEvent.click(update);
    await screen.findByText(new RegExp(CHANGED_IN_APP_LINE));
    expect(fake.server.of("update")).toHaveLength(0);
    fireEvent.click(await findButton("Trotzdem aktualisieren"));
    await screen.findByText(SUCCESS_LINE);
    expect(fake.server.of("update")).toHaveLength(1);
  });

  it("a stale token goes back to check and shows the result, even with an unchanged document", async () => {
    const fake = withKey();
    fake.server.next("update", ERROR(409, "conflict"));
    show(fake, { link: LINK });
    fireEvent.click(await findButton("Aktualisieren"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Das Projekt hat sich gerade geändert/);
    await waitFor(() => expect(fake.server.of("check")).toHaveLength(3));
    await waitFor(() => expect(button("Aktualisieren").disabled).toBe(false));
    expect(screen.getByRole("alert").textContent).toMatch(/Das Projekt hat sich gerade geändert/);
    fireEvent.click(button("Aktualisieren"));
    await screen.findByText(SUCCESS_LINE);
    expect(fake.server.of("update").map((r) => r.baseToken)).toEqual(["token-2", "token-4"]);
  });

  it("the same pattern again: a normal success", async () => {
    const fake = withKey();
    show(fake, { link: LINK });
    fireEvent.click(await findButton("Aktualisieren"));
    await screen.findByText(SUCCESS_LINE);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a project deleted in the app: says so, keeps the key and offers it as a new project", async () => {
    const fake = fakeTmcServices({ projects: [] });
    const events = show(fake, { link: LINK });
    expect((await screen.findByRole("alert")).textContent).toMatch(/gibt es in deinem Account nicht mehr/);
    expect(events.forgotten).toBe(1);
    const create = await findButton("Als neues Projekt anlegen");
    expect(create.disabled).toBe(true);
    expect(radio(SELF_CREATED_LABEL).checked).toBe(false);
    fireEvent.click(radio(SELF_CREATED_LABEL));
    fireEvent.click(create);
    await screen.findByText(SUCCESS_LINE);
    expect(fake.server.of("create")[0]).toMatchObject({ builderKey: "key-1", origin: "self_created" });
    expect(events.uploaded[0]!.lastUpload!.patternId).toBe("pattern-new");
  });

  it("deleted between the dialog's check and the update: the same, and other projects stay choosable", async () => {
    const other = target({ title: "Ball", patternId: "p-other", builderKey: "key-other" });
    const fake = fakeTmcServices({ projects: [target(), other] });
    show(fake, { link: LINK });
    const update = await findButton("Aktualisieren");
    fake.server.projects.splice(0, 1);
    fireEvent.click(update);
    expect((await screen.findByRole("alert")).textContent).toMatch(/gibt es in deinem Account nicht mehr/);
    await findButton("Als neues Projekt anlegen");
    expect(radio("Neues Projekt").checked).toBe(true);
    expect(radio(/Ball/).checked).toBe(false);
  });

  it("opened again after that: new project with the kept key, without a stored project id", async () => {
    const fake = fakeTmcServices({ projects: [] });
    show(fake, { link: { builderKey: "key-1", lastUpload: null } });
    const create = await findButton("Als neues Projekt anlegen");
    expect(fake.server.of("check")).toHaveLength(0);
    fireEvent.click(radio(SELF_CREATED_LABEL));
    fireEvent.click(create);
    await screen.findByText(SUCCESS_LINE);
    expect(fake.server.of("create")[0]!.builderKey).toBe("key-1");
  });

  it("a project of another account: says so, too", async () => {
    const fake = fakeTmcServices({ projects: [] });
    fake.server.next("check", ERROR(403, "forbidden"));
    const events = show(fake, { link: LINK });
    expect((await screen.findByRole("alert")).textContent).toMatch(/gehört nicht zu deinem Account/);
    expect(events.forgotten).toBe(1);
  });
});

describe("failures", () => {
  it("rate limit: one line with the waiting time, and the upload can be tried again", async () => {
    const fake = fakeTmcServices({ projects: [target()] });
    fake.server.next("update", ERROR(429, "rate-limited", { retryAfterSeconds: 720 }));
    show(fake, { link: LINK });
    fireEvent.click(await findButton("Aktualisieren"));
    expect((await screen.findByRole("alert")).textContent).toBe("Zu viele Uploads in kurzer Zeit. Versuche es in 12 Minuten noch einmal.");
    fireEvent.click(await findButton("Aktualisieren"));
    await screen.findByText(SUCCESS_LINE);
  });

  it.each([
    ["invalid", 400, /nicht angenommen, weil etwas an ihrem Aufbau nicht passt/],
    ["too-large", 413, /zu groß zum Hochladen/],
  ])("%s has its own line", async (code, status, line) => {
    const fake = fakeTmcServices({ projects: [target()] });
    fake.server.next("update", ERROR(status, code));
    show(fake, { link: LINK });
    fireEvent.click(await findButton("Aktualisieren"));
    expect((await screen.findByRole("alert")).textContent).toMatch(line);
  });

  it("the endpoint's `internal` and unknown codes: try again later", async () => {
    const fake = fakeTmcServices({ projects: [target()] });
    fake.server.next("update", ERROR(500, "internal"));
    show(fake, { link: LINK });
    fireEvent.click(await findButton("Aktualisieren"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Versuche es später noch einmal/);
  });

  it("a pattern without any row is stopped before anything is sent", async () => {
    const fake = fakeTmcServices();
    show(fake, { doc: emptyDocument("leer") });
    expect((await screen.findByRole("alert")).textContent).toBe(EMPTY_PATTERN_LINE);
    await settled(fake);
    expect(fake.server.requests).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Hochladen" })).toBeNull();
  });

  it("a list that fails can be asked for again", async () => {
    const fake = fakeTmcServices();
    fake.server.next("list", { status: 500, body: null });
    show(fake);
    expect((await screen.findByRole("alert")).textContent).toMatch(/schiefgelaufen/);
    expect(button("Abbrechen")).toBeTruthy();
    fireEvent.click(await findButton("Erneut versuchen"));
    await findButton("Hochladen");
  });

  it("a document that cannot be exported is blocked with the export's own message, before any sign-in", async () => {
    const doc = ball();
    doc.parts[0]!.quantity = 0;
    const fake = fakeTmcServices({ session: null });
    show(fake, { doc });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/^Das hat nicht geklappt: Export ist ungültig/);
    expect(screen.queryByRole("button", { name: "Mit Google anmelden" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hochladen" })).toBeNull();
    expect(fake.server.requests).toHaveLength(0);
  });
});

describe("the sign-in", () => {
  it("not signed in: sign-in first, then the list", async () => {
    const fake = fakeTmcServices({ session: null });
    show(fake);
    await findButton("Mit Google anmelden");
    expect(fake.server.requests).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), { target: { value: ` ${MAIL} ` } });
    fireEvent.click(button("Code senden"));
    const field = (await screen.findByLabelText("Code aus der E-Mail")) as HTMLInputElement;
    expect(fake.auth.calls.signInWithOtp).toHaveBeenCalledWith({ email: MAIL, options: { shouldCreateUser: false } });
    // A code, no link: the mail may hold both.
    expect(screen.getByText(/Falls die Mail auch einen Link enthält/)).toBeTruthy();

    const signIn = button("Anmelden");
    fireEvent.change(field, { target: { value: "12a34" } });
    expect(field.value).toBe("1234");
    expect(signIn.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "123456" } });
    expect(signIn.disabled).toBe(false);
    fireEvent.click(signIn);
    await findButton("Hochladen");
    expect(fake.auth.calls.verifyOtp).toHaveBeenCalledWith({ email: MAIL, token: "123456", type: "email" });
    expect(fake.server.of("list")).toHaveLength(1);
  });

  it("„Datenschutz“ and „Impressum“ stand under the form, without any consent sentence", async () => {
    const fake = fakeTmcServices({ session: null });
    show(fake);
    await findButton("Mit Google anmelden");
    expect((screen.getByRole("link", { name: "Datenschutz" }) as HTMLAnchorElement).href).toBe(PRIVACY_URL);
    expect((screen.getByRole("link", { name: "Impressum" }) as HTMLAnchorElement).href).toBe(IMPRINT_URL);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/stimmst|akzeptierst|einverstanden/)).toBeNull();
  });

  it("no account: the hint to install the app first, with the store link", async () => {
    const fake = fakeTmcServices({ session: null });
    fake.auth.otpError = { message: "Signups not allowed for otp", code: "otp_disabled", status: 422 };
    show(fake);
    fireEvent.change(await screen.findByLabelText("E-Mail-Adresse"), { target: { value: MAIL } });
    fireEvent.click(button("Code senden"));
    const hint = await screen.findByRole("alert");
    expect(hint.textContent).toContain(NO_ACCOUNT_LINE);
    expect((within(hint).getByRole("link") as HTMLAnchorElement).href).toBe(APP_STORE_URL);
    expect(screen.queryByLabelText("Code aus der E-Mail")).toBeNull();
  });

  it("a wrong code says so and stays on the code", async () => {
    const fake = fakeTmcServices({ session: null });
    fake.auth.verifyError = { message: "Token has expired or is invalid", code: "otp_expired", status: 403 };
    show(fake);
    fireEvent.change(await screen.findByLabelText("E-Mail-Adresse"), { target: { value: MAIL } });
    fireEvent.click(button("Code senden"));
    fireEvent.change(await screen.findByLabelText("Code aus der E-Mail"), { target: { value: "000000" } });
    fireEvent.click(button("Anmelden"));
    expect((await screen.findByRole("alert")).textContent).toBe(CODE_REJECTED_LINE);
    expect(screen.getByLabelText("Code aus der E-Mail")).toBeTruthy();
    fireEvent.click(button("Andere Adresse"));
    expect(screen.getByLabelText("E-Mail-Adresse")).toBeTruthy();
  });

  it("too many mails: asks to wait", async () => {
    const fake = fakeTmcServices({ session: null });
    fake.auth.otpError = { message: "rate limit", code: "over_email_send_rate_limit", status: 429 };
    show(fake);
    fireEvent.change(await screen.findByLabelText("E-Mail-Adresse"), { target: { value: MAIL } });
    fireEvent.click(button("Code senden"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Zu viele Versuche/);
  });

  it("„Mit Google anmelden“ goes back to this page without query and fragment, and marks the trip", async () => {
    const fake = fakeTmcServices({ session: null });
    history.replaceState(null, "", "/app/?x=1#data=v1.abc");
    // The real client leaves the page here; the fake answers, as for a redirect under way.
    fake.auth.calls.signInWithOAuth.mockImplementation(() => {
      expect(sessionStorage.getItem("crochetbuilder:tmc-redirect")).not.toBeNull();
    });
    show(fake);
    fireEvent.click(await findButton("Mit Google anmelden"));
    await waitFor(() => expect(fake.auth.calls.signInWithOAuth).toHaveBeenCalled());
    const { provider, options } = fake.auth.calls.signInWithOAuth.mock.calls[0]![0] as { provider: string; options: { redirectTo: string } };
    expect(provider).toBe("google");
    expect(options.redirectTo).toBe(`${location.origin}/app/`);
    history.replaceState(null, "", "/");
  });

  it("an expired session goes back to the sign-in; what was chosen stays, and the upload goes on", async () => {
    const fake = fakeTmcServices();
    fake.server.next("create", ERROR(401, "unauthorized"));
    show(fake);
    const upload = await findButton("Hochladen");
    fireEvent.click(radio(new RegExp(IMPORTED_LABEL)));
    fireEvent.click(upload);
    await screen.findByText(EXPIRED_LINE);
    expect(button("Mit Google anmelden")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), { target: { value: MAIL } });
    fireEvent.click(button("Code senden"));
    fireEvent.change(await screen.findByLabelText("Code aus der E-Mail"), { target: { value: "123456" } });
    fireEvent.click(button("Anmelden"));
    const again = await findButton("Hochladen");
    expect(radio(new RegExp(IMPORTED_LABEL)).checked).toBe(true);
    expect(again.disabled).toBe(false);
    expect(screen.queryByText(EXPIRED_LINE)).toBeNull();
    fireEvent.click(again);
    await screen.findByText(SUCCESS_LINE);
  });

  it("a session that ends by itself while the dialog is open comes back to the sign-in", async () => {
    const fake = fakeTmcServices();
    show(fake);
    await findButton("Hochladen");
    act(() => fake.auth.setSession(null));
    await screen.findByText(EXPIRED_LINE);
  });

  it("the library cannot be loaded: says so and tries again on request", async () => {
    const fake = fakeTmcServices();
    fake.loadClient.mockRejectedValueOnce(new Error("offline"));
    show(fake);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Prüfe deine Internetverbindung/);
    fireEvent.click(button("Erneut versuchen"));
    await findButton("Hochladen");
    expect(fake.loadClient).toHaveBeenCalledTimes(2);
  });
});

describe("after the upload", () => {
  const sharedProject = () => fakeTmcServices({ projects: [target({ shared: true, hasUnsharedChanges: true })] });

  it("a shared pattern: asks about sharing; „Jetzt teilen“ shares", async () => {
    const fake = sharedProject();
    show(fake, { link: LINK });
    fireEvent.click(await findButton("Aktualisieren"));
    await screen.findByText(SHARE_QUESTION);
    expect(screen.getByText(SUCCESS_LINE)).toBeTruthy();
    fireEvent.click(button("Jetzt teilen"));
    await screen.findByText("Die Bearbeitung ist jetzt geteilt.");
    expect(fake.server.of("share")[0]!.patternId).toBe("pattern-1");
    expect(screen.queryByText(SHARE_QUESTION)).toBeNull();
    fireEvent.click(button("Fertig"));
    expect(screen.getByText("geschlossen")).toBeTruthy();
  });

  it("„Später“ closes without sharing", async () => {
    const fake = sharedProject();
    show(fake, { link: LINK });
    fireEvent.click(await findButton("Aktualisieren"));
    fireEvent.click(await findButton("Später"));
    expect(screen.getByText("geschlossen")).toBeTruthy();
    expect(fake.server.of("share")).toHaveLength(0);
  });

  it("a failed share can be repeated; the upload itself stays done", async () => {
    const fake = sharedProject();
    fake.server.next("share", ERROR(429, "rate-limited", { retryAfterSeconds: 30 }));
    show(fake, { link: LINK });
    fireEvent.click(await findButton("Aktualisieren"));
    fireEvent.click(await findButton("Jetzt teilen"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/30 Sekunden/);
    expect(screen.getByText(SUCCESS_LINE)).toBeTruthy();
    fireEvent.click(await findButton("Jetzt teilen"));
    await screen.findByText("Die Bearbeitung ist jetzt geteilt.");
  });

  it("listed but not shared: no question, the endpoint would refuse", async () => {
    const fake = fakeTmcServices({ projects: [target({ listed: true, shared: false, hasUnsharedChanges: true })] });
    show(fake, { link: LINK });
    fireEvent.click(await findButton("Aktualisieren"));
    await screen.findByText(SUCCESS_LINE);
    expect(screen.queryByText(SHARE_QUESTION)).toBeNull();
    expect(screen.queryByRole("button", { name: "Jetzt teilen" })).toBeNull();
  });

  it("deleted in the app before sharing: back to „als neues Projekt anlegen“", async () => {
    const fake = sharedProject();
    show(fake, { link: LINK });
    fireEvent.click(await findButton("Aktualisieren"));
    const share = await findButton("Jetzt teilen");
    fake.server.projects.splice(0, 1);
    fireEvent.click(share);
    expect((await screen.findByRole("alert")).textContent).toMatch(/gibt es in deinem Account nicht mehr/);
    await findButton("Als neues Projekt anlegen");
  });

  it("nothing new to share (the same pattern again): no question", async () => {
    const fake = fakeTmcServices({ projects: [target({ shared: true, hasUnsharedChanges: false })] });
    show(fake, { link: LINK });
    fireEvent.click(await findButton("Aktualisieren"));
    await screen.findByText(SUCCESS_LINE);
    expect(screen.queryByText(SHARE_QUESTION)).toBeNull();
  });
});

describe("the dialog as a modal", () => {
  it("is a modal dialog with its title; Tab stays inside; Escape closes", async () => {
    const fake = fakeTmcServices();
    show(fake);
    await findButton("Hochladen");
    const dialog = screen.getByRole("dialog", { name: "Zu TellmeCrochet hochladen" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const close = button("Schließen");
    const cancel = button("Abbrechen");
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    // Last enabled element: the upload is disabled, so "Abbrechen".
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByText("geschlossen")).toBeTruthy();
  });

  it("Escape waits for a running upload: its answer holds the project's key", async () => {
    const fake = fakeTmcServices();
    let release = () => {};
    fake.server.next(
      "create",
      () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 200, body: { target: target() } });
        }),
    );
    const events = show(fake);
    const upload = await findButton("Hochladen");
    fireEvent.click(radio(SELF_CREATED_LABEL));
    fireEvent.click(upload);
    await waitFor(() => expect(fake.server.of("create")).toHaveLength(1));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByText("geschlossen")).toBeNull();
    await act(async () => release());
    await screen.findByText(SUCCESS_LINE);
    expect(events.uploaded).toHaveLength(1);
  });
});

describe("loading the library", () => {
  function Quiet({ fake }: { fake: Fake }) {
    const auth = useTmcAuth(fake.services);
    return <p>{auth.status}</p>;
  }

  it("nobody signed in, no dialog: nothing is loaded", async () => {
    const fake = fakeTmcServices();
    render(<Quiet fake={fake} />);
    await settled(fake);
    expect(fake.loadClient).not.toHaveBeenCalled();
    expect(screen.getByText("idle")).toBeTruthy();
  });

  it("a session from an earlier visit loads it and shows the account", async () => {
    localStorage.setItem(TMC_STORAGE_KEY, "{}");
    const fake = fakeTmcServices();
    render(<Quiet fake={fake} />);
    await screen.findByText("signedIn");
    expect(fake.loadClient).toHaveBeenCalledTimes(1);
  });
});
