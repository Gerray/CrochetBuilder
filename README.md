# CrochetBuilder

**Write a crochet pattern row by row — and watch the piece take shape in 3D while you type.**

**Try it in your browser:** https://gerray.github.io/CrochetBuilder/ — nothing to install.
*(The link goes live with the first deployment.)*

<!-- TODO: add docs/screenshot.png and uncomment:
![CrochetBuilder: pattern editor on the left, live 3D model on the right](docs/screenshot.png)
-->

CrochetBuilder is a free, open-source desktop web app for crochet pattern designers. The left
pane is an editor for rows and rounds; the right pane is a live 3D model of what you will get
when you follow the pattern, in real-world size. If the model renders, the pattern is
topologically sound: stitch counts add up, increases and decreases match the previous round,
nothing is left hanging.

## Features

- **Row-by-row editor** — structured, or type free-text notation such as
  `6× (1 sc, 1 inc)` (German: `6× (1 fM, 1 Zun)`).
- **Live 3D model in real size** — from your gauge swatch, or from yarn weight or yarn
  thickness in mm and hook size.
- **Validation while you type** — stitch counts per row and whether every stitch of the
  previous row is worked into exactly as often as the pattern says.
- **Export** — open the pattern in [TellmeCrochet](https://tellmecrochet.de) (the companion
  app for crocheting stitch by stitch), or save it as PDF or JSON.
- **Share links and an embeddable viewer** — send a link that shows the 3D model and the
  pattern.
- **Private by design** — everything runs in your browser. No account, no server; a share
  link carries the pattern in the URL fragment, which is never sent to a web server.

The user interface is in German for now; English is on the roadmap.

## How it works

```
pattern (rows / rounds / ops)  →  stitch graph  →  relaxation  →  mesh + measurements
```

1. **Parse / edit.** Every row is a list of operations: a stitch code (`SC`, `DC`, `INC`,
   `DEC`, `MR`, `BOBBLE`, `PICOT`, …) with a count, optional modifiers (`BLO`, `FLO`, `TOG`,
   `FP`, `BP`), nested repeat groups like `6× (1 SC, INC)` and groups of stitches worked into
   one stitch ("3 sc in one", shells). Rows and stitches can change the yarn colour; a part
   says how it is finished and stuffed. Stitch counts and consumption are checked here. The
   format is documented in [`docs/FORMAT.md`](docs/FORMAT.md).
2. **Build the graph.** Each worked stitch becomes a node. It is linked to the previous
   stitch in its row and to the stitch(es) of the previous row it is worked into. Increases
   fan out, decreases fan in. The topology of the finished piece is decided here.
3. **Size it.** Every edge gets a rest length from your gauge: stitch width horizontally,
   stitch height vertically (a double crochet is roughly twice as tall as a single). Without
   a swatch, yarn weight and hook give a plausible estimate.
4. **Relax.** A mass–spring solver with a fixed seed pulls the graph into the shape where
   all edges are at rest length. Rounds with increases curve into discs and spheres on their
   own. The same pattern always gives the same shape.
5. **Mesh and measure.** The relaxed graph becomes yarn tubes for the 3D view, and the
   engine reports the finished size (width, height, depth, largest round diameter) in
   millimetres.

