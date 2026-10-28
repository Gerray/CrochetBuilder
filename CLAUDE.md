# CLAUDE.md — CrochetBuilder

Betriebsmodell für Claude-Code-Sessions in diesem Repository. Anweisungen des Projektleiters
im Chat haben Vorrang.

## Scope-Quellen (in dieser Reihenfolge lesen)

1. `docs/intern/PROTOKOLL-BUILDER.md` — Entscheidungen E1–E9 mit Begründung. **Vor jeder
   Änderung an Architektur, Format oder Scope lesen.** Neue Entscheidungen werden dort
   angehängt, nie umgeschrieben.
2. `docs/intern/PLAN-BUILDER.md` — Arbeitspakete B0–B8 mit Fertig-Kriterien. Reihenfolge ist
   verbindlich.
3. `docs/intern/REVISIONSPLAN-BUILDER.md` — Ausgangszustand von TellmeCrochet und Rückbau je
   Paket. Nach jedem abgeschlossenen Paket dort den Rückbau-Eintrag ergänzen.

`docs/intern/` ist per `.gitignore` ausgeschlossen und wird nie veröffentlicht. Öffentliche
Dokumentation (README, `docs/FORMAT.md`) enthält keine Marktplatz-, Monetarisierungs- oder
Strategiedetails.

## Arbeitsmodus

- Direkt und autonom innerhalb des aktuellen Pakets; keine Rückfragen zu Entscheidungen, die
  das Protokoll schon beantwortet. Eskalation nur bei: Geld, Secrets, Lizenzänderung,
  Änderung des kanonischen Formats, Änderungen am privaten TellmeCrochet-Repo.
- Git: kleine Feature-Branches, früh nach `main`, Branches löschen. Vor Commit gezielt stagen
  und `git diff --cached` prüfen. Commits auf Englisch im Conventional-Commits-Stil
  (`feat(engine): …`).
- Berichte kurz, auf Deutsch, produktsprachlich.

## Qualitätslatte

- Engine: deterministische Unit-Tests (vitest) für jede Funktion; Formen werden über Maße und
  Topologie geprüft, nie über Screenshots. Relaxation mit festem Seed.
- Keine UI-/Framework-Importe in `packages/engine`. Three.js nur in `apps/*`.
- Vor jedem Merge: `npm run typecheck` und `npm test` grün. Ungetestetes gilt als nicht fertig.

## Beziehung zu TellmeCrochet

Das Schema in `packages/engine/src/schema.ts` ist die Quelle des Builders. TellmeCrochet hat
(Stand 2026-10-28) eine eigene Kopie von Format v1 in `@tellmecrochet/shared` und übernimmt
Builder-Anleitungen nur über die Übergabe in seiner Entwurfsstruktur (`tellmecrochet.ts`,
`docs/FORMAT.md` „Hand-off to TellmeCrochet“, Protokoll E24/E25). Jede Änderung am Schema
oder an dieser Übergabe: Protokoll-Eintrag, SemVer-Major, Abstimmung mit dem Projektleiter.
