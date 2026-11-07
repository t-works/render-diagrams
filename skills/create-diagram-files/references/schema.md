# Diagram schema

Every file is one diagram. Only `meta.id`, `meta.title` and `nodes` are required.
**Authored content carries no coordinates.** Layout is automatic. The app may
write a user's arrangement into a saved layout version (see “Recorded geometry”
below), but it never writes it back into the authored file.

```jsonc
{
  "specVersion": "1",
  "meta": {
    "id": "preprocess-pipeline",   // required, unique, URL-safe, = filename stem
    "title": "Preprocess Pipeline",// required, shown in the topbar
    "order": 10,                   // optional topbar sort key
    "description": "How raw data becomes training tensors." // page header + legend
  },
  "direction": "LR",               // "LR" | "TB" (default "LR")
  "nodes": [
    {
      "id": "load",                // unique within the file
      "kind": "task",              // fixed vocabulary, see below
      "label": "Load",
      "color": "green",            // optional palette name
      "parent": "pre",             // optional -> nest inside a group node
      "size": { "width": 140 },   // optional override; width always, height only for containers
      "inputs": [{ "id": "in", "label": "raw" }],
      "outputs": [{ "id": "out", "label": "data" }],
      "sections": [                // optional expandable detail
        { "id": "files", "label": "Files", "open": true, "items": ["raw.csv"] }
      ]
    },
    {
      "id": "pre",
      "kind": "group",
      "label": "Preprocess",
      "color": "violet"
      // groups size themselves to their children
    }
  ],
  "edges": [
    {
      "id": "e-load-norm",         // optional; synthesized when omitted
      "source": "load",
      "sourcePort": "out",         // optional; defaults to the first output
      "target": "norm",
      "targetPort": "in",          // optional; defaults to the first input
      "label": "raw",
      "variant": "default"         // "default" | "dashed" | "animated"
    }
  ]
}
```

## Recorded geometry (saved layout versions)

An arranged layout is kept in `localStorage` per diagram id as a compact
geometry record; **Download** exports the whole diagram with the geometry written
into its nodes, so the file is a normal diagram you can commit to
`src/diagrams/` or load back through Upload. Either form adds two optional
fields to a node:

```jsonc
{
  "id": "load",
  "position": { "x": 40, "y": 60 },   // absolute for roots, parent-relative for children
  "size": { "width": 220 }            // width always; height only for containers/groups
}
```

- `position.x` / `position.y` must be finite numbers.
- `size.width` must be a positive number; `size.height` is optional and positive
  when present. Leaving it out is the point for a leaf: an explicit height would
  freeze the node so its expandable sections scroll instead of growing it.
- Never author these by hand in `src/diagrams/`; they come from dragging or
  resizing in the browser and Download.

## Invariants

- `meta.id` unique across files; `node.id` unique within a file.
- Every `parent`, `source`, `target`, `sourcePort`, `targetPort` resolves.
- A parent node appears **before** its children (React Flow ordering).
- `section.id` unique within a node.
- A `group` sizes itself to its children unless `size` is given.
- `position` is optional and only ever written by the app; a node without it is
  placed by auto-layout.
- `section.open` is the initial state; the app records the reader's toggles in the
  saved version and in Downloaded files, so a downloaded diagram reopens the way
  it was left.

## Defaults — an omitted field is never an error

| Field | Default |
|---|---|
| `direction` | `"LR"` |
| `edge.variant` | `"default"` |
| `section.open` | `false` (a saved version or a Download writes the reader's actual choice) |
| `sourcePort` / `targetPort` | the node's first `output` / `input` |
| `node.size` | the kind's default size |
| `node.size.height` | auto (content-driven; containers derive it from children) |
| `node.color` | the kind's default color |

A `color` outside the palette is a **warning**: the node renders with its kind's
default color. Unknown colors never block a render.

## Kind vocabulary

| kind | purpose | slots | default size | default color |
|---|---|---|---|---|
| `group` | container/lane, nests children | — | derived from children | `slate` |
| `task` | generic step | in/out | 140×64 | `blue` |
| `source` | input, dataset, entry point | out | 140×56 | `green` |
| `sink` | output, report, exit point | in | 140×56 | `amber` |
| `service` | long-running component | in/out | 160×72 | `teal` |
| `store` | db / cache / bucket | in/out | 140×64 | `violet` |
| `decision` | branch point | in/out | 120×72 | `pink` |
| `note` | annotation, no connections | — | 160×56 | `slate` |
| `generic` | fallback for unknown kinds | in/out | 140×64 | `slate` |

## Palette

`slate` · `blue` · `teal` · `green` · `amber` · `red` · `violet` · `pink`

A palette name, never a hex value. Every kind has a default, so a diagram with no
`color` at all still reads well. Color overrides the default and is how you encode
semantics: green for healthy, red for a failure path, violet for stores. Children
do **not** inherit their group's color.

## Budget

| Nodes | Behaviour |
|---|---|
| ≤ 300 | target |
| 300–1000 | degraded; culling enabled, rendering slows |
| > 1000 | out of scope |

Exceeding `300` nodes or `500` edges is a validation **warning**: the diagram still
renders, with a large-diagram notice on the page.
