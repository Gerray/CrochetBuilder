import { afterEach, describe, expect, it, vi } from "vitest";
import { renderedRows, type BuilderExport, type Material } from "./export.js";
import type { Gauge } from "./gauge.js";
import { createRandom } from "./random.js";
import type { Op, Row, StitchCode } from "./schema.js";
import {
  buildViewerUrl,
  canonicalSharePayload,
  decodeShare,
  encodeShare,
  exceedsJsonDepth,
  INFLATE_SLICE_BYTES,
  MAX_JSON_DEPTH,
  MAX_SHARE_CHARS,
  MAX_SHARE_JSON_BYTES,
  readShareFragment,
  ShareDecodeError,
  type ShareDecodeErrorCode,
} from "./share.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    const bad = { ...sphere(), schemaVersion: 3 } as unknown as BuilderExport;
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

  it("returns the canonical payload: trimmed (also %-encoded and Unicode whitespace), without padding", async () => {
    const payload = await encodeShare(sphere());
    for (const wrap of ["%20", "%0A", "\u00a0", "\ufeff", "\u2028", " "]) {
      expect(readShareFragment(`#data=${wrap}${payload}${wrap}`), JSON.stringify(wrap)).toBe(payload);
    }
    expect(readShareFragment("#data=v1.abc==")).toBe("v1.abc");
    expect(readShareFragment("#data=%20%20")).toBeNull();
    // What the viewer forwards into builder links is that canonical form.
    expect(buildViewerUrl("https://x.test/viewer/", readShareFragment(`#data=%20${payload}%0A`)!)).toBe(
      buildViewerUrl("https://x.test/viewer/", payload),
    );
  });
});

// ---------------------------------------------------------------------------
// Review fixes: bounded decompression, nesting depth, padding, trailing bytes, support
// ---------------------------------------------------------------------------

