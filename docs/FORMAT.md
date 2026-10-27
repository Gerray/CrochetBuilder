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
};
```

Resolution order: an explicit swatch (`stitchesPer10cm`/`rowsPer10cm`) wins; otherwise
defaults from `yarnWeight` + `hookMm`; otherwise the engine default (DK, 4 mm) and the result
is flagged as estimated.

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
