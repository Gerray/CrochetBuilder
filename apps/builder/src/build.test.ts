import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "crochetbuilder-build-"));

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe("production build", () => {
  it("uses only relative URLs, so it runs under a sub-path (GitHub Pages)", async () => {
    await build({
      root,
      configFile: join(root, "vite.config.ts"),
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
    });
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    expect(html).toMatch(/src="\.\/assets\/index-[\w-]+\.js"/);
    // The viewer page (share links, embeds) sits one level down and reaches the shared assets.
    const viewer = readFileSync(join(outDir, "viewer", "index.html"), "utf8");
    expect(viewer).toMatch(/src="\.\.\/assets\/viewer-[\w-]+\.js"/);
    expect(viewer).not.toMatch(/(src|href)="\/|(src|href)="\.\/assets/);
    const assets = readdirSync(join(outDir, "assets"));
    expect(assets.some((f) => f.startsWith("preview.worker-"))).toBe(true);
    expect(assets.some((f) => f.startsWith("assembly.worker-"))).toBe(true);
    expect(assets.some((f) => f.startsWith("ModelCanvas-"))).toBe(true);
    for (const file of [html, viewer, ...assets.filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(outDir, "assets", f), "utf8"))]) {
      expect(file).not.toMatch(/["'`]\/assets\//);
    }
  }, 60_000);
});
