/**
 * Gauge — turns "what yarn and hook" or "my swatch" into stitch dimensions in millimetres.
 *
 * Resolution order for the stitch size (see docs/FORMAT.md):
 *   1. an explicit swatch (`stitchesPer10cm` / `rowsPer10cm`) wins;
 *   2. otherwise defaults derived from the yarn thickness `yarnDiameterMm` (interpolated over
 *      the yarn weight table) + `hookMm`;
 *   3. otherwise defaults derived from `yarnWeight` + `hookMm`;
 *   4. otherwise the engine default (DK, 4 mm) — flagged as estimated.
 * The rendered yarn thickness always follows `yarnDiameterMm` when it is given.
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

/** Thickest yarn the format accepts (mm). Anything above is a typo, not a yarn. */
export const MAX_YARN_DIAMETER_MM = 30;

/** Optional gauge information carried alongside a pattern. All fields optional. */
export const GaugeSchema = z
  .object({
    stitchesPer10cm: z.number().positive().optional(),
    rowsPer10cm: z.number().positive().optional(),
    yarnWeight: YarnWeightSchema.optional(),
    hookMm: z.number().positive().optional(),
    /** Yarn thickness in mm (since engine 0.2.0). More specific than `yarnWeight`. */
    yarnDiameterMm: z.number().positive().max(MAX_YARN_DIAMETER_MM).optional(),
  })
  .strict();
export type Gauge = z.infer<typeof GaugeSchema>;

/**
 * Typical single-crochet gauge at the weight's standard hook, plus yarn diameter.
 * Values are approximate midpoints for amigurumi-style, fairly tight crochet. Single crochet
 * is taken as square (rows = stitches), as a swatch without rows is: the crocheter's rule
 * "six increases per round lie flat" then holds with a small margin (2π·h/w ≈ 6.3), so a
 * six-increase disc lies flat or cups very slightly. Stitches any lower than wide would put
 * it past the ruffling point (2π·h/w < 6) and warp the start of every ball.
 */
interface WeightDefaults {
  stitchesPer10cm: number;
  rowsPer10cm: number;
  hookMm: number;
  yarnDiameterMm: number;
}

export const YARN_WEIGHT_DEFAULTS: Record<YarnWeight, WeightDefaults> = {
  lace: { stitchesPer10cm: 32, rowsPer10cm: 32, hookMm: 2.0, yarnDiameterMm: 1.0 },
  fingering: { stitchesPer10cm: 28, rowsPer10cm: 28, hookMm: 2.5, yarnDiameterMm: 1.5 },
  sport: { stitchesPer10cm: 24, rowsPer10cm: 24, hookMm: 3.0, yarnDiameterMm: 2.0 },
  dk: { stitchesPer10cm: 20, rowsPer10cm: 20, hookMm: 4.0, yarnDiameterMm: 2.5 },
  worsted: { stitchesPer10cm: 16, rowsPer10cm: 16, hookMm: 5.0, yarnDiameterMm: 3.0 },
  aran: { stitchesPer10cm: 14, rowsPer10cm: 14, hookMm: 5.5, yarnDiameterMm: 3.5 },
  bulky: { stitchesPer10cm: 11, rowsPer10cm: 11, hookMm: 7.0, yarnDiameterMm: 5.0 },
  jumbo: { stitchesPer10cm: 7, rowsPer10cm: 7, hookMm: 10.0, yarnDiameterMm: 8.0 },
};

export const DEFAULT_YARN_WEIGHT: YarnWeight = "dk";

/**
 * Height of one stitch relative to a single crochet. CH as a foundation chain is as tall
 * as it is wide; MR has no height of its own (it is the anchor of round 1). Bobble, puff
 * and popcorn are worked from double crochets and stand as tall as one; a picot is a
 * decorative loop on top of the row and adds no height.
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
  BOBBLE: 2,
  PUFF: 2,
  POPCORN: 2,
  PICOT: 0,
};

/**
 * How far a stitch stands proud of the fabric, in stitch widths — the bobble family is
 * several loops closed into one top and bulges out. A rendering hint carried on the graph
 * node (`StitchNode.bulge`); the stitch mesh pushes the stitch's top outwards by it, the
 * relaxation ignores it.
 */
export const STITCH_BULGE: Partial<Record<StitchCode, number>> = {
  BOBBLE: 0.5,
  POPCORN: 0.6,
  PUFF: 0.3,
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
  /**
   * Where the stitch size came from. `"yarn-weight"` covers every estimate from the yarn
   * (`yarnWeight` and/or `yarnDiameterMm`) and the hook; whether the thickness in mm drove
   * it is visible on the input (`gauge.yarnDiameterMm !== undefined`).
   */
  source: "swatch" | "yarn-weight" | "default";
}

/** Clamp a hook-size scaling factor so a wild hook entry cannot explode the model. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Stitch size and standard hook the yarn weight table suggests for one yarn thickness. */
export interface YarnSizeDefaults {
  /** Single-crochet width at the standard hook (mm). */
  stitchWidthMm: number;
  /** Single-crochet height at the standard hook (mm). */
  stitchHeightMm: number;
  /** Standard hook for this thickness (mm). */
  hookMm: number;
}

interface TablePoint extends YarnSizeDefaults {
  yarnDiameterMm: number;
}

