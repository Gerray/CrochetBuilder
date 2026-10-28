# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the engine package
(`@crochetbuilder/engine`) follows [Semantic Versioning](https://semver.org/).

## [Unreleased] — engine 1.0.0, format version 2

### Breaking

- **Format version 2.** `PartContent.schemaVersion` and `BuilderExport.schemaVersion` are
  `1 | 2`; parsers read both, writers write 2. Version 2 is purely additive — every
  version-1 document is a valid version-2 document — but software that only knows version 1
  rejects version-2 documents (the objects are strict). Consumers of the schema need engine
  1.0.0. The builder's file import accepts both versions.
- New members of exported unions: the op kind `group`, the stitch codes `BOBBLE`, `PUFF`,
  `POPCORN`, `PICOT`, the modifiers `FP`, `BP` and the finding codes `EMPTY_GROUP`,
  `INVALID_GROUP`, `INVALID_MODIFIER`, `UNKNOWN_COLOR`. Exhaustive `switch`es and
  `Record<StitchCode, …>` maps in consuming code have to cover them.
- A document that says `schemaVersion: 1` but uses a version-2 feature is rejected by
  `PartContentSchema` / `BuilderExportSchema` (`usesFormatV2`). `PartContentSchema` and
  `BuilderExportSchema` are refined schemas now (no `.shape` / `.extend`).
- `modifierAllowed` allows `FP` / `BP` only on SC, HDC, DC, TR and DTR; `normalizeModifiers`
  refuses FP together with BP (the same rules as validation).
- Whole-pattern import: `ImportIssueCode` loses `UNSUPPORTED_GROUP` and `UNSUPPORTED_COLOR`
  (both are read now) and gains `COLOR_UNNAMED`, `ASSEMBLY_ANGLE_GUESSED`,
  `AMBIGUOUS_INCREASE`, `DETAIL_UNASSIGNED` and `PLACEMENT_ROUND_UNKNOWN`; `UNSUPPORTED_SPECIAL_STITCH` only covers stitches without a code
  (clusters, bullions, shells …). `ImportedPart.id` and `PatternImport.colors` / `.assembly`
  are new required fields; `ParseRowWarning` gains `increase-ambiguous`.

### Added

- **Colours.** A palette in `overview.colors` (`{ id, name, hex? }`), colour changes per row
  (`Row.color`) and per op (`StitchOp.color`) that hold until the next change.
  `colorsOfStitches` resolves the working colour of every stitch, `nodeColorIndices` the
  palette index of every graph node, and `toMesh(…, { nodeColors })` carries it per vertex
  (`MeshData.colorIndex`) in every mesh style.
- **Stitch groups** (`{ kind: "group", ops }`): all stitches into one stitch — "3 sc in one",
  shells, V-stitches. A group consumes one stitch and produces the sum of its stitches; in the
  stitch graph its stitches share one anchor slot and fan out like an increase's.
- **Special stitches:** `BOBBLE`, `PUFF`, `POPCORN` (one stitch, as tall as a DC, drawn
  standing proud of the fabric) and `PICOT` (a decorative loop that does not shape the
  piece). **Relief stitches:** the modifiers `FP` / `BP` on SC, HDC, DC, TR and DTR.
- **Finish and stuffing per part:** `PartContent.finish` (`open`, `gather`, `flat`) and
  `PartContent.stuffing` (`none`, `light`, `firm`). The relaxation closes a flat finish into a
  straight seam (the two halves of the last round joined stitch by stitch); the surface mesh
  closes it with a strip instead of a pole. `buildModel` applies the part's own finish and
  stuffing and reports the finish it used (`Model.finish`).
- **Assembly:** `BuilderPart.id` and `BuilderExport.assembly` (placements `attach`, `eyes`,
  `embroidery` on a row and angle of a target part). `placementAnchor(graph, rowId, angle)`
  gives the point and outward normal of a placement on a relaxed part.
  `composeAssembly(doc, models)` puts the parts together: a rigid transform per part copy
  (attached parts sewn on with their last row, pointing outwards, mirrored second copy for a
  part ×2 with one placement), safety eyes and embroidery positions, and findings for
  unknown references and cycles. `anchorOfNode(graph, node)` is the inverse of
  `placementAnchor` (row and angle of a stitch) for creating placements by clicking.
- Validation: `INVALID_MODIFIER` (FP/BP on a stitch without a post), `UNKNOWN_COLOR` (with a
  palette), `EMPTY_GROUP` (a group with nothing worked into its stitch), `INVALID_GROUP` (MR,
  DEC, INVDEC or TOG inside a group); `validateExport` checks a whole export — part findings,
  duplicate ids and dangling assembly references. `withCurrentVersion` stamps an export and
  its parts with version 2.
- **Notation:** groups render as `(3 fM) in dieselbe M` / `(3 sc) in same st` and are read
  back; with `RenderOptions.colors` colour changes render as `[Farbe: Weiß] 6 fM` and
  `parseRowText` reads them back (`ParseRowContext.colors` maps names to ids). The parser
  knows `Relief v/h`, `RStbv`, `FPdc`/`BPtr`, "front post dc", and bobble/puff/popcorn/picot
  in German, US and UK spellings. `renderedRows(content, locale, palette)` shows colour
  changes, so do `rendered`, the PDF and the viewer.
- **Builder:** writes version 2 everywhere (new documents, demos, exports, saves; opened
  version-1 documents are upgraded). The export keeps every v2 field (palette, part ids,
  finish, stuffing, assembly). Bobble, puff, popcorn and picot are in the stitch picker,
  relief chips (Relief v/h) show on post stitches, and groups are edited as a card "in
  dieselbe Masche" (like a repeat; "in 1 M" puts a stitch into a group, "Auflösen" takes it
  apart). The 3D preview closes a part as its finish says and relaxes again when finish or
  stuffing change. Importing duplicate row ids renames them and moves the placements that
  point at them; a duplicated part gets no part id of its own.
