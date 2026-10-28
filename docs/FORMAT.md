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

Optional, carried alongside the pattern (in TellmeCrochet: `pattern.overview.gauge`).

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

### Stitch groups

A group works all its stitches into **one** stitch of the previous row: "3 sc in the next
stitch", a half-double increase, a shell, a V-stitch, a corner. It consumes one stitch (none
if it is empty) and produces the sum of its stitches. It may contain stitches and repeats,
not another group.

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
  **as seen from the front**, so `90` is on the right of the picture and `-90` on the left. On a
  flat piece the angle runs along the row instead, from `-180` (left end) to `180` (right end).
- `spacing` is in stitches, `size` in millimetres.

```json
"assembly": [
  { "id": "eyes", "kind": "eyes", "target": "head", "row": "r9", "angle": 0, "spacing": 6, "size": 8 },
  { "id": "ear-l", "kind": "attach", "part": "ear", "target": "head", "row": "r4", "angle": -40, "note": "sew on flat" },
  { "id": "nose", "kind": "embroidery", "target": "head", "row": "r11", "angle": 0, "size": 4 }
]
```

`placementAnchor(graph, rowId, angle)` returns the point and the outward normal of a
placement on a relaxed part.

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
| Import into TellmeCrochet | `https://tellmecrochet.de/import#data=<payload>` |

`<builder>` is wherever the builder is deployed, e.g. `https://gerray.github.io/CrochetBuilder`.
The builder removes the fragment from the address bar after reading it and asks before it
replaces a document that is not empty.

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
