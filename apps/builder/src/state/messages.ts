/**
 * German wording for engine results shown in the editor: validation findings and parse
 * errors of the free-text row field.
 */

import { MAX_COUNT, MAX_ROW_STITCHES, type Finding, type ParseRowResult, type Row } from "@crochetbuilder/engine";

/** German message for a validation finding of `row`. */
export function findingMessage(finding: Finding, row: Row | undefined): string {
  const previous = row?.type === "row" ? "die Vorreihe" : "die Vorrunde";
  const { expected, actual } = finding;
  switch (finding.code) {
    case "STITCH_COUNT_MISMATCH":
      return `Maschenzahl stimmt nicht: Soll ${expected}, Ist ${actual}.`;
    case "CONSUMES_OVERFLOW":
      return `Wird in ${actual} Maschen gearbeitet, aber ${previous} hat nur ${expected}.`;
    case "CONSUMES_UNDERFLOW": {
      const left = (expected ?? 0) - (actual ?? 0);
      return `Wird nur in ${actual} von ${expected} Maschen gearbeitet – ${left} ${left === 1 ? "bleibt" : "bleiben"} frei.`;
    }
    case "NO_ANCHOR_ROW":
      return `Wird in ${actual} Maschen gearbeitet, aber davor gibt es keine Runde, Luftmaschenkette oder keinen Magischen Ring.`;
    case "EMPTY_REPEAT":
      return actual === 1
        ? "Eine Wiederholung enthält keine Maschen."
        : `${actual} Wiederholungen enthalten keine Maschen.`;
    case "EMPTY_GROUP":
      return actual === 1
        ? "Eine Gruppe „in dieselbe Masche“ enthält keine Masche, die in die Einstichstelle gearbeitet wird."
        : `${actual} Gruppen „in dieselbe Masche“ enthalten keine Masche, die in die Einstichstelle gearbeitet wird.`;
    case "INVALID_GROUP":
      return "In einer Gruppe „in dieselbe Masche“ dürfen kein Magischer Ring, keine Abnahme und keine zusammen abgemaschten Maschen stehen.";
    case "INVALID_MODIFIER":
      return "Reliefmaschen (vorne/hinten) gehen nur bei fM, hStb, Stb, DStb und DDStb, und nur eine Richtung pro Masche.";
    case "UNKNOWN_COLOR":
      return "Die Zeile verwendet eine Farbe, die nicht in der Farbpalette steht.";
    case "TOO_MANY_STITCHES":
      return `Das Teil hat ${n(actual ?? 0)} Maschen – das 3D-Modell zeigt höchstens ${n(expected ?? 0)}.`;
  }
}

const n = (value: number) => value.toLocaleString("de-DE");

/** German message for a failed parse, or null on success. */
export function parseErrorMessage(result: ParseRowResult): string | null {
  if (result.ok) return null;
  switch (result.code) {
    case "empty":
      return "Bitte mindestens eine Masche angeben, z. B. „6 fM“.";
    case "unknown-term":
      return `Unbekannter Begriff: „${result.term ?? ""}“`;
    case "too-large":
      return result.limit === MAX_ROW_STITCHES
        ? `Zu viele Maschen in einer Zeile – höchstens ${n(MAX_ROW_STITCHES)}.`
        : `Zahl zu groß – höchstens ${n(result.limit ?? MAX_COUNT)}.`;
    case "invalid-modifier":
      return `„${result.term ?? ""}“ passt hier nicht (widerspricht einer anderen Angabe oder gilt nicht für diese Masche).`;
    case "needs-context":
      return "„Rundherum“ braucht die Maschenzahl der Vorrunde – bitte die Maschen ausschreiben, z. B. „18 fM“.";
    case "fill-mismatch":
      return `„Rundherum“ geht mit ${n(result.limit ?? 0)} Maschen der Vorrunde nicht auf.`;
    case "syntax":
      return result.position !== undefined
        ? `Nicht lesbar ab Zeichen ${result.position + 1}. Beispiel: 6× (1 fM, 1 Zun)`
        : "Nicht lesbar. Beispiel: 6× (1 fM, 1 Zun)";
  }
}
