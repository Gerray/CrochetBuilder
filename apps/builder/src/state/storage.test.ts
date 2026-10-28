// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDocument, emptyDocument } from "./document.js";
import { MAX_PART_QUANTITY, MAX_PARTS } from "./editor.js";
import { BACKUP_KEY, LS_KEY, PART_KEY, loadShownPart, loadState, resetStorageConnection, saveShownPart, saveState } from "./storage.js";

const realIndexedDB = globalThis.indexedDB;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStorageConnection();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  globalThis.indexedDB = realIndexedDB;
});

const lsRecord = () => JSON.parse(localStorage.getItem(LS_KEY) ?? "null") as { doc: { title: string }; savedAt: number } | null;

describe("storage — IndexedDB", () => {
  it("round-trips a document through IndexedDB", async () => {
    const doc = demoDocument();
    await saveState({ doc, pinned: ["x"] });
    localStorage.clear(); // only the IndexedDB copy remains
    const result = await loadState();
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.state.doc).toEqual(doc);
      expect(result.state.pinned).toEqual(["x"]);
    }
  });

  it("returns empty when nothing is stored", async () => {
    expect(await loadState()).toEqual({ kind: "empty" });
  });

  it("writes a localStorage copy synchronously (survives the tab closing)", () => {
    void saveState({ doc: { ...emptyDocument("a"), title: "Sofort" }, pinned: [] });
    expect(lsRecord()?.doc.title).toBe("Sofort");
  });
});

describe("storage — ordering and fallback", () => {
  it("prefers the newer copy: localStorage after a failed IndexedDB write", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1000);
    await saveState({ doc: { ...emptyDocument("a"), title: "alt" }, pinned: [] });

    vi.setSystemTime(2000);
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new Error("quota");
    });
    await saveState({ doc: { ...emptyDocument("a"), title: "neu" }, pinned: [] });
    put.mockRestore();

    const result = await loadState();
    expect(result.kind === "ok" && result.state.doc.title).toBe("neu");
  });

  it("prefers the newer copy: IndexedDB when localStorage is older", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1000);
    await saveState({ doc: { ...emptyDocument("a"), title: "alt" }, pinned: [] });
    const older = localStorage.getItem(LS_KEY)!;
    vi.setSystemTime(2000);
    await saveState({ doc: { ...emptyDocument("a"), title: "neu" }, pinned: [] });
    localStorage.setItem(LS_KEY, older);

    const result = await loadState();
    expect(result.kind === "ok" && result.state.doc.title).toBe("neu");
  });

  it("falls back to localStorage without IndexedDB", async () => {
    // @ts-expect-error — simulate a browser without IndexedDB
    globalThis.indexedDB = undefined;
    resetStorageConnection();
    await saveState({ doc: { ...emptyDocument("a"), title: "nur LS" }, pinned: [] });
    const result = await loadState();
    expect(result.kind === "ok" && result.state.doc.title).toBe("nur LS");
  });
});

describe("storage — unreadable values", () => {
  it("reports a schema-foreign document as invalid and backs it up", async () => {
    const doc = demoDocument() as unknown as { parts: Array<{ content: { rows: Array<Record<string, unknown>> } }> };
    doc.parts[0]!.content.rows[0]!.farbe = "rot"; // field from a newer/foreign format
    const raw = { doc, pinned: [], savedAt: 5 };
    localStorage.setItem(LS_KEY, JSON.stringify(raw));

    const result = await loadState();
    expect(result).toEqual({ kind: "invalid", raw });
    expect(JSON.parse(localStorage.getItem(BACKUP_KEY)!).raw).toEqual(raw);
    expect(JSON.parse(localStorage.getItem(LS_KEY)!)).toEqual(raw); // untouched
  });

  it("treats documents over the limits as invalid", async () => {
    const doc = demoDocument();
    doc.parts[0]!.content.rows[0]!.ops = [{ kind: "repeat", times: 1000, ops: [{ kind: "stitch", code: "SC", count: 1 }] }];
    localStorage.setItem(LS_KEY, JSON.stringify({ doc, pinned: [] }));
    expect((await loadState()).kind).toBe("invalid");
  });
});

describe("storage — several parts", () => {
  it("round-trips all parts", async () => {
    const doc = demoDocument(undefined, "bunny");
    await saveState({ doc, pinned: [] });
    localStorage.clear(); // only the IndexedDB copy remains
    const result = await loadState();
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.state.doc).toEqual(doc);
      expect(result.state.doc.parts).toHaveLength(5);
    }
  });

  it("loads a save of the one-part builder unchanged", async () => {
    const doc = demoDocument();
    const old = { doc, pinned: [doc.parts[0]!.content.rows[0]!.id], savedAt: 7 };
    localStorage.setItem(LS_KEY, JSON.stringify(old));
    expect(await loadState()).toEqual({ kind: "ok", state: old });
  });

  it("keeps the shown part under its own key; anything odd reads as the first part", () => {
    expect(loadShownPart()).toBe(0);
    saveShownPart(3);
    expect(localStorage.getItem(PART_KEY)).toBe("3");
    expect(loadShownPart()).toBe(3);
    for (const raw of ["-2", "1.5", '"2"', "kaputt"]) {
      localStorage.setItem(PART_KEY, raw);
      expect(loadShownPart(), raw).toBe(0);
    }
    // The document copy is not touched by it.
    expect(localStorage.getItem(LS_KEY)).toBeNull();
  });

  it("refuses documents without parts, with too many parts or too high a quantity", async () => {
    const tooMany = { ...emptyDocument("a"), parts: Array.from({ length: MAX_PARTS + 1 }, () => emptyDocument("b").parts[0]!) };
    const tooOften = emptyDocument("c");
    tooOften.parts[0]!.quantity = MAX_PART_QUANTITY + 1;
    for (const doc of [{ ...emptyDocument("a"), parts: [] }, tooMany, tooOften]) {
      localStorage.setItem(LS_KEY, JSON.stringify({ doc, pinned: [], savedAt: 1 }));
      expect((await loadState()).kind).toBe("invalid");
    }
    const atLimit = emptyDocument("d");
    atLimit.parts[0]!.quantity = MAX_PART_QUANTITY;
    localStorage.setItem(LS_KEY, JSON.stringify({ doc: atLimit, pinned: [], savedAt: 2 }));
    expect((await loadState()).kind).toBe("ok");
  });
});
