import { expect, loadDemo, openBuilder, openExportMenu, rowText, test, typeRow } from "./fixtures.js";
import type { Locator, Page } from "@playwright/test";

/** The part tabs above the rows. */
function partTabs(page: Page): Locator {
  return page.getByRole("tablist", { name: "Teile der Anleitung" }).getByRole("tab");
}

/** One part tab, by the part's name (its accessible name starts with it). */
function partTab(page: Page, name: string): Locator {
  return page.getByRole("tab", { name: new RegExp(`^${name},`) });
}

function nameField(page: Page): Locator {
  return page.getByRole("textbox", { name: "Name des Teils" });
}

test("several parts: add, rename, quantity, switch, delete with undo, reload", async ({ page }) => {
  await openBuilder(page);
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("textbox", { name: "Titel der Anleitung" }).fill("Zwei Teile");
  await typeRow(page, "Runde 1", "1 MR, 6 fM (6)");
  await expect(partTabs(page)).toHaveCount(1);

  // "+ Teil": a new part with one empty round, its name ready to type over.
  await page.getByRole("button", { name: "+ Teil" }).click();
  await expect(partTabs(page)).toHaveCount(2);
  await expect(nameField(page)).toBeFocused();
  await expect(nameField(page)).toHaveValue("Teil 2");
  await page.keyboard.type("Ohr");
  await page.keyboard.press("Enter");
  await expect(partTab(page, "Ohr")).toHaveAttribute("aria-selected", "true");
  await expect(partTab(page, "Ohr")).toBeFocused();
  await expect(rowText(page, "Runde 1")).toHaveValue("");
  await typeRow(page, "Runde 1", "1 MR, 5 fM (5)");

  // Quantity 2: the tab and the total follow.
  await page.getByRole("button", { name: "Anzahl erhöhen" }).click();
  await expect(page.getByRole("textbox", { name: "Anzahl des Teils" })).toHaveValue("2");
  await expect(partTab(page, "Ohr")).toContainText("×2");
  await expect(page.locator(".parts-total")).toHaveText("Gesamt: 16 Maschen, 3 Teile zu häkeln");

  // Switching parts with the keyboard and by click; the rows and stats follow.
  await rowText(page, "Runde 1").click();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(partTab(page, "Teil 1")).toHaveAttribute("aria-selected", "true");
  await expect(rowText(page, "Runde 1")).toHaveValue("1 MR, 6 fM");
  const stats = page.getByRole("region", { name: "Kennzahlen" });
  await expect(stats).toContainText("6");
  await page.keyboard.press("Alt+ArrowDown");
  await expect(partTab(page, "Ohr")).toHaveAttribute("aria-selected", "true");
  await expect(partTab(page, "Ohr")).toBeFocused();
  await expect(rowText(page, "Runde 1")).toHaveValue("1 MR, 5 fM");

  // Unreadable text stops the switch: by shortcut and by click; error and focus stay.
  const field = rowText(page, "Runde 1");
  await field.fill("6 xyz");
  await page.keyboard.press("Alt+ArrowUp");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toBeFocused();
  await expect(partTab(page, "Ohr")).toHaveAttribute("aria-selected", "true");
  await partTab(page, "Teil 1").click();
  await expect(partTab(page, "Ohr")).toHaveAttribute("aria-selected", "true");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("6 xyz");
  await page.keyboard.press("Escape");
  await expect(field).toHaveValue("1 MR, 5 fM");

  // Delete, then undo from the notice.
  await page.getByRole("button", { name: "Teil löschen" }).click();
  await expect(partTabs(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Teil löschen" })).toBeDisabled();
  await page.getByRole("button", { name: "Löschen von „Ohr“ rückgängig machen" }).click();
  await expect(partTabs(page)).toHaveCount(2);
  await expect(partTab(page, "Ohr")).toHaveAttribute("aria-selected", "true");
  await expect(rowText(page, "Runde 1")).toHaveValue("1 MR, 5 fM");

  // Delete again and undo with Ctrl+Z (outside a text field).
  await page.getByRole("button", { name: "Teil löschen" }).click();
  await expect(partTabs(page)).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(partTabs(page)).toHaveCount(2);

  // A reload keeps all parts, quantities and the part in view.
  await expect(page.getByRole("status").filter({ hasText: "Lokal gespeichert" })).toBeVisible();
  await page.reload();
  await expect(partTabs(page)).toHaveCount(2);
  await expect(partTab(page, "Ohr")).toHaveAttribute("aria-selected", "true");
  await expect(partTab(page, "Ohr")).toContainText("×2");
  await expect(rowText(page, "Runde 1")).toHaveValue("1 MR, 5 fM");
  await partTab(page, "Teil 1").click();
  await expect(rowText(page, "Runde 1")).toHaveValue("1 MR, 6 fM");
});

test("the bunny demo: every part has a model; the share link opens the viewer with part tabs", async ({
  page,
  context,
}) => {
  await openBuilder(page);
  await loadDemo(page, "Hase");
  await expect(partTabs(page)).toHaveCount(5);
  await expect(page.locator(".parts-total")).toHaveText("Gesamt: 1.140 Maschen, 8 Teile zu häkeln");

  // The 3D view shows the chosen part: the ear is long and slim, the head round.
  const dims = page.getByLabel("Maße", { exact: true });
  const size = async () => {
    const [w, h] = ((await dims.textContent()) ?? "").match(/(\d+,\d) × (\d+,\d) ×/)!.slice(1).map((v) => Number(v.replace(",", ".")));
    return { w: w!, h: h! };
  };
  await expect(dims).toContainText(/B × H × T/);
  const head = await size();
  await partTab(page, "Ohr").click();
  await expect.poll(async () => (await size()).h / (await size()).w).toBeGreaterThan(1.8);
  expect(head.h / head.w).toBeLessThan(1.4);

  // Duplicate for left/right, then share.
  await partTab(page, "Bein").click();
  await page.getByRole("button", { name: "Teil duplizieren" }).click();
  await expect(nameField(page)).toHaveValue("Bein (Kopie)");
  await expect(partTabs(page)).toHaveCount(6);

  const panel = await openExportMenu(page);
  await panel.getByRole("button", { name: "Link teilen" }).click();
  const viewerUrl = await panel.getByRole("textbox", { name: "Link zur 3D-Ansicht" }).inputValue();
  await page.keyboard.press("Escape");

  const viewer = await context.newPage();
  await viewer.goto(viewerUrl);
  await expect(viewer.getByRole("heading", { level: 1, name: "Hase (einfach)" })).toBeVisible();
  const tabs = viewer.getByRole("tablist", { name: "Teile" }).getByRole("tab");
  await expect(tabs).toHaveText(["Kopf", "Körper", "Ohr ×2", "Arm ×2", "Bein ×2", "Bein (Kopie) ×2"]);
  // The text lists every part (and prints them all); the tabs pick the model.
  await expect(viewer.getByRole("heading", { level: 3 })).toHaveText([
    "Kopf",
    "Körper",
    "Ohr ×2",
    "Arm ×2",
    "Bein ×2",
    "Bein (Kopie) ×2",
  ]);
  await expect(viewer.getByRole("list", { name: "Reihen von Kopf" }).getByRole("listitem")).toHaveCount(14);
  await expect(viewer.getByRole("list", { name: "Reihen von Ohr ×2" }).getByRole("listitem")).toHaveCount(13);
  await viewer.getByRole("tab", { name: "Ohr ×2" }).click();
  await expect(viewer.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "viewer-part-2");
  // Scrolled to the ear's rows.
  await expect(viewer.getByRole("heading", { level: 3, name: "Ohr ×2" })).toBeInViewport();
  await viewer.emulateMedia({ media: "print" });
  await expect(viewer.getByRole("list", { name: "Reihen von Bein (Kopie) ×2" })).toBeVisible();
  await viewer.emulateMedia({ media: "screen" });
  await expect(viewer.getByRole("region", { name: "3D-Modell" }).locator("canvas")).toBeVisible();
  const size3d = viewer.getByLabel("Maße", { exact: true });
  await expect(size3d).toContainText(/Größe/);
  await expect(viewer.getByRole("link", { name: "In TellmeCrochet öffnen" })).toHaveAttribute(
    "href",
    /^https:\/\/tellmecrochet\.de\/import#data=v1\./,
  );
});
