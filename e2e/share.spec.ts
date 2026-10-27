import { expect, loadDemo, openBuilder, openExportMenu, rowText, test } from "./fixtures.js";

test("share link opens the viewer, embed mode, and back into the builder", async ({ page, context }) => {
  await openBuilder(page);
  await loadDemo(page, "Kugel");
  const panel = await openExportMenu(page);
  await panel.getByRole("button", { name: "Link teilen" }).click();
  // The link is read from the visible field, not from the clipboard.
  const viewerUrl = await panel.getByRole("textbox", { name: "Link zur 3D-Ansicht" }).inputValue();
  expect(viewerUrl).toMatch(/^http:\/\/localhost:\d+\/CrochetBuilder\/viewer\/#data=v1\.[A-Za-z0-9_-]+$/);
  await panel.getByRole("button", { name: "Einbetten" }).click();
  const embedUrl = await panel.getByRole("link", { name: "Vorschau" }).getAttribute("href");
  expect(embedUrl).toMatch(/\/CrochetBuilder\/viewer\/\?embed=1#data=v1\./);
  await expect(panel.getByRole("textbox", { name: "Code zum Einbetten (Blog, Shop)" })).toHaveValue(/^<iframe src="/);

  // Meanwhile the builder holds a different pattern: opening the link must ask first.
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Titel der Anleitung" }).fill("Mein anderes Projekt");
  await expect(page.getByRole("status").filter({ hasText: "Lokal gespeichert" })).toBeVisible();

  // Viewer: title, rows, size, 3D model.
  const viewer = await context.newPage();
  await viewer.goto(viewerUrl);
  await expect(viewer.getByRole("heading", { level: 1, name: "Amigurumi-Kugel" })).toBeVisible();
  await expect(viewer).toHaveTitle("Amigurumi-Kugel – CrochetBuilder");
  const rows = viewer.getByRole("list", { name: "Reihen" }).getByRole("listitem");
  await expect(rows).toHaveCount(8);
  await expect(rows.first()).toContainText("1 MR, 6 fM");
  await expect(rows.last()).toContainText("6 Abn");
  await expect(viewer.getByLabel("Maße", { exact: true })).toContainText(/Größe.*\d+,\d.*cm/);
  await expect(viewer.getByText("Baumwollgarn DK")).toBeVisible();
  const canvas = viewer.getByRole("region", { name: "3D-Modell" }).locator("canvas");
  await expect(canvas).toBeVisible();
  expect((await canvas.boundingBox())?.width).toBeGreaterThan(50);
  await expect(viewer.getByRole("link", { name: "In TellmeCrochet öffnen" })).toHaveAttribute(
    "href",
    /^https:\/\/tellmecrochet\.de\/import#data=v1\./,
  );

  // Embed: compact layout, no pattern text or edit link.
  const embed = await context.newPage();
  await embed.goto(embedUrl!);
  await expect(embed.locator("html")).toHaveClass(/is-embed/);
  await expect(embed.locator(".viewer-embed-title")).toHaveText("Amigurumi-Kugel");
  await expect(embed.locator("canvas")).toBeVisible();
  await expect(embed.getByRole("link", { name: "In TellmeCrochet öffnen" })).toBeVisible();
  await expect(embed.getByRole("heading", { level: 1 })).toHaveCount(0);
  await expect(embed.getByRole("list", { name: "Reihen" })).toHaveCount(0);
  await expect(embed.getByRole("link", { name: "Im Builder bearbeiten" })).toHaveCount(0);
  await embed.close();

  // Back into the builder: confirm replacing the stored pattern.
  const dialog = viewer.waitForEvent("dialog").then(async (d) => {
    expect(d.type()).toBe("confirm");
    expect(d.message()).toContain("Anleitung aus dem Link öffnen?");
    await d.accept();
  });
  await viewer.getByRole("link", { name: "Im Builder bearbeiten" }).click();
  await dialog;
  await expect(viewer.getByRole("textbox", { name: "Titel der Anleitung" })).toHaveValue("Amigurumi-Kugel");
  await expect(rowText(viewer, "Runde 8")).toHaveValue("6 Abn");
  // The fragment is removed, so a reload does not import again.
  await expect(viewer).toHaveURL(/\/CrochetBuilder\/$/);
});

test("declining the confirm keeps the current pattern", async ({ page, context }) => {
  await openBuilder(page);
  await loadDemo(page, "Kugel");
  const panel = await openExportMenu(page);
  await panel.getByRole("button", { name: "Link teilen" }).click();
  const viewerUrl = await panel.getByRole("textbox", { name: "Link zur 3D-Ansicht" }).inputValue();
  await page.keyboard.press("Escape");
  await loadDemo(page, "Topflappen");
  await expect(page.getByRole("status").filter({ hasText: "Lokal gespeichert" })).toBeVisible();

  const builder = await context.newPage();
  builder.once("dialog", (d) => void d.dismiss());
  await builder.goto(viewerUrl.replace("/viewer/", "/"));
  await expect(builder.getByRole("textbox", { name: "Titel der Anleitung" })).toHaveValue("Topflappen");
  await expect(builder).toHaveURL(/\/CrochetBuilder\/$/);
});

test("a broken share link shows a German error in the viewer", async ({ page }) => {
  await page.goto("viewer/#data=v1.das-ist-kaputt");
  const alert = page.getByRole("alert");
  await expect(alert.getByRole("heading", { name: "Anleitung konnte nicht geöffnet werden" })).toBeVisible();
  await expect(alert).toContainText(/Der Link (ist beschädigt|enthält keine gültige Anleitung|konnte nicht gelesen)/);
  await expect(alert.getByRole("link", { name: "Zum CrochetBuilder" })).toHaveAttribute(
    "href",
    /\/CrochetBuilder\/$/,
  );

  await page.goto("viewer/");
  await expect(page.getByRole("heading", { name: "Keine Anleitung im Link" })).toBeVisible();
});
