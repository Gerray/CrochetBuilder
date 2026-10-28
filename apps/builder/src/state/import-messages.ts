/**
 * German wording for the findings of the pattern import ("Anleitung einfügen"): one short
 * message per `ImportIssueCode`, plus the label an imported row gets when its text could not
 * be turned into stitches (it stays in the document as an instruction with the original text).
 */

import type { ImportIssue, ImportIssueCode } from "@crochetbuilder/engine";

const LOCALE_NAMES = { de: "Deutsch", en_us: "US", en_uk: "UK" } as const;

/** Short German message for an import issue. */
export function importIssueMessage(issue: Pick<ImportIssue, "code" | "message">): string {
  switch (issue.code) {
    case "UNREADABLE":
      return "Nicht lesbar – bleibt als Hinweis mit dem Originaltext stehen.";
    case "UNSUPPORTED_GROUP":
      return "Mehrere Maschen in eine Einstichstelle kann der Builder noch nicht darstellen – bleibt als Hinweis stehen.";
    case "UNSUPPORTED_SPECIAL_STITCH":
      return "Spezialmaschen (Noppe, Puff, Büschel, Relief, Picot) kann der Builder noch nicht darstellen – bleibt als Hinweis stehen.";
    case "UNSUPPORTED_JOIN":
      return "Teile beim Häkeln verbinden geht noch nicht – bleibt als Hinweis stehen.";
    case "UNSUPPORTED_CHAIN_SPACE":
      return "Häkeln in Luftmaschenbögen geht noch nicht – bleibt als Hinweis stehen.";
    case "UNSUPPORTED_FOUNDATION_OVAL":
      return "Ovaler Anfang um eine Luftmaschenkette geht noch nicht – bleibt als Hinweis stehen.";
    case "UNSUPPORTED_COLOR":
      return "Farbwechsel speichert der Builder noch nicht – der Text bleibt als Hinweis erhalten.";
    case "UNSUPPORTED_ROUND_JOIN":
      return "Runde mit Kettmasche geschlossen – als Spiralrunde übernommen.";
    case "NEEDS_PREVIOUS_COUNT":
      return "„Rundherum“ ohne bekannte Maschenzahl der Vorrunde – bitte die Maschen ausschreiben, z. B. „18 fM“.";
    case "FILL_MISMATCH":
      return "„Bis zum Rundenende“ geht mit der Maschenzahl der Vorrunde nicht auf.";
    case "RANGE_MISMATCH":
      return "Rundenbereich und Rundenzahl in Klammern passen nicht zusammen – bitte prüfen.";
    case "LABEL_GAP":
      return "Die Rundennummern springen – fehlt hier eine Runde?";
    case "PREAMBLE":
      return "Material, Abkürzungen oder Einleitung – gehört nicht zu den Runden.";
    case "IGNORED":
      return "Übersprungen (Seitenzahl oder Fortsetzungs-Überschrift).";
    case "LOCALE_UNCERTAIN":
      return "Die Schreibweise ist nicht sicher erkannt – bitte bestätigen.";
    case "REPEAT_GUESSED":
      return "Wiederholung anhand der angegebenen Maschenzahl gedeutet – bitte kurz prüfen.";
    case "AMBIGUOUS_REPEAT":
      return "Die Wiederholung lässt sich zweifach lesen – bleibt als Hinweis stehen, bitte ausschreiben.";
  }
}

/** Codes that turn a row into an instruction because the format cannot hold it yet. */
const UNSUPPORTED: ReadonlySet<ImportIssueCode> = new Set([
  "UNSUPPORTED_GROUP",
  "UNSUPPORTED_SPECIAL_STITCH",
  "UNSUPPORTED_JOIN",
  "UNSUPPORTED_CHAIN_SPACE",
  "UNSUPPORTED_FOUNDATION_OVAL",
]);

/** Row label for text that stayed unread: something the builder cannot show yet … */
export const UNSUPPORTED_ROW_LABEL = "Nicht unterstützt";
/** … or text that could not be read at all. */
export const UNREAD_ROW_LABEL = "Nicht gelesen";

/**
 * The label an instruction row gets when its text should have been stitches (a warning), so
 * it stands out in the row list, the PDF and the export — or undefined for a real note.
 */
export function unreadRowLabel(codes: readonly ImportIssueCode[]): string | undefined {
  if (codes.some((c) => UNSUPPORTED.has(c))) return UNSUPPORTED_ROW_LABEL;
  if (codes.some((c) => c === "UNREADABLE" || c === "AMBIGUOUS_REPEAT" || c === "NEEDS_PREVIOUS_COUNT" || c === "FILL_MISMATCH")) {
    return UNREAD_ROW_LABEL;
  }
  return undefined;
}

/** "Deutsch", "US", "UK". */
export function localeName(locale: keyof typeof LOCALE_NAMES): string {
  return LOCALE_NAMES[locale];
}
