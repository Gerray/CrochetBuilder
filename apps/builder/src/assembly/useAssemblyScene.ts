/**
 * React side of the "Montage" computation: sends the parts and placements to the assembly
 * client (debounced), keeps the part meshes it received (by key, so they are not sent again)
 * and hands back the scene combined into one mesh.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { AssemblyScene, MeshStyle } from "@crochetbuilder/engine";
import { createAssemblyClient, type AssemblyClient } from "./client.js";
import { combineScene, type CombinedScene } from "./combine.js";
import type { AssemblyDoc, AssemblyPartResult, PartMesh } from "./compute.js";

export interface AssemblySceneState {
  status: "pending" | "scene" | "error";
  scene: AssemblyScene | null;
  /** Per part: the computation's status ("model", "empty", "overBudget", "error"). */
  parts: AssemblyPartResult[];
  combined: CombinedScene | null;
  computing: boolean;
  error?: string;
}

export interface AssemblySceneOptions {
  /** Wait this long after the last edit (default 120 ms). */
  debounceMs?: number;
  /** Client factory (tests pass one on the main thread). Must be stable. */
  createClient?: () => AssemblyClient;
}

const INITIAL: AssemblySceneState = { status: "pending", scene: null, parts: [], combined: null, computing: true };

export function useAssemblyScene(
  doc: AssemblyDoc,
  style: MeshStyle,
  { debounceMs = 120, createClient = createAssemblyClient }: AssemblySceneOptions = {},
): AssemblySceneState {
  const [state, setState] = useState<{ base: Omit<AssemblySceneState, "combined">; meshes: Map<string, PartMesh> }>({
    base: { status: "pending", scene: null, parts: [], computing: true },
    meshes: new Map(),
  });
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
    setState((s) => (s.base.computing ? s : { ...s, base: { ...s.base, computing: true } }));
    const delay = first.current ? 0 : debounceMs;
    first.current = false;
    const timer = setTimeout(() => {
      const client = clientRef.current;
      if (!client) return;
      void client.compute({ doc: input, style, have: [...meshesRef.current.keys()] }).then((result) => {
        if (!result) return;
        if (result.kind === "error") {
          setState((s) => ({ ...s, base: { ...s.base, status: "error", computing: client.busy, error: result.message } }));
          return;
        }
        // Keep the meshes the scene uses: the ones held already plus the new ones.
        const meshes = new Map<string, PartMesh>();
        for (const p of result.parts) {
          const mesh = p.mesh ?? meshesRef.current.get(p.key);
          if (mesh && p.status === "model") meshes.set(p.key, mesh);
        }
        meshesRef.current = meshes;
        setState({ base: { status: "scene", scene: result.scene, parts: result.parts, computing: client.busy }, meshes });
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [input, style, debounceMs]);

  const { base, meshes } = state;
  const combined = useMemo(() => {
    if (!base.scene) return null;
    const byPart = base.parts.map((p) => meshes.get(p.key));
    return combineScene(base.scene, byPart);
  }, [base.scene, base.parts, meshes]);
  return { ...base, combined };
}

export { INITIAL as INITIAL_ASSEMBLY_SCENE };