function base64UrlBytes(payload: string): Uint8Array<ArrayBuffer> {
  const body = payload.slice(3).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(body + "=".repeat((4 - (body.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function payloadOf(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return "v1." + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A minimal export whose first row holds `depth` repeat groups nested in each other. */
function nestedExportJson(depth: number): string {
  const ops = '{"kind":"repeat","times":1,"ops":['.repeat(depth) + '{"kind":"stitch","code":"SC","count":1}' + "]}".repeat(depth);
  return (
    '{"schemaVersion":1,"title":"T","overview":{},"parts":[{"name":"A","quantity":1,"content":{"schemaVersion":1,' +
    `"rows":[{"id":"r1","type":"round","ops":[${ops}],"stitchCountTarget":1}]}}]}`
  );
}

describe("decodeShare: bounded decompression", () => {
  it("feeds the input in slices and writes nothing more once the output is over the limit", async () => {
    // Like Chromium: every written chunk is inflated completely and enqueued at once,
    // regardless of the reader's backpressure.
    const PER_WRITE = 512 * 1024;
    const calls: Array<{ bytes: number; enqueuedBefore: number }> = [];
    let enqueued = 0;
    class EagerDecompressionStream {
      readonly writable: WritableStream<BufferSource>;
      readonly readable: ReadableStream<Uint8Array>;
      constructor(format: string) {
        expect(format).toBe("deflate-raw");
        const t = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            calls.push({ bytes: chunk.byteLength, enqueuedBefore: enqueued });
            for (let i = 0; i < 8; i++) controller.enqueue(new Uint8Array(PER_WRITE / 8));
            enqueued += PER_WRITE;
          },
        });
        this.writable = t.writable as WritableStream<BufferSource>;
        this.readable = t.readable;
      }
    }
    vi.stubGlobal("DecompressionStream", EagerDecompressionStream);

    const input = new Uint8Array(64 * 1024).map((_, i) => (i * 31) & 0xff);
    const started = performance.now();
    expect(await decodeError(payloadOf(input))).toBe("too-large");
    expect(performance.now() - started).toBeLessThan(2000);

    expect(calls.every((c) => c.bytes <= INFLATE_SLICE_BYTES)).toBe(true);
    // No slice is written after the output went over the limit …
    expect(calls.every((c) => c.enqueuedBefore <= MAX_SHARE_JSON_BYTES)).toBe(true);
    // … so only a few of the 32 slices were ever inflated.
    expect(calls.length).toBe(MAX_SHARE_JSON_BYTES / PER_WRITE + 1);
    expect(calls.length).toBeLessThan(input.byteLength / INFLATE_SLICE_BYTES);
  });

  it("a real zip bomb (50 MB of spaces) is refused quickly", async () => {
    const payload = await pack(new Uint8Array(50 * 1024 * 1024).fill(0x20));
    expect(payload.length).toBeLessThan(MAX_SHARE_CHARS);
    const started = performance.now();
    expect(await decodeError(payload)).toBe("too-large");
    expect(performance.now() - started).toBeLessThan(2000);
  }, 20_000);

  it("refuses a payload beyond MAX_SHARE_CHARS (256 Ki characters) before decoding", async () => {
    expect(MAX_SHARE_CHARS).toBe(256 * 1024);
    expect(await decodeError("v1." + "A".repeat(MAX_SHARE_CHARS))).toBe("too-large");
  });

  it("encodeShare refuses an export whose payload would exceed MAX_SHARE_CHARS", async () => {
    const exp = sphere();
    const rnd = createRandom(3);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    // Incompressible text: well below the JSON limit, but too long as a link.
    exp.overview.notes = Array.from({ length: 400_000 }, () => alphabet[Math.floor(rnd() * 64)]).join("");
    await expect(encodeShare(exp)).rejects.toThrow(RangeError);
  });
});

describe("decodeShare: nesting depth", () => {
  it("exceedsJsonDepth counts objects and arrays, not brackets in strings", () => {
    expect(exceedsJsonDepth("[[[]]]", 3)).toBe(false);
    expect(exceedsJsonDepth("[[[[]]]]", 3)).toBe(true);
    expect(exceedsJsonDepth('{"a":{"b":[1]}}', 3)).toBe(false);
    expect(exceedsJsonDepth('["[[[[[", "\\"[[[[", {}]', 2)).toBe(false);
    expect(exceedsJsonDepth("", 0)).toBe(false);
  });

  it("~1000 nested repeats (a short link) → typed `invalid`, no stack overflow", async () => {
    const payload = await pack(new TextEncoder().encode(nestedExportJson(1000)));
    expect(payload.length).toBeLessThan(1000);
    expect(await decodeError(payload)).toBe("invalid");
    const deeper = await pack(new TextEncoder().encode(nestedExportJson(20_000)));
    expect(await decodeError(deeper)).toBe("invalid");
  });

  it("nesting within MAX_JSON_DEPTH still decodes", async () => {
    const depth = Math.floor((MAX_JSON_DEPTH - 8) / 2);
    const exp = await decodeShare(await pack(new TextEncoder().encode(nestedExportJson(depth))));
    expect(exp.parts[0]!.content.rows[0]!.ops[0]!.kind).toBe("repeat");
    expect(await decodeError(await pack(new TextEncoder().encode(nestedExportJson(depth + 1))))).toBe("invalid");
  });

  it("encodeShare refuses an export nested deeper than MAX_JSON_DEPTH", async () => {
    const exp = JSON.parse(nestedExportJson(MAX_JSON_DEPTH)) as BuilderExport;
    await expect(encodeShare(exp)).rejects.toThrow(RangeError);
  });
});

describe("decodeShare: padding and trailing bytes", () => {
  it("canonicalSharePayload trims and drops base64 padding", () => {
    expect(canonicalSharePayload("  v1.abc==\n")).toBe("v1.abc");
    expect(canonicalSharePayload("v1.abcd")).toBe("v1.abcd");
  });

  it("tolerates RFC 4648 padding", async () => {
    let tested = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const payload = await encodeShare(generator(seed)());
      const pad = (4 - ((payload.length - 3) % 4)) % 4;
      if (pad === 0) continue;
      tested++;
      expect(await decodeShare(payload + "=".repeat(pad))).toEqual(await decodeShare(payload));
    }
    expect(tested).toBeGreaterThan(0);
    expect(await decodeError((await encodeShare(sphere())) + "===")).toBe("malformed");
  });

  it("rejects bytes after the end of the deflate stream (as browsers do)", async () => {
    const bytes = base64UrlBytes(await encodeShare(sphere()));
    for (const junk of [[0], [0x4a, 0x55, 0x4e, 0x4b], Array.from({ length: 300 }, (_, i) => i & 0xff)]) {
      expect(await decodeError(payloadOf(new Uint8Array([...bytes, ...junk])))).toBe("malformed");
    }
    // The untouched stream still decodes.
    expect(await decodeShare(payloadOf(bytes))).toEqual(sphere());
  });
});

describe("decodeShare / encodeShare without stream support", () => {
  it("no DecompressionStream at all → `unsupported`", async () => {
    const payload = await encodeShare(sphere());
    vi.stubGlobal("DecompressionStream", undefined);
    expect(await decodeError(payload)).toBe("unsupported");
  });

  it("no 'deflate-raw' format (older browsers) → `unsupported`", async () => {
    const payload = await encodeShare(sphere());
    class OldDecompressionStream {
      constructor(format: string) {
        if (format !== "gzip" && format !== "deflate") throw new TypeError(`Unsupported format ${format}`);
      }
    }
    vi.stubGlobal("DecompressionStream", OldDecompressionStream);
    expect(await decodeError(payload)).toBe("unsupported");
  });

  it("encodeShare without CompressionStream → ShareDecodeError `unsupported`", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    await expect(encodeShare(sphere())).rejects.toMatchObject({ name: "ShareDecodeError", code: "unsupported" });
  });
});
