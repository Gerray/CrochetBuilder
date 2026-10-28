import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, loadDemo, openBuilder, openExportMenu, rowText, test } from "./fixtures.js";

/** The colour chip of a row card ("Runde 5"). */
function chip(page: Page, label: string) {
  return page.getByRole("button", { name: new RegExp(`^Farbe von ${label}:`) });
}

async function addSuggested(page: Page, name: string) {
  await page.getByRole("group", { name: "Farbpalette" }).getByRole("button", { name: "Farbe hinzufügen" }).click();
  await page.getByRole("dialog", { name: "Farbe hinzufügen" }).getByRole("button", { name, exact: true }).click();
}

test("colours and finish: palette, colour change at round 5, export, flat finish", async ({ page }, testInfo) => {
  await openBuilder(page);
  await loadDemo(page, "Kugel");
  await expect(rowText(page, "Runde 8")).toHaveValue("6 Abn");

  // A palette with two colours, straight from the suggestions.
  await addSuggested(page, "Weiß");
  await addSuggested(page, "Rosa");
  const strip = page.getByRole("group", { name: "Farbpalette" });
  await expect(strip.getByRole("button", { name: "Weiß bearbeiten (Anfangsfarbe)" })).toBeVisible();
  await expect(strip.getByRole("button", { name: "Rosa bearbeiten" })).toBeVisible();

  // Colour change from round 5 on.
  await expect(chip(page, "Runde 5")).toHaveAccessibleName("Farbe von Runde 5: Weiß (weiter)");
  await chip(page, "Runde 5").click();
  await page.getByRole("dialog", { name: "Farbwechsel ab Runde 5" }).getByRole("button", { name: "Rosa", exact: true }).click();
  await expect(chip(page, "Runde 5")).toHaveAccessibleName("Farbe von Runde 5: Rosa (Farbwechsel)");
  await expect(chip(page, "Runde 6")).toHaveAccessibleName("Farbe von Runde 6: Rosa (weiter)");
  await expect(chip(page, "Runde 4")).toHaveAccessibleName("Farbe von Runde 4: Weiß (weiter)");
  await expect(rowText(page, "Runde 5")).toHaveValue("[Farbe: Rosa] 24 fM");

  // The finish: automatic (gathered) → crocheted flat.
  const finish = page.getByRole("combobox", { name: "Abschluss des Teils" });
  await expect(finish.locator("option:checked")).toHaveText("Automatisch (Zusammengezogen)");
  await finish.selectOption("flat");
  await expect(page.getByRole("combobox", { name: "Füllung des Teils" }).locator("option:checked")).toHaveText("Automatisch (Keine)");

  // Everything is in the exported JSON.
  const panel = await openExportMenu(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("button", { name: "JSON herunterladen" }).click(),
  ]);
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  const exp = JSON.parse(await readFile(file, "utf8"));
  expect(exp.overview.colors.map((c: { id: string; name: string }) => [c.id, c.name])).toEqual([
    ["weiss", "Weiß"],
    ["rosa", "Rosa"],
  ]);
  expect(exp.parts[0].content.rows[4].color).toBe("rosa");
  expect(exp.parts[0].content.rows.filter((r: { color?: string }) => r.color !== undefined)).toHaveLength(1);
  expect(exp.parts[0].content.finish).toBe("flat");
  expect(exp.parts[0].content).not.toHaveProperty("stuffing");
  expect(exp.rendered.rows[4]).toBe("Runde 5: [Farbe: Rosa] 24 fM (24)");
});
