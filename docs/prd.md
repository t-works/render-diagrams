# PRD — Semantic JSON → Diagram Visualizer

> Status: draft. v1/v2 open questions resolved (§0); remaining ones in §7.
> Basis: `` React Flow grouped-nodes demo + `docs/tech-analysis.md`.

## 0. Decisions locked

| Topic | Decision |
|---|---|
| Editability | **Read-only** viewer. Pan/zoom/select only. |
| Diagram location | `src/diagrams/`. |
| Discovery | Reload-time in dev, bundle-time in prod (§5.1). |
| Topbar | **Flat**, sorted by `order`; `meta.group` not needed. |
| Layout | **Automatic**. No coordinates in JSON at all (§5.3). |
| `meta.description` | **Page-level**: what the diagram shows + legend (§5.2). |
| Per-node detail | **Expandable sections inside the node** (§5.5). |
| Node color | Optional named palette value; every kind has a default (§5.4). |
| Node budget | ≤ 300 nodes comfortable; > 1000 out of scope (§5.6). |

## 1. Problem

We produce structured knowledge (pipelines, architectures, taxonomies, state
machines) as **text/JSON**, and read it as text. That is slow and hides
relationships. We already have a renderer that can draw grouped, connected
nodes, but it only draws hand-written examples.

We want a **viewer**: an AI agent writes a JSON file describing a domain
structure, and the app turns it into a navigable diagram — no code changes.

## 2. Goal

A React app that:

1. Loads diagram JSON files (one per diagram) with no central registry.
2. Auto-lays them out and renders them as interactive React Flow diagrams.
3. Gives each diagram its own page, with a topbar derived from the JSON itself
   — adding a file is the only step needed to add a page.
4. Is driven by a documented schema + an agent skill, so the agent can emit new
   diagrams that render correctly on the first try.

## 3. Non-goals (v1)

- Authoring/editing diagrams in the UI.
- Live connection-rule enforcement (rules are descriptive, not enforced).
- Backend, auth, persistence, collaboration, external/remote diagram sources.
- The "dive into sub-nodes" navigation from `docs/draft.md` — v2.
- Free-form visual styling by the agent (see §5.4).
- Diagrams beyond the §5.6 budget.

## 4. Users & flows

**Reader** — opens the app, picks a diagram from the topbar, reads the page
description, explores (pan/zoom, minimap), expands node sections for detail.

**AI agent** — given a source (PRD, repo, spec), writes
`src/diagrams/<id>.json` following the skill's schema, runs
`npm run validate`, fixes errors, stops.

They never share a UI: the agent writes files, the app reads them.

## 5. Design

### 5.1 Diagram discovery

Vite glob over the source folder, **lazily** so adding a file does not require
a rebuild in dev:

```ts
const files = import.meta.glob('../diagrams/*.json');   // eager: false
```

- Dev: adding/removing a JSON invalidates the glob module → **reload picks it
  up**, no rebuild.
- Prod: the file list is baked into the bundle. That is inherent — a static
  bundle cannot enumerate a folder at runtime.
- JSON is parsed and validated on load (§5.7), so a malformed file fails
  visibly in the app and in CI rather than at bundle time.

**Escape hatch (only if needed):** to drop new diagrams into an already-deployed
static folder without rebuilding, move the files to `public/diagrams/` and
fetch `/diagrams/manifest.json` at runtime. Costs one generated manifest (the
validator already reads every file, so it emits the list) and one fetch path.
A browser cannot list a directory on its own, so *some* manifest is required for
that workflow. Not doing this unless the deploy story demands it.

### 5.2 Navigation & page chrome

`react-router-dom`, one route per diagram.

| Route | Page |
|---|---|
| `/` | redirect to the first diagram (by `order`) |
| `/d/:id` | diagram page |
| `*` | not-found |

**Topbar** = a flat list derived from the `meta` block of every loaded diagram,
sorted by `order` then `title`. No hand-maintained nav list — that is the whole
point of the "standard prop" requirement.

