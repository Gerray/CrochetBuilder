/** German display labels shared by the editor, the PDF and the viewer. */

import {
  flatIncreasesPerRound,
  resolveGauge,
  YARN_WEIGHT_DEFAULTS,
  type Gauge,
  type Material,
  type MaterialKind,
  type YarnWeight,
} from "@crochetbuilder/engine";

export const YARN_WEIGHTS: Array<[YarnWeight, string]> = [
  ["lace", "Lace (sehr fein)"],
  ["fingering", "Fingering / Sockengarn"],
  ["sport", "Sport (fein)"],
  ["dk", "DK (leicht)"],
  ["worsted", "Worsted (mittel)"],
  ["aran", "Aran (mitteldick)"],
  ["bulky", "Bulky (dick)"],
  ["jumbo", "Jumbo (sehr dick)"],
];

export const MATERIAL_KINDS: Array<[MaterialKind, string]> = [
  ["yarn", "Garn"],
  ["hook", "Nadel"],
  ["accessory", "Zubehör"],
];

const YARN_WEIGHT_LABEL = new Map(YARN_WEIGHTS);
const MATERIAL_KIND_LABEL = new Map(MATERIAL_KINDS);

/** German number: 3,5 — at most `digits` decimals. */
export function num(value: number, digits = 1): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: digits });
}

/** Millimetres as centimetres with one decimal: 62 → "6,2". */
export function cm(valueMm: number): string {
  return (valueMm / 10).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "Garn: Baumwollgarn DK (Weiß, Rosa), ca. 10 g" — empty labels give an empty string. */
export function materialLine(m: Material): string {
  const label = m.label.trim();
  if (!label) return "";
  const colors = (m.colors ?? []).map((c) => c.trim()).filter(Boolean);
  let line = `${MATERIAL_KIND_LABEL.get(m.kind) ?? m.kind}: ${label}`;
  if (colors.length > 0) line += ` (${colors.join(", ")})`;
  if (m.amount?.trim()) line += `, ${m.amount.trim()}`;
  return line;
}

/** Select option for a yarn weight with its typical thickness: "DK (leicht) · ca. 2,5 mm". */
export function yarnWeightOption(weight: YarnWeight): string {
  const label = YARN_WEIGHT_LABEL.get(weight) ?? weight;
  return `${label} · ca. ${num(YARN_WEIGHT_DEFAULTS[weight].yarnDiameterMm)} mm`;
}

/**
 * Which inputs drive the stitch size, as a short sentence for the editor:
 * "Größe aus Garndicke 2,5 mm und Nadel 3 mm geschätzt". Mirrors `resolveGauge`'s order.
 */
export function sizeBasisText(gauge: Gauge | undefined): string {
  const g = gauge ?? {};
  if (g.stitchesPer10cm !== undefined || g.rowsPer10cm !== undefined) return "Größe aus der Maschenprobe";
  const hook = g.hookMm !== undefined ? `Nadel ${num(g.hookMm, 2)} mm` : null;
  let yarn: string | null = null;
  if (g.yarnDiameterMm !== undefined) yarn = `Garndicke ${num(g.yarnDiameterMm, 2)} mm`;
  else if (g.yarnWeight) yarn = `Garn ${YARN_WEIGHT_LABEL.get(g.yarnWeight) ?? g.yarnWeight}`;
  if (!yarn && !hook) return "Größe aus Standardwerten (DK, 4 mm) geschätzt";
  const basis = [yarn ?? "Standardgarn (DK)", hook].filter(Boolean).join(" und ");
  let text = `Größe aus ${basis} geschätzt`;
  if (g.yarnDiameterMm !== undefined && g.yarnWeight) text += " – die Garndicke hat Vorrang vor der Garnstärke";
  return text;
}

/**
 * How many single-crochet increases per round lie flat with this gauge, as a hint for the
 * swatch fields: "Flacher Kreis in fM: ca. 8 Zunahmen pro Runde". `exact` is the unrounded
 * value for a tooltip.
 */
export function flatCircleHint(gauge: Gauge | undefined): { text: string; exact: string } {
  const n = flatIncreasesPerRound(gauge);
  return {
    text: `Flacher Kreis in fM: ca. ${num(Math.round(n), 0)} Zunahmen pro Runde`,
    exact: `Genau ${num(n)} – mit weniger Zunahmen wölbt sich der Kreis, mit mehr wird der Rand wellig.`,
  };
}

/**
 * The size basis in one line: the swatch when there is one, then yarn weight, yarn thickness
 * and hook, else a note that the engine defaults apply.
 */
export function gaugeLine(gauge: Gauge | undefined): string {
  const g = gauge ?? {};
  const parts: string[] = [];
  if (g.stitchesPer10cm !== undefined || g.rowsPer10cm !== undefined) {
    const counts = [
      g.stitchesPer10cm !== undefined ? `${num(g.stitchesPer10cm)} M` : "",
      g.rowsPer10cm !== undefined ? `${num(g.rowsPer10cm)} R` : "",
    ].filter(Boolean);
    parts.push(`Maschenprobe: ${counts.join(" × ")} = 10 × 10 cm`);
  }
  if (g.yarnWeight) parts.push(`Garn: ${YARN_WEIGHT_LABEL.get(g.yarnWeight) ?? g.yarnWeight}`);
  if (g.yarnDiameterMm !== undefined) parts.push(`Garndicke: ${num(g.yarnDiameterMm, 2)} mm`);
  if (g.hookMm !== undefined) parts.push(`Nadel: ${num(g.hookMm, 2)} mm`);
  return parts.length > 0 ? parts.join(" · ") : "Keine Angabe zu Garn, Nadel oder Maschenprobe";
}

/** Why sizes are estimates, or null when they come from a swatch. */
export function estimateNote(gauge: Gauge | undefined): string | null {
  switch (resolveGauge(gauge).source) {
    case "swatch":
      return null;
    case "yarn-weight":
      return "Maße geschätzt aus Garn und Nadel – mit deiner Maschenprobe können sie abweichen.";
    case "default":
      return "Maße geschätzt aus Standardwerten (DK, 4 mm).";
  }
}

export interface SizeInfo {
  width: number;
  height: number;
  depth: number;
  maxDiameter: number;
}

/** "6,2 × 6,0 × 6,2 cm (B × H × T), max. Ø 6,3 cm" */
export function sizeLine(size: SizeInfo): string {
  let line = `${cm(size.width)} × ${cm(size.height)} × ${cm(size.depth)} cm (B × H × T)`;
  if (size.maxDiameter > 0) line += `, max. Ø ${cm(size.maxDiameter)} cm`;
  return line;
}
