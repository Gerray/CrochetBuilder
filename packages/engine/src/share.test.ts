import { describe, expect, it } from "vitest";
import { renderedRows, type BuilderExport, type Material } from "./export.js";
import type { Gauge } from "./gauge.js";
import { createRandom } from "./random.js";
import type { Op, Row, StitchCode } from "./schema.js";
import {
  buildTmcImportUrl,
  buildViewerUrl,
  decodeShare,
  encodeShare,
  MAX_SHARE_CHARS,
  MAX_SHARE_JSON_BYTES,
  readShareFragment,
  ShareDecodeError,
  type ShareDecodeErrorCode,
} from "./share.js";

const sc = (count: number): Op => ({ kind: "stitch", code: "SC", count });
const inc = (count: number): Op => ({ kind: "stitch", code: "INC", count });

function sphere(): BuilderExport {
  const content = {
    schemaVersion: 1 as const,
    rows: [
      { id: "r1", type: "round" as const, ops: [{ kind: "stitch" as const, code: "MR" as const, count: 1 }, sc(6)], stitchCountTarget: 6 },
      { id: "r2", type: "round" as const, ops: [inc(6)], stitchCountTarget: 12 },
      { id: "r3", type: "round" as const, ops: [{ kind: "repeat" as const, times: 6, ops: [sc(1), inc(1)] }], stitchCountTarget: 18 },
    ],
  };
  return {
    schemaVersion: 1,
    title: "Amigurumi-Kugel – „Größe“ ×",
    overview: {
      materials: [{ kind: "yarn", label: "Baumwollgarn DK", colors: ["Weiß"], amount: "ca. 10 g" }],
      gauge: { yarnWeight: "dk", hookMm: 3 },
      notes: "In Spiralrunden häkeln. 🧶",
    },
    parts: [{ name: "Kugel", quantity: 1, content }],
    rendered: { locale: "de", rows: renderedRows(content, "de") },
  };
}

// ---------------------------------------------------------------------------
// Seeded generator of arbitrary (schema-valid) exports
// ---------------------------------------------------------------------------

const CODES: StitchCode[] = ["CH", "SL_ST", "SC", "HDC", "DC", "TR", "DTR", "MR", "INC", "DEC", "INVDEC", "ST"];
const TEXT = "abcdefghijklmnopqrstuvwxyzäöüßÄÖÜ ×–„“…0123456789 ()\"'\\/#&=?%🧶\n";

function generator(seed: number) {
  const rnd = createRandom(seed);
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
  const pick = <T,>(list: readonly T[]): T => list[int(0, list.length - 1)]!;
  const maybe = <T,>(p: number, make: () => T): T | undefined => (rnd() < p ? make() : undefined);
  const text = (max: number) => Array.from({ length: int(0, max) }, () => pick([...TEXT])).join("");

  const op = (depth: number): Op => {
    if (depth < 3 && rnd() < 0.25) {
      return { kind: "repeat", times: int(1, 12), ops: Array.from({ length: int(0, 3) }, () => op(depth + 1)) };
    }
    const stitch: Op = { kind: "stitch", code: pick(CODES), count: int(1, 40) };
    const modifiers = maybe(0.2, () => [pick(["BLO", "FLO", "TOG"] as const)]);
    if (modifiers) stitch.modifiers = modifiers;
    const into = maybe(0.1, () => text(12));
    if (into !== undefined) stitch.into = into;
    return stitch;
  };
  const row = (i: number): Row => {
    const r: Row = {
      id: `row-${seed}-${i}`,
      type: pick(["row", "round"] as const),
      ops: Array.from({ length: int(0, 5) }, () => op(0)),
      stitchCountTarget: int(0, 500),
    };
    const label = maybe(0.2, () => text(10));
    if (label !== undefined) r.label = label;
    const note = maybe(0.3, () => text(30));
    if (note !== undefined) r.note = note;
    return r;
  };
  const material = (): Material => {
    const m: Material = { kind: pick(["yarn", "hook", "accessory"] as const), label: text(20) };
    const colors = maybe(0.5, () => Array.from({ length: int(0, 3) }, () => text(8)));
    if (colors) m.colors = colors;
    const amount = maybe(0.5, () => text(6));
    if (amount !== undefined) m.amount = amount;
    return m;
  };
  const gauge = (): Gauge => {
    const g: Gauge = {};
    if (rnd() < 0.5) g.stitchesPer10cm = int(5, 40) + 0.5 * int(0, 1);
    if (rnd() < 0.5) g.rowsPer10cm = int(5, 40);
    if (rnd() < 0.5) g.yarnWeight = pick(["lace", "fingering", "sport", "dk", "worsted", "aran", "bulky", "jumbo"] as const);
    if (rnd() < 0.5) g.hookMm = int(4, 40) / 4;
    return g;
  };

  return (): BuilderExport => {
    const parts = Array.from({ length: int(1, 3) }, (_, p) => ({
      name: text(12),
      quantity: int(1, 6),
      content: { schemaVersion: 1 as const, rows: Array.from({ length: int(0, 25) }, (_, i) => row(p * 100 + i)) },
    }));
    const overview: BuilderExport["overview"] = {};
    const materials = maybe(0.7, () => Array.from({ length: int(0, 4) }, material));
    if (materials) overview.materials = materials;
    const g = maybe(0.6, gauge);
    if (g) overview.gauge = g;
    const notes = maybe(0.5, () => text(80));
    if (notes !== undefined) overview.notes = notes;
    const exp: BuilderExport = { schemaVersion: 1, title: text(30), overview, parts };
    if (rnd() < 0.5) exp.rendered = { locale: pick(["de", "en_us", "en_uk"] as const), rows: parts[0]!.content.rows.map(() => text(20)) };
    return exp;
  };
}

