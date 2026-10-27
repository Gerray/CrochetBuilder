/**
 * Mesh arrays → Three.js geometry. Needs Three but no WebGL, so it is testable in Node.
 */

import { BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, GridHelper } from "three";
import type { GridPlacement, Rgb, ViewMesh } from "./mapping.js";

/**
 * A `BufferGeometry` sharing the mesh's typed arrays (no copy): `position`, `normal`, a
 * `color` attribute for the row highlight (filled by the caller) and, for triangles, the
 * index. Bounding box and sphere are computed for framing and raycasting.
 */
export function toBufferGeometry(mesh: ViewMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(mesh.positions.length), 3));
  if (mesh.primitive === "triangles") geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** A CSS colour (hex, rgb(), named) as linear RGB for vertex colours. */
export function linearRgb(css: string): Rgb {
  const c = new Color();
  try {
    c.setStyle(css.trim());
  } catch {
    c.set(0x888888);
  }
  return [c.r, c.g, c.b];
}

/** A grid helper placed and oriented as `placement` says (1-cm cells). */
export function createGrid(placement: GridPlacement, color: string): GridHelper {
  const grid = new GridHelper(placement.size, placement.divisions, color, color);
  // GridHelper lies in XZ (normal +Y); turn it for a backdrop or a side wall.
  if (placement.normalAxis === 2) grid.rotation.x = Math.PI / 2;
  else if (placement.normalAxis === 0) grid.rotation.z = Math.PI / 2;
  grid.position.set(...placement.center);
  const material = grid.material as { transparent: boolean; opacity: number; depthWrite: boolean };
  material.transparent = true;
  material.opacity = 0.55;
  material.depthWrite = false;
  return grid;
}
