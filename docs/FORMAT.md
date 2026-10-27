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
