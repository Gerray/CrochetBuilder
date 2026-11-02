import { describe, expect, it } from "vitest";
import { demoDocument, emptyDocument, type BuilderDoc } from "./document.js";
import { editorReducer, initEditorState, type EditorAction, type EditorState } from "./editor.js";
import type { UploadLink } from "./uploadLink.js";

function ids(prefix = "row") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const LINK: UploadLink = { builderKey: "key-1", lastUpload: { patternId: "p1", at: 1000, origin: "self_created" } };
const OTHER: UploadLink = { builderKey: "key-2", lastUpload: { patternId: "p2", at: 2000, origin: "imported" } };

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state);
const start = (doc: BuilderDoc = demoDocument(ids(), "ball"), link: UploadLink | null = LINK) => initEditorState(doc, [], 0, false, link);

describe("the document's project in the editor", () => {
  it("edits leave it alone; a loaded document brings its own", () => {
    const state = run(start(), { type: "setTitle", title: "Neu" }, { type: "setNotes", notes: "x" });
    expect(state.uploadLink).toEqual(LINK);
    const loaded = run(start(emptyDocument("a"), null), { type: "hydrate", doc: demoDocument(ids(), "ball"), uploadLink: OTHER });
    expect(loaded.uploadLink).toEqual(OTHER);
    expect(run(start(), { type: "hydrate", doc: demoDocument(ids(), "ball") }).uploadLink).toBeNull();
  });

  it("undo and redo of an edit do not touch it, not even across the upload itself", () => {
    const edited = run(start(demoDocument(ids(), "ball"), null), { type: "setTitle", title: "Eins" });
    const uploaded = run(edited, { type: "tmcUploaded", link: LINK });
    expect(uploaded.past).toHaveLength(edited.past.length);
    const undone = run(uploaded, { type: "undo" });
    expect(undone.doc.title).not.toBe("Eins");
    expect(undone.uploadLink).toEqual(LINK);
    expect(run(undone, { type: "redo" }).uploadLink).toEqual(LINK);
  });

  it.each<[string, EditorAction]>([
    ["„Neu“ and the demos", { type: "replaceDocument", doc: emptyDocument("n") }],
    ["an opened file or link", { type: "replaceDocument", doc: emptyDocument("n"), source: "foreign" }],
    ["a pasted pattern", { type: "replaceDocument", doc: emptyDocument("n"), source: "paste" }],
  ])("%s: no project until the next upload", (_name, action) => {
    expect(run(start(), action).uploadLink).toBeNull();
  });

  it("stepping back over a replaced document brings back the project of the document that returns", () => {
    const replaced = run(start(), { type: "replaceDocument", doc: emptyDocument("n") });
    const second = run(replaced, { type: "setTitle", title: "Zweite" }, { type: "tmcUploaded", link: OTHER });
    const back = run(second, { type: "undo" }, { type: "undo" });
    expect(back.doc.title).toBe("Amigurumi-Ball");
    expect(back.uploadLink).toEqual(LINK);
    const forward = run(back, { type: "redo" });
    expect(forward.doc.parts.map((p) => p.name)).toEqual(["Teil 1"]);
    // The second document's project: it got it after that step.
    expect(forward.uploadLink).toEqual(OTHER);
    expect(run(forward, { type: "redo" }).uploadLink).toEqual(OTHER);
  });

  it("forgetting clears it, without an undo step", () => {
    const state = run(start(), { type: "tmcForget" });
    expect(state.uploadLink).toBeNull();
    expect(state.past).toHaveLength(0);
  });

  it("a deleted project leaves the key for a new one, and the upload goes", () => {
    const state = run(start(), { type: "tmcForget", keepKey: true });
    expect(state.uploadLink).toEqual({ builderKey: "key-1", lastUpload: null });
    expect(state.past).toHaveLength(0);
    expect(run(start(demoDocument(ids(), "ball"), null), { type: "tmcForget", keepKey: true }).uploadLink).toBeNull();
  });
});

describe("part ids at the upload", () => {
  const two = () => {
    const doc = demoDocument(ids(), "ball");
    doc.parts.push({ ...doc.parts[0]!, name: "Ohr", content: { ...doc.parts[0]!.content, rows: [] } });
    return doc;
  };

  it("every part gets an id from its name, without an undo step; a part's id never changes again", () => {
    const uploaded = run(start(two(), null), { type: "tmcUploaded", link: LINK });
    expect(uploaded.doc.parts.map((p) => p.id)).toEqual(["ball", "ohr"]);
    expect(uploaded.past).toHaveLength(0);
    const renamed = run(uploaded, { type: "renamePart", index: 0, name: "Kugel" });
    expect(renamed.doc.parts[0]!.id).toBe("ball");
    const moved = run(renamed, { type: "movePart", index: 0, delta: 1 });
    expect(moved.doc.parts.map((p) => p.id)).toEqual(["ohr", "ball"]);
  });

  it("older states in the history get them too, so undo and a rename do not make a new part", () => {
    const edited = run(start(two(), null), { type: "setTitle", title: "Eins" }, { type: "setPartQuantity", index: 1, quantity: 2 });
    const undone = run(edited, { type: "tmcUploaded", link: LINK }, { type: "undo" }, { type: "undo" });
    expect(undone.doc.parts.map((p) => p.id)).toEqual(["ball", "ohr"]);
    expect(run(undone, { type: "redo" }, { type: "redo" }).doc.parts.map((p) => p.id)).toEqual(["ball", "ohr"]);
  });

  it("parts of the same name get the same ids in older states as well", () => {
    const doc = two();
    doc.parts[1]!.name = doc.parts[0]!.name;
    const edited = run(start(doc, null), { type: "setTitle", title: "Eins" });
    const uploaded = run(edited, { type: "tmcUploaded", link: LINK });
    expect(uploaded.doc.parts.map((p) => p.id)).toEqual(["ball", "ball-2"]);
    expect(run(uploaded, { type: "undo" }).doc.parts.map((p) => p.id)).toEqual(["ball", "ball-2"]);
  });

  it("parts that have an id keep it; history entries without any change stay as they are", () => {
    const doc = two();
    doc.parts[0]!.id = "eigene-id";
    doc.parts[1]!.id = "ohr";
    const edited = run(start(doc, null), { type: "setTitle", title: "Eins" });
    const uploaded = run(edited, { type: "tmcUploaded", link: LINK });
    expect(uploaded.doc).toBe(edited.doc);
    expect(uploaded.past[0]).toBe(edited.past[0]);
    expect(uploaded.doc.parts.map((p) => p.id)).toEqual(["eigene-id", "ohr"]);
  });
});