- **Montage in the builder.** The preview switches between "Teil" and "Montage": all parts
  assembled in 3D (computed in a worker, eyes as glossy spheres) with a placement list in
  words ("Ohr ×2 an Kopf, zwischen Runde 4 und 5, ±45°"). "+ Annähen", "+ Augen" and
  "+ Stickerei" take one click on the target in the 3D view (the round under the pointer
  lights up, Escape cancels); small fields fine-tune round, angle, spacing and size; every
  edit is undoable, deleting a part removes its placements. The PDF lists the assembly and
  shows the assembled toy, the viewer has a "Teil | Montage" switch. The bunny demo comes
  sewn together.
- `ParseRowContext.rowColor`: a leading colour mark (`[Farbe: Weiß] 6 fM`) comes back as the
  row's colour (`result.color`) instead of on the first stitch, so `renderRow` text reads
  back into `Row.color`.
- **Colours in the builder.** A palette strip in the parts bar and a "Farben" section in
  "Material & Hinweise": built-in colour names with one click, own name and colour, rename,
  recolour, choose the start colour, delete (rows that use the colour switch to a replacement
  or lose the change), take the colours over into the yarn of the material list. Every row
  card shows the colour it starts in — emphasised where it changes, muted where it carries
  on — and sets or clears "Farbwechsel ab dieser Runde"; the op editor sets a colour change
  per stitch. The row text shows colour changes with the palette's names and reads them back
  (a name the palette lacks joins it). The 3D preview, the viewer and the PDF image show
  every stitch in its colour (the row highlight blends in, so it stays visible on any
  colour); PDF and viewer list the palette with swatches.
- **Finish and stuffing in the builder:** "Abschluss" (Offen, Zusammengezogen, Flach
  zusammengehäkelt) and "Füllung" (Keine, Leicht, Fest) per part, "Automatisch" showing what
  the engine decides; a large gathered last round offers a flat finish with one click.
- **Pasted patterns in format v2.** `parseRowText` reads several stitches into one stitch as
  groups ("3 sc in next st", "5 dc in same st", "3 fM in 1 M", "(3 dc, ch 2, 3 dc) in next
  st", "3 sc in each st"), taller-stitch increases ("hdc inc", "3 hdc-inc", "2 hStb-Zun"),
  bobble-family stitches with their loops in the name ("5-dc bobble", "Noppe aus 5 Stb",
  "ch-3 picot") and more relief spellings ("Reliefstäbchen vorne", "Relief-Stb h").
  `parsePatternText` gives every part an `id` and reads from the instruction sentences a
  palette (`colors`, with `hex` for common colour names or from "Color A: Gray" in the
  materials) and `Row.color` on the row after a colour change, `finish` and `stuffing` per
  part, and `assembly` placements for safety eyes and sewn-on parts; the sentences stay
  instruction rows. In German text a capitalised noun no longer starts a row ("…, 4 M
  Abstand" stays text). When in doubt the import reports instead of guessing: sentences in an
  assembly section apply only to a part they name, stuffing is read clause by clause and per
  named part, a finish is the last finishing sentence after the last stitch row (closing the
  magic ring or a round, a negated close, a brim folded up and "sew it to …" are told apart),
  placements are matched by round label only, colour choices and stripes, felt, knots and
  "same colour" are no colour changes, and the written count decides "3 hdc inc". Sentences
  over 300 characters are not read for details, so long lines stay fast.

## [0.2.0] — not released separately

### Added

- **Patterns with several parts in the builder** (head, body, arms ×2 …). A parts bar above
  the rows shows every part with its quantity, stitch count and validation light; parts are
  added ("+ Teil"), renamed in place, duplicated (fresh row ids, "(Kopie)"), moved and
  deleted (undoable). Alt+↑/↓ switches parts; the 3D view, stats and findings follow the
  shown part, and the total over all parts × quantity is shown. Saved documents keep all
  parts (older saves load unchanged). The PDF starts with a parts overview and has one
  section per part; the viewer gets part tabs. New demo "Hase (einfach)". The canonical
  format is unchanged.
- **"Anleitung einfügen" in the builder.** Paste a whole pattern (from a PDF or a web page)
  — via the top bar, the offer in an empty pattern, or Ctrl+V outside a text field — and see
  a live preview next to the text: notation (Deutsch / US / UK, a doubtful detection must be
  confirmed), parts with editable name and quantity, every round as it will appear
  ("Runde 5–8: 24 fM (24)") with a status, Soll/Ist for wrong stitch counts and a German
  message per import finding, a summary and a "nur Problemstellen" filter. A click on a line
  marks its source line in the text, so it can be fixed in place. "Als neue Anleitung
  übernehmen" replaces the pattern (title from the text), "Teile hinzufügen" appends the
  parts; both are one undo step, keep the part limits and can put materials and
  abbreviations into the pattern notes. Text that stayed unread becomes an instruction row
  labelled „Nicht gelesen“ / „Nicht unterstützt“ with the original text. The preview is
  computed in a Web Worker, so large pastes do not block typing.
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
  "sl-st". New error codes `needs-context` and `fill-mismatch`; the result may carry
  `rounds` ("(4 rounds)") and `warnings` where the written count decided between two
  readings ("sc, inc x6 (18)", "rep from * 5 times"). When in doubt the row fails rather than
  being misread ("6 inc 12", "2 hdc in next st").
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