/** Deflate-raw + base64url of arbitrary bytes — builds hostile payloads for the decoder. */
async function pack(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const b of packed) binary += String.fromCharCode(b);
  return "v1." + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function decodeError(payload: string): Promise<ShareDecodeErrorCode> {
  try {
    await decodeShare(payload);
  } catch (err) {
    expect(err).toBeInstanceOf(ShareDecodeError);
    return (err as ShareDecodeError).code;
  }
  throw new Error("decodeShare did not throw");
}

// ---------------------------------------------------------------------------

describe("encodeShare / decodeShare", () => {
  it("round-trips the sphere export, umlauts and emoji included", async () => {
    const exp = sphere();
    const payload = await encodeShare(exp);
    expect(payload).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(await decodeShare(payload)).toEqual(exp);
  });

  it("is deterministic and compresses", async () => {
    const exp = sphere();
    const a = await encodeShare(exp);
    expect(await encodeShare(structuredClone(exp))).toBe(a);
    expect(a.length).toBeLessThan(JSON.stringify(exp).length);
  });

  it("round-trips 60 generated exports (seeded)", async () => {
    for (let seed = 1; seed <= 60; seed++) {
      const exp = generator(seed)();
      const payload = await encodeShare(exp);
      expect(payload).toMatch(/^v1\.[A-Za-z0-9_-]*$/);
      expect(await decodeShare(payload), `seed ${seed}`).toEqual(exp);
    }
  });

  it("refuses to encode an invalid export", async () => {
    const bad = { ...sphere(), schemaVersion: 2 } as unknown as BuilderExport;
    await expect(encodeShare(bad)).rejects.toThrow();
  });

  it("tolerates surrounding whitespace", async () => {
    const payload = await encodeShare(sphere());
    expect(await decodeShare(`  ${payload}\n`)).toEqual(sphere());
  });
});

