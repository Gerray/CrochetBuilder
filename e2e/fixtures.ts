import { expect, test as base, type Locator, type Page } from "@playwright/test";

/**
 * Console messages of type "error" that are expected and harmless. Keep this list short and
 * say why each entry is here.
 */
const ALLOWED_CONSOLE_ERRORS: RegExp[] = [];

export const test = base.extend<{ consoleErrors: string[] }>({
  // Every page of the test's context (builder, viewer opened from a link, …) is watched; the
  // test fails if any of them logged an error or threw an uncaught exception.
  consoleErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      context.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (ALLOWED_CONSOLE_ERRORS.some((re) => re.test(text))) return;
        errors.push(`console.error on ${msg.page()?.url() ?? "?"}: ${text}`);
      });
      context.on("weberror", (err) => errors.push(`uncaught: ${err.error().message}`));
      await use(errors);
      expect(errors, "no console errors or uncaught exceptions").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The builder page, after the stored document has been restored. */
export async function openBuilder(page: Page, path = ""): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("textbox", { name: "Titel der Anleitung" })).toBeVisible();
}

/** Free-text field of a row ("Runde 3"). */
export function rowText(page: Page, label: string): Locator {
  return page.getByRole("textbox", { name: `Maschen von ${label} als Text`, exact: true });
}

/** Soll field of a row. */
export function rowTarget(page: Page, label: string): Locator {
  return page.getByRole("textbox", { name: `Soll-Maschenzahl von ${label}`, exact: true });
}

/** Ist output of a row. */
export function rowActual(page: Page, label: string): Locator {
  return page.getByLabel(`Ist-Maschenzahl von ${label}`, { exact: true });
}

/** The row card ("Runde 3") as a whole. */
export function rowCard(page: Page, label: string): Locator {
  return page.getByRole("article", { name: label, exact: true });
}

/** Type `text` into a row's free-text field and commit it with Enter. */
export async function typeRow(page: Page, label: string, text: string): Promise<void> {
  const field = rowText(page, label);
  await field.click();
  await field.fill(text);
  await field.press("Enter");
}

/** The "keine Befunde" line of the Prüfung section. */
export function allGood(page: Page): Locator {
  return page.getByText("Keine Befunde – Maschenzahlen und Übergänge stimmen.");
}

/** The real-size line under the 3D view ("B × H × T 4,1 × 3,9 × 4,0 cm"). */
export function dimensions(page: Page): Locator {
  return page.getByLabel("Maße", { exact: true });
}

/** Open the "Exportieren" panel and wait until the links are ready. */
export async function openExportMenu(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Exportieren ▾" }).click();
  const panel = page.getByRole("dialog", { name: "Exportieren" });
  await expect(panel.getByRole("link", { name: "In TellmeCrochet öffnen" })).toBeVisible();
  return panel;
}

/** Load a demo via the "Weitere Demos" menu ("Hase" is the multi-part bunny). */
export async function loadDemo(page: Page, label: "Kugel" | "Ball" | "Topflappen" | "Hase"): Promise<void> {
  await page.getByRole("button", { name: "Weitere Demos" }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${label}`) }).click();
}
