import { PACKAGE_NAME, validate, type PartContent } from "@crochetbuilder/engine";

/**
 * Placeholder shell until B3 (editor) and B4 (3D preview). It proves the workspace wiring:
 * the app imports the engine and runs a validation.
 */
const SPHERE: PartContent = {
  schemaVersion: 1,
  rows: [
    { id: "r1", type: "round", ops: [{ kind: "stitch", code: "MR", count: 1 }, { kind: "stitch", code: "SC", count: 6 }], stitchCountTarget: 6 },
    { id: "r2", type: "round", ops: [{ kind: "stitch", code: "INC", count: 6 }], stitchCountTarget: 12 },
  ],
};

export function App() {
  const findings = validate(SPHERE);
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720 }}>
      <h1>CrochetBuilder</h1>
      <p>
        Gerüst steht. Engine <code>{PACKAGE_NAME}</code> ist eingebunden; die Beispielanleitung
        hat {findings.length} Befund{findings.length === 1 ? "" : "e"}.
      </p>
      <p>Editor (B3) und 3D-Vorschau (B4) folgen gemäß Plan.</p>
    </main>
  );
}