describe("decodeShare rejects broken input with typed errors", () => {
  it("malformed: missing or unknown version, bad characters, empty", async () => {
    const payload = await encodeShare(sphere());
    const body = payload.slice(3);
    expect(await decodeError(body)).toBe("malformed");
    expect(await decodeError(`v2.${body}`)).toBe("malformed");
    expect(await decodeError(`x.${body}`)).toBe("malformed");
    expect(await decodeError("v1.")).toBe("malformed");
    expect(await decodeError("v1.abc+def/")).toBe("malformed");
    expect(await decodeError("v1.a")).toBe("malformed");
    expect(await decodeError("")).toBe("malformed");
    expect(await decodeError(42 as unknown as string)).toBe("malformed");
  });

  it("malformed: truncated payloads (a link cut off while copying)", async () => {
    const payload = await encodeShare(sphere());
    for (const cut of [10, Math.floor(payload.length / 2), payload.length - 3]) {
      const code = await decodeError(payload.slice(0, cut));
      expect(code, `cut at ${cut}`).toBe("malformed");
    }
  });

  it("corrupted payloads never decode to something unvalidated", async () => {
    const payload = await encodeShare(sphere());
    const rnd = createRandom(7);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let i = 0; i < 40; i++) {
      const at = 3 + Math.floor(rnd() * (payload.length - 3));
      const ch = alphabet[Math.floor(rnd() * alphabet.length)]!;
      const corrupted = payload.slice(0, at) + ch + payload.slice(at + 1);
      try {
        const decoded = await decodeShare(corrupted);
        // A flip that survives deflate and JSON must still be a valid export.
        expect(decoded.schemaVersion).toBe(1);
      } catch (err) {
        expect(err).toBeInstanceOf(ShareDecodeError);
        expect(["malformed", "invalid"]).toContain((err as ShareDecodeError).code);
      }
    }
  });

  it("malformed: valid deflate, but not UTF-8 JSON", async () => {
    expect(await decodeError(await pack(new TextEncoder().encode("{ not json")))).toBe("malformed");
    expect(await decodeError(await pack(new Uint8Array([0xff, 0xfe, 0x7b, 0x7d])))).toBe("malformed");
  });

  it("invalid: JSON that is not a builder export", async () => {
    expect(await decodeError(await pack(new TextEncoder().encode("[]")))).toBe("invalid");
    expect(await decodeError(await pack(new TextEncoder().encode(JSON.stringify({ ...sphere(), title: 5 }))))).toBe("invalid");
    const bare = sphere().parts[0]!.content;
    expect(await decodeError(await pack(new TextEncoder().encode(JSON.stringify(bare))))).toBe("invalid");
  });

  it("too-large: a small payload that inflates beyond the cap (zip bomb)", async () => {
    const bomb = new Uint8Array(MAX_SHARE_JSON_BYTES + 1024).fill(0x20);
    const payload = await pack(bomb);
    expect(payload.length).toBeLessThan(20_000);
    expect(await decodeError(payload)).toBe("too-large");
  });

  it("too-large: an encoded string beyond the length cap is refused without decoding", async () => {
    expect(await decodeError("v1." + "A".repeat(MAX_SHARE_CHARS))).toBe("too-large");
  });

  it("encodeShare refuses an export beyond the cap", async () => {
    const exp = sphere();
    exp.overview.notes = "x".repeat(MAX_SHARE_JSON_BYTES);
    await expect(encodeShare(exp)).rejects.toThrow(RangeError);
  });
});

describe("share URLs", () => {
  it("reads the payload from a URL fragment", () => {
    expect(readShareFragment("#data=v1.abc")).toBe("v1.abc");
    expect(readShareFragment("data=v1.abc")).toBe("v1.abc");
    expect(readShareFragment("#x=1&data=v1.abc&y=2")).toBe("v1.abc");
    expect(readShareFragment("#data=v1.a%2Db")).toBe("v1.a-b");
    expect(readShareFragment("#data=")).toBeNull();
    expect(readShareFragment("#metadata=v1.abc")).toBeNull();
    expect(readShareFragment("")).toBeNull();
  });

  it("builds the TellmeCrochet import link", () => {
    expect(buildTmcImportUrl("v1.abc")).toBe("https://tellmecrochet.de/import#data=v1.abc");
  });

  it("builds viewer links relative to the deployment, embed optional", () => {
    const base = "https://gerray.github.io/CrochetBuilder/viewer/";
    expect(buildViewerUrl(base, "v1.abc")).toBe("https://gerray.github.io/CrochetBuilder/viewer/#data=v1.abc");
    expect(buildViewerUrl(base, "v1.abc", { embed: true })).toBe(
      "https://gerray.github.io/CrochetBuilder/viewer/?embed=1#data=v1.abc",
    );
    expect(buildViewerUrl(`${base}?embed=1#data=old`, "v1.new")).toBe(`${base}#data=v1.new`);
  });

  it("a full round trip through a viewer URL", async () => {
    const url = buildViewerUrl("http://localhost:5190/viewer/", await encodeShare(sphere()), { embed: true });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("embed")).toBe("1");
    expect(await decodeShare(readShareFragment(parsed.hash)!)).toEqual(sphere());
  });
});
