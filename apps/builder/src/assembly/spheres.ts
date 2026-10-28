/** Eyes and embroidery of an assembled scene as spheres for the model view (no Three.js). */

import type { ViewSphere } from "../three/modelView.js";
import type { CombinedScene } from "./combine.js";

/**
 * Eyes: a sphere of their diameter centred on the surface (half sunk in). An embroidered
 * mark is flat on the fabric: a sphere mostly sunk in shows as a low bump.
 */
export function sceneSpheres(combined: Pick<CombinedScene, "eyes" | "marks"> | null): ViewSphere[] {
  if (!combined) return [];
  const eyes = combined.eyes.map((e): ViewSphere => ({ center: e.position, radius: e.diameter / 2, kind: "eye" }));
  const marks = combined.marks.map((m): ViewSphere => {
    const r = m.size / 2;
    const c: [number, number, number] = [m.position[0] - 0.6 * r * m.normal[0], m.position[1] - 0.6 * r * m.normal[1], m.position[2] - 0.6 * r * m.normal[2]];
    return { center: c, radius: r, kind: "mark" };
  });
  return [...eyes, ...marks];
}