The approach follows [CrochetPARADE](https://crochetparade.org) and the paper *Modeling
Crochet Patterns with a Force-directed Graph Layout* (Eurographics).

## Run it locally

You need [Node.js](https://nodejs.org/) 20.19 or newer (22 LTS recommended) and, optionally,
[Git](https://git-scm.com/). The commands are the same on Windows (PowerShell or Command
Prompt), macOS and Linux:

```bash
git clone https://github.com/Gerray/CrochetBuilder.git
cd CrochetBuilder
npm install
npm start
```

Your browser opens at http://localhost:5190. Stop the server with `Ctrl+C`.

**Without Git:** on the [repository page](https://github.com/Gerray/CrochetBuilder) click
**Code → Download ZIP**, unpack it, open a terminal in the unpacked folder
(`CrochetBuilder-main`) and run `npm install` and `npm start`.

### Troubleshooting

- **Port 5190 is already in use** — another copy of the dev server is probably still
  running; close it, or run `npm run dev -- --port 5191` and open that port instead.
- **`Unsupported engine` or syntax errors on install/start** — your Node.js is too old.
  Check with `node --version`; install the current LTS from [nodejs.org](https://nodejs.org/)
  (with nvm: `nvm use` picks the version from `.nvmrc`).
- **Peer-dependency warnings** — expected. The repository's `.npmrc` sets
  `legacy-peer-deps=true` to work around an npm 10.9 resolution bug with Vitest 4; plain
  `npm install` / `npm ci` work as they are. Do not delete `.npmrc`.
- **The browser does not open** — open http://localhost:5190 yourself.

## Self-hosting

```bash
npm run build
```

writes static files to `apps/builder/dist` (the builder, plus the viewer page in
`apps/builder/dist/viewer/`). Copy that folder to any static web host — GitHub Pages,
Netlify, an S3 bucket, a folder on your own server. All asset paths are relative, so it
works under any sub-path, and there is no server-side code. `npm run preview` serves the
build locally to try it first.

## Using the engine

`packages/engine` is a UI-free TypeScript library (one runtime dependency, `zod`) that runs
in the browser and in Node. It is not published to npm yet; inside this repository it is the
workspace package `@crochetbuilder/engine`.

```ts
import { buildModel, parseRowText, toMesh, validate, type PartContent, type Row } from "@crochetbuilder/engine";

const lines = ["1 MR, 6 sc (6)", "6 inc (12)", "6× (1 sc, 1 inc) (18)"];

const rows: Row[] = lines.map((text) => {
  const parsed = parseRowText(text, "en_us"); // also "en_uk" and "de"
  if (!parsed.ok) throw new Error(`${parsed.code} at ${parsed.position}`);
  return { id: crypto.randomUUID(), type: "round", ops: parsed.ops, stitchCountTarget: parsed.stitchCountTarget ?? 0 };
});
const content: PartContent = { schemaVersion: 2, rows };

validate(content);                                              // [] — no findings
const model = buildModel(content, { yarnWeight: "dk", hookMm: 4 });
model.size;                                                     // { width, height, depth } in mm
model.maxDiameter;                                              // ≈ 28 mm
const mesh = toMesh(model.graph, "tube", { finish: model.finish }); // positions, normals, indices
```

The pattern format is specified in [`docs/FORMAT.md`](docs/FORMAT.md); the full public API is
exported from [`packages/engine/src/index.ts`](packages/engine/src/index.ts) (schema,
expansion, validation, graph, relaxation, measurements, mesh, notation, export schema).

## Packages

| Package | What it is |
|---|---|
| [`packages/engine`](packages/engine) | The library: pattern schema (Zod), gauge, stitch expansion, validation, stitch graph, relaxation, measurements, mesh data, row notation (parse and render). No UI; runs in Node and the browser. |
| [`apps/builder`](apps/builder) | The desktop web app (Vite + React + Three.js): editor on the left, 3D preview on the right, export, share links. Its build also contains the viewer page for share links and embeds. |

## Status and roadmap

Working today:

- Pattern engine: schema, validation, stitch graph, relaxation, measurements, mesh
- Format version 2 in the engine: colours, stitch groups, bobble/puff/popcorn/picot, relief
  stitches, finish and stuffing per part, placements for assembly (editor support follows)
- Editor: structured and free-text row input, German and English stitch notation; patterns
  with several parts (head, body, arms ×2 …), each with its own rows and quantity
- Live 3D preview in real size
- Export to TellmeCrochet, PDF and JSON; share links and embeddable viewer

Next:

- Import from TellmeCrochet
- Feedback round with pattern designers

Later:

- Assembling the parts of a piece in 3D
- Colour changes and the other format-2 features in the editor and the 3D view
- English user interface

## Contributing

Bug reports, ideas and pull requests are welcome — please read
[`CONTRIBUTING.md`](CONTRIBUTING.md) first. For a bug with a specific pattern, attach the
pattern as JSON (export from the builder).

## License

[AGPL-3.0](LICENSE). You may use, study, modify and self-host CrochetBuilder, including
commercially. If you distribute it, or run a modified version as a service that other
people use over a network, you must make your source code available under the same license.
Patterns you create with CrochetBuilder are yours; the license covers the software, not your
designs.
