/**
 * A synthetic pattern for the "Anleitung einfügen" tests (unit and e2e) — written for these
 * tests, not taken from a real pattern. Three parts; on purpose it has a wrong stitch count
 * (Körper, Runde 3), a stitch the format cannot hold yet (Ohren, Runde 3) and an unreadable
 * round (Ohren, Runde 4).
 */
export const SAMPLE_PATTERN = [
  "Kleiner Igel",
  "Material: 50 g Baumwollgarn in Braun und Creme, Häkelnadel 3 mm, Füllwatte",
  "Abkürzungen: fM = feste Masche, Zun = Zunahme, Abn = Abnahme",
  "",
  "Kopf",
  "Runde 1: 6 fM in den Fadenring (6)",
  "Runde 2: 6 Zun (12)",
  "Runde 3: (1 fM, 1 Zun) x 6 (18)",
  "Runde 4: (2 fM, 1 Zun) x 6 (24)",
  "Runde 5-8: 24 fM (24)",
  "Sicherheitsaugen zwischen Runde 6 und 7 einsetzen.",
  "Runde 9: (2 fM, 1 Abn) x 6 (18)",
  "Runde 10: (1 fM, 1 Abn) x 6 (12)",
  "Kopf füllen.",
  "Runde 11: 6 Abn (6)",
  "",
  "Körper",
  "Runde 1: 6 fM in den Fadenring (6)",
  "Runde 2: 6 Zun (12)",
  "Runde 3: (1 fM, 1 Zun) x 6 (20)",
  "Runde 4-6: 18 fM (18)",
  "",
  "Ohren (2x)",
  "Runde 1: 5 fM in den Fadenring (5)",
  "Runde 2: 5 Zun (10)",
  "Runde 3: 3 Noppen, 7 fM (10)",
  "Runde 4: 10 fM, dann xq kringeln (10)",
].join("\n");

/** 1-based line numbers of interesting lines of `SAMPLE_PATTERN`. */
export const SAMPLE_LINES = {
  kopfRange: 10,
  kopfFill: 14,
  koerperMismatch: 20,
  ohrenUnsupported: 26,
  ohrenUnreadable: 27,
} as const;
