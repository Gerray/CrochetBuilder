/**
 * Opening a pattern from outside: a JSON file ("JSON öffnen…") or a share link (`#data=`).
 * Accepts a `BuilderExport` or a bare `PartContent`, validates it and checks the editor's
 * limits; every refusal comes with a German message for the person.
 */

import {
  BuilderExportSchema,
  exceedsJsonDepth,
  MAX_STITCH_COUNT_TARGET,
  opsWithinLimits,
  PartContentSchema,
  ShareDecodeError,
  type BuilderExport,
  type PartContent,
} from "@crochetbuilder/engine";
import { newId, type BuilderDoc } from "../state/document.js";
import { MAX_PART_QUANTITY, MAX_PARTS } from "../state/editor.js";

/** Files above this size are not read at all (bytes). */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

export type ImportResult =
  | {
      ok: true;
      doc: BuilderDoc;
      /** Row ids whose Soll is author-declared (all imported rows). */
      pinned: string[];
      /** Something the person should know about the opened document (German), if anything. */
      notice?: string;
    }
  | { ok: false; message: string };

const TOO_DEEP_MESSAGE = "Die Anleitung in der Datei ist zu tief verschachtelt (zu viele Wiederholungen ineinander).";

/** Where the first schema problem sits: ` (bei „parts.0.content.rows.3.ops“)` — or nothing. */
function issueText(issue: { path: ReadonlyArray<PropertyKey> } | undefined): string {
  if (!issue || issue.path.length === 0) return "";
  return ` (bei „${issue.path.map(String).join(".")}“)`;
}

function hasKey(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && key in value;
}

function withinLimits(content: PartContent): boolean {
  return content.rows.every((row) => opsWithinLimits(row.ops) && row.stitchCountTarget <= MAX_STITCH_COUNT_TARGET);
}

/**
 * Give every row a unique id: the editor relies on it, the schema does not enforce it.
 * Unique ids are kept as they are (they are stable identities).
 */
function uniqueRowIds(doc: BuilderDoc, makeId: () => string): BuilderDoc {
  const seen = new Set<string>();
  let changed = false;
  const parts = doc.parts.map((part) => {
    const rows = part.content.rows.map((row) => {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        return row;
      }
      changed = true;
      let id = makeId();
      while (seen.has(id)) id = makeId();
      seen.add(id);
      return { ...row, id };
    });
    return { ...part, content: { ...part.content, rows } };
  });
  return changed ? { ...doc, parts } : doc;
}

/**
 * A validated export as an editor document: `rendered` is dropped (it is regenerated on
 * every export), duplicate row ids are replaced, the editor limits are checked.
 */
export function documentFromExport(exp: BuilderExport, makeId: () => string = newId): ImportResult {
  if (exp.parts.length === 0) return { ok: false, message: "Die Anleitung enthält keine Teile." };
  if (exp.parts.length > MAX_PARTS) {
    return {
      ok: false,
      message: `Die Anleitung hat ${exp.parts.length} Teile – der Builder bearbeitet höchstens ${MAX_PARTS}.`,
    };
  }
  const many = exp.parts.findIndex((p) => p.quantity > MAX_PART_QUANTITY);
  if (many >= 0) {
    const part = exp.parts[many]!;
    return {
      ok: false,
      message: `„${part.name.trim() || `Teil ${many + 1}`}“ soll ${part.quantity}-mal gehäkelt werden – der Builder erlaubt höchstens ${MAX_PART_QUANTITY}.`,
    };
  }
  if (!exp.parts.every((p) => withinLimits(p.content))) {
    return {
      ok: false,
      message: "Die Anleitung ist zu groß für den Builder (Anzahl über 999 oder mehr als 10.000 Maschen in einer Reihe).",
    };
  }
  const { rendered: _rendered, ...rest } = exp;
  const doc = uniqueRowIds(rest, makeId);
  const pinned = doc.parts.flatMap((p) => p.content.rows.map((r) => r.id));
  return { ok: true, doc, pinned };
}

/** A bare part content becomes a one-part document (title from the file name). */
function documentFromPart(content: PartContent, title: string, makeId: () => string): ImportResult {
  return documentFromExport(
    { schemaVersion: 1, title, overview: {}, parts: [{ name: "Teil 1", quantity: 1, content }] },
    makeId,
  );
}

/** Title from a file name: "amigurumi-kugel.json" → "amigurumi-kugel". */
export function titleFromFileName(fileName: string | undefined): string {
  return (fileName ?? "").replace(/\.[^.]*$/, "").trim();
}

/** Schema validation that never throws (a stack overflow becomes `null`). */
function safely<T>(validate: () => T): T | null {
  try {
    return validate();
  } catch {
    return null;
  }
}

/** Parse the text of an imported file; never throws. */
export function parseImportText(text: string, fileName?: string, makeId: () => string = newId): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, message: "Die Datei ist kein lesbares JSON." };
  }
  // Schema validation recurses per nesting level; absurd nesting must not overflow the stack.
  if (exceedsJsonDepth(text)) return { ok: false, message: TOO_DEEP_MESSAGE };

  if (hasKey(data, "parts")) {
    const version = (data as { schemaVersion?: unknown }).schemaVersion;
    if (version !== 1 && version !== 2) {
      return { ok: false, message: `Die Datei hat ein unbekanntes Format (schemaVersion ${JSON.stringify(version ?? null)}).` };
    }
    const parsed = safely(() => BuilderExportSchema.safeParse(data));
    if (!parsed) return { ok: false, message: TOO_DEEP_MESSAGE };
    if (!parsed.success) {
      return { ok: false, message: `Die Anleitung in der Datei ist fehlerhaft${issueText(parsed.error.issues[0])}.` };
    }
    return documentFromExport(parsed.data, makeId);
  }

  if (hasKey(data, "rows")) {
    const parsed = safely(() => PartContentSchema.safeParse(data));
    if (!parsed) return { ok: false, message: TOO_DEEP_MESSAGE };
    if (!parsed.success) {
      return { ok: false, message: `Die Reihen in der Datei sind fehlerhaft${issueText(parsed.error.issues[0])}.` };
    }
    return documentFromPart(parsed.data, titleFromFileName(fileName), makeId);
  }

  return {
    ok: false,
    message: "Die Datei enthält keine CrochetBuilder-Anleitung (erwartet: Builder-Export oder Reihen eines Teils).",
  };
}

/** Read and parse a file chosen in "JSON öffnen…". */
export async function importFile(file: File, makeId: () => string = newId): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_FILE_BYTES) return { ok: false, message: "Die Datei ist zu groß (höchstens 5 MB)." };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, message: "Die Datei konnte nicht gelesen werden." };
  }
  return parseImportText(text, file.name, makeId);
}

/** Shown when the browser has no `DecompressionStream` / `CompressionStream` with "deflate-raw". */
export const UNSUPPORTED_BROWSER_MESSAGE =
  "Dein Browser ist zu alt für Teilen-Links – aktualisiere ihn oder öffne den Link in einem aktuellen Browser.";

/** German message for a share link that could not be decoded. */
export function shareErrorMessage(err: unknown): string {
  if (err instanceof ShareDecodeError) {
    switch (err.code) {
      case "malformed":
        return "Der Link ist beschädigt oder unvollständig – vielleicht wurde er beim Kopieren abgeschnitten.";
      case "too-large":
        return "Die Anleitung im Link ist zu groß.";
      case "invalid":
        return "Der Link enthält keine gültige Anleitung.";
      case "unsupported":
        return UNSUPPORTED_BROWSER_MESSAGE;
    }
  }
  return "Der Link konnte nicht gelesen werden.";
}
