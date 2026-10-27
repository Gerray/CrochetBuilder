/**
 * Share payloads — a `BuilderExport` packed into a URL fragment, so share links, embeds and
 * "open in TellmeCrochet" work without any server (the fragment never leaves the browser).
 *
 *   payload = "v1." + base64url(deflate-raw(UTF-8(JSON)))
 *
 * Compression uses the standard `CompressionStream` / `DecompressionStream` (browsers and
 * Node ≥ 18), so the engine stays free of extra dependencies. Decoding is defensive: the
 * input is bounded before and after decompression (no zip bombs) and the result is
 * validated against `BuilderExportSchema`.
 */

import { BuilderExportSchema, type BuilderExport } from "./export.js";

/** Version prefix of the current payload format. */
export const SHARE_VERSION = "v1";

/** Upper bound of the decompressed JSON (bytes). Larger payloads are refused. */
export const MAX_SHARE_JSON_BYTES = 2 * 1024 * 1024;

/**
 * Upper bound of an encoded payload (characters). Deflate never grows JSON by more than a
 * few bytes per 64 KiB block, and base64 adds a third, so anything longer cannot decode to
 * an allowed payload and is refused before decompressing.
 */
export const MAX_SHARE_CHARS = Math.ceil(((MAX_SHARE_JSON_BYTES + 1024) * 4) / 3) + SHARE_VERSION.length + 1;

/** Where TellmeCrochet imports a builder export (its fragment carries the payload). */
export const TMC_IMPORT_URL = "https://tellmecrochet.de/import";

export type ShareDecodeErrorCode =
  /** Not a payload of this format: wrong prefix, bad characters, broken compression or JSON. */
  | "malformed"
  /** Larger than the limits (encoded or decompressed). */
  | "too-large"
  /** Readable JSON, but not a valid `BuilderExport`. */
  | "invalid";

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
// Streams
// ---------------------------------------------------------------------------

type ByteTransform = { writable: WritableStream<BufferSource>; readable: ReadableStream<Uint8Array> };

/**
 * Push `input` through a (de)compression stream and collect the output. With `limit`, reading
 * stops as soon as the output exceeds it (`TooLarge` is thrown) — the rest is never inflated.
 */
async function transform(input: Uint8Array<ArrayBuffer>, stream: ByteTransform, limit = Infinity): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Errors of the write side show up on the read side too; never leave this one unhandled.
  const writing = writer
    .write(input)
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge();
    }
    chunks.push(value);
  }
  await writing;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

class TooLarge extends Error {}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Pack a builder export into a share payload (`v1.` + base64url). The export is validated
 * first, so every payload this produces decodes again. Throws for an invalid export or one
 * larger than `MAX_SHARE_JSON_BYTES`.
 */
export async function encodeShare(exp: BuilderExport): Promise<string> {
  const valid = BuilderExportSchema.parse(exp);
  const json = new TextEncoder().encode(JSON.stringify(valid));
  if (json.byteLength > MAX_SHARE_JSON_BYTES) {
    throw new RangeError(`Export is larger than ${MAX_SHARE_JSON_BYTES} bytes.`);
  }
  const packed = await transform(json, new CompressionStream("deflate-raw"));
  return `${SHARE_VERSION}.${toBase64Url(packed)}`;
}

/**
 * Unpack and validate a share payload. Throws `ShareDecodeError` (`malformed`, `too-large`
 * or `invalid`) — never anything else.
 */
export async function decodeShare(payload: string): Promise<BuilderExport> {
  if (typeof payload !== "string") throw new ShareDecodeError("malformed", "Payload is not a string.");
  const text = payload.trim();
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
    json = await transform(packed, new DecompressionStream("deflate-raw"), MAX_SHARE_JSON_BYTES);
  } catch (err) {
    if (err instanceof TooLarge) throw new ShareDecodeError("too-large", "Decompressed payload is too large.");
    throw new ShareDecodeError("malformed", "Payload cannot be decompressed.", { cause: err });
  }

  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch (err) {
    throw new ShareDecodeError("malformed", "Payload is not JSON.", { cause: err });
  }
  const parsed = BuilderExportSchema.safeParse(data);
  if (!parsed.success) {
    throw new ShareDecodeError("invalid", "Payload is not a valid builder export.", { cause: parsed.error });
  }
  return parsed.data;
}

/** The payload of a `#data=…` URL fragment (with or without `#`), or null. */
export function readShareFragment(hash: string): string | null {
  const match = /(?:^#?|&)data=([^&]*)/.exec(hash);
  if (!match) return null;
  let value = match[1]!;
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep it raw; decodeShare reports it as malformed
  }
  return value || null;
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
