import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first `{ … }` block that follows `selector` (balanced braces). */
function blockAfter(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start + selector.length);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unbalanced block: ${selector}`);
}

function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

const tokens = stripComments(read("./tokens.css"));
const dark = declarations(blockAfter(tokens, ":root"));
const lightMedia = declarations(blockAfter(blockAfter(tokens, "@media (prefers-color-scheme: light)"), ':root:not([data-theme="dark"])'));
const lightForced = declarations(blockAfter(tokens, ':root[data-theme="light"]'));
const light = new Map([...dark, ...lightMedia]);

function resolve(theme: Map<string, string>, name: string, seen: string[] = []): string {
  const value = theme.get(name);
  if (value === undefined) throw new Error(`undefined token ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (!ref) return value;
  if (seen.includes(name)) throw new Error(`cycle at ${name}`);
  return resolve(theme, ref[1]!, [...seen, name]);
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const channel = (i: number) => {
    const c = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text tokens on the backgrounds they are used on (styles.css, export.css, viewer.css). */
const TEXT_PAIRS: Array<[string, string]> = [
  ["--c-text", "--c-bg"],
  ["--c-text", "--c-surface"],
  ["--c-text", "--c-surface-2"],
  ["--c-text", "--c-field"],
  ["--c-text", "--c-accent-subtle"],
  ["--c-text", "--c-warn-bg"],
  ["--c-text-2", "--c-surface"],
  ["--c-text-2", "--c-surface-2"],
  ["--c-text-2", "--c-warn-bg"],
  ["--c-text-mute", "--c-bg"],
  ["--c-text-mute", "--c-surface"],
  ["--c-text-mute", "--c-surface-2"],
  ["--c-accent-text", "--c-bg"],
  ["--c-accent-text", "--c-surface"],
  ["--c-accent-text", "--c-accent-subtle"],
  ["--c-accent-on", "--c-accent-fill"],
  ["--c-accent-on", "--c-accent-fill-hover"],
  ["--c-warn-text", "--c-warn-bg"],
  ["--c-warn-text", "--c-surface"],
  ["--c-warn-text", "--c-surface-2"],
  ["--c-ok-text", "--c-ok-bg"],
  ["--c-ok-text", "--c-surface"],
];

/** Non-text UI that must stay visible (WCAG 1.4.11, ≥ 3:1). */
const UI_PAIRS: Array<[string, string]> = [
  ["--c-accent-base", "--c-surface"], // focus ring, selection marker
  ["--c-accent-base", "--c-bg"],
  ["--c-warn", "--c-surface"], // error marker
  ["--c-model-highlight", "--c-model-bg"],
];

describe("design tokens", () => {
  it("keeps both copies of the light palette identical", () => {
    expect(Object.fromEntries(lightForced)).toEqual(Object.fromEntries(lightMedia));
  });

  it("defines every light colour for dark too (dark is the default)", () => {
    for (const name of lightMedia.keys()) expect(dark.has(name), name).toBe(true);
    expect(blockAfter(tokens, ":root")).toMatch(/color-scheme:\s*dark/);
  });

  it("resolves the 3D view colours to plain #rrggbb values (Three.js parses them)", () => {
    for (const theme of [dark, light])
      for (const name of ["--c-model-bg", "--c-model-grid", "--c-model-highlight", "--c-model-yarn"])
        expect(resolve(theme, name)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  for (const [label, theme] of [
    ["dark", dark],
    ["light", light],
  ] as const) {
    it(`has AA text contrast in ${label}`, () => {
      for (const [fg, bg] of TEXT_PAIRS) {
        const ratio = contrast(resolve(theme, fg), resolve(theme, bg));
        expect(ratio, `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`keeps markers visible in ${label}`, () => {
      for (const [fg, bg] of UI_PAIRS) {
        const ratio = contrast(resolve(theme, fg), resolve(theme, bg));
        expect(ratio, `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("leaves colour values to the tokens: no literal colours in the stylesheets", () => {
    for (const file of ["./styles.css", "./components/export.css", "./components/paste.css", "./viewer/viewer.css"]) {
      const css = stripComments(read(file));
      expect(css, file).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css, file).not.toMatch(/\brgba?\(|\bhsla?\(/i);
      // Every custom property a stylesheet uses is a token.
      for (const m of css.matchAll(/var\((--[\w-]+)/g)) {
        if (m[1] === "--split") continue; // layout state set inline by SplitPane
        expect(dark.has(m[1]!), `${file}: ${m[1]}`).toBe(true);
      }
    }
  });
});
