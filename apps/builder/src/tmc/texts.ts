/** The upload's German wording: fixed lines, plural forms, one honest line per failure. */

import type { TmcImpact, TmcErrorCode } from "./api.js";

export const UPLOAD_TITLE = "Zu TellmeCrochet hochladen";
export const PRIVACY_URL = "https://tellmecrochet.vercel.app/datenschutz";
export const IMPRINT_URL = "https://tellmecrochet.vercel.app/impressum";
export const APP_STORE_URL = "https://play.google.com/store/apps/details?id=de.tellmecrochet.app";

export const SELF_CREATED_LABEL = "Ich habe diese Anleitung selbst entworfen";
export const IMPORTED_LABEL = "Nicht selbst entworfen, aber ich darf sie so verwenden";
export const IMPORTED_HINT = "Bleibt privat und kann nicht verkauft werden";

export const SHARED_LINE =
  "Geteilt oder verkauft: Käufer behalten ihre Version, bis du teilst und sie selbst aktualisieren. Das Material änderst du dort in der App.";
export const CHANGED_IN_APP_LINE = "Seit deinem letzten Upload wurde sie in der App geändert.";
export const CHANGES_LOST_LINE = "Die Änderungen aus der App gehen dabei verloren";
export const SHARED_VERSION_KEPT_LINE = "Die zuletzt geteilte Version bleibt erhalten";

export const PRIVACY_LINE = "Die Anleitung wird in deinen TellmeCrochet-Account übertragen.";
export const SUMMARY_TITLE = "So kommt die Anleitung in TellmeCrochet an:";
export const SUCCESS_LINE = "Ist in deinem TellmeCrochet-Account. Öffne die App, dort steht sie unter deinen Projekten.";
export const MATERIALS_KEPT_LINE = "Das Material bleibt unverändert.";
export const SHARE_QUESTION =
  "Das ist eine geteilte Anleitung. Möchtest du die Bearbeitung jetzt teilen? Danach kannst du nicht mehr zur ursprünglichen Version zurückkehren.";

export const NEW_ACCOUNT_LINE = "Mit dieser Google-Adresse gab es noch kein Konto, deshalb wurde gerade ein neues TellmeCrochet-Konto angelegt.";

export const NO_ACCOUNT_LINE = "Für diese Adresse gibt es noch kein TellmeCrochet-Konto. Installiere zuerst die App und lege dort dein Konto an.";
export const EXPIRED_LINE = "Deine Anmeldung ist abgelaufen. Bitte melde dich neu an.";
export const GOOGLE_FAILED_LINE = "Die Anmeldung mit Google hat nicht geklappt. Versuche es noch einmal oder melde dich mit einem Code an.";
export const STALE_CODE_LINE = "Diese Anmeldung lässt sich hier nicht mehr abschließen. Bitte melde dich neu an.";
export const CODE_HINT = "Falls die Mail auch einen Link enthält, brauchst du ihn hier nicht: Gib nur den Code ein.";
export const CODE_REJECTED_LINE = "Der Code stimmt nicht oder ist abgelaufen. Prüfe ihn oder fordere einen neuen an.";
export const LIBRARY_FAILED_LINE = "Die Anmeldung konnte nicht geladen werden. Prüfe deine Internetverbindung und versuche es noch einmal.";

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** "3 Markierungen entfallen", one line per thing that changes; empty when nothing does. */
export function impactLines(impact: TmcImpact): string[] {
  const out: string[] = [];
  if (impact.progressMoved > 0) {
    out.push(plural(impact.progressMoved, "Fortschrittsposition wird verschoben oder gekürzt", "Fortschrittspositionen werden verschoben oder gekürzt"));
  }
  if (impact.markersDropped > 0) out.push(plural(impact.markersDropped, "Markierung entfällt", "Markierungen entfallen"));
  if (impact.partsDropped > 0) out.push(`Bei ${plural(impact.partsDropped, "Teil", "Teilen")} geht der Fortschritt verloren`);
  return out;
}

/** "45 Sekunden", "1 Minute", "12 Minuten". */
export function waitText(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return plural(s, "Sekunde", "Sekunden");
  return plural(Math.ceil(s / 60), "Minute", "Minuten");
}

/** One line for each failure of the endpoint. Nothing here blames the person for the server. */
export function errorLine(code: TmcErrorCode, retryAfterSeconds?: number): string {
  switch (code) {
    case "invalid":
      return "TellmeCrochet hat die Anleitung nicht angenommen, weil etwas an ihrem Aufbau nicht passt, zum Beispiel Maschenzahlen. Du kannst sie als Datei speichern.";
    case "unauthorized":
      return EXPIRED_LINE;
    case "forbidden":
      return "TellmeCrochet erlaubt das für dieses Projekt nicht.";
    case "not-found":
      return "Dieses Projekt gibt es in deinem Account nicht mehr. Du kannst die Anleitung als neues Projekt anlegen.";
    case "conflict":
      return "Das Projekt hat sich gerade geändert. Prüfe die Angaben hier noch einmal.";
    case "key-in-use":
      return "Für diese Anleitung gibt es schon ein Projekt in deinem Account. Wähle es aus oder lege ein neues an.";
    case "too-large":
      return "Die Anleitung ist zu groß zum Hochladen (höchstens 2 MB). Speichere sie stattdessen als Datei.";
    case "rate-limited":
      return retryAfterSeconds !== undefined
        ? `Zu viele Uploads in kurzer Zeit. Versuche es in ${waitText(retryAfterSeconds)} noch einmal.`
        : "Zu viele Uploads in kurzer Zeit. Versuche es später noch einmal.";
    case "network":
      return "Keine Verbindung zu TellmeCrochet. Prüfe deine Internetverbindung und versuche es noch einmal.";
    case "server":
      return "Bei TellmeCrochet ist gerade etwas schiefgelaufen. Versuche es später noch einmal.";
  }
}

const two = (n: number) => String(n).padStart(2, "0");

/** "heute, 14:32", "gestern, 09:05", else "28.10.2026, 14:32" (local time). */
export function uploadedWhen(at: number, now: number): string {
  const when = new Date(at);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const time = `${two(when.getHours())}:${two(when.getMinutes())}`;
  if (day(when) === day(today)) return `heute, ${time}`;
  if (day(when) === yesterday.getTime()) return `gestern, ${time}`;
  return `${two(when.getDate())}.${two(when.getMonth() + 1)}.${when.getFullYear()}, ${time}`;
}

export const lastUploadLine = (at: number, now: number) => `Zuletzt hochgeladen: ${uploadedWhen(at, now)}`;
