import {
  allGood,
  dimensions,
  expect,
  openBuilder,
  rowActual,
  rowCard,
  rowTarget,
  rowText,
  test,
  typeRow,
} from "./fixtures.js";

/** The amigurumi sphere of docs/FORMAT.md, in German notation with stitch counts. */
const SPHERE: Array<[text: string, rendered: string, count: number]> = [
  ["1 MR, 6 fM (6)", "1 MR, 6 fM", 6],
  ["6 Zun (12)", "6 Zun", 12],
  ["6× (1 fM, 1 Zun) (18)", "6× (1 fM, 1 Zun)", 18],
  ["6× (2 fM, 1 Zun) (24)", "6× (2 fM, 1 Zun)", 24],
  ["24 fM (24)", "24 fM", 24],
  ["6× (2 fM, 1 Abn) (18)", "6× (2 fM, 1 Abn)", 18],
  ["6× (1 fM, 1 Abn) (12)", "6× (1 fM, 1 Abn)", 12],
  ["6 Abn (6)", "6 Abn", 6],
];

test("typing the amigurumi sphere row by row builds a valid 3D model", async ({ page }) => {
  await openBuilder(page);
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("textbox", { name: "Titel der Anleitung" }).fill("Getippte Kugel");

  // Before the first stitch the preview invites typing.
  await expect(page.getByText("Noch keine Maschen")).toBeVisible();

  for (const [i, [text]] of SPHERE.entries()) await typeRow(page, `Runde ${i + 1}`, text);

  for (const [i, [, rendered, count]] of SPHERE.entries()) {
    const label = `Runde ${i + 1}`;
    await expect(rowText(page, label)).toHaveValue(rendered);
    await expect(rowTarget(page, label)).toHaveValue(String(count));
    await expect(rowActual(page, label)).toHaveText(String(count));
  }

  await expect(allGood(page)).toBeVisible();
  await expect(page.locator(".row-findings")).toHaveCount(0);

  const stats = page.getByRole("region", { name: "Kennzahlen" });
  await expect(stats.getByRole("definition").first()).toHaveText("8");
  await expect(stats).toContainText(String(SPHERE.reduce((sum, [, , n]) => sum + n, 0)));

  // The worker-built model reports its real size; a sphere is about as wide as it is tall.
  const dims = dimensions(page);
  await expect(dims).toContainText(/B × H × T\s*\d+,\d × \d+,\d × \d+,\d cm/);
  await expect(dims).toContainText(/max\. Ø\s*\d+,\d cm/);
  const [width, height] = ((await dims.textContent()) ?? "")
    .match(/(\d+,\d) × (\d+,\d) × \d+,\d cm/)!
    .slice(1)
    .map((v) => Number(v.replace(",", ".")));
  expect(width).toBeGreaterThan(1);
  expect(height! / width!).toBeGreaterThan(0.6);
  expect(height! / width!).toBeLessThan(1.6);

  const preview = page.getByRole("region", { name: "3D-Vorschau" });
  await expect(preview.getByText("3D-Ansicht nicht verfügbar")).toHaveCount(0);
  const canvas = preview.locator("canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(50);
  expect(box?.height).toBeGreaterThan(50);
});

test("a wrong stitch count shows a German finding that leads to the row", async ({ page }) => {
  await openBuilder(page);
  // Enough rounds that the editor has to scroll.
  await page.getByRole("button", { name: "Weitere Demos" }).click();
  await page.getByRole("menuitem", { name: /^Ball/ }).click();
  await expect(rowText(page, "Runde 11")).toHaveValue("6 Abn");
  await expect(allGood(page)).toBeVisible();

  await typeRow(page, "Runde 2", "5 Zun (12)");
  await expect(rowTarget(page, "Runde 2")).toHaveValue("12");
  await expect(rowActual(page, "Runde 2")).toHaveText("10");

  // Inline, in the row card …
  const inline = rowCard(page, "Runde 2").getByRole("list", { name: "Befunde zu Runde 2" });
  await expect(inline).toContainText("Maschenzahl stimmt nicht: Soll 12, Ist 10.");
  // … and in the Prüfung list of the preview.
  await expect(allGood(page)).toHaveCount(0);
  const finding = page.getByRole("button", { name: "Runde 2: Maschenzahl stimmt nicht: Soll 12, Ist 10." });
  await expect(finding).toBeVisible();
  await expect(page.getByText(/\d+ Fehler/)).toBeVisible();

  // Move away: focus elsewhere and scroll the row list to its end.
  await page.getByRole("textbox", { name: "Titel der Anleitung" }).focus();
  await rowCard(page, "Runde 11").scrollIntoViewIfNeeded();
  await expect(rowCard(page, "Runde 2")).not.toBeInViewport();

  await finding.click();
  await expect(rowText(page, "Runde 2")).toBeFocused();
  await expect(rowCard(page, "Runde 2")).toBeInViewport();
  await expect(rowCard(page, "Runde 2")).toHaveClass(/is-selected/);
});

test("an unknown term shows an inline error and keeps the text", async ({ page }) => {
  await openBuilder(page);
  await typeRow(page, "Runde 1", "6 Quatsch");

  const field = rowText(page, "Runde 1");
  await expect(field).toHaveValue("6 Quatsch");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const error = rowCard(page, "Runde 1").getByRole("alert");
  await expect(error).toHaveText(/Unbekannter Begriff: „Quatsch“/i);
  await expect(field).toHaveAccessibleDescription(/Unbekannter Begriff/);
  // Nothing was committed, so there is still no model.
  await expect(page.getByText("Noch keine Maschen")).toBeVisible();

  // Escape restores the (empty) row and clears the error.
  await field.press("Escape");
  await expect(field).toHaveValue("");
  await expect(error).toHaveCount(0);
});

test("the pattern survives a reload", async ({ page }) => {
  await openBuilder(page);
  await page.getByRole("textbox", { name: "Titel der Anleitung" }).fill("Bleibt da");
  await typeRow(page, "Runde 1", "1 MR, 6 fM (6)");
  await typeRow(page, "Runde 2", "6 Zun (12)");
  await expect(page.getByRole("status").filter({ hasText: "Lokal gespeichert" })).toBeVisible();

  await page.reload();

  await expect(page.getByRole("textbox", { name: "Titel der Anleitung" })).toHaveValue("Bleibt da");
  await expect(rowText(page, "Runde 1")).toHaveValue("1 MR, 6 fM");
  await expect(rowText(page, "Runde 2")).toHaveValue("6 Zun");
  await expect(rowTarget(page, "Runde 2")).toHaveValue("12");
  await expect(page).toHaveTitle("Bleibt da – CrochetBuilder");
});
