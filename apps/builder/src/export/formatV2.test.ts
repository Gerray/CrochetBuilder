/**
 * Format v2 through the app: import a v2 file, export it as JSON and as a share link, and get
 * the same v2 content back; writers write version 2; duplicate row ids stay consistent with
 * the assembly.
 */
import { describe, expect, it } from "vitest";
import {
  BuilderExportSchema,
  CURRENT_SCHEMA_VERSION,
  decodeShare,
  validateExport,
  type BuilderExport,
  type PartContent,
} from "@crochetbuilder/engine";
import { demoDocument, emptyDocument } from "../state/document.js";
import { editorReducer, initEditorState } from "../state/editor.js";
import { documentFromExport, parseImportText } from "./import.js";
import { prepareExport } from "./prepare.js";
import { shareLinks } from "./share.js";

function ids(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const head: PartContent = {
  schemaVersion: 2,
  finish: "gather",
  stuffing: "firm",
  rows: [
    { id: "h1", type: "round", color: "white", ops: [{ kind: "stitch", code: "MR", count: 1 }, { kind: "stitch", code: "SC", count: 6 }], stitchCountTarget: 6 },
    { id: "h2", type: "round", ops: [{ kind: "repeat", times: 6, ops: [{ kind: "group", ops: [{ kind: "stitch", code: "SC", count: 2 }] }] }], stitchCountTarget: 12 },
    { id: "h3", type: "round", ops: [{ kind: "stitch", code: "SC", count: 6, color: "pink" }, { kind: "stitch", code: "BOBBLE", count: 1 }, { kind: "stitch", code: "SC", count: 5 }], stitchCountTarget: 12 },
    { id: "h4", type: "round", ops: [{ kind: "stitch", code: "DEC", count: 6 }], stitchCountTarget: 6 },
  ],
};
const ear: PartContent = {
  schemaVersion: 2,
  finish: "flat",
  stuffing: "none",
  rows: [
    { id: "e1", type: "round", ops: [{ kind: "stitch", code: "MR", count: 1 }, { kind: "stitch", code: "SC", count: 6 }], stitchCountTarget: 6 },
    { id: "e2", type: "round", ops: [{ kind: "stitch", code: "DC", count: 6, modifiers: ["FP"] }], stitchCountTarget: 6 },
  ],
};

const V2: BuilderExport = {
  schemaVersion: 2,
  title: "Hase",
  overview: {
    materials: [{ kind: "yarn", label: "Baumwolle", colors: ["Weiß", "Rosa"] }],
    colors: [
      { id: "white", name: "Weiß", hex: "#ffffff" },
      { id: "pink", name: "Rosa", hex: "#f2a7c0" },
    ],
  },
  parts: [
    { id: "head", name: "Kopf", quantity: 1, content: head },
    { id: "ear", name: "Ohr", quantity: 2, content: ear },
  ],
  assembly: [
    { id: "p1", kind: "attach", part: "ear", target: "head", row: "h3", angle: -40, note: "flach annähen" },
    { id: "p2", kind: "eyes", target: "head", row: "h2", angle: 0, spacing: 4, size: 6 },
  ],
};

/** The content of an export without the regenerated text view. */
const content = (exp: BuilderExport) => {
  const { rendered: _rendered, ...rest } = exp;
  return rest;
};

describe("format v2 in the app", () => {
  it("round-trips a v2 file: import → JSON export → share link, identical v2 content", async () => {
    const opened = parseImportText(JSON.stringify(V2), "hase.json");
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(validateExport(opened.doc)).toEqual([]);

    const exported = prepareExport(opened.doc);
    expect(content(exported)).toEqual(V2);
    expect(BuilderExportSchema.safeParse(exported).success).toBe(true);

    const links = await shareLinks(opened.doc, "https://example.test/builder/");
    const shared = await decodeShare(links.payload);
    expect(content(shared)).toEqual(V2);

    // And once more through the import: still the same.
    const reopened = parseImportText(JSON.stringify(exported));
    expect(reopened.ok && content(prepareExport(reopened.doc))).toEqual(V2);
  });

  it("writes version 2 on the export and every part, also for documents opened as version 1", () => {
    const v1 = {
      schemaVersion: 1,
      title: "Alt",
      overview: {},
      parts: [{ name: "Kugel", quantity: 1, content: { schemaVersion: 1, rows: head.rows.slice(3) } }],
    };
    const opened = parseImportText(JSON.stringify(v1));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const exp = prepareExport(opened.doc);
    expect(exp.schemaVersion).toBe(2);
    expect(exp.parts.map((p) => p.content.schemaVersion)).toEqual([2]);
    // A stale version-1 stamp in the editor state is overwritten on export.
    const stale = { ...demoDocument(ids()), schemaVersion: 1 as const };
    stale.parts = stale.parts.map((p) => ({ ...p, content: { ...p.content, schemaVersion: 1 as const } }));
    const fixed = prepareExport(stale);
    expect([fixed.schemaVersion, ...fixed.parts.map((p) => p.content.schemaVersion)]).toEqual([2, 2]);
  });

  it("creates new documents and parts in version 2", () => {
    const doc = emptyDocument("r");
    expect(doc.schemaVersion).toBe(2);
    expect(doc.parts[0]!.content.schemaVersion).toBe(2);
    expect(demoDocument(ids(), "bunny").parts.every((p) => p.content.schemaVersion === 2)).toBe(true);
    const state = editorReducer(initEditorState(doc), { type: "addPart", rowId: "new" });
    expect(state.doc.parts[1]!.content.schemaVersion).toBe(2);
  });

  it("refuses a file that says version 1 but uses version-2 features", () => {
    const bad = { ...V2, schemaVersion: 1 };
    const result = parseImportText(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it("keeps row ids unique across two identical parts and moves the placements with them", () => {
    const twin = structuredClone(V2.parts[0]!);
    const doubled: BuilderExport = {
      ...V2,
      // The second head has the same row ids; the placement on "head2" points at one of them.
      parts: [V2.parts[0]!, { ...twin, id: "head2", name: "Kopf 2" }, V2.parts[1]!],
      assembly: [...V2.assembly!, { id: "p3", kind: "embroidery", target: "head2", row: "h3", angle: 10 }],
    };
    const result = documentFromExport(doubled, ids("new"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const all = result.doc.parts.flatMap((p) => p.content.rows.map((r) => r.id));
    expect(new Set(all).size).toBe(all.length);
    // The first head keeps its ids; the twin's rows were renamed …
    expect(result.doc.parts[0]!.content.rows.map((r) => r.id)).toEqual(["h1", "h2", "h3", "h4"]);
    const twinRows = result.doc.parts[1]!.content.rows.map((r) => r.id);
    expect(twinRows.every((id) => id.startsWith("new-"))).toBe(true);
    // … and the placement on the twin follows its row, those on the first head stay.
    const byId = new Map(result.doc.assembly!.map((p) => [p.id, p]));
    expect(byId.get("p3")!.row).toBe(twinRows[2]);
    expect(byId.get("p1")!.row).toBe("h3");
    expect(byId.get("p2")!.row).toBe("h2");
    expect(validateExport(result.doc)).toEqual([]);
  });

  it("gives a duplicated part no id of its own, so placements keep their target", () => {
    const opened = documentFromExport(V2, ids());
    if (!opened.ok) throw new Error("import failed");
    const rowIds = opened.doc.parts[0]!.content.rows.map((_, i) => `copy-${i}`);
    const state = editorReducer(initEditorState(opened.doc), { type: "duplicatePart", index: 0, rowIds });
    expect(state.doc.parts).toHaveLength(3);
    expect(state.doc.parts[1]!.id).toBeUndefined();
    expect(validateExport(state.doc)).toEqual([]);
  });
});
