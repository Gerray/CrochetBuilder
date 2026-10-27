// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { useReducer } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { resolveGauge, type Gauge } from "@crochetbuilder/engine";
import { emptyDocument } from "../state/document.js";
import { editorReducer, initEditorState } from "../state/editor.js";
import { GaugeEditor } from "./GaugeEditor.js";

let latest: Gauge | undefined;

function Harness({ gauge }: { gauge?: Gauge }) {
  const doc = emptyDocument("r1");
  const [state, dispatch] = useReducer(
    editorReducer,
    initEditorState(gauge ? { ...doc, overview: { ...doc.overview, gauge } } : doc),
  );
  latest = state.doc.overview.gauge;
  return <GaugeEditor gauge={state.doc.overview.gauge} dispatch={dispatch} />;
}

const mmField = () => screen.getByLabelText("Garndicke in mm") as HTMLInputElement;
const weightSelect = () => screen.getByLabelText("Garn") as HTMLSelectElement;
const hookField = () => screen.getByLabelText(/Nadel/) as HTMLInputElement;

afterEach(() => {
  cleanup();
  latest = undefined;
});

describe("GaugeEditor: Garndicke", () => {
  it("offers the weights with their typical thickness", () => {
    render(<Harness />);
    const labels = Array.from(weightSelect().options).map((o) => o.textContent);
    expect(labels).toContain("DK (leicht) · ca. 2,5 mm");
    expect(labels).toContain("Bulky (dick) · ca. 5 mm");
    expect(mmField().placeholder).toBe("2,5");
  });

  it("accepts a decimal comma or dot and shows what drives the size", () => {
    render(<Harness />);
    fireEvent.change(hookField(), { target: { value: "3" } });
    fireEvent.change(mmField(), { target: { value: "2,5" } });
    expect(latest).toEqual({ hookMm: 3, yarnDiameterMm: 2.5 });
    expect(screen.getByText("Größe aus Garndicke 2,5 mm und Nadel 3 mm geschätzt")).toBeTruthy();

    fireEvent.change(mmField(), { target: { value: "1.75" } });
    expect(latest?.yarnDiameterMm).toBe(1.75);
    fireEvent.blur(mmField());
    expect(mmField().value).toBe("1,75");
  });

  it("does not overwrite a typed thickness when a weight is chosen", () => {
    render(<Harness gauge={{ yarnDiameterMm: 2, hookMm: 3 }} />);
    fireEvent.change(weightSelect(), { target: { value: "bulky" } });
    expect(latest).toEqual({ yarnDiameterMm: 2, hookMm: 3, yarnWeight: "bulky" });
    expect(mmField().value).toBe("2");
    expect(screen.getByText(/Garndicke hat Vorrang vor der Garnstärke/)).toBeTruthy();
    // The size still follows the 2 mm, not bulky.
    expect(resolveGauge(latest).stitchWidthMm).toBeCloseTo(resolveGauge({ yarnDiameterMm: 2, hookMm: 3 }).stitchWidthMm);
  });

  it("marks invalid entries and keeps them out of the document; empty clears", () => {
    render(<Harness gauge={{ yarnDiameterMm: 2.5 }} />);
    fireEvent.change(mmField(), { target: { value: "45" } });
    expect(mmField().getAttribute("aria-invalid")).toBe("true");
    expect(latest).toEqual({ yarnDiameterMm: 2.5 });

    fireEvent.change(mmField(), { target: { value: "0" } });
    expect(mmField().getAttribute("aria-invalid")).toBe("true");
    expect(latest).toEqual({ yarnDiameterMm: 2.5 });

    fireEvent.change(mmField(), { target: { value: "abc" } });
    expect(mmField().getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(mmField(), { target: { value: "" } });
    expect(latest).toBeUndefined();
    expect(screen.getByText("Größe aus Standardwerten (DK, 4 mm) geschätzt")).toBeTruthy();
  });

  it("shows the selected weight's typical thickness as placeholder", () => {
    render(<Harness gauge={{ yarnWeight: "worsted" }} />);
    expect(mmField().value).toBe("");
    expect(mmField().placeholder).toBe("3");
    expect(screen.getByText("Größe aus Garn Worsted (mittel) geschätzt")).toBeTruthy();
  });
});
