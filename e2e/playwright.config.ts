import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the production build, served under the GitHub Pages sub-path
 * (`/CrochetBuilder/`) so relative asset, worker and viewer URLs are exercised as deployed.
 *
 * `npm run e2e` builds the builder app, starts `vite preview` and runs the suite in headless
 * Chromium. Set `E2E_SKIP_BUILD=1` to reuse an existing `apps/builder/dist`, and `E2E_PORT`
 * to serve on another port (several checkouts testing at once must not share a server).
 */

const PORT = Number(process.env.E2E_PORT) || 4179;
const BASE_PATH = "/CrochetBuilder/";
const CI = !!process.env.CI;

const preview = `npx vite preview --base ${BASE_PATH} --port ${PORT} --strictPort`;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    locale: "de-DE",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1400, height: 900 },
        // Software WebGL, so the 3D view renders in headless Chromium and on CI runners
        // without a GPU.
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
      },
    },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? preview : `npm run build && ${preview}`,
    cwd: "../apps/builder",
    url: `http://localhost:${PORT}${BASE_PATH}`,
    reuseExistingServer: !CI,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