**Page header** = `meta.title` + `meta.description`. The description is the
page-level explanation of what the diagram shows, and doubles as the legend.

**Legend** = auto-derived: the set of `kind`s actually present in the diagram,
rendered with each kind's label + one-line `description` from the registry
(§5.4). No extra schema, and it can never drift from what is on screen.

### 5.3 Standard props (the schema)

Every diagram file has this envelope. Only `meta.id`, `meta.title`, and `nodes`
are required. **There are no coordinates in a diagram file.**

```jsonc
{
  "specVersion": "1",
  "meta": {
    "id": "preprocess-pipeline",   // required, unique, URL-safe
    "title": "Preprocess Pipeline",// required, shown in topbar
    "order": 10,                   // optional topbar sort key
    "description": "How raw data becomes training tensors."  // page header / legend
  },
  "direction": "LR",               // "LR" | "TB" (auto-layout direction)
  "nodes": [
    {
      "id": "load",                // unique within the file
      "kind": "task",              // renderer vocabulary, see §5.4
      "label": "Load",
      "color": "green",            // optional palette name, see §5.4
      "parent": "pre",             // optional -> nest inside a group node
      "size": { "width": 140, "height": 64 },  // optional override of kind default
      "inputs": [{ "id": "in", "label": "raw" }],
      "outputs": [{ "id": "out", "label": "data" }],
      "sections": [                // optional expandable detail, see §5.5
        { "id": "files", "label": "Files", "open": true, "items": ["raw.csv"] }
      ]
    },
    {
      "id": "pre",
      "kind": "group",
      "label": "Preprocess",
      "color": "violet"            // groups take color too
      // groups size themselves to their children
    }
  ],
  "edges": [
    {
      "id": "e-load-norm",
      "source": "load",
      "sourcePort": "out",         // optional: which output slot
      "target": "norm",
      "targetPort": "in",          // optional: which input slot
      "label": "raw",
      "variant": "default"         // "default" | "dashed" | "animated"
    }
  ]
}
```

**Invariants** (enforced by §5.7):

- `meta.id` unique across files; `node.id` unique within a file.
- Every `parent`, `source`, `target`, `sourcePort`, `targetPort` resolves.
- A parent node appears **before** its children (React Flow ordering).
- `section.id` unique within a node.
- `size` is an optional override; everything else is laid out by the app.
- A `group` sizes itself to its children unless `size` is given.

**Defaults** — an omitted field is never an error:

| Field | Default |
|---|---|
| `direction` | `"LR"` |
| `edge.variant` | `"default"` |
| `section.open` | `false` |
| `sourcePort` / `targetPort` | the node's **first** `output` / `input` |
| `node.size` | the kind's default size (§5.4) |
| `node.color` | the kind's default color (§5.4) |

A `color` that is not in the palette is a **warning**, not an error: the node
renders with its kind's default color. Unknown colors must never block a
render — a wrong shade is not worth an error page.

Removing coordinates is deliberate: they were the single most likely thing for
the agent to get wrong, and they are the one thing the renderer can compute
better. `size` survives only because a `group` or `note` may need to be forced
larger than its content — a genuinely rare, deliberate act.

There is no free-form `props` bag: anything a node needs to show beyond its
label is a `section`. Add a typed per-kind field only when a kind genuinely
needs one.

### 5.4 Kind vocabulary

The renderer maps `kind` → { component, default size, label, description } via
a registry. The agent picks `kind` from a **fixed, documented list**; it does
not invent styles. Unknown kinds fall back to `generic` instead of crashing.

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

**Palette.** `color` is a name from a fixed palette, never a hex value:

`slate` · `blue` · `teal` · `green` · `amber` · `red` · `violet` · `pink`

