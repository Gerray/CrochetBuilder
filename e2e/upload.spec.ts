import type { Page, Route } from "@playwright/test";
import { expect, loadDemo, openBuilder, openExportMenu, test } from "./fixtures.js";

/**
 * The upload against a fake TellmeCrochet: `page.route` answers the auth endpoints and
 * `builder-upload`, so the real sign-in library runs and no request leaves the machine.
 */

const BASE = "https://tmc-fake.invalid";
const MAIL = "anna@example.org";

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
    body: JSON.stringify(body),
  });

// Shaped like a JWT, signed by nobody; only this fake ever sees it.
const FAKE_JWT = [
  Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
  Buffer.from(JSON.stringify({ sub: "user-1", exp: 4102444800 })).toString("base64url"),
  "fake",
].join(".");

function sessionBody(createdAt: string) {
  return {
    access_token: FAKE_JWT,
    refresh_token: "fake-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", aud: "authenticated", email: MAIL, created_at: createdAt, app_metadata: {}, user_metadata: {} },
  };
}

interface FakeBackend {
  requests: Array<Record<string, unknown>>;
  /** Where Google's fake sends the browser back to. */
  authorizeRedirects: string[];
}

async function fakeBackend(page: Page, options: { createdAt?: string } = {}): Promise<FakeBackend> {
  const createdAt = options.createdAt ?? "2025-01-01T00:00:00.000Z";
  const backend: FakeBackend = { requests: [], authorizeRedirects: [] };
  const target = (extra: Record<string, unknown> = {}) => ({
    patternId: "pattern-1",
    builderKey: backend.requests.find((r) => r.action === "create")?.builderKey ?? "key",
    title: "Amigurumi-Kugel",
    origin: "self_created",
    shared: false,
    listed: false,
    hasUnsharedChanges: false,
    updatedAt: "2026-11-01T10:00:00.000Z",
    ...extra,
  });

  await page.route(`${BASE}/functions/v1/builder-upload`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    backend.requests.push(body);
    expect(route.request().headers().authorization).toBe(`Bearer ${FAKE_JWT}`);
    expect(route.request().headers().apikey).toBe("e2e-placeholder");
    // The endpoint is strict about its fields.
    const payload = ["envelope", "partKeys"];
    const fields: Record<string, string[]> = {
      list: ["action"],
      check: ["action", "patternId", ...payload],
      create: ["action", "builderKey", "origin", ...payload],
      update: ["action", "patternId", "baseToken", ...payload],
    };
    expect(Object.keys(body).sort()).toEqual([...(fields[String(body.action)] ?? [])].sort());
    switch (body.action) {
      case "list":
        return json(route, 200, { projects: [] });
      case "create":
        return json(route, 200, { target: target() });
      case "check":
        return json(route, 200, {
          target: target(),
          changedInApp: false,
          impact: { progressMoved: 0, markersDropped: 2, partsDropped: 0 },
          baseToken: "token-1",
        });
      case "update":
        return json(route, 200, { target: target() });
      default:
        return json(route, 400, { error: { code: "invalid" } });
    }
  });
  await page.route(`${BASE}/auth/v1/otp**`, (route) => json(route, 200, {}));
  await page.route(`${BASE}/auth/v1/verify**`, (route) => json(route, 200, sessionBody(createdAt)));
  await page.route(`${BASE}/auth/v1/token**`, (route) => json(route, 200, sessionBody(createdAt)));
  await page.route(`${BASE}/auth/v1/logout**`, (route) => route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } }));
  await page.route(`${BASE}/auth/v1/authorize**`, async (route) => {
    const back = new URL(route.request().url()).searchParams.get("redirect_to")!;
    backend.authorizeRedirects.push(back);
    await route.fulfill({ status: 302, headers: { location: `${back}?code=fake-code` } });
  });
  // Anything else at that address is a mistake in the code, and fails here.
  return backend;
}

async function openUpload(page: Page) {
  const panel = await openExportMenu(page);
  await panel.getByRole("button", { name: "Zu TellmeCrochet hochladen" }).click();
  return page.getByRole("dialog", { name: "Zu TellmeCrochet hochladen" });
}

