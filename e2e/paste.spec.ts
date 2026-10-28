import type { Locator, Page } from "@playwright/test";
import { SAMPLE_LINES, SAMPLE_PATTERN } from "../apps/builder/src/test/samplePattern.js";
import { expect, openBuilder, rowCard, rowText, test } from "./fixtures.js";

/** The part tabs above the rows. */
function partTabs(page: Page): Locator {
  return page.getByRole("tablist", { name: "Teile der Anleitung" }).getByRole("tab");
}

function partTab(page: Page, name: string): Locator {
  return page.getByRole("tab", { name: new RegExp(`^${name},`) });
}

function pasteDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Anleitung einfügen" });
}

const SUMMARY = "3 Teile, 19 Runden, 1 Hinweis – 2 Stellen konnten nicht gelesen werden";

test("paste a whole pattern: preview, fix in place, import as parts, undo", async ({ page }) => {
  await openBuilder(page);
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("button", { name: "Anleitung einfügen…", exact: true }).click();
  const dialog = pasteDialog(page);
  const text = dialog.getByRole("textbox", { name: "Text der Anleitung" });
  await expect(text).toBeFocused();
  await text.fill(SAMPLE_PATTERN);

  // The preview (computed in a worker) counts parts, rounds and problems.
  await expect(dialog.getByRole("status").filter({ hasText: SUMMARY })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Deutsch" })).toHaveAttribute("aria-checked", "true");
  for (const [i, name] of ["Kopf", "Körper", "Ohren"].entries()) {
    await expect(dialog.getByRole("textbox", { name: `Name von Teil ${i + 1}` })).toHaveValue(name);
  }
  await expect(dialog.getByRole("textbox", { name: "Anzahl von Teil 3" })).toHaveValue("2");
  await expect(dialog.getByText("Runde 5–8:")).toBeVisible();

  // Only the problem spots; a click marks the source line in the text.
  await dialog.getByRole("checkbox", { name: "nur Problemstellen" }).check();
  await expect(dialog.getByRole("listitem")).toHaveCount(3);
  await dialog.getByRole("button", { name: /Maschenzahl stimmt nicht: Soll 20, Ist 18/ }).click();
  await expect(text).toBeFocused();
  const selected = await text.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd));
  expect(selected).toBe(SAMPLE_PATTERN.split("\n")[SAMPLE_LINES.koerperMismatch - 1]);

  // Fixing the text in place updates the preview.
  await page.keyboard.type("Runde 3: (1 fM, 1 Zun) x 6 (18)");
  await expect(dialog.getByRole("status")).toHaveText(
    "3 Teile, 19 Runden, 0 Hinweise – 2 Stellen konnten nicht gelesen werden",
  );
  await expect(dialog.getByRole("listitem")).toHaveCount(2);

  await dialog.getByRole("button", { name: "Als neue Anleitung übernehmen" }).click();
  await expect(dialog).toBeHidden();
  await expect(partTabs(page)).toHaveCount(3);
  await expect(partTab(page, "Kopf")).toHaveAttribute("aria-selected", "true");
  await expect(partTab(page, "Ohren")).toContainText("×2");
  await expect(page.getByRole("textbox", { name: "Titel der Anleitung" })).toHaveValue("Kleiner Igel");
  await expect(page.getByText(/^Anleitung übernommen: 3 Teile\. 2 Stellen blieben Text/)).toBeVisible();
  await expect(rowText(page, "Runde 1")).toHaveValue("1 MR, 6 fM");
  await expect(rowText(page, "Runde 8")).toHaveValue("24 fM");
  await expect(page.locator(".parts-total")).toHaveText("Gesamt: 312 Maschen, 4 Teile zu häkeln");

  // Unread text stays visible as a marked instruction with the original text.
  await partTab(page, "Ohren").click();
  await expect(rowCard(page, "Nicht unterstützt").getByRole("textbox", { name: "Hinweistext von Nicht unterstützt" })).toHaveValue(
    "Runde 3: 3 Noppen, 7 fM (10)",
  );
  await expect(rowCard(page, "Nicht gelesen")).toBeVisible();

  // One undo step brings the old pattern back.
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(partTabs(page)).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Titel der Anleitung" })).toHaveValue("");
});

test("pasting a pattern outside a text field opens the dialog; parts can be added to a pattern", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openBuilder(page);
  await page.getByRole("button", { name: "Demo laden" }).click();
  await expect(partTabs(page)).toHaveCount(1);

  await page.evaluate((text) => navigator.clipboard.writeText(text), SAMPLE_PATTERN);
  await page.locator(".brand").click();
  await page.keyboard.press("Control+V");
  const dialog = pasteDialog(page);
  await expect(dialog.getByRole("textbox", { name: "Text der Anleitung" })).toHaveValue(SAMPLE_PATTERN);
  await expect(dialog.getByRole("status").filter({ hasText: SUMMARY })).toBeVisible();

  // Escape closes; the text is offered again.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Anleitung einfügen…", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: SUMMARY })).toBeVisible();

  await dialog.getByRole("button", { name: "Teile hinzufügen" }).click();
  await expect(partTabs(page)).toHaveCount(4);
  await expect(partTab(page, "Kopf")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "Titel der Anleitung" })).toHaveValue("Amigurumi-Kugel");
  await page.keyboard.press("Control+z");
  await expect(partTabs(page)).toHaveCount(1);
});
