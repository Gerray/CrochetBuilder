import { useState, type Dispatch } from "react";
import {
  MAX_YARN_DIAMETER_MM,
  YARN_WEIGHT_DEFAULTS,
  YarnWeightSchema,
  type Gauge,
  type YarnWeight,
} from "@crochetbuilder/engine";
import { flatCircleHint, num, sizeBasisText, yarnWeightOption } from "../export/labels.js";
import type { EditorAction } from "../state/editor.js";
import { NumberField } from "./fields.js";

/**
 * Size basis in the top bar: either yarn (weight class, thickness in mm) and hook, or a
 * swatch. The thickness in mm is independent of the weight select — choosing a weight never
 * overwrites it; the weight's typical thickness only shows as placeholder.
 */
export function GaugeEditor({ gauge = {}, dispatch }: { gauge: Gauge | undefined; dispatch: Dispatch<EditorAction> }) {
  const hasSwatch = gauge.stitchesPer10cm !== undefined || gauge.rowsPer10cm !== undefined;
  const [mode, setMode] = useState<"yarn" | "swatch">(hasSwatch ? "swatch" : "yarn");
  const effective = hasSwatch ? "swatch" : mode;
  const set = (patch: Partial<Gauge>) => dispatch({ type: "setGauge", gauge: { ...gauge, ...patch } });
  const typicalMm = YARN_WEIGHT_DEFAULTS[gauge.yarnWeight ?? "dk"].yarnDiameterMm;
  const flat = hasSwatch ? flatCircleHint(gauge) : null;

  return (
    <div className="gauge" role="group" aria-label="Größe">
      <div className="segmented" role="radiogroup" aria-label="Größenangabe">
        <button
          type="button"
          role="radio"
          aria-checked={effective === "yarn"}
          onClick={() => {
            setMode("yarn");
            if (hasSwatch) set({ stitchesPer10cm: undefined, rowsPer10cm: undefined });
          }}
        >
          Garn & Nadel
        </button>
        <button type="button" role="radio" aria-checked={effective === "swatch"} onClick={() => setMode("swatch")}>
          Maschenprobe
        </button>
      </div>
      {effective === "yarn" ? (
        <>
          <label className="inline-field">
            <span>Garn</span>
            <select
              value={gauge.yarnWeight ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                set({ yarnWeight: YarnWeightSchema.safeParse(value).success ? (value as YarnWeight) : undefined });
              }}
            >
              <option value="">– Garnstärke –</option>
              {YarnWeightSchema.options.map((weight) => (
                <option key={weight} value={weight}>
                  {yarnWeightOption(weight)}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            <span>Garndicke</span>
            <NumberField
              className="narrow"
              aria-label="Garndicke in mm"
              decimal
              allowEmpty
              min={0.1}
              max={MAX_YARN_DIAMETER_MM}
              step={0.1}
              value={gauge.yarnDiameterMm}
              onValue={(yarnDiameterMm) => set({ yarnDiameterMm })}
              placeholder={num(typicalMm)}
            />
            <span className="unit">mm</span>
          </label>
          <label className="inline-field">
            <span>Nadel</span>
            <NumberField
              className="narrow"
              decimal
              allowEmpty
              min={0.5}
              step={0.25}
              value={gauge.hookMm}
              onValue={(hookMm) => set({ hookMm })}
              placeholder="4"
            />
            <span className="unit">mm</span>
          </label>
          <span className="gauge-hint" aria-live="polite">
            {sizeBasisText(gauge)}
          </span>
        </>
      ) : (
        <>
          <label className="inline-field">
            <span>Maschen</span>
            <NumberField
              className="narrow"
              decimal
              allowEmpty
              min={1}
              value={gauge.stitchesPer10cm}
              onValue={(stitchesPer10cm) => set({ stitchesPer10cm })}
              placeholder="20"
            />
          </label>
          <label className="inline-field">
            <span>Reihen</span>
            <NumberField
              className="narrow"
              decimal
              allowEmpty
              min={1}
              value={gauge.rowsPer10cm}
              onValue={(rowsPer10cm) => set({ rowsPer10cm })}
              placeholder="24"
            />
          </label>
          <span className="unit">pro 10 cm</span>
          {flat && (
            <span className="gauge-hint" aria-live="polite" title={flat.exact}>
              {flat.text}
            </span>
          )}
        </>
      )}
    </div>
  );
}