test("sign in with a code, upload as a new project, upload again after a reload", async ({ page }) => {
  const backend = await fakeBackend(page);
  await openBuilder(page);
  await loadDemo(page, "Kugel");
  const dialog = await openUpload(page);

  await dialog.getByLabel("E-Mail-Adresse").fill(MAIL);
  await dialog.getByRole("button", { name: "Code senden" }).click();
  await dialog.getByLabel("Code aus der E-Mail").fill("123456");
  await dialog.getByRole("button", { name: "Anmelden" }).click();

  const upload = dialog.getByRole("button", { name: "Hochladen" });
  await expect(upload).toBeDisabled();
  await expect(dialog.getByText("So kommt die Anleitung in TellmeCrochet an:")).toBeVisible();
  await dialog.getByRole("radio", { name: "Ich habe diese Anleitung selbst entworfen" }).check();
  await upload.click();
  await expect(dialog.getByText("Ist in deinem TellmeCrochet-Account.")).toBeVisible();
  const create = backend.requests.find((r) => r.action === "create")!;
  expect(create.origin).toBe("self_created");
  expect(create.builderKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(create.partKeys).toEqual(["kugel"]);
  await dialog.getByRole("button", { name: "Fertig" }).click();

  // The focus returns to the menu's button, and the account shows.
  await expect(page.getByRole("button", { name: "Exportieren ▾" })).toBeFocused();
  await expect(page.getByText(`Angemeldet als ${MAIL}`)).toBeVisible();

  // Saved next to the document: after a reload the same project, signed in without asking.
  await expect(page.getByText("Lokal gespeichert")).toBeVisible();
  await page.reload();
  await expect(page.getByText(`Angemeldet als ${MAIL}`)).toBeVisible();
  const panel = await openExportMenu(page);
  await expect(panel.getByText(/^Zuletzt hochgeladen: heute, \d\d:\d\d$/)).toBeVisible();
  await page.keyboard.press("Escape");
  const again = await openUpload(page);
  await expect(again.getByText("2 Markierungen entfallen")).toBeVisible();
  await again.getByRole("button", { name: "Speichern" }).click();
  await expect(again.getByText("Ist in deinem TellmeCrochet-Account.")).toBeVisible();
  const update = backend.requests.find((r) => r.action === "update")!;
  expect(update).toMatchObject({ patternId: "pattern-1", baseToken: "token-1", partKeys: ["kugel"] });
  await again.getByRole("button", { name: "Fertig" }).click();

  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page.getByText(/Angemeldet als/)).toHaveCount(0);
});

test("signing in with Google leaves the page and comes back to the dialog, with the document", async ({ page }) => {
  const backend = await fakeBackend(page, { createdAt: new Date().toISOString() });
  await openBuilder(page);
  await loadDemo(page, "Kugel");
  await expect(page.getByText("Lokal gespeichert")).toBeVisible();
  const dialog = await openUpload(page);
  await dialog.getByRole("button", { name: "Mit Google anmelden" }).click();

  await expect(dialog.getByRole("button", { name: "Hochladen" })).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(backend.authorizeRedirects[0]).toBe(new URL(page.url()).href);
  await expect(page.getByRole("textbox", { name: "Titel der Anleitung" })).toHaveValue("Amigurumi-Kugel");
  // Google cannot be limited to existing accounts: a new one is said to be new.
  await expect(dialog.getByText(/gerade ein neues TellmeCrochet-Konto angelegt/)).toBeVisible();
});

test("the viewer has nothing of the upload", async ({ page }) => {
  await openBuilder(page);
  await loadDemo(page, "Kugel");
  const panel = await openExportMenu(page);
  await panel.getByRole("button", { name: "Link teilen" }).click();
  const url = await panel.getByLabel("Link zur 3D-Ansicht").inputValue();
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Amigurumi-Kugel");
  await expect(page.getByRole("button", { name: /TellmeCrochet/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /TellmeCrochet/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Im Builder bearbeiten" })).toBeVisible();
  expect(requests.filter((r) => r.includes("tmc-fake"))).toEqual([]);
});

test("nobody signed in: nothing of the sign-in is downloaded until the dialog opens", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  await openBuilder(page);
  await loadDemo(page, "Kugel");
  const panel = await openExportMenu(page);
  await expect(panel.getByRole("button", { name: "Für TellmeCrochet speichern (.json)" })).toBeVisible();
  const before = scripts.length;
  await panel.getByRole("button", { name: "Zu TellmeCrochet hochladen" }).click();
  await expect(page.getByRole("button", { name: "Mit Google anmelden" })).toBeVisible();
  expect(scripts.length).toBeGreaterThan(before);
});
