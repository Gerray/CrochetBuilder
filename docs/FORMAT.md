# Pattern format

The canonical, language-neutral representation of a crochet pattern. It is what the engine
validates, expands and renders, what the builder saves, and what other software can read.
Stitches are stored as **codes**, never as display text; rendering to German, US or UK
terminology is a separate concern.

Schema source: `packages/engine/src/schema.ts` (Zod). Version: `schemaVersion: 1`.

## Part content

A pattern consists of one or more **parts** (head, body, arm…). Each part is a list of rows.

```ts
type PartContent = { schemaVersion: 1; rows: Row[] };

type Row = {
  id: string;                 // stable UUID — never regenerated on edit or reorder
  label?: string;             // "Round 3"
  type: "row" | "round";      // row = turn at the end; round = continue in a spiral
  ops: Op[];
  stitchCountTarget: number;  // stitches on the fabric after this row, as the author declares
  note?: string;              // free text shown with the row
};

type Op = StitchOp | RepeatGroup;

type StitchOp = {
  kind: "stitch";
  code: StitchCode;
  count: number;              // ≥ 1
  modifiers?: ("BLO" | "FLO" | "TOG")[];
  into?: string;              // display-only note, e.g. "into the chain space"
};

type RepeatGroup = { kind: "repeat"; times: number; ops: Op[] };   // nests freely
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

**produces** is how many stitches one worked instance adds to the fabric count — the basis
of the stitch-count check (`Σ produces == stitchCountTarget`).
**consumes** is how many stitches of the previous row it is worked into — the basis of the
graph and of the consumes check (`Σ consumes(row n) == Σ produces(row n−1)`).

Modifiers never change counts. `BLO`/`FLO` only affect how a stitch is drawn.

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
| `lace`       |    1.0 mm |               32 |           34 |        2.0 mm |
| `fingering`  |    1.5 mm |               28 |           29 |        2.5 mm |
| `sport`      |    2.0 mm |               24 |           25 |        3.0 mm |
| `dk`         |    2.5 mm |               20 |           21 |        4.0 mm |
| `worsted`    |    3.0 mm |               16 |           17 |        5.0 mm |
| `aran`       |    3.5 mm |               14 |           15 |        5.5 mm |
| `bulky`      |    5.0 mm |               11 |           12 |        7.0 mm |
| `jumbo`      |    8.0 mm |                7 |            7 |       10.0 mm |

Parsers older than engine 0.2.0 reject a gauge with `yarnDiameterMm` (the gauge object is
strict).

## Builder export

```ts
type BuilderExport = {
  schemaVersion: 1;
  title: string;
  overview: { materials?: Material[]; gauge?: Gauge; notes?: string };
  parts: { name: string; quantity: number; content: PartContent }[];
  rendered?: { locale: "de" | "en_us" | "en_uk"; rows: string[] };   // a view, not the source
};

type Material = { kind: "yarn" | "hook" | "accessory"; label: string; colors?: string[]; amount?: string };
```

`rendered` is redundant with `parts` and exists so that consumers which only display text
can do so without understanding the op tree.

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
   `BuilderExport` (`schemaVersion: 1`). Anything that fails is rejected — never partially
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
  "schemaVersion": 1,
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