Each name maps to a token set — border, tinted background, title/section accent,
label text — defined once as CSS variables, so light/dark mode and contrast come
free. Raw hex would let the agent emit unreadable or off-brand diagrams and
would break dark mode; a palette keeps every diagram consistent and legible.

Every kind has a default color, so a diagram with no `color` at all still reads
well. `color` overrides it, and that override is how the agent encodes
semantics: green for healthy, red for a failure path, violet for stores.
Children do **not** inherit their group's color — explicit beats surprising, and
inheritance makes an override on a child impossible to reason about.

The auto-legend (§5.2) shows each kind's swatch.

Default sizes exist so auto-layout can compute a result **before** first paint —
no DOM measurement pass. Nodes render at their declared size; content that
overflows (long labels, expanded sections on a fixed-size node) clips or scrolls.

Any kind may carry `sections` (§5.5) — expandable detail is data, not a kind.

New kinds = one registry entry (including its legend label + description) + one
row in this table + one line in the skill. Deliberately not agent-extensible, so
rendering stays consistent.

### 5.5 Rendering, sections & auto-layout

Reuse the `` components:

- `GroupNode` / `TaskNode` generalise into a `kind → component` registry.
- Slots come from `inputs`/`outputs`; each renders a `<Handle>` on left/right
  (top/bottom when `direction: "TB"`).
- `MiniMap`, `Controls`, `Background` per page, `fitView` on mount.
- **Read-only:** `nodesDraggable={false}`, `nodesConnectable={false}`.
  Pan/zoom stays on.
- **Box model:** the node root renders at exactly its declared size (kind
  default or `size`), with `overflow: hidden`. Declared size == rendered size —
  that equality is what makes pre-paint layout valid.
- Invalid diagram → an error panel with the validator's messages, not a crash.

**Sections** use native `<details>` / `<summary>` — expand/collapse, keyboard
access and focus all come free, no state library.

**Layout** runs on load, before nodes reach React Flow:

- `elkjs`, algorithm `layered`, direction from `meta.direction`,
  `hierarchyHandling: 'INCLUDE_CHILDREN'` so nested groups are laid out as
  compound nodes. (This is why ELK over dagre — dagre's compound support is
  thin and groups are a core requirement.)
- ELK consumes kind default sizes (or `size` overrides) and returns positions
  plus computed group sizes.
- Groups stay intact: children keep `parentId` + `extent: 'parent'`.
- **ELK positions nodes only.** Edge routing stays React Flow's job
  (handle-to-handle, client-side). Ports are *not* handed to ELK; port-aware
  edge ordering is not a v1 concern and must not become one.

**Expanding a section changes node height, which ELK already assumed.** So:

- Layout is computed from **collapsed** sizes, with `sections[].open` applied
  only to presentation.
- Expanding grows the node in place. Edges re-route for free (React Flow tracks
  handle positions online). Siblings do not move, so an expanded node can
  overlap a neighbour.
- A **Re-layout** action re-runs ELK against measured (expanded) heights to
  clean that up. Not automatic — auto re-layout makes the canvas jump while
  reading.
- Fixed-`size` nodes scroll their section body instead of growing.

> `ponytail:` expansion does not re-layout; worst case is visual overlap until
> the user hits Re-layout. Add ResizeObserver-driven auto-layout only if overlap
> turns out to be common in real diagrams.

### 5.6 Budget

| Nodes | Behaviour |
|---|---|
| ≤ 300 | target — no special handling |
| 300–1000 | degraded — loader enables `onlyRenderVisibleElements` (culling); ELK should move to a worker |
| > 1000 | out of scope for v1 — canvas escalation, per `docs/tech-analysis.md` |

Constant `BUDGET = { nodes: 300, edges: 500 }`. Exceeding it is a validation
**warning** (not an error): the diagram still renders, with a "large diagram"
notice on the page.

> These thresholds are estimates from React Flow/ELK behaviour, not measurements.
> M2 must benchmark a generated worst case and correct this table.

### 5.7 Validation

