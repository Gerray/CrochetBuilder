/**
 * React side of the "Montage" computation: sends the parts and placements to the shared
 * assembly client (debounced), keeps the part meshes it received (by key, so they are not
 * sent again) and hands back the scene combined into one mesh.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { AssemblyScene, MeshStyle } from "@crochetbuilder/engine";
import { sharedAssemblyClient, type AssemblyClient } from "./client.js";
import { combineScene, type CombinedScene } from "./combine.js";
import { meshesByPart, type AssemblyDoc, type AssemblyPartResult, type PartMesh } from "./compute.js";

export interface AssemblySceneState {
  status: "pending" | "scene" | "error";
  scene: AssemblyScene | null;
  /** Per part: the computation's status ("model", "empty", "overBudget", "error", "skipped"). */
  parts: AssemblyPartResult[];
  combined: CombinedScene | null;
  /** A computation is scheduled or running: the scene may not match the document yet. */
  computing: boolean;
  /** Total stitch budget of the Montage (parts beyond it are `skipped`). */
  maxTotal: number;
  error?: string;
}

export interface AssemblySceneOptions {
  /** Wait this long after the last edit (default 120 ms). */
  debounceMs?: number;
  /** Client factory (tests pass one on the main thread). Must be stable. */
  createClient?: () => AssemblyClient;
}

interface Held {
  base: Omit<AssemblySceneState, "combined">;
  meshes: Map<string, PartMesh>;
}

export function useAssemblyScene(
  doc: AssemblyDoc,
  style: MeshStyle,
  { debounceMs = 120, createClient = sharedAssemblyClient }: AssemblySceneOptions = {},
): AssemblySceneState {
  const [state, setState] = useState<Held>({
    base: { status: "pending", scene: null, parts: [], computing: true, maxTotal: 0 },
    meshes: new Map(),
  });
  // Bumped when a request was superseded by another user of the shared client: ask again.
  const [retry, setRetry] = useState(0);
  const clientRef = useRef<AssemblyClient | null>(null);
  const meshesRef = useRef(new Map<string, PartMesh>());
  const first = useRef(true);
  // Only what shapes the scene: parts, placements, gauge and palette (not title or notes).
  const input = useMemo<AssemblyDoc>(
    () => ({
      parts: doc.parts,
      ...(doc.assembly ? { assembly: doc.assembly } : {}),
      overview: { ...(doc.overview.gauge ? { gauge: doc.overview.gauge } : {}), ...(doc.overview.colors ? { colors: doc.overview.colors } : {}) },
    }),
    [doc.parts, doc.assembly, doc.overview.gauge, doc.overview.colors],
  );

  useEffect(() => {
    const client = createClient();
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, [createClient]);

  useEffect(() => {
    let live = true;
    setState((s) => (s.base.computing ? s : { ...s, base: { ...s.base, computing: true } }));
    const delay = first.current ? 0 : debounceMs;
    first.current = false;
    const timer = setTimeout(() => {
      const client = clientRef.current;
      if (!client) return;
      void client.compute({ doc: input, style, have: [...meshesRef.current.keys()] }).then((result) => {
        if (!live) return;
        if (!result) {
          // Superseded by another user of the shared client (the PDF): ask again.
          setRetry((n) => n + 1);
          return;
        }
        if (result.kind === "error") {
          setState((s) => ({ ...s, base: { ...s.base, status: "error", computing: client.busy, error: result.message } }));
          return;
        }
        // Keep the meshes the scene uses: the ones held already plus the new ones.
        const byPart = meshesByPart(result, meshesRef.current);
        const meshes = new Map<string, PartMesh>();
        result.parts.forEach((p, i) => {
          const mesh = byPart[i];
          if (mesh) meshes.set(p.key, mesh);
        });
        meshesRef.current = meshes;
        setState({
          base: { status: "scene", scene: result.scene, parts: result.parts, computing: client.busy, maxTotal: result.maxTotal },
          meshes,
        });
      });
    }, delay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [input, style, debounceMs, retry]);

  const { base, meshes } = state;
  const combined = useMemo(() => {
    if (!base.scene) return null;
    return combineScene(
      base.scene,
      base.parts.map((p) => meshes.get(p.key)),
    );
  }, [base.scene, base.parts, meshes]);
  return { ...base, combined };
}
