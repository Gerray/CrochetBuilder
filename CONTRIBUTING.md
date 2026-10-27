# Contributing

Thanks for looking. A few things to know before opening an issue or a pull request.

## What this project is

- A pattern engine (schema, validation, stitch graph, relaxation, mesh) and a desktop
  builder app for crochet pattern designers.
- The canonical pattern format is the one in `docs/FORMAT.md`. Changes to it are rare and
  need a strong reason, because other software reads it.

## What it is not

- Not an account system or a mobile app. Following a pattern stitch by stitch on a phone is
  what TellmeCrochet is for.
- Not a general yarn-level cloth simulator. The solver is deliberately simple
  (mass–spring, no self-collision) so it runs in a browser tab.
- Not a parser for free-text patterns from the wild. The builder is a structured editor;
  the row-text helper is a convenience, not a promise.

## Ground rules

- Every change to `packages/engine` comes with deterministic unit tests (vitest). Shapes are
  tested by measurements and topology, never by screenshots.
- `npm run typecheck` and `npm test` must be green.
- Keep the engine free of UI and framework imports. Three.js belongs in the apps.
- Bug reports about a specific pattern: attach the pattern as JSON (export from the builder)
  and say what you expected to see.

## Scope questions

If you are unsure whether something fits, open an issue first. Out-of-scope requests get a
friendly "no" with a pointer, not silence.
