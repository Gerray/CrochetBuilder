import { describe, it, expect } from "vitest";
import {
  GaugeSchema,
  YARN_WEIGHT_DEFAULTS,
  STITCH_HEIGHT_FACTOR,
  resolveGauge,
} from "./gauge.js";
import { StitchCodeSchema } from "./schema.js";

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