/** The weight table as points over yarn thickness, thinnest first. */
const TABLE_BY_DIAMETER: readonly TablePoint[] = Object.values(YARN_WEIGHT_DEFAULTS)
  .map((d) => ({
    yarnDiameterMm: d.yarnDiameterMm,
    stitchWidthMm: 100 / d.stitchesPer10cm,
    stitchHeightMm: 100 / d.rowsPer10cm,
    hookMm: d.hookMm,
  }))
  .sort((a, b) => a.yarnDiameterMm - b.yarnDiameterMm);

/**
 * Outside the table, sizes scale proportionally with the thickness — down to `below` × the
 * thinnest and up to `above` × the thickest table yarn; beyond that they stay constant.
 */
export const YARN_DIAMETER_EXTRAPOLATION = { below: 0.5, above: 1.5 } as const;

function scaled(p: TablePoint, factor: number): YarnSizeDefaults {
  return {
    stitchWidthMm: p.stitchWidthMm * factor,
    stitchHeightMm: p.stitchHeightMm * factor,
    hookMm: p.hookMm * factor,
  };
}

/**
 * Stitch size and standard hook for a yarn thickness, interpolated piecewise linearly over
 * `YARN_WEIGHT_DEFAULTS`: stitch width (100 / stitchesPer10cm), row height (100 / rowsPer10cm)
 * and hook, each between the two neighbouring weights. Exact at the table's thicknesses,
 * monotonic, proportional outside the table and clamped as `YARN_DIAMETER_EXTRAPOLATION`
 * says. Interpolating width and height separately keeps their ratio between the
 * neighbours' ratios, so the square default stitch carries over.
 */
export function yarnDefaultsForDiameter(diameterMm: number): YarnSizeDefaults {
  const first = TABLE_BY_DIAMETER[0]!;
  const last = TABLE_BY_DIAMETER[TABLE_BY_DIAMETER.length - 1]!;
  const d = clamp(
    diameterMm,
    first.yarnDiameterMm * YARN_DIAMETER_EXTRAPOLATION.below,
    last.yarnDiameterMm * YARN_DIAMETER_EXTRAPOLATION.above,
  );
  if (d <= first.yarnDiameterMm) return scaled(first, d / first.yarnDiameterMm);
  if (d >= last.yarnDiameterMm) return scaled(last, d / last.yarnDiameterMm);
  let i = 1;
  while (TABLE_BY_DIAMETER[i]!.yarnDiameterMm < d) i++;
  const lo = TABLE_BY_DIAMETER[i - 1]!;
  const hi = TABLE_BY_DIAMETER[i]!;
  const t = (d - lo.yarnDiameterMm) / (hi.yarnDiameterMm - lo.yarnDiameterMm);
  const lerp = (a: number, b: number) => a + t * (b - a);
  return {
    stitchWidthMm: lerp(lo.stitchWidthMm, hi.stitchWidthMm),
    stitchHeightMm: lerp(lo.stitchHeightMm, hi.stitchHeightMm),
    hookMm: lerp(lo.hookMm, hi.hookMm),
  };
}

/**
 * Resolve a (possibly empty) gauge into millimetre dimensions.
 *
 * With a swatch, width = 100 / stitchesPer10cm and height = 100 / rowsPer10cm; a missing
 * rows value falls back to the width (single crochet is roughly square). Without a swatch,
 * the size comes from the yarn — its thickness in mm when given (see
 * `yarnDefaultsForDiameter`; it wins over the weight class), else its weight class — scaled
 * by the hook: a bigger hook than the yarn's standard makes stitches proportionally larger
 * (factor clamped to 0.6–1.6). `yarnDiameterMm`, when given, is always the rendered yarn
 * thickness, also with a swatch.
 */
export function resolveGauge(gauge: Gauge | undefined = {}): ResolvedGauge {
  const weight = gauge.yarnWeight ?? DEFAULT_YARN_WEIGHT;
  const defaults = YARN_WEIGHT_DEFAULTS[weight];
  const yarnDiameterMm = gauge.yarnDiameterMm ?? defaults.yarnDiameterMm;

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
      yarnDiameterMm,
      estimated: false,
      source: "swatch",
    };
  }

  const base: YarnSizeDefaults =
    gauge.yarnDiameterMm !== undefined
      ? yarnDefaultsForDiameter(gauge.yarnDiameterMm)
      : {
          stitchWidthMm: 100 / defaults.stitchesPer10cm,
          stitchHeightMm: 100 / defaults.rowsPer10cm,
          hookMm: defaults.hookMm,
        };
  const hookScale = gauge.hookMm !== undefined ? clamp(gauge.hookMm / base.hookMm, 0.6, 1.6) : 1;
  const fromYarn =
    gauge.yarnWeight !== undefined || gauge.yarnDiameterMm !== undefined || gauge.hookMm !== undefined;
  return {
    stitchWidthMm: base.stitchWidthMm * hookScale,
    stitchHeightMm: base.stitchHeightMm * hookScale,
    yarnDiameterMm,
    estimated: true,
    source: fromYarn ? "yarn-weight" : "default",
  };
}

/**
 * Increases per round that make a circle of `code` stitches lie flat: each round must grow
 * the circumference by 2π × its height, so n₀ = 2π · h / w. Fewer increases cup the piece
 * into a cone that rises by arccos(n / n₀) out of the plane, more make the edge ruffle. For
 * single crochet this is the crocheter's "six increases" with roughly square stitches and
 * about eight with stitches 1.25 × as tall as wide. Not rounded.
 */
export function flatIncreasesPerRound(gauge?: Gauge, code: StitchCode = "SC"): number {
  const g = resolveGauge(gauge);
  return (2 * Math.PI * g.stitchHeightMm * STITCH_HEIGHT_FACTOR[code]) / g.stitchWidthMm;
}
