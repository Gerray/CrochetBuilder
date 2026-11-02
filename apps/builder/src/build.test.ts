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

  it("keeps the sign-in library in a chunk of its own, loaded only on demand", () => {
    const assets = readdirSync(join(outDir, "assets")).filter((f) => f.endsWith(".js"));
    const source = (file: string) => readFileSync(join(outDir, "assets", file), "utf8");
    const withLibrary = assets.filter((f) => source(f).includes("X-Supabase-Api-Version"));
    expect(withLibrary).toHaveLength(1);
    const lazy = withLibrary[0]!;
    // Neither page loads it up front, directly or through what it preloads.
    for (const page of ["index.html", join("viewer", "index.html")]) {
      const html = readFileSync(join(outDir, page), "utf8");
      const upFront = [...html.matchAll(/assets\/([\w.-]+\.js)/g)].map((m) => m[1]!);
      expect(upFront.length).toBeGreaterThan(0);
      expect(upFront).not.toContain(lazy);
    }
    // No worker has it, and nothing imports it statically (`import … from "./lazy"`).
    for (const file of assets) {
      if (file !== lazy) expect(source(file), file).not.toMatch(new RegExp(`from\\s*["']\\./${lazy.replace(/[.]/g, "\\.")}["']`));
      if (/worker/.test(file)) expect(source(file), file).not.toContain(lazy);
    }
    // The viewer's own code never refers to it.
    expect(assets.filter((f) => f.startsWith("viewer-")).every((f) => !source(f).includes(lazy))).toBe(true);
  });
});
