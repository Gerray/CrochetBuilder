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
- `npm run typecheck` and `npm test` must be green (`npm run check` runs both plus the build).
- Keep the engine free of UI and framework imports. Three.js belongs in the apps.
- Bug reports about a specific pattern: attach the pattern as JSON (export from the builder)
  and say what you expected to see.

## Development

Node.js 20.19+ (22 LTS recommended; `nvm use` reads `.nvmrc`). Then `npm install` once.
Keep the repository's `.npmrc` — it works around an npm 10.9 bug with Vitest 4.

| Command | What it does |
|---|---|
| `npm start` | Builder dev server at http://localhost:5190, opens the browser |
| `npm run dev` | The same without opening the browser (`npm run dev -- --port 5191` for another port) |
| `npm test` | All unit tests once (Vitest); `npm run test:watch` re-runs on change |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run build` | Production build of the builder (incl. viewer) into `apps/builder/dist` |
| `npm run preview` | Serves that build locally |
| `npm run check` | typecheck + test + build — run this before opening a pull request |
| `npm run e2e` | End-to-end tests in headless Chromium (see below) |

Run a single test file, or only tests whose name matches:

```bash
npx vitest run packages/engine/src/relax.test.ts
npx vitest run -t "stitch count"
```

### Tests

- Tests are deterministic: the relaxation uses a fixed seed, so the same pattern always
  gives the same positions. Never depend on timing or `Math.random`.
- Shapes are checked by numbers — sizes, round diameters, node and edge counts, closedness —
  not by screenshots. A test for "a ball" asserts that the piece is closed and roughly as
  wide as it is tall.
- Engine tests live next to the code (`foo.ts` → `foo.test.ts`). App tests use
  Testing Library with jsdom; the 3D view is replaced by a fake in tests.
- Something without a test is not finished.

### End-to-end tests

A small Playwright suite in `e2e/` drives the real app in headless Chromium: typing a
pattern, validation, saving across a reload, JSON/PDF export and import, share links, the
viewer and its embed mode. It runs against the production build, served by `vite preview`
under `/CrochetBuilder/` like on GitHub Pages.

```bash
npx playwright install chromium   # once, downloads the browser
npm run e2e                       # builds, serves on port 4179, runs all tests
E2E_SKIP_BUILD=1 npm run e2e      # reuse an existing apps/builder/dist (PowerShell: $env:E2E_SKIP_BUILD=1)
```

Use roles, labels and visible German text as selectors (`getByRole`, `getByLabel`), not CSS
classes or test ids. Assert the 3D view by its reported size in cm and by the canvas being
there — never by screenshots. Every test fails on a console error or an uncaught exception.
On failure, traces and screenshots land in `e2e/test-results/`; `npx playwright show-report
e2e/playwright-report` opens the report. CI runs the suite on every pull request and before
each deployment.

### Where things live

| Path | Contents |
|---|---|
| `packages/engine/src/schema.ts` | Canonical pattern format (Zod). Changes are rare — see above. |
| `packages/engine/src/expand.ts`, `stitch-count.ts`, `validate.ts` | Expansion of repeats into stitches, stitch-count and consumes checks |
| `packages/engine/src/gauge.ts` | Gauge and yarn-weight defaults → stitch size in mm |
| `packages/engine/src/graph.ts`, `relax.ts`, `measure.ts`, `mesh.ts`, `model.ts` | Stitch graph, relaxation, measurements, mesh data, and the `buildModel` pipeline |
| `packages/engine/src/notation.ts` | Parsing and rendering row text (German, US, UK terms) |
| `packages/engine/src/export.ts` | Export file schema |
| `packages/engine/src/index.ts` | The public API — everything the apps may import |
| `apps/builder/src/components` | Editor UI (React) |
| `apps/builder/src/state` | Document model, editing actions, saving in the browser (IndexedDB) |
| `apps/builder/src/preview`, `apps/builder/src/three` | Model building in a web worker, Three.js view |
| `docs/FORMAT.md` | The pattern format, for people and other software |

## Scope questions

If you are unsure whether something fits, open an issue first. Out-of-scope requests get a
friendly "no" with a pointer, not silence.
