import { readFile } from "node:fs/promises";
import { allGood, expect, loadDemo, openBuilder, openExportMenu, rowText, test } from "./fixtures.js";

const SPHERE_ROWS = [
  "1 MR, 6 fM",
  "6 Zun",
  "6× (1 fM, 1 Zun)",
  "6× (2 fM, 1 Zun)",
  "24 fM",
  "6× (2 fM, 1 Abn)",
  "6× (1 fM, 1 Abn)",
  "6 Abn",
];

test("a demo exported as JSON can be opened again", async ({ page }, testInfo) => {
  await openBuilder(page);
  await loadDemo(page, "Kugel");
  const title = page.getByRole("textbox", { name: "Titel der Anleitung" });
  await expect(title).toHaveValue("Amigurumi-Kugel");
  await expect(rowText(page, "Runde 8")).toHaveValue("6 Abn");

  const panel = await openExportMenu(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("button", { name: "JSON herunterladen" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("amigurumi-kugel.json");
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  await expect(panel.getByRole("status").filter({ hasText: "JSON-Datei gespeichert." })).toBeVisible();

  const exp = JSON.parse(await readFile(file, "utf8"));
  expect(exp.schemaVersion).toBe(2);
  expect(exp.title).toBe("Amigurumi-Kugel");
  expect(exp.parts).toHaveLength(1);
  expect(exp.parts[0].content.rows).toHaveLength(8);
  expect(exp.parts[0].content.rows.map((r: { stitchCountTarget: number }) => r.stitchCountTarget)).toEqual([
    6, 12, 18, 24, 24, 18, 12, 6,
  ]);
  expect(exp.rendered.locale).toBe("de");
  expect(exp.rendered.rows).toHaveLength(8);
  expect(exp.rendered.rows[0]).toContain("1 MR, 6 fM");

  // Start over, then open the file again.
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await expect(title).toHaveValue("");
  await expect(rowText(page, "Runde 1")).toHaveValue("");
  await expect(rowText(page, "Runde 2")).toHaveCount(0);

  const reopened = await openExportMenu(page);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    reopened.getByRole("button", { name: "JSON öffnen…" }).click(),
  ]);
  await chooser.setFiles(file);
  await expect(reopened.getByText("„amigurumi-kugel.json“ geöffnet.")).toBeVisible();

  await expect(title).toHaveValue("Amigurumi-Kugel");
  for (const [i, text] of SPHERE_ROWS.entries()) await expect(rowText(page, `Runde ${i + 1}`)).toHaveValue(text);
  await expect(allGood(page)).toBeVisible();
});

test("PDF export produces a real PDF file", async ({ page }, testInfo) => {
  await openBuilder(page);
  await page.getByRole("button", { name: "Demo laden", exact: true }).click();
  // The PDF contains a snapshot of the model: wait until it is there.
  await expect(page.getByRole("region", { name: "3D-Vorschau" }).locator("canvas")).toBeVisible();

  const panel = await openExportMenu(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("button", { name: "Als PDF speichern" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("amigurumi-kugel.pdf");
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  await expect(panel.getByText("PDF „amigurumi-kugel.pdf“ gespeichert.")).toBeVisible();

  const bytes = await readFile(file);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(10_000);
});

test("'In TellmeCrochet öffnen' links to the TellmeCrochet import", async ({ page }) => {
  await openBuilder(page);
  await loadDemo(page, "Kugel");
  const panel = await openExportMenu(page);
  const link = panel.getByRole("link", { name: "In TellmeCrochet öffnen" });
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^https:\/\/tellmecrochet\.de\/import#data=v1\.[A-Za-z0-9_-]+$/);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
});
