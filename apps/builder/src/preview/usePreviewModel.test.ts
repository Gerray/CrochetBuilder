import { describe, expect, it } from "vitest";
import type { PreviewModel } from "./protocol.js";
import { applyResult, INITIAL_PREVIEW, type PreviewState } from "./usePreviewModel.js";

const model = { rowIds: ["a"] } as unknown as PreviewModel;
const withModel: PreviewState = { status: "model", model, computing: true };

describe("applyResult", () => {
  it("shows a new model and ends computing", () => {
    expect(applyResult(INITIAL_PREVIEW, { id: 1, kind: "model", model })).toEqual({
      status: "model",
      model,
      computing: false,
    });
  });

  it("keeps computing while a newer request is still on its way", () => {
    expect(applyResult(INITIAL_PREVIEW, { id: 1, kind: "model", model }, true).computing).toBe(true);
  });

  it("clears the model for an empty pattern", () => {
    expect(applyResult(withModel, { id: 2, kind: "empty" })).toEqual({ status: "empty", model: null, computing: false });
  });

  it("keeps the last model when over the budget or after an error", () => {
    const over = applyResult(withModel, { id: 2, kind: "overBudget", stitchCount: 30000, maxStitches: 20000 });
    expect(over).toEqual({
      status: "overBudget",
      model,
      computing: false,
      overBudget: { stitchCount: 30000, maxStitches: 20000 },
    });
    const failed = applyResult(withModel, { id: 3, kind: "error", message: "x" });
    expect(failed).toEqual({ status: "error", model, computing: false, error: "x" });
    // A model after that replaces the stale state completely.
    expect(applyResult(over, { id: 4, kind: "model", model })).toEqual({ status: "model", model, computing: false });
  });
});
