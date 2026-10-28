import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { expect, loadDemo, openBuilder, openExportMenu, test } from "./fixtures.js";

/** The placement list of the "Montage" view. */
const placements = (page: Page) => page.locator(".placement-list .placement-text");

/**
 * Move the pointer over the 3D view until the hint names `part`, then click there. The model
 * is framed by the view itself, so the spot is found by hovering rather than hard-coded.
 */
async function clickOnPart(page: Page, stage: Locator, part: string): Promise<string> {
  await stage.scrollIntoViewIfNeeded();
  const box = (await stage.boundingBox())!;
  const hover = page.locator(".assembly-hover");
  for (const fy of [0.3, 0.35, 0.25, 0.4, 0.2, 0.45]) {
    for (const fx of [0.5, 0.47, 0.53, 0.44, 0.56]) {
      const x = box.x + fx * box.width;
      const y = box.y + fy * box.height;
      await page.mouse.move(x, y);
      try {
        await expect(hover).toContainText(`${part}:`, { timeout: 600 });
      } catch {
        continue;
      }
      const where = (await hover.textContent())!.trim();
      await page.mouse.down();
      await page.mouse.up();
      return where;
    }
  }
  throw new Error(`no stitch of ${part} found under the pointer`);
}

test("Montage: sew ears to the head and set eyes by clicking, fine-tune, export, undo", async ({ page }, testInfo) => {
  await openBuilder(page);
  await loadDemo(page, "Hase");
  await page.getByRole("radio", { name: "Montage" }).click();
  const stage = page.getByTestId("assembly-stage");
  await expect(stage.locator("canvas")).toBeVisible();
  await expect(placements(page)).toHaveText([
    "Kopf an Körper, auf Runde 14 (Ende)",
    "Ohr ×2 an Kopf, zwischen Runde 4 und 5, ±45° – flach annähen",
    "Arm ×2 an Körper, zwischen Runde 11 und 12, ±80°",
    "Bein ×2 an Körper, zwischen Runde 3 und 4, ±35°",
    "Augen 8 mm an Kopf, zwischen Runde 8 und 9, 6 M Abstand",
    "Stickerei 4 mm an Kopf, zwischen Runde 10 und 11, vorne – mit rosa Garn sticken",
  ]);
  await expect(page.getByLabel("Maße der Montage")).toContainText(/Zusammengesetzt B × H × T \d+,\d × \d+,\d × \d+,\d cm/);

  // Take the ears and eyes off, then put them on again with clicks.
  await page.getByRole("button", { name: /^Entfernen: Ohr ×2/ }).click();
  await page.getByRole("button", { name: /^Entfernen: Augen/ }).click();
  await expect(placements(page)).toHaveCount(4);

  await page.getByRole("button", { name: "+ Annähen" }).click();
  // The part shown in the editor (Kopf) is preselected; pick the ear.
  await page.getByLabel("Welches Teil wird angenäht?").selectOption({ label: "Ohr ×2" });
  await expect(page.getByText(/an die Ohr genäht wird/)).toBeVisible();
  // Escape cancels, "+ Annähen" starts again.
  await page.keyboard.press("Escape");
  await expect(page.getByText(/genäht wird/)).toHaveCount(0);
  await page.getByRole("button", { name: "+ Annähen" }).click();
  await page.getByLabel("Welches Teil wird angenäht?").selectOption({ label: "Ohr ×2" });
  const earSpot = await clickOnPart(page, stage, "Kopf");
  await expect(placements(page).last()).toHaveText(new RegExp(`^Ohr ×2 an Kopf, ${earSpot.replace(/^Kopf: /, "").replace(/[()]/g, "\\$&")}, `));

  await page.getByRole("button", { name: "+ Augen" }).click();
  await clickOnPart(page, stage, "Kopf");
  await expect(placements(page).last()).toHaveText(/^Augen 10 mm an Kopf, (zwischen|auf) Runde \d+.*6 M Abstand/);

  // Fine-tune the new eyes: their fields are open.
  const item = page.locator(".placement-item").last();
  const field = (name: string) => item.getByRole("textbox", { name, exact: true });
  await field("Größe (mm)").fill("12");
  await field("Runde").fill("8");
  await field("Winkel °").fill("0");
  await expect(placements(page).last()).toHaveText("Augen 12 mm an Kopf, zwischen Runde 8 und 9, 6 M Abstand");

  // The export carries the placements.
  const panel = await openExportMenu(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("button", { name: "JSON herunterladen" }).click(),
  ]);
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  await page.keyboard.press("Escape");
  const exp = JSON.parse(await readFile(file, "utf8"));
  const ids = exp.parts.map((p: { id?: string }) => p.id);
  expect(ids).toEqual(["kopf", "koerper", "ohr", "arm", "bein"]);
  const eyes = exp.assembly.find((p: { kind: string }) => p.kind === "eyes");
  expect(eyes).toMatchObject({ kind: "eyes", target: "kopf", angle: 0, spacing: 6, size: 12, row: exp.parts[0].content.rows[7].id });
  expect(exp.assembly.filter((p: { kind: string; part?: string }) => p.kind === "attach" && p.part === "ohr")).toHaveLength(1);

  // Undo takes the edits back step by step (the size first typed, so it comes back last),
  // then the eyes.
  const undo = page.getByRole("button", { name: "Rückgängig" });
  await expect
    .poll(async () => {
      await undo.click();
      return placements(page).last().textContent();
    })
    .toMatch(/^Augen 10 mm an Kopf/);
  await undo.click();
  await expect(placements(page)).toHaveCount(5);
  await expect(placements(page).last()).toHaveText(/^Ohr ×2 an Kopf/);
});
