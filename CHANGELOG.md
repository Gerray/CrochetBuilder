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
