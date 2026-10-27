# CrochetBuilder

**Write a crochet pattern row by row — and watch the piece take shape in 3D while you type.**

CrochetBuilder is a desktop web app for pattern designers. The left pane is a structured
editor for rows and rounds; the right pane is a live 3D model of what you will get when you
follow the pattern, in real-world size derived from your gauge (or yarn weight + hook).
If the model renders, the pattern is topologically sound: stitch counts add up, increases
and decreases match the previous round, nothing is left hanging.

> Demo GIF: coming with the first preview build (see roadmap).

## Why

Pattern errors are usually found by the person crocheting — at round 14, with a half-made
toy in hand. A pattern that can be turned into a stitch graph and relaxed into a mesh
cannot have those errors. The 3D preview is the designer's proof-read, and it is a lot more
fun than counting.

## How it works

```
pattern (rows / rounds / ops)  →  stitch graph  →  force-directed relaxation  →  mesh
```

1. **Parse / edit.** Every row is a list of operations: a stitch code (`SC`, `DC`, `INC`,
   `DEC`, `MR`, …) with a count, optional modifiers (`BLO`, `FLO`, `TOG`) and nested repeat
   groups like `6× (1 SC, INC)`. The format is documented in [`docs/FORMAT.md`](docs/FORMAT.md).
2. **Build the graph.** Each worked stitch becomes a node. It is linked to the previous
   stitch in its row and to the stitch(es) of the previous row it is worked into. Increases
   fan out, decreases fan in. The topology of the finished piece is already decided here.
3. **Measure.** Every edge gets a rest length from your gauge: stitch width horizontally,
   stitch height vertically (a double crochet is roughly twice as tall as a single).
4. **Relax and render.** A mass–spring solver pulls the graph into the shape where all
   edges are at rest length. Rounds with increases curve into spheres on their own.
   The result is rendered as yarn tubes.

The same approach powers [CrochetPARADE](https://github.com/crochetparade) and is described
in *Modeling Crochet Patterns with a Force-directed Graph Layout* (Eurographics).

## Packages

| Package | What it is |
|---|---|
| `packages/engine` | The library: pattern schema (Zod), gauge resolution, stitch expansion, validation, and — coming — graph, relaxation and mesh export. No UI, runs in Node and the browser. |
| `apps/builder` | The desktop web app (Vite + React + Three.js): editor on the left, 3D preview on the right, export. |
| `apps/viewer` | *(planned)* A lightweight page for share links and embeds: rotate the model, open the pattern in TellmeCrochet. |

The engine is also used by [TellmeCrochet](https://tellmecrochet.de), the companion app for
crocheting a pattern stitch by stitch on your phone. "Open in TellmeCrochet" is the primary
export; PDF and JSON are available too.

## Status and roadmap

| Step | Scope | State |
|---|---|---|
| B0 | Repository scaffold, CI, license | done |
| B1 | Schema, stitch expansion, stitch-count and consumes checks, gauge | engine side done |
| B2 | Stitch graph, relaxation, measurements, golden-shape tests | next |
| B3 | Structured editor | |
| B4 | 3D preview | |
| B5 | Export (TellmeCrochet, PDF, JSON), viewer, share links | |

## Development

```bash
npm install
npm run typecheck
npm test
npm run builder:dev
```

Node 20 or newer. The engine has a single runtime dependency (`zod`); Three.js is used only
in the apps.

## License

AGPL-3.0. You may use, modify and self-host CrochetBuilder; if you run a modified version
as a service, you must publish your changes under the same license. See [`LICENSE`](LICENSE).
