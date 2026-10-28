import { allGood, expect, loadDemo, openBuilder, rowActual, rowCard, rowText, test } from "./fixtures.js";

test("a ball start typed with Enter only: every round is the suggestion", async ({ page }) => {
  await openBuilder(page);
  await page.getByRole("button", { name: "Neu", exact: true }).click();

  // One click into the first round; from there only Enter: each Enter takes the suggested
  // round and offers the next one (goal: 6 → 36 in at most 8 Enters).
  await rowText(page, "Runde 1").click();
  const enters = 6;
  for (let i = 0; i < enters; i++) {
    await page.keyboard.press("Enter");
    await expect(rowText(page, `Runde ${i + 2}`)).toBeFocused();
  }
  expect(enters).toBeLessThanOrEqual(8);

  const counts = [6, 12, 18, 24, 30, 36];
  for (const [i, n] of counts.entries()) await expect(rowActual(page, `Runde ${i + 1}`)).toHaveText(String(n));
  await expect(rowText(page, "Runde 6")).toHaveValue("6× (4 fM, 1 Zun)");
  // The next round is offered, selected: typing replaces it.
  await expect(rowText(page, "Runde 7")).toBeFocused();
  await expect(rowText(page, "Runde 7")).toHaveValue("6× (5 fM, 1 Zun)");
  await expect(rowCard(page, "Runde 7")).toContainText("ergibt 42 M");
  await page.keyboard.type("36 fM (6 Runden)");
  await page.keyboard.press("Enter");
  await expect(rowCard(page, "Runde 7–12")).toContainText("6 Runden");
  await expect(allGood(page)).toBeVisible();
});

test("Runde ×N and editing a group of identical rounds", async ({ page }) => {
  await openBuilder(page);
  await loadDemo(page, "Ball");
  const group = rowCard(page, "Runde 5–8");
  await expect(group).toContainText("4 Runden");

  await group.getByRole("button", { name: "Runde 5–8 wiederholen" }).click();
  const times = page.getByRole("dialog", { name: "Runde 5–8 wiederholen" }).getByLabel("Wie oft Runde 5–8 insgesamt");
  await times.fill("6");
  await times.press("Enter");
  const longer = rowCard(page, "Runde 5–10");
  await expect(longer).toContainText("6 Runden");
  await expect(rowText(page, "Runde 13")).toHaveValue("6 Abn");

  // One text for all six rounds.
  const text = rowText(page, "Runde 5–10");
  await text.fill("24 hStb");
  await text.press("Enter");
  await expect(rowText(page, "Runde 5–10")).toHaveValue("24 hStb");
  await expect(allGood(page)).toBeVisible();

  // Split into single cards; one undo step (outside a text field) restores the text.
  await longer.getByRole("button", { name: "Runde 5–10 aufteilen" }).click();
  for (const n of [5, 6, 7, 8, 9, 10]) await expect(rowText(page, `Runde ${n}`)).toHaveValue("24 hStb");
  await page.getByRole("button", { name: "Rückgängig" }).click();
  for (const n of [5, 10]) await expect(rowText(page, `Runde ${n}`)).toHaveValue("24 fM");
});

test("a snippet inserts a whole sphere in one step", async ({ page }) => {
  await openBuilder(page);
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("button", { name: "+ Baustein" }).click();
  const dialog = page.getByRole("dialog", { name: "Baustein einfügen" });
  await dialog.getByRole("radio", { name: "Kugel", exact: true }).click();
  await dialog.getByRole("button", { name: "24", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("11 Runden: 6 → 24 → 6 M · am Ende");
  await dialog.getByRole("button", { name: "Einfügen" }).click();

  await expect(rowActual(page, "Runde 1")).toHaveText("6");
  await expect(rowCard(page, "Runde 5–8")).toContainText("4 Runden");
  await expect(rowActual(page, "Runde 11")).toHaveText("6");
  await expect(rowText(page, "Runde 11")).toBeFocused();
  await expect(allGood(page)).toBeVisible();
  const preview = page.getByRole("region", { name: "3D-Vorschau" });
  await expect(preview.locator("canvas")).toBeVisible();
  await expect(page.getByLabel("Maße", { exact: true })).toContainText(/max\. Ø\s*\d+,\d cm/);
});

test("a quick fix repairs a wrong repeat count with one click", async ({ page }) => {
  await openBuilder(page);
  await loadDemo(page, "Ball");
  const r9 = rowText(page, "Runde 9");
  await r9.fill("4× (2 fM, 1 Abn) (18)");
  await r9.press("Enter");
  const card = rowCard(page, "Runde 9");
  await expect(card).toContainText("Maschenzahl stimmt nicht: Soll 18, Ist 12.");

  await card.getByRole("button", { name: "Wiederholung auf ×6 ändern" }).first().click();
  await expect(rowText(page, "Runde 9")).toHaveValue("6× (2 fM, 1 Abn)");
  await expect(allGood(page)).toBeVisible();
  await expect(rowText(page, "Runde 9")).toBeFocused();
});
