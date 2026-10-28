import { describe, it, expect } from "vitest";
import type { PartContent } from "./schema.js";
import {
  GaugeSchema,
  YARN_WEIGHT_DEFAULTS,
  YarnWeightSchema,
  STITCH_HEIGHT_FACTOR,
  MAX_YARN_DIAMETER_MM,
  resolveGauge,
  yarnDefaultsForDiameter,
  flatIncreasesPerRound,
} from "./gauge.js";
import { StitchCodeSchema } from "./schema.js";
import { BuilderExportSchema } from "./export.js";
import { buildModel } from "./model.js";

describe("GaugeSchema.yarnDiameterMm", () => {
  it("accepts positive thicknesses up to the maximum", () => {
    expect(GaugeSchema.safeParse({ yarnDiameterMm: 2.5 }).success).toBe(true);
    expect(GaugeSchema.safeParse({ yarnDiameterMm: 0.2 }).success).toBe(true);
    expect(GaugeSchema.safeParse({ yarnDiameterMm: MAX_YARN_DIAMETER_MM }).success).toBe(true);
    expect(
      GaugeSchema.safeParse({ yarnWeight: "dk", hookMm: 3, yarnDiameterMm: 2.5, stitchesPer10cm: 20 }).success,
    ).toBe(true);
  });

  it("rejects zero, negative, too thick and non-numeric values", () => {
    expect(GaugeSchema.safeParse({ yarnDiameterMm: 0 }).success).toBe(false);
    expect(GaugeSchema.safeParse({ yarnDiameterMm: -1 }).success).toBe(false);
    expect(GaugeSchema.safeParse({ yarnDiameterMm: MAX_YARN_DIAMETER_MM + 0.1 }).success).toBe(false);
    expect(GaugeSchema.safeParse({ yarnDiameterMm: Number.NaN }).success).toBe(false);
    expect(GaugeSchema.safeParse({ yarnDiameterMm: "2,5" }).success).toBe(false);
  });

  it("stays strict and travels in a builder export", () => {
    expect(GaugeSchema.safeParse({ yarnDiameterMm: 2.5, yarnDiameter: 2.5 }).success).toBe(false);
    const exp = {
      schemaVersion: 1,
      title: "Kugel",
      overview: { gauge: { yarnDiameterMm: 2.5, hookMm: 3 } },
      parts: [{ name: "Kugel", quantity: 1, content: { schemaVersion: 1, rows: [] } }],
    };
    const parsed = BuilderExportSchema.safeParse(exp);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.overview.gauge).toEqual({ yarnDiameterMm: 2.5, hookMm: 3 });
  });
});

