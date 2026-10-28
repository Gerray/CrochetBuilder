import { describe, expect, it } from "vitest";
import { parseRowText, renderOps, validate, type Finding, type Row } from "@crochetbuilder/engine";
import { emptyDocument } from "./document.js";
import { currentPart, editorReducer, initEditorState, type EditorAction } from "./editor.js";
import { quickFixes, repeatPaths } from "./quickfix.js";

/** A part from [text, Soll] pairs (Soll defaults to the written count). */
function part(...lines: Array<[string, number?]>): Row[] {
  return lines.map(([text, target], i) => {
    const parsed = parseRowText(text, "de");
    if (!parsed.ok) throw new Error(`unreadable: ${text}`);
    return { id: `r${i}`, type: "round", ops: parsed.ops, stitchCountTarget: target ?? parsed.stitchCountTarget ?? 0 };
  });
}

/** Findings, without the missing anchor of the test parts' first row. */
function findingsOf(rows: Row[]): Finding[] {
  return validate({ schemaVersion: 1, rows }).filter((f) => f.code !== "NO_ANCHOR_ROW");
}

/** Apply a fix's action to the rows and return the fixed rows. */
function apply(rows: Row[], action: EditorAction): Row[] {
  const doc = emptyDocument("x");
  doc.parts[0]!.content.rows = rows;
  return currentPart(editorReducer(initEditorState(doc), action).doc).rows;
}

const text = (row: Row) => renderOps(row.ops, "de");

describe("quick fixes", () => {
  it("lists repeat paths, outermost first", () => {
    const [row] = part(["2× (1 fM, 3× (1 Zun)), 6 fM"]);
    expect(repeatPaths(row!.ops)).toEqual([[0], [0, 1]]);
  });

  it("stitch count mismatch: adopt the Ist, or the repeat count that makes the Soll", () => {
    const rows = part(["36 fM (36)"], ["6× (2 fM, 1 Abn)", 27]);
    const finding = findingsOf(rows).find((f) => f.code === "STITCH_COUNT_MISMATCH")!;
    const fixes = quickFixes(finding, rows);
    expect(fixes.map((f) => f.label)).toEqual(["Soll auf Ist setzen", "Wiederholung auf ×9 ändern"]);
    expect(fixes[0]!.action).toEqual({ type: "adoptTarget", rowId: "r1" });
    const fixed = apply(rows, fixes[1]!.action);
    expect(text(fixed[1]!)).toBe("9× (2 fM, 1 Abn)");
    expect(findingsOf(fixed)).toEqual([]);
  });

  it("offers no repeat count that would not consume the previous row", () => {
    // ×9 would make 27, but would work into 36 of 30 stitches.
    const rows = part(["30 fM (30)"], ["6× (2 fM, 1 Abn)", 27]);
    const finding = findingsOf(rows).find((f) => f.code === "STITCH_COUNT_MISMATCH")!;
    expect(quickFixes(finding, rows).map((f) => f.label)).toEqual(["Soll auf Ist setzen"]);
  });

  it("a first row (no previous row) only has to match the Soll", () => {
    const rows = part(["1 MR, 3× (2 fM)", 8]);
    const finding = findingsOf(rows).find((f) => f.code === "STITCH_COUNT_MISMATCH")!;
    expect(quickFixes(finding, rows).map((f) => f.label)).toEqual(["Soll auf Ist setzen", "Wiederholung auf ×4 ändern"]);
  });

  it("underflow: fill the rest with single crochets, or use every stitch by repeating", () => {
    const rows = part(["12 fM (12)"], ["5× (1 fM, 1 Zun)"]);
    const finding = findingsOf(rows).find((f) => f.code === "CONSUMES_UNDERFLOW")!;
    const fixes = quickFixes(finding, rows);
    expect(fixes.map((f) => f.label)).toEqual(["Rest mit 2 fM auffüllen", "Wiederholung auf ×6 ändern"]);
    expect(text(apply(rows, fixes[0]!.action)[1]!)).toBe("5× (1 fM, 1 Zun), 2 fM");
    expect(text(apply(rows, fixes[1]!.action)[1]!)).toBe("6× (1 fM, 1 Zun)");
    // A trailing plain fM grows instead of getting a neighbour.
    const plain = part(["12 fM (12)"], ["2 Zun, 8 fM"]);
    const fill = quickFixes(findingsOf(plain).find((f) => f.code === "CONSUMES_UNDERFLOW")!, plain)[0]!;
    expect(text(apply(plain, fill.action)[1]!)).toBe("2 Zun, 10 fM");
    // The Soll followed the Ist (it was automatic): no findings left.
    expect(findingsOf(apply(plain, fill.action))).toEqual([]);
  });

  it("overflow: the nearest repeat count that fits, else a shorter last stitch", () => {
    const over = part(["18 fM (18)"], ["7× (2 fM, 1 Zun)"]);
    const overFix = quickFixes(findingsOf(over).find((f) => f.code === "CONSUMES_OVERFLOW")!, over);
    expect(overFix.map((f) => f.label)).toEqual(["Wiederholung auf ×6 ändern"]);
    // Nearest fitting, not necessarily exact: 20 stitches take 6 × 3 = 18.
    const near = part(["20 fM (20)"], ["7× (2 fM, 1 Zun)"]);
    expect(quickFixes(findingsOf(near).find((f) => f.code === "CONSUMES_OVERFLOW")!, near).map((f) => f.label)).toEqual([
      "Wiederholung auf ×6 ändern",
    ]);
    const long = part(["36 fM (36)"], ["40 fM"]);
    const shorten = quickFixes(findingsOf(long).find((f) => f.code === "CONSUMES_OVERFLOW")!, long);
    expect(shorten.map((f) => f.label)).toEqual(["Auf 36 statt 40 kürzen"]);
    expect(findingsOf(apply(long, shorten[0]!.action))).toEqual([]);
    // Nothing sensible: an odd excess on decreases.
    const odd = part(["35 fM (35)"], ["18 Abn"]);
    expect(quickFixes(findingsOf(odd).find((f) => f.code === "CONSUMES_OVERFLOW")!, odd)).toEqual([]);
  });

  it("other findings and unknown rows have no fixes", () => {
    const rows = part(["6 fM"]);
    const noAnchor = validate({ schemaVersion: 1, rows }).find((f) => f.code === "NO_ANCHOR_ROW")!;
    expect(quickFixes(noAnchor, rows)).toEqual([]);
    expect(quickFixes({ ...noAnchor, rowId: "nope" }, rows)).toEqual([]);
  });
});
