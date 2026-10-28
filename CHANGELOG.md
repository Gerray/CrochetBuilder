# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the engine package
(`@crochetbuilder/engine`) follows [Semantic Versioning](https://semver.org/).

## [Unreleased] — engine 0.2.0

### Added

- **Yarn thickness in mm.** The gauge accepts an optional `yarnDiameterMm` (0 < x ≤ 30).
  Without a swatch it sets the stitch size — interpolated over the yarn weight table and
  scaled by the hook — and wins over the yarn weight. It is always the rendered yarn
  thickness, also with a swatch. See [`docs/FORMAT.md`](docs/FORMAT.md#gauge).
- Builder: a "Garndicke" field (mm) next to the yarn weight, typical thicknesses in the yarn
  weight list, and a hint which inputs drive the size. PDF and viewer list the thickness.
- **Stitch-level 3D model.** New mesh style `toMesh(graph, "stitches")`: every stitch is a
  yarn loop with its V top, posts and wraps; increases, decreases, chains and the magic ring
  have their own shapes. It is the default "Maschen" view in the builder, the viewer and
  the PDF image.
- `flatIncreasesPerRound(gauge, code)`: the increases per round that make a circle lie
  flat (2π · stitch height / width). The builder shows it next to the swatch fields
  ("Flacher Kreis in fM: ca. 8 Zunahmen pro Runde").
- Share links are documented in [`docs/FORMAT.md`](docs/FORMAT.md#share-links);
  `ShareDecodeError` gains the code `unsupported` (browser without deflate-raw streams).
- `toMesh` options `smooth` (surface: 0–2 subdivision steps or `"auto"`, which keeps the
  stitch vertices and rounds the fabric off) and `closed` (override of `isClosedPiece`, as
  for `relax`).

### Fixed

- Closed pieces are closed at the top in every mesh style: the surface fans the last round
  to a closing pole (watertight, like the magic ring at the start), the stitch lattice
  gathers the last round's front loops into a cinched ring, the tube runs on to the pole.
  Surface normals are angle-weighted.

- Share links: decompression is streamed in small slices so the 2 MiB cap holds in
  browsers; links are limited to 256 Ki characters; deeply nested payloads are rejected
  as `invalid` instead of overflowing the stack.
- PDF: long words without spaces wrap in linear time; decomposed umlauts and ligatures
  survive the WinAnsi conversion.

### Changed

- Engine version 0.2.0. Parsers older than 0.2.0 reject a gauge that contains
  `yarnDiameterMm`, because the gauge object is strict.

## [0.1.0] — 2026-10-27

First version (not published as a package).

### Added

- **Engine:** pattern schema with rows, rounds, stitch codes, modifiers and repeat groups;
  expansion and stitch counting; validation of counts and consumption; free-text row
  notation (German and English); gauge from swatch or yarn weight and hook; stitch graph,
  mass–spring relaxation with a fixed seed, measurements and mesh; builder export schema;
  compressed share payloads.
- **Builder:** row-by-row editor with free-text input, undo/redo, local autosave and demo
  patterns; live 3D preview in real size (surface, yarn and point styles) in a web worker.
- **Export and sharing:** JSON export and import, PDF export, "open in TellmeCrochet" links,
  share links and an embeddable read-only viewer.
- **Quality:** unit tests (Vitest) for engine and builder, end-to-end tests (Playwright), CI
  and GitHub Pages deployment.