describe("yarnDefaultsForDiameter", () => {
  const table = YarnWeightSchema.options.map((w) => YARN_WEIGHT_DEFAULTS[w]);

  it("is exact at every table thickness", () => {
    for (const d of table) {
      const r = yarnDefaultsForDiameter(d.yarnDiameterMm);
      expect(r.stitchWidthMm).toBeCloseTo(100 / d.stitchesPer10cm, 10);
      expect(r.stitchHeightMm).toBeCloseTo(100 / d.rowsPer10cm, 10);
      expect(r.hookMm).toBeCloseTo(d.hookMm, 10);
    }
  });

  it("interpolates linearly between neighbouring weights", () => {
    // Halfway between DK (2,5 mm) and worsted (3,0 mm).
    const r = yarnDefaultsForDiameter(2.75);
    expect(r.stitchWidthMm).toBeCloseTo((100 / 20 + 100 / 16) / 2, 10);
    expect(r.stitchHeightMm).toBeCloseTo((100 / 21 + 100 / 17) / 2, 10);
    expect(r.hookMm).toBeCloseTo(4.5, 10);
  });

  it("is monotonic and continuous over the whole range", () => {
    let prev = yarnDefaultsForDiameter(0.1);
    for (let d = 0.15; d <= 20; d += 0.05) {
      const r = yarnDefaultsForDiameter(d);
      expect(r.stitchWidthMm).toBeGreaterThanOrEqual(prev.stitchWidthMm);
      expect(r.stitchHeightMm).toBeGreaterThanOrEqual(prev.stitchHeightMm);
      expect(r.hookMm).toBeGreaterThanOrEqual(prev.hookMm);
      // No jumps: a 0,05 mm step never moves the width by more than half a millimetre.
      expect(r.stitchWidthMm - prev.stitchWidthMm).toBeLessThan(0.5);
      prev = r;
    }
  });

  it("keeps the E15 height/width ratio between the table's ratios", () => {
    const ratios = table.map((d) => d.stitchesPer10cm / d.rowsPer10cm);
    const [lo, hi] = [Math.min(...ratios), Math.max(...ratios)];
    for (let d = 0.5; d <= 12; d += 0.1) {
      const r = yarnDefaultsForDiameter(d);
      const ratio = r.stitchHeightMm / r.stitchWidthMm;
      expect(ratio).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(ratio).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it("extrapolates proportionally outside the table and clamps beyond that", () => {
    const lace = YARN_WEIGHT_DEFAULTS.lace;
    const jumbo = YARN_WEIGHT_DEFAULTS.jumbo;
    expect(yarnDefaultsForDiameter(0.75).stitchWidthMm).toBeCloseTo((100 / lace.stitchesPer10cm) * 0.75, 10);
    expect(yarnDefaultsForDiameter(10).stitchWidthMm).toBeCloseTo((100 / jumbo.stitchesPer10cm) * 1.25, 10);
    expect(yarnDefaultsForDiameter(0.1)).toEqual(yarnDefaultsForDiameter(0.5));
    expect(yarnDefaultsForDiameter(MAX_YARN_DIAMETER_MM)).toEqual(yarnDefaultsForDiameter(12));
    expect(yarnDefaultsForDiameter(12).hookMm).toBeCloseTo(jumbo.hookMm * 1.5, 10);
  });
});

describe("resolveGauge with yarnDiameterMm", () => {
  it("derives an estimated size from the thickness alone", () => {
    const g = resolveGauge({ yarnDiameterMm: 2.5 });
    expect(g.stitchWidthMm).toBeCloseTo(5, 10);
    expect(g.stitchHeightMm).toBeCloseTo(100 / 21, 10);
    expect(g.yarnDiameterMm).toBe(2.5);
    expect(g.estimated).toBe(true);
    expect(g.source).toBe("yarn-weight");
  });

  it("scales by the hook relative to the interpolated standard hook", () => {
    const at = (hookMm: number) => resolveGauge({ yarnDiameterMm: 2.75, hookMm }).stitchWidthMm;
    const standard = yarnDefaultsForDiameter(2.75);
    expect(at(standard.hookMm)).toBeCloseTo(standard.stitchWidthMm, 10);
    expect(at(3.6)).toBeCloseTo(standard.stitchWidthMm * (3.6 / 4.5), 10);
    expect(at(40) / standard.stitchWidthMm).toBeCloseTo(1.6, 10);
    expect(at(0.5) / standard.stitchWidthMm).toBeCloseTo(0.6, 10);
  });

  it("wins over the yarn weight for size and tube", () => {
    const both = resolveGauge({ yarnWeight: "bulky", yarnDiameterMm: 2.5, hookMm: 3 });
    const mmOnly = resolveGauge({ yarnDiameterMm: 2.5, hookMm: 3 });
    expect(both.stitchWidthMm).toBeCloseTo(mmOnly.stitchWidthMm, 10);
    expect(both.stitchHeightMm).toBeCloseTo(mmOnly.stitchHeightMm, 10);
    expect(both.yarnDiameterMm).toBe(2.5);
    expect(both.stitchWidthMm).toBeLessThan(resolveGauge({ yarnWeight: "bulky", hookMm: 3 }).stitchWidthMm);
  });

  it("loses to a swatch for size but still drives the tube", () => {
    const g = resolveGauge({ stitchesPer10cm: 25, rowsPer10cm: 20, yarnDiameterMm: 1.8, yarnWeight: "dk" });
    expect(g.stitchWidthMm).toBeCloseTo(4, 10);
    expect(g.stitchHeightMm).toBeCloseTo(5, 10);
    expect(g.yarnDiameterMm).toBe(1.8);
    expect(g.source).toBe("swatch");
    expect(g.estimated).toBe(false);
  });

  it("reaches the model: same size as the matching weight, smaller for thinner yarn", () => {
    const st = (code: "MR" | "SC" | "INC", count: number) => ({ kind: "stitch" as const, code, count });
    const disc: PartContent = {
      schemaVersion: 1,
      rows: [
        { id: "r1", type: "round", ops: [st("MR", 1), st("SC", 6)], stitchCountTarget: 6 },
        { id: "r2", type: "round", ops: [st("INC", 6)], stitchCountTarget: 12 },
        { id: "r3", type: "round", ops: [st("SC", 12)], stitchCountTarget: 12 },
      ],
    };
    const bulky = buildModel(disc, { yarnWeight: "bulky", hookMm: 7 });
    const mm5 = buildModel(disc, { yarnDiameterMm: 5, hookMm: 7 });
    const mm2 = buildModel(disc, { yarnDiameterMm: 2, hookMm: 3 });
    expect(mm5.graph.gauge.yarnDiameterMm).toBe(5);
    expect(mm5.size.width).toBeCloseTo(bulky.size.width, 6);
    expect(mm5.size.height).toBeCloseTo(bulky.size.height, 6);
    expect(mm2.size.width).toBeLessThan(mm5.size.width);
  });

  it("leaves gauges without a thickness unchanged", () => {
    expect(resolveGauge({ yarnWeight: "worsted", hookMm: 5 }).yarnDiameterMm).toBe(
      YARN_WEIGHT_DEFAULTS.worsted.yarnDiameterMm,
    );
    expect(resolveGauge({ stitchesPer10cm: 20 }).yarnDiameterMm).toBe(YARN_WEIGHT_DEFAULTS.dk.yarnDiameterMm);
  });
});

describe("GaugeSchema", () => {
  it("accepts an empty object and any subset of fields", () => {
    expect(GaugeSchema.safeParse({}).success).toBe(true);
    expect(GaugeSchema.safeParse({ stitchesPer10cm: 20 }).success).toBe(true);
    expect(GaugeSchema.safeParse({ yarnWeight: "dk", hookMm: 2.5 }).success).toBe(true);
  });

  it("rejects unknown fields, zero and negative numbers, unknown weights", () => {
    expect(GaugeSchema.safeParse({ stitchesPer10cm: 0 }).success).toBe(false);
    expect(GaugeSchema.safeParse({ rowsPer10cm: -3 }).success).toBe(false);
    expect(GaugeSchema.safeParse({ yarnWeight: "chunky" }).success).toBe(false);
    expect(GaugeSchema.safeParse({ tension: 4 }).success).toBe(false);
  });
});

describe("resolveGauge", () => {
  it("uses the swatch when given: width = 100 / stitches, height = 100 / rows", () => {
    const g = resolveGauge({ stitchesPer10cm: 25, rowsPer10cm: 20 });
    expect(g.stitchWidthMm).toBeCloseTo(4);
    expect(g.stitchHeightMm).toBeCloseTo(5);
    expect(g.estimated).toBe(false);
    expect(g.source).toBe("swatch");
  });

  it("falls back to a square stitch when only one swatch number is given", () => {
    const g = resolveGauge({ stitchesPer10cm: 20 });
    expect(g.stitchWidthMm).toBeCloseTo(5);
    expect(g.stitchHeightMm).toBeCloseTo(5);
  });

  it("derives estimated dimensions from yarn weight at its standard hook", () => {
    const g = resolveGauge({ yarnWeight: "dk" });
    expect(g.stitchWidthMm).toBeCloseTo(100 / YARN_WEIGHT_DEFAULTS.dk.stitchesPer10cm);
    expect(g.estimated).toBe(true);
    expect(g.source).toBe("yarn-weight");
  });

  it("scales with the hook, clamped to a sane range", () => {
    const standard = resolveGauge({ yarnWeight: "dk", hookMm: 4 });
    const smaller = resolveGauge({ yarnWeight: "dk", hookMm: 2.5 });
    const huge = resolveGauge({ yarnWeight: "dk", hookMm: 40 });
    expect(smaller.stitchWidthMm).toBeLessThan(standard.stitchWidthMm);
    expect(huge.stitchWidthMm / standard.stitchWidthMm).toBeCloseTo(1.6);
  });

  it("returns the DK default for no information at all", () => {
    const g = resolveGauge();
    expect(g.source).toBe("default");
    expect(g.estimated).toBe(true);
    expect(g.yarnDiameterMm).toBe(YARN_WEIGHT_DEFAULTS.dk.yarnDiameterMm);
  });
});

describe("STITCH_HEIGHT_FACTOR", () => {
  it("covers every stitch code and keeps the classic height ladder", () => {
    for (const code of StitchCodeSchema.options) {
      expect(typeof STITCH_HEIGHT_FACTOR[code]).toBe("number");
    }
    expect(STITCH_HEIGHT_FACTOR.SC).toBe(1);
    expect(STITCH_HEIGHT_FACTOR.HDC).toBeGreaterThan(STITCH_HEIGHT_FACTOR.SC);
    expect(STITCH_HEIGHT_FACTOR.DC).toBeGreaterThan(STITCH_HEIGHT_FACTOR.HDC);
    expect(STITCH_HEIGHT_FACTOR.TR).toBeGreaterThan(STITCH_HEIGHT_FACTOR.DC);
    expect(STITCH_HEIGHT_FACTOR.MR).toBe(0);
  });
});

describe("flatIncreasesPerRound", () => {
  it("gives the crocheter's rules: about 6 for sc, 9 for hdc and 12 for dc by default", () => {
    expect(flatIncreasesPerRound()).toBeCloseTo(6, 0);
    expect(flatIncreasesPerRound(undefined, "HDC")).toBeCloseTo(9, 0);
    expect(flatIncreasesPerRound({}, "DC")).toBeCloseTo(12, 0);
    for (const weight of YarnWeightSchema.options) {
      expect(Math.round(flatIncreasesPerRound({ yarnWeight: weight }))).toBe(6);
    }
  });

  it("follows the swatch: taller stitches need more increases", () => {
    expect(flatIncreasesPerRound({ stitchesPer10cm: 20, rowsPer10cm: 16 })).toBeCloseTo((2 * Math.PI * 20) / 16, 10);
    expect(flatIncreasesPerRound({ stitchesPer10cm: 20, rowsPer10cm: 16 })).toBeCloseTo(7.85, 2);
    // Without rows, sc is taken as square.
    expect(flatIncreasesPerRound({ stitchesPer10cm: 20 })).toBeCloseTo(2 * Math.PI, 10);
  });
});
