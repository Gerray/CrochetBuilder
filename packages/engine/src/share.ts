/**
 * Share payloads — a `BuilderExport` packed into a URL fragment, so share links, embeds and
 * "open in TellmeCrochet" work without any server (the fragment never leaves the browser).
 *
 *   payload = "v1." + base64url(deflate-raw(UTF-8(JSON)))
 *
 * Compression uses the standard `CompressionStream` / `DecompressionStream` (browsers and
 * Node ≥ 18), so the engine stays free of extra dependencies. Decoding is defensive: the
 * input is bounded before and while decompressing (no zip bombs), the JSON nesting depth is
 * bounded, and the result is validated against `BuilderExportSchema`. The format is
 * documented in `docs/FORMAT.md` ("Share links").
 */

import { BuilderExportSchema, type BuilderExport } from "./export.js";

/** Version prefix of the current payload format. */
export const SHARE_VERSION = "v1";

/** Upper bound of the decompressed JSON (bytes). Larger payloads are refused. */
export const MAX_SHARE_JSON_BYTES = 2 * 1024 * 1024;

/**
 * Upper bound of an encoded payload (characters), checked before anything is decoded.
 * 256 Ki characters (≈ 192 KiB deflated) is far beyond any real pattern — a 200-row pattern
 * packs into a few KiB — and well inside what browsers keep in an address bar. `encodeShare`
 * refuses exports that would exceed it, so every payload it produces also decodes.
 */
export const MAX_SHARE_CHARS = 256 * 1024;

/**
 * Upper bound of the JSON nesting depth (objects and arrays) of a payload or import. Every
 * repeat group adds two levels; 200 allows about 95 nested repeats — real patterns use 1–3.
 * Deeper documents are refused before schema validation (which recurses per level).
 */
export const MAX_JSON_DEPTH = 200;

/** Where TellmeCrochet imports a builder export (its fragment carries the payload). */
export const TMC_IMPORT_URL = "https://tellmecrochet.de/import";

export type ShareDecodeErrorCode =
  /** Not a payload of this format: wrong prefix, bad characters, broken compression or JSON. */
  | "malformed"
  /** Larger than the limits (encoded or decompressed). */
  | "too-large"
  /** Readable JSON, but not a valid `BuilderExport` (or nested deeper than `MAX_JSON_DEPTH`). */
  | "invalid"
  /** This runtime has no `CompressionStream` / `DecompressionStream` with "deflate-raw". */
  | "unsupported";

