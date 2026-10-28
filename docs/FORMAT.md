# Pattern format

The canonical, language-neutral representation of a crochet pattern. It is what the engine
validates, expands and renders, what the builder saves, and what other software can read.
Stitches are stored as **codes**, never as display text; rendering to German, US or UK
terminology is a separate concern.

Schema source: `packages/engine/src/schema.ts` (Zod). Version: `schemaVersion: 2` (engine 1.0.0).
Parsers read versions 1 and 2, writers write 2. Version 2 only adds fields and codes (see
[Format version 2](#format-version-2)), so every version-1 document is a valid version-2 document
and needs no migration.

## Part content

A pattern consists of one or more **parts** (head, body, arm…). Each part is a list of rows.

```ts
type PartContent = {
  schemaVersion: 1 | 2;       // writers write 2
  rows: Row[];
  finish?: "open" | "gather" | "flat";      // v2, see "Finish and stuffing"
  stuffing?: "none" | "light" | "firm";     // v2
};

type Row = {
  id: string;                 // stable UUID — never regenerated on edit or reorder
  label?: string;             // "Round 3"
  type: "row" | "round";      // row = turn at the end; round = continue in a spiral
  ops: Op[];
  stitchCountTarget: number;  // stitches on the fabric after this row, as the author declares
  note?: string;              // free text shown with the row
  color?: string;             // v2: palette id, working colour from the start of this row
};

type Op = StitchOp | RepeatGroup | StitchGroup;

type StitchOp = {
  kind: "stitch";
  code: StitchCode;
  count: number;              // ≥ 1
  modifiers?: ("BLO" | "FLO" | "TOG" | "FP" | "BP")[];
  into?: string;              // display-only note, e.g. "into the chain space"
  color?: string;             // v2: palette id, working colour from this op on
};

type RepeatGroup = { kind: "repeat"; times: number; ops: Op[] };   // nests freely

// v2: all stitches into the same stitch. Contains stitches and repeats, never another group.
type StitchGroup = { kind: "group"; ops: (StitchOp | RepeatGroup)[] };
```

A row with no ops but with a `note` or `label` is a **free instruction** ("insert safety
eyes between rounds 8 and 9"). It is a step for the person crocheting, not a stitch.

## Stitch codes

| Code | Meaning | produces | consumes |
|---|---|---|---|
| `CH` | chain | 0 | 0 |
| `SL_ST` | slip stitch | 1 | 1 |
| `SC` | single crochet (US) / double crochet (UK) | 1 | 1 |
| `HDC` | half double crochet | 1 | 1 |
| `DC` | double crochet (US) / treble (UK) | 1 | 1 |
| `TR` | treble (US) / double treble (UK) | 1 | 1 |
| `DTR` | double treble (US) | 1 | 1 |
| `MR` | magic ring (opens a round) | 0 | 0 |
| `INC` | increase: two stitches into one | 2 | 1 |
| `DEC` | decrease: two stitches worked together | 1 | 2 |
| `INVDEC` | invisible decrease | 1 | 2 |
| `ST` | generic stitch | 1 | 1 |
| `BOBBLE` | bobble (v2) | 1 | 1 |
| `PUFF` | puff stitch (v2) | 1 | 1 |
| `POPCORN` | popcorn (v2) | 1 | 1 |
| `PICOT` | picot: a decorative loop (v2) | 0 | 0 |

**produces** is how many stitches one worked instance adds to the fabric count — the basis
of the stitch-count check (`Σ produces == stitchCountTarget`).
**consumes** is how many stitches of the previous row it is worked into — the basis of the
graph and of the consumes check (`Σ consumes(row n) == Σ produces(row n−1)`).

Modifiers never change the fabric count. `BLO`/`FLO` only affect how a stitch is drawn;
`TOG` turns a stitch that consumes 1 into one that consumes 2 (`SC` + `TOG` = sc2tog).
`FP`/`BP` (v2, front post / back post) work the stitch around the post of the stitch below;
they are valid only on `SC`, `HDC`, `DC`, `TR` and `DTR`, and never both on one stitch
(validation finding `INVALID_MODIFIER`).

Bobble, puff and popcorn stand as tall as a double crochet and are drawn standing proud of
the fabric. A picot sits on the yarn path between its neighbours; nothing is worked into it
and it does not shape the piece.

## Gauge

Optional, carried alongside the pattern in the builder export (`overview.gauge`). The
hand-off to TellmeCrochet turns it into a text step (see
[Hand-off to TellmeCrochet](#hand-off-to-tellmecrochet)).

```ts
type Gauge = {
  stitchesPer10cm?: number;
  rowsPer10cm?: number;
  yarnWeight?: "lace" | "fingering" | "sport" | "dk" | "worsted" | "aran" | "bulky" | "jumbo";
  hookMm?: number;
  yarnDiameterMm?: number;   // yarn thickness in mm, 0 < x ≤ 30 (since engine 0.2.0)
};
```

Resolution order for the stitch size:

1. an explicit swatch (`stitchesPer10cm`/`rowsPer10cm`) wins;
2. otherwise `yarnDiameterMm` + `hookMm`: the thickness is interpolated over the yarn weight
   table (stitch width, row height and standard hook, piecewise linear between the two
   neighbouring weights; proportional below the thinnest and above the thickest weight,
   constant below 0.5 mm and above 12 mm), then scaled by `hookMm` relative to that
   standard hook. It wins over `yarnWeight` when both are given;
3. otherwise defaults from `yarnWeight` + `hookMm`;
4. otherwise the engine default (DK, 4 mm).

Without a swatch the result is flagged as estimated (`source: "yarn-weight"` for cases 2
and 3, `"default"` for case 4). The rendered yarn thickness is `yarnDiameterMm` whenever it
is given — also with a swatch — and otherwise the table value of the yarn weight.

| `yarnWeight` | thickness | stitches / 10 cm | rows / 10 cm | standard hook |
| ------------ | --------: | ---------------: | -----------: | ------------: |
| `lace`       |    1.0 mm |               32 |           32 |        2.0 mm |
| `fingering`  |    1.5 mm |               28 |           28 |        2.5 mm |
| `sport`      |    2.0 mm |               24 |           24 |        3.0 mm |
| `dk`         |    2.5 mm |               20 |           20 |        4.0 mm |
| `worsted`    |    3.0 mm |               16 |           16 |        5.0 mm |
| `aran`       |    3.5 mm |               14 |           14 |        5.5 mm |
| `bulky`      |    5.0 mm |               11 |           11 |        7.0 mm |
| `jumbo`      |    8.0 mm |                7 |            7 |       10.0 mm |

Single crochet is taken as square, as with a swatch that gives only stitches. A circle then
lies flat at 2π ≈ 6.3 increases per round, so six increases lie flat or cup very slightly
(see `flatIncreasesPerRound`).

Parsers older than engine 0.2.0 reject a gauge with `yarnDiameterMm` (the gauge object is
strict).

## Builder export

```ts
type BuilderExport = {
  schemaVersion: 1 | 2;       // writers write 2
  title: string;
  overview: {
    materials?: Material[];
    gauge?: Gauge;
    notes?: string;
    colors?: PaletteColor[];  // v2
  };
  parts: { id?: string; name: string; quantity: number; content: PartContent }[];   // id: v2
  rendered?: { locale: "de" | "en_us" | "en_uk"; rows: string[] };   // a view, not the source
  assembly?: Placement[];     // v2
};

type Material = { kind: "yarn" | "hook" | "accessory"; label: string; colors?: string[]; amount?: string };

type PaletteColor = { id: string; name: string; hex?: string };   // hex: "#rrggbb"

type Placement = {
  id: string;
  kind: "attach" | "eyes" | "embroidery";
  part?: string;              // the part that is attached (kind "attach"): a part id
  target: string;             // the part it is placed on: a part id
  row: string;                // a row id of the target part
  angle: number;              // degrees around the target, see "Assembly"
  spacing?: number;           // distance in stitches, e.g. between two eyes
  size?: number;              // size in mm, e.g. of a safety eye
  note?: string;
};
```

`rendered` is redundant with `parts` and exists so that consumers which only display text
can do so without understanding the op tree.

The schema checks the shape of an export only. Whether ids are unique and references resolve
(colour ids used by rows and stitches, part and row ids used by placements) is reported by
`validateExport`, so that a document with a dangling reference can still be loaded and
repaired.

## Format version 2

Version 2 adds colours, stitch groups, four stitch codes, two modifiers, a part's finish and
stuffing, part ids and an assembly. Nothing was removed or renamed. Software that only knows
version 1 rejects version-2 documents (the objects are strict); it needs engine 1.0.0.

Writers write `schemaVersion: 2` on the export and on every part. A document that says
`schemaVersion: 1` but uses anything of version 2 is **rejected by the schema**, so a
version-1 label always means the document can be read by version-1 software:

- a part with `finish`, `stuffing`, a row or stitch `color`, a stitch group, one of the codes
  `BOBBLE`, `PUFF`, `POPCORN`, `PICOT` or one of the modifiers `FP`, `BP`;
- an export with `overview.colors`, `assembly`, a part `id`, or a part that says version 2.

A version-2 export may contain parts that say version 1.

### Colours

The palette lists the yarn colours of the whole pattern in `overview.colors`. Rows and
stitches refer to a colour by its `id`:

- `Row.color` changes the working colour at the start of the row,
- `StitchOp.color` changes it at that op.

A change holds until the next one, also across rows — as "change to white" does in a written
pattern. Before the first change the work is in the palette's first colour. A colour id that
is not in the palette is a validation error (`UNKNOWN_COLOR`); the engine ignores it when it
resolves colours (`colorsOfStitches`, `nodeColorIndices`).

```json
{
  "overview": { "colors": [{ "id": "c1", "name": "White", "hex": "#f4f1ea" }, { "id": "c2", "name": "Pink", "hex": "#e8a0b4" }] },
  "parts": [{ "id": "head", "name": "Head", "quantity": 1, "content": { "schemaVersion": 2, "rows": [
    { "id": "r1", "type": "round", "ops": [{ "kind": "stitch", "code": "MR", "count": 1 }, { "kind": "stitch", "code": "SC", "count": 6 }], "stitchCountTarget": 6 },
    { "id": "r2", "type": "round", "color": "c2", "ops": [{ "kind": "stitch", "code": "INC", "count": 6 }], "stitchCountTarget": 12 },
    { "id": "r3", "type": "round", "ops": [{ "kind": "repeat", "times": 6, "ops": [
      { "kind": "stitch", "code": "SC", "count": 1, "color": "c1" },
      { "kind": "stitch", "code": "INC", "count": 1, "color": "c2" }
    ] }], "stitchCountTarget": 18 }
  ] } }]
}
```

Round 1 is white (the first colour), round 2 pink, round 3 alternates white and pink.

In the rendered text (`rendered`, PDF, viewer) a colour change is written in front of the
stitch it starts at, with the palette name: `[Farbe: Weiß] 6 fM` (US `[Color: White]`, UK
`[Colour: White]`). The row notation reads these marks back.

### Stitch groups

A group works all its stitches into **one** stitch of the previous row: "3 sc in the next
stitch", a half-double increase, a shell, a V-stitch, a corner. It consumes one stitch and
produces the sum of its stitches. It may contain stitches and repeats, not another group.

- Chains and picots inside a group are not worked into the stitch; a group that contains
  nothing else (or nothing at all) consumes no stitch and is reported as `EMPTY_GROUP`
  (warning). A row that consists only of such a group of chains is a foundation chain.
- An `INC` inside a group adds its two stitches to the group's stitch: `(INC, SC)` in one
  stitch produces 3 and consumes 1.
- A magic ring, `DEC`, `INVDEC` or a stitch with `TOG` cannot be worked into a single
  stitch; inside a group they are a validation error (`INVALID_GROUP`).
- In the row notation a group is written `(3 fM) in dieselbe M` / `(3 sc) in same st`.

```json
{ "kind": "repeat", "times": 6, "ops": [{ "kind": "group", "ops": [{ "kind": "stitch", "code": "SC", "count": 3 }] }] }
```

Worked into a round of 6, this round consumes 6 and produces 18. A V-stitch is
`{ "kind": "group", "ops": [DC, CH, DC] }`: it consumes 1 and produces 2 (the chain counts
for nothing, as everywhere). In the 3D model the stitches of a group fan out of their shared
stitch like the two stitches of an increase.

### Finish and stuffing

`PartContent.finish` says how the last round is closed:

| `finish` | Meaning |
|---|---|
| `"open"` | left open (an arm sewn on open, a hat) |
| `"gather"` | pulled shut through the front loops (the end of a ball) |
| `"flat"` | flattened and crocheted shut through both layers (an ear, a flat arm) |

`PartContent.stuffing` is `"none"`, `"light"` or `"firm"`. Without these fields the engine
guesses: a piece that starts with a magic ring, consists of rounds and ends with fewer than
half the stitches of its widest round is gathered and stuffed firmly; anything else is open
and not stuffed. A flat-finished part is not stuffed unless it says so.

### Assembly

`assembly` places parts, safety eyes and embroidery on other parts. Parts are referenced by
`BuilderPart.id`, which has to be unique and stay the same when parts are renamed or moved.

- `row`: the placement sits between this row of the target and the next one.
- `angle`: degrees around the target's rounds. `0` is the **front**, opposite the start of the
  round (where the jogs of a spiral line up at the back); positive angles turn to the right
  **as seen from the front**, so `90` is on the right of the picture and `-90` on the left.
- `spacing` is in stitches, `size` in millimetres.

The angle refers to the target part in its **own pose**, the pose the engine relaxes every
part into:

- Rounds: **up is the direction the rounds grow**, the magic ring (the first round) is at the
  bottom. "Seen from the front" means looking at the front (angle 0) with the rounds growing
  upwards. This holds for every part, also for one worked from the top down (a hat, a head
  started at the crown): its angles are still counted with its first round at the bottom. Turned
  the right way up, such a part has right and left swapped — that is up to the assembly in 3D,
  which places the parts; the placement itself never depends on how a part is put on.
- Flat pieces (rows): the piece lies with its rows running left to right and growing upwards,
  the front (the side the surface normal points to) facing the viewer. The angle runs along
  the row: `-180` is the left end, `0` the middle, `180` the right end; the normal is the
  front's.

```json
"assembly": [
  { "id": "eyes", "kind": "eyes", "target": "head", "row": "r9", "angle": 0, "spacing": 6, "size": 8 },
  { "id": "ear-l", "kind": "attach", "part": "ear", "target": "head", "row": "r4", "angle": -40, "note": "sew on flat" },
  { "id": "nose", "kind": "embroidery", "target": "head", "row": "r11", "angle": 0, "size": 4 }
]
```

`placementAnchor(graph, rowId, angle)` returns the point and the outward normal of a
placement on a relaxed part; `anchorOfNode(graph, node)` is its inverse (the row and angle of
a stitch).

`composeAssembly(doc, models)` builds the assembled scene from the relaxed parts. How the
engine reads a placement in 3D:

- The part nothing is attached *with* (no `attach` placement of its own) stays in its own
  pose; with several such parts the one that has something attached to it, then the largest,
  is the centre and the others are set beside it.
- An attached part is sewn on with its **last row** (the open end, the flat seam or the
  gathered end). Its centre goes to the placement's point, the part points outwards along
  the surface normal (its first row is the tip). Its front (angle 0) turns towards the
  target's front; a flat-finished part (or a piece in rows) lays its seam along the target's
  round instead. A placement on the target's last row is centred on that end (a head on the
  open top of a body); the angle then only turns the part.
- `attach` placements of the same part apply to its copies in order. A part with quantity 2
  or more and a single placement gets its second copy mirrored: same row, angle `-angle`
  (ears, arms, legs). Copy *k* of an attached part goes onto copy *k* of its target when the
  target has one.
- `eyes`: two eyes at `angle ± spacing / 2` stitches along the row (one eye without
  `spacing`), `size` mm across (10 mm when missing), half sunk into the surface.

Placements whose part, target or row does not exist, parts attached to themselves and
cycles (A on B, B on A) are reported; the parts concerned are set beside the scene.

## Share links

A share link carries a complete `BuilderExport` in the URL **fragment**, so it works without
any server — browsers never send the fragment to the host. Source:
`packages/engine/src/share.ts` (`encodeShare`, `decodeShare`, `readShareFragment`).

### Payload

```
payload = "v1." + base64url( deflate-raw( UTF-8( JSON.stringify(BuilderExport) ) ) )
```

- **`v1.`** — format version. Decoders refuse any other prefix (`v2.` …) instead of guessing.
- **base64url** — RFC 4648 §5 alphabet (`A–Z a–z 0–9 - _`). Encoders write no padding;
  decoders accept up to two trailing `=` and ignore them.
- **deflate-raw** — raw DEFLATE (RFC 1951) without zlib or gzip header, as produced by
  `new CompressionStream("deflate-raw")`. The stream must end exactly at the last byte;
  trailing bytes make the payload invalid.
- **JSON** — the UTF-8 encoded `BuilderExport` described above (`rendered` included when
  the producer has it).

### Limits

| Limit | Value | When exceeded |
|---|---|---|
| Encoded payload | 262,144 characters (256 Ki) | refused before decoding |
| Decompressed JSON | 2,097,152 bytes (2 MiB) | decompression stops; refused |
| JSON nesting (objects and arrays) | 200 levels | refused before schema validation |

Decoders must enforce the decompressed limit **while** inflating (feed the input in small
slices and stop at the limit), not after — a few KiB of DEFLATE can expand to gigabytes.
Encoders must not produce payloads beyond these limits.

### Decoding

1. Take the value of the `data` parameter of the fragment (`#data=…`; it may also follow
   other `&`-separated parameters), and URL-decode it.
2. Trim surrounding whitespace (including Unicode whitespace such as no-break space, the
   byte order mark or line separators) and drop trailing `=` padding. This is the
   **canonical payload**; links passed on to other pages carry it in this form.
3. Check the length limit and the `v1.` prefix, decode base64url, inflate within the limit.
4. Decode UTF-8 strictly, parse JSON, check the nesting depth, then validate against
   `BuilderExport` (`schemaVersion` 1 or 2). Anything that fails is rejected — never partially
   shown.

The reference decoder reports failures as `ShareDecodeError` with a `code`: `malformed`
(prefix, characters, compression, UTF-8 or JSON), `too-large`, `invalid` (not a valid
`BuilderExport`, or nested too deeply) or `unsupported` (the runtime lacks
`DecompressionStream` with `deflate-raw`).

### URLs

| Purpose | URL |
|---|---|
| Viewer (read-only page with 3D model and rows) | `<builder>/viewer/#data=<payload>` |
| Embed (compact viewer for an `<iframe>`) | `<builder>/viewer/?embed=1#data=<payload>` |
| Open in the builder for editing | `<builder>/#data=<payload>` |
| Open in TellmeCrochet | `https://tellmecrochet.de/import#data=tmc1.…` — a different payload, see [Hand-off to TellmeCrochet](#hand-off-to-tellmecrochet) |

`<builder>` is wherever the builder is deployed, e.g. `https://gerray.github.io/CrochetBuilder`.
The builder removes the fragment from the address bar after reading it and asks before it
replaces a document that is not empty.

## Hand-off to TellmeCrochet

TellmeCrochet, the companion app for crocheting along a pattern, keeps its own copy of
**format version 1** and creates new patterns from **drafts**. It does not read
`BuilderExport`. "In TellmeCrochet öffnen" and "Für TellmeCrochet speichern (.json)" therefore
convert the export into a draft in TellmeCrochet's structure and wrap it in an **envelope**.
Source: `packages/engine/src/tellmecrochet.ts` (`toTellmeCrochetDraft`, `toTmcEnvelope`,
`encodeTmcPayload`, `decodeTmcPayload`, `buildTmcImportUrl`; Zod schemas `TmcDraftSchema`,
`TmcEnvelopeSchema`).

> Status: the receiving side in TellmeCrochet is not live yet. Until then the builder offers to
> save the envelope as a file.

### Envelope

```ts
type TmcEnvelope = {
  format: "tmc-draft";                    // fixed
  version: 1;                             // envelope version; a receiver refuses others
  sourceNotation: "de" | "us" | "uk";     // notation of all text in the draft; the builder writes "de"
  originHint: "self_created" | "imported";
  draft: TmcDraft;
};

type TmcDraft = {
  schemaVersion: 1;
  title?: string;                         // left out when empty
  materials?: TmcMaterial[];              // the builder always writes the list (maybe empty)
  parts: TmcDraftPart[];                  // at least one
};

type TmcDraftPart = {
  name: string;                           // never empty
  quantity: number;                       // integer ≥ 1
  content: { schemaVersion: 1; rows: TmcRow[] };   // at least one row, ids unique per part
  stitchCheck: { rowId: string; expected: number; actual: number; ok: boolean }[];
};

type TmcRow = {                           // a version-1 row: no colours
  id: string; label?: string; type: "row" | "round";
  ops: TmcOp[];                           // version-1 codes and modifiers (BLO, FLO, TOG) only, no groups
  stitchCountTarget: number;
  note?: string;
};

type TmcMaterial = {
  kind: "yarn" | "hook" | "accessory";
  label: string;                          // never empty
  colors?: string[];                      // no empty entries
  amount?: string;                        // never empty
};
```

All objects are strict: unknown fields make the envelope invalid. `stitchCheck` has one entry
per row, in row order: `actual` is the sum of the stitches the row's ops produce
(`STITCH_PROPERTIES`), `ok` is `actual === expected`. A free instruction (see below) has
`stitchCountTarget: 0` and checks green.

**`originHint`** says where the pattern presumably comes from. The builder writes `imported`
as soon as the document has taken in text through "Anleitung einfügen" (pasting a pattern
text), for a document opened from a file or a link, and from the viewer — in those cases the
author is unknown. It writes `self_created` only for documents started with "Neu" or from a
demo. It is a hint only: a receiver records a pattern as the person's own creation only
after she has confirmed that explicitly, and otherwise as imported. The builder remembers
this next to the stored document (undo and redo restore it; undoing a paste keeps
`imported`), not in the format.

### Payload and link

```
payload = "tmc1." + base64url( deflate-raw( UTF-8( JSON.stringify(TmcEnvelope) ) ) )
link    = "https://tellmecrochet.de/import#data=" + payload
```

Packing, limits and decoding are exactly those of [share links](#share-links) — base64url
without padding, raw DEFLATE ending at the last byte, at most 262,144 encoded characters,
2 MiB of JSON (enforced while inflating) and 200 nesting levels — with two differences: the
prefix is **`tmc1.`** (a `v1.` share payload is refused, and the other way round), and the
JSON is validated against `TmcEnvelope` instead of `BuilderExport`. The saved file
(`<title>.tellmecrochet.json`) is the same envelope as plain, pretty-printed JSON.

### Mapping

| Builder export | In the draft |
|---|---|
| `title` | `title` (trimmed; left out when empty) |
| part `name`, `quantity` | `name` (empty → `Teil n`), `quantity` |
| row without version-2 features | same row (colours removed); `stitchCountTarget` 0 on a row with stitches ("no number given") → the counted stitches |
| row with stitch groups, BOBBLE/PUFF/POPCORN/PICOT or FP/BP | **text**: free instruction, `label` = "Runde 3", `note` = the full German line, e.g. `Runde 3: 6× ((3 fM) in dieselbe M) (18)` |
| rows after such a row | keep their number as `label` ("Runde 4"), because the receiver numbers only rows with stitches |
| free instruction (no stitches, with text) | same row; with both label and note the note reads `Label: note` (the receiver shows the note, else the label); rows with neither stitches nor text are left out |
| colour at the start of a row | **text**: an instruction before the row, `Farbwechsel: Weiß`, when the colour really changes; with two or more palette colours each part first states its starting colour, `Farbe: …` |
| colour change inside a row | **text**: appended to the row's `note`, `Farbwechsel in dieser Runde: 6 fM, [Farbe: Weiß] 6 fM` (`Reihe` for rows); marks that repeat the working colour are left out, here and in rows that became text |
| `stuffing`, `finish` | **text**: instructions at the end of the part (`Füllung: fest mit Füllwatte füllen.`, `Abschluss: …`) |
| `overview.notes`, `overview.gauge` | **text**: instructions at the start of the first part (`Hinweise: …`, `Maschenprobe: … · Garn: DK · Nadel: 3,5 mm`) |
| `assembly` | **text**: an extra last part `Zusammensetzen` (quantity 1), one instruction per placement, e.g. `Kopf: Sicherheitsaugen 12 mm vorne zwischen Runde 8 und 9 einsetzen, 6 Maschen Abstand.` |
| `overview.colors` (palette) | colour names added to the yarn material (one yarn: its `colors`; none: a new yarn `Garn`; several: a new yarn `Garnfarben`) |
| `overview.materials` | trimmed; entries with an empty label are left out, empty colours and amounts dropped |
| part without rows | one instruction `Für dieses Teil sind noch keine Reihen angegeben.` |
| row ids | kept. Ids of added steps (`<row>-farbe`, `tmc-hinweise`, `tmc-fuellung` …) never take a row's id, and a repeated id in a part, from its second occurrence on, get the next free `-2`, `-3`, … |
| `rendered`, part `id`s | not carried |

A free instruction is a row with `ops: []` and its text in `note`; TellmeCrochet's guided mode
shows it as a step of its own. Nothing is dropped silently: the converter returns a list of
everything it carried differently (`losses`, with a German message each), and the builder shows
a short summary before it opens TellmeCrochet.

### What a receiver implements

1. A page at `/import` that reads `#data=` from the fragment (the fragment never reaches a
   server), takes the canonical payload as in [Decoding](#decoding), checks the `tmc1.` prefix,
   decodes and inflates within the limits and validates against `TmcEnvelope` (strict). Any
   failure is shown as an error; nothing is partially imported. A received file is validated
   the same way.
2. If the person is not signed in, keeps the payload (e.g. in session storage) through sign-in
   and continues afterwards.
3. Shows a preview (title, parts, number of rows) and asks whether the pattern is her own
   creation; `originHint` only preselects the answer. The stored origin is "self-created" only
   after an explicit confirmation, otherwise "imported".
4. Creates a draft from `draft` as it is (it already matches the draft structure), with
   `sourceNotation` as the draft's notation, recomputes `stitchCheck` with its own check rather
   than trusting the received one, and opens the draft for review.

## Example: an amigurumi sphere

```json
{
  "schemaVersion": 2,
  "finish": "gather",
  "stuffing": "firm",
  "rows": [
    { "id": "r1", "type": "round", "ops": [{ "kind": "stitch", "code": "MR", "count": 1 }, { "kind": "stitch", "code": "SC", "count": 6 }], "stitchCountTarget": 6 },
    { "id": "r2", "type": "round", "ops": [{ "kind": "stitch", "code": "INC", "count": 6 }], "stitchCountTarget": 12 },
    { "id": "r3", "type": "round", "ops": [{ "kind": "repeat", "times": 6, "ops": [{ "kind": "stitch", "code": "SC", "count": 1 }, { "kind": "stitch", "code": "INC", "count": 1 }] }], "stitchCountTarget": 18 },
    { "id": "r4", "type": "round", "ops": [{ "kind": "repeat", "times": 6, "ops": [{ "kind": "stitch", "code": "SC", "count": 2 }, { "kind": "stitch", "code": "INC", "count": 1 }] }], "stitchCountTarget": 24 },
    { "id": "r5", "type": "round", "ops": [{ "kind": "stitch", "code": "SC", "count": 24 }], "stitchCountTarget": 24 },
    { "id": "r6", "type": "round", "ops": [{ "kind": "repeat", "times": 6, "ops": [{ "kind": "stitch", "code": "SC", "count": 2 }, { "kind": "stitch", "code": "DEC", "count": 1 }] }], "stitchCountTarget": 18 },
    { "id": "r7", "type": "round", "ops": [{ "kind": "repeat", "times": 6, "ops": [{ "kind": "stitch", "code": "SC", "count": 1 }, { "kind": "stitch", "code": "DEC", "count": 1 }] }], "stitchCountTarget": 12 },
    { "id": "r8", "type": "round", "ops": [{ "kind": "stitch", "code": "DEC", "count": 6 }], "stitchCountTarget": 6 }
  ]
}
```

Round 3 consumes 12 stitches (6 × (1 + 1)) and produces 18 (6 × (1 + 2)); round 2 produced
12. Both checks pass for every round of this pattern.
