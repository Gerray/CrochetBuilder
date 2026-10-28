# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the engine package
(`@crochetbuilder/engine`) follows [Semantic Versioning](https://semver.org/).

## [Unreleased] — engine 0.2.0

### Added

- **Whole-pattern import.** `parsePatternText(text, { locale?, makeId? })` reads a pattern
  pasted from a PDF or web page into parts (name, quantity) and rows: part headers
  ("Ears (make 2)", "Kopf", "2 Ohren"), round labels anywhere in a line ("R1:", "Rnd 8 – 9",
  "6-8.", "R18+R19", "2-3 rnd.", "5.7 sc"), one row per round of a range, instruction rows
  between rounds, and a separate `preamble` (materials, abbreviations, intro). What the
  format cannot represent yet becomes an instruction row with an issue (`UNSUPPORTED_GROUP`,
  `UNSUPPORTED_SPECIAL_STITCH`, `UNSUPPORTED_JOIN`, `UNSUPPORTED_CHAIN_SPACE`,
  `UNSUPPORTED_FOUNDATION_OVAL`, `UNSUPPORTED_COLOR`, `UNREADABLE`, …). Declared stitch counts
  are kept, so `validate` reports the author's mistakes. No format change.
- `detectNotationLocale(text)`: German, US or UK terms, with a confidence.
- `parseRowText(text, locale, { previousCount })` reads what real patterns write in a
  lenient second pass: counts after the stitch ("inc x 6", "sc 2"), "repeat 6 times",
  "*…* 6 times", to the end of the round ("sc around", "(…)*", "Zun in jede M" — with the
  previous row's count), magic ring starts ("6 sc in MR", "MR 6"), every stitch-count form
  ("= 18", "[18]", "– 18", "(18 sts)"), row-level "BLO:" / "nur hinteres Maschenglied" and
  "sl-st". New error codes `needs-context` and `fill-mismatch`.
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

- Flat increase discs (and the start of every ball) no longer warp into a saddle ("potato
  chip"): the yarn's step from one round into the next no longer acts as a stiff spring, and
  the first round is never pulled tighter than its own polygon.
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

- Default stitches without a swatch are square (rows per 10 cm = stitches per 10 cm, was
  about 1.05 ×). Six increases per round now lie flat with a small margin instead of right
  at the ruffling point. Pieces without a swatch come out about 5 % taller.
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