export class ShareDecodeError extends Error {
  readonly code: ShareDecodeErrorCode;
  constructor(code: ShareDecodeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ShareDecodeError";
    this.code = code;
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

const BASE64URL = /^[A-Za-z0-9_-]*$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url without padding (`canonicalSharePayload` has removed it already). */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  // A base64 string never has length ≡ 1 (mod 4); atob would reject it anyway.
  if (!BASE64URL.test(text) || text.length % 4 === 1) {
    throw new ShareDecodeError("malformed", "Payload is not base64url.");
  }
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch (err) {
    throw new ShareDecodeError("malformed", "Payload is not base64url.", { cause: err });
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// JSON depth
// ---------------------------------------------------------------------------

/**
 * Whether `json` nests objects/arrays deeper than `max` — a linear scan of the text, without
 * parsing (strings are skipped, so brackets inside them do not count).
 */
export function exceedsJsonDepth(json: string, max: number = MAX_JSON_DEPTH): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i++; // backslash: skip the escaped character
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) {
      inString = true;
    } else if (c === 0x5b || c === 0x7b) {
      if (++depth > max) return true;
    } else if (c === 0x5d || c === 0x7d) {
      depth--;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

type ByteTransform = { writable: WritableStream<BufferSource>; readable: ReadableStream<Uint8Array> };
type StreamConstructor = new (format: "deflate-raw") => ByteTransform;

/**
 * Input is fed to the (de)compressor in slices of this size. Browsers inflate a written chunk
 * completely, whatever the reader's backpressure, so one big write of a zip bomb would
 * allocate its whole output before the limit check sees it. Deflate expands at most ~1032:1,
 * so a slice yields at most ~2 MiB before the next check.
 */
export const INFLATE_SLICE_BYTES = 2048;

/** A (de)compression stream for "deflate-raw", or `unsupported` when the runtime has none. */
function deflateStream(kind: "CompressionStream" | "DecompressionStream"): ByteTransform {
  const Ctor = (globalThis as unknown as Record<string, StreamConstructor | undefined>)[kind];
  if (typeof Ctor !== "function") throw new ShareDecodeError("unsupported", `${kind} is not available.`);
  try {
    return new Ctor("deflate-raw");
  } catch (err) {
    // Older browsers know the class, but not the "deflate-raw" format (TypeError).
    throw new ShareDecodeError("unsupported", `${kind} does not support "deflate-raw".`, { cause: err });
  }
}

class TooLarge extends Error {}

/**
 * Push `input` through a (de)compression stream in slices and collect the output. With
 * `limit`, the output is checked after every chunk; once it exceeds the limit no further
 * input is written, the stream is cancelled and `TooLarge` is thrown.
 */
async function transform(input: Uint8Array<ArrayBuffer>, stream: ByteTransform, limit = Infinity): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  let stopped = false;
  // Errors of the write side show up on the read side too; never leave this one unhandled.
  void (async () => {
    for (let at = 0; at < input.byteLength; at += INFLATE_SLICE_BYTES) {
      if (stopped) return;
      await writer.write(input.subarray(at, at + INFLATE_SLICE_BYTES));
    }
    if (!stopped) await writer.close();
  })().catch(() => undefined);

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        stopped = true;
        await reader.cancel().catch(() => undefined);
        throw new TooLarge();
      }
      chunks.push(value);
    }
  } finally {
    stopped = true;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function inflate(packed: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return transform(packed, deflateStream("DecompressionStream"), MAX_SHARE_JSON_BYTES);
}

/** Whether `packed` without its last byte still inflates — then it carries trailing junk. */
async function hasTrailingBytes(packed: Uint8Array<ArrayBuffer>): Promise<boolean> {
  // The last byte of a deflate stream always holds bits of its final block, so a complete
  // stream cut by one byte never inflates. Browsers reject trailing junk themselves, Node's
  // DecompressionStream ignores it; this check makes both behave the same.
  try {
    await inflate(packed.subarray(0, packed.byteLength - 1));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Pack a builder export into a share payload (`v1.` + base64url). The export is validated
 * first, so every payload this produces decodes again. Throws a `RangeError` for an export
 * beyond the limits (`MAX_SHARE_JSON_BYTES`, `MAX_JSON_DEPTH`, `MAX_SHARE_CHARS`), a
 * `ShareDecodeError` with code `unsupported` when the runtime cannot compress, and a schema
 * error for an invalid export.
 */
export async function encodeShare(exp: BuilderExport): Promise<string> {
  const valid = BuilderExportSchema.parse(exp);
  const text = JSON.stringify(valid);
  const json = new TextEncoder().encode(text);
  if (json.byteLength > MAX_SHARE_JSON_BYTES) {
    throw new RangeError(`Export is larger than ${MAX_SHARE_JSON_BYTES} bytes.`);
  }
  if (exceedsJsonDepth(text)) throw new RangeError(`Export is nested deeper than ${MAX_JSON_DEPTH} levels.`);
  const packed = await transform(json, deflateStream("CompressionStream"));
  const payload = `${SHARE_VERSION}.${toBase64Url(packed)}`;
  if (payload.length > MAX_SHARE_CHARS) {
    throw new RangeError(`Share payload is longer than ${MAX_SHARE_CHARS} characters.`);
  }
  return payload;
}

/**
 * The canonical form of a payload as found in a link: surrounding whitespace and base64
 * padding (`=`, optional per RFC 4648) removed. Decoders read this form; links built from a
 * received payload should carry it.
 */
export function canonicalSharePayload(payload: string): string {
  return payload.trim().replace(/={1,2}$/, "");
}

/**
 * Unpack and validate a share payload. Throws `ShareDecodeError` (`malformed`, `too-large`,
 * `invalid` or `unsupported`) — never anything else.
 */
export async function decodeShare(payload: string): Promise<BuilderExport> {
  if (typeof payload !== "string") throw new ShareDecodeError("malformed", "Payload is not a string.");
  const text = canonicalSharePayload(payload);
  if (text.length > MAX_SHARE_CHARS) throw new ShareDecodeError("too-large", "Payload is too large.");
  const dot = text.indexOf(".");
  const version = dot < 0 ? "" : text.slice(0, dot);
  if (version !== SHARE_VERSION) {
    throw new ShareDecodeError(
      "malformed",
      /^v\d+$/.test(version) ? `Unsupported payload version "${version}".` : "Missing payload version.",
    );
  }
  const packed = fromBase64Url(text.slice(dot + 1));
  if (packed.byteLength === 0) throw new ShareDecodeError("malformed", "Payload is empty.");

  let json: Uint8Array;
  try {
    json = await inflate(packed);
  } catch (err) {
    if (err instanceof ShareDecodeError) throw err;
    if (err instanceof TooLarge) throw new ShareDecodeError("too-large", "Decompressed payload is too large.");
    throw new ShareDecodeError("malformed", "Payload cannot be decompressed.", { cause: err });
  }
  if (await hasTrailingBytes(packed)) {
    throw new ShareDecodeError("malformed", "Payload has bytes after the end of the compressed data.");
  }

  let source: string;
  let data: unknown;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(json);
    data = JSON.parse(source);
  } catch (err) {
    throw new ShareDecodeError("malformed", "Payload is not JSON.", { cause: err });
  }
  if (exceedsJsonDepth(source)) {
    throw new ShareDecodeError("invalid", `Payload is nested deeper than ${MAX_JSON_DEPTH} levels.`);
  }
  let parsed: ReturnType<typeof BuilderExportSchema.safeParse>;
  try {
    parsed = BuilderExportSchema.safeParse(data);
  } catch (err) {
    // Defensive: validation must never escape as an untyped error (e.g. a stack overflow).
    throw new ShareDecodeError("invalid", "Payload cannot be validated.", { cause: err });
  }
  if (!parsed.success) {
    throw new ShareDecodeError("invalid", "Payload is not a valid builder export.", { cause: parsed.error });
  }
  return parsed.data;
}

/**
 * The payload of a `#data=…` URL fragment (with or without `#`), or null. The value is
 * URL-decoded and returned in canonical form (`canonicalSharePayload`), so it can be passed
 * on into other links as it is.
 */
export function readShareFragment(hash: string): string | null {
  const match = /(?:^#?|&)data=([^&]*)/.exec(hash);
  if (!match) return null;
  let value = match[1]!;
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep it raw; decodeShare reports it as malformed
  }
  return canonicalSharePayload(value) || null;
}

/** "Open in TellmeCrochet": `https://tellmecrochet.de/import#data=<payload>`. */
export function buildTmcImportUrl(payload: string): string {
  return `${TMC_IMPORT_URL}#data=${payload}`;
}

/**
 * Link to the viewer page at `baseUrl` showing `payload`; `embed` adds `?embed=1` (compact
 * layout for iframes). Query and fragment of `baseUrl` are replaced.
 */
export function buildViewerUrl(baseUrl: string | URL, payload: string, opts: { embed?: boolean } = {}): string {
  const url = new URL(baseUrl);
  url.search = opts.embed ? "?embed=1" : "";
  url.hash = "";
  return `${url.href}#data=${payload}`;
}
