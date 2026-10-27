/**
 * Gauge — turns "what yarn and hook" or "my swatch" into stitch dimensions in millimetres.
 *
 * Resolution order (see docs/FORMAT.md):
 *   1. an explicit swatch (`stitchesPer10cm` / `rowsPer10cm`) wins;
 *   2. otherwise defaults derived from `yarnWeight` + `hookMm`;
 *   3. otherwise the engine default (DK, 4 mm) — flagged as estimated.
 *
 * The default table is deliberately coarse: it exists so a pattern without a swatch still
 * renders at a plausible size. Designers who care about size enter their swatch.
 */

import { z } from "zod";
import type { StitchCode } from "./schema.js";

export const YarnWeightSchema = z.enum([
  "lace",
  "fingering",
  "sport",
  "dk",
  "worsted",
  "aran",
  "bulky",
  "jumbo",
]);
export type YarnWeight = z.infer<typeof YarnWeightSchema>;

/** Optional gauge information carried alongside a pattern. All fields optional. */
export const GaugeSchema = z
  .object({
    stitchesPer10cm: z.number().positive().optional(),
    rowsPer10cm: z.number().positive().optional(),
    yarnWeight: YarnWeightSchema.optional(),
    hookMm: z.number().positive().optional(),
  })
  .strict();
export type Gauge = z.infer<typeof GaugeSchema>;

/**
 * Typical single-crochet gauge at the weight's standard hook, plus yarn diameter.
 * Values are approximate midpoints for amigurumi-style, fairly tight crochet.
 */
interface WeightDefaults {
  stitchesPer10cm: number;
  rowsPer10cm: number;
  hookMm: number;
  yarnDiameterMm: number;
}

export const YARN_WEIGHT_DEFAULTS: Record<YarnWeight, WeightDefaults> = {
  lace: { stitchesPer10cm: 32, rowsPer10cm: 36, hookMm: 2.0, yarnDiameterMm: 1.0 },
  fingering: { stitchesPer10cm: 28, rowsPer10cm: 32, hookMm: 2.5, yarnDiameterMm: 1.5 },
  sport: { stitchesPer10cm: 24, rowsPer10cm: 28, hookMm: 3.0, yarnDiameterMm: 2.0 },
  dk: { stitchesPer10cm: 20, rowsPer10cm: 24, hookMm: 4.0, yarnDiameterMm: 2.5 },
  worsted: { stitchesPer10cm: 16, rowsPer10cm: 19, hookMm: 5.0, yarnDiameterMm: 3.0 },
  aran: { stitchesPer10cm: 14, rowsPer10cm: 16, hookMm: 5.5, yarnDiameterMm: 3.5 },
  bulky: { stitchesPer10cm: 11, rowsPer10cm: 13, hookMm: 7.0, yarnDiameterMm: 5.0 },
  jumbo: { stitchesPer10cm: 7, rowsPer10cm: 8, hookMm: 10.0, yarnDiameterMm: 8.0 },
};

export const DEFAULT_YARN_WEIGHT: YarnWeight = "dk";

/**
 * Height of one stitch relative to a single crochet. CH as a foundation chain is as tall
 * as it is wide; MR has no height of its own (it is the anchor of round 1).
 */
export const STITCH_HEIGHT_FACTOR: Record<StitchCode, number> = {
  CH: 1,
  SL_ST: 0.5,
  SC: 1,
  HDC: 1.5,
  DC: 2,
  TR: 3,
  DTR: 4,
  MR: 0,
  INC: 1,
  DEC: 1,
  INVDEC: 1,
  ST: 1,
};

/** Stitch dimensions the graph and the mesh work with. */
export interface ResolvedGauge {
  /** Horizontal rest length between two neighbouring stitches of a row (mm). */
  stitchWidthMm: number;
  /** Vertical rest length of a single crochet (mm); other codes scale by STITCH_HEIGHT_FACTOR. */
  stitchHeightMm: number;
  /** Yarn thickness for rendering tubes (mm). */
  yarnDiameterMm: number;
  /** `true` when no swatch was given and the numbers come from defaults. */
  estimated: boolean;
  /** Where the numbers came from. */
  source: "swatch" | "yarn-weight" | "default";
}

/** Clamp a hook-size scaling factor so a wild hook entry cannot explode the model. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Resolve a (possibly empty) gauge into millimetre dimensions.
 *
 * With a swatch, width = 100 / stitchesPer10cm and height = 100 / rowsPer10cm; a missing
 * rows value falls back to the width (single crochet is roughly square). Without a swatch,
 * the yarn-weight table applies, scaled by the hook: a bigger hook than the weight's
 * standard makes stitches proportionally larger (factor clamped to 0.6–1.6).
 */
export function resolveGauge(gauge: Gauge | undefined = {}): ResolvedGauge {
  const weight = gauge.yarnWeight ?? DEFAULT_YARN_WEIGHT;
  const defaults = YARN_WEIGHT_DEFAULTS[weight];

  if (gauge.stitchesPer10cm !== undefined || gauge.rowsPer10cm !== undefined) {
    const stitchWidthMm =
      gauge.stitchesPer10cm !== undefined
        ? 100 / gauge.stitchesPer10cm
        : 100 / gauge.rowsPer10cm!;
    const stitchHeightMm =
      gauge.rowsPer10cm !== undefined ? 100 / gauge.rowsPer10cm : stitchWidthMm;
    return {
      stitchWidthMm,
      stitchHeightMm,
      yarnDiameterMm: defaults.yarnDiameterMm,
      estimated: false,
      source: "swatch",
    };
  }

  const hookScale = gauge.hookMm !== undefined ? clamp(gauge.hookMm / defaults.hookMm, 0.6, 1.6) : 1;
  const fromWeight = gauge.yarnWeight !== undefined || gauge.hookMm !== undefined;
  return {
    stitchWidthMm: (100 / defaults.stitchesPer10cm) * hookScale,
    stitchHeightMm: (100 / defaults.rowsPer10cm) * hookScale,
    yarnDiameterMm: defaults.yarnDiameterMm,
    estimated: true,
    source: fromWeight ? "yarn-weight" : "default",
  };
}