One shared checker, `src/lib/validate.ts`, used three ways:

- CI/build: fail on invalid diagrams.
- Agent loop: the skill requires running `npm run validate` and fixing output.
- Runtime: the loader validates each diagram and reports errors per diagram.

A diagram that fails validation **still appears in the topbar** and routes to a
page showing its errors. Silently dropping it hides the agent's mistake, which
is the one thing this loop exists to surface.

Hand-written (~80 lines) rather than a JSON Schema library: the invariants are
cross-field (uniqueness, references, ordering), which JSON Schema handles poorly
and a plain loop handles directly. Emits errors (blocking) and warnings
(budget, unknown kind falling back to `generic`).

### 5.8 Agent skill

Location: `skills/render-diagram/` — a self-contained folder, so the whole
`render-diagram/` directory can be copied into another project (and into
whatever skill location that project uses).

```
skills/render-diagram/
├── SKILL.md              # frontmatter + rules; kept short
├── references/schema.md  # §5.3 + §5.4 verbatim, loaded on demand
└── assets/               # 2-3 worked example diagrams
```

`SKILL.md` frontmatter requires a lowercase-hyphen `name` and a specific
`description`. Body:

1. When to use the skill.
2. Pointer to `references/schema.md` and `assets/` — not the whole schema inline.
3. Rules: unique ids; parent-before-child; **no coordinates or sizes**; stay
   inside the §5.6 budget; use `sections` for detail rather than cramming text
   into `label`; color **only** from the palette and only where it carries
   meaning; short `meta.description`; one diagram per file.
4. Output path: `src/diagrams/<meta.id>.json`.
5. A mandatory `npm run validate` step and what to do with its output.

### 5.9 File layout

```
<repo root>/
    skills/render-diagram/   # portable agent skill (see §5.8)
    src/
      App.tsx            # router + layout
      Topbar.tsx         # derived from diagram metas
      DiagramPage.tsx    # header + description/legend + ReactFlow + error panel
      loader.ts          # glob + parse + validate + sort
      lib/schema.ts      # types shared by loader / validator / registry
      lib/validate.ts    # shared checker (also run from CLI)
      lib/layout.ts      # ELK auto-layout
      nodes/registry.tsx # kind -> { component, defaultSize, color, label, description }
      lib/palette.ts     # palette name -> CSS variable tokens (light/dark)
      nodes/*.tsx        # node components (incl. <details> sections)
      diagrams/*.json    # the content
    scripts/validate.ts  # CLI wrapper over lib/validate.ts
    doc/prd-draft.md
```

## 6. Milestones

| M | Deliverable | Done when |
|---|---|---|
| M0 | Schema frozen + validator + CLI | `npm run validate` catches each invariant in §5.3 |
| M1 | Loader + topbar + routing + page header/legend + error panel | 3 JSON files, each at `/d/:id`, nav auto-built, legend matches contents |
| M2 | Kind registry + default sizes + ELK layout + benchmark | All §5.4 kinds render; nested groups laid out; budget table (§5.6) corrected with real numbers |
| M3 | Node sections + Re-layout action | `<details>` sections expand in place; Re-layout resolves overlap |
| M4 | Agent skill + 3 real diagrams | A fresh session produces a valid diagram that renders, first try |
| M5 | Polish: dark mode, deep-link to node, section state in URL | — |
| v2 | Dive/navigation stack, connection rules, editable mode | — |

## 7. Open questions

1. **Auto re-layout on expand** — currently manual (`ponytail:` in §5.5). Does
   overlap actually happen often enough to justify the jump/scrolling cost of
   doing it automatically? Answer from real diagrams at M3.
2. **Section content shape** — `items: string[]` only, or do sections need
   key/value rows or nested content? Start with strings; widen only on a real
   case.
3. **Auto-legend** (§5.2) — is deriving it from kinds-present correct, or does
   `meta.description` need to carry hand-written legend text too?
