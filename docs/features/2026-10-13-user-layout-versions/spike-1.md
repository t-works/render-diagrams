# Spike 1 — layout-version geometry round-trip

## Unknown

Can a user-adjusted layout — positions **and** sizes, including nodes nested
inside groups — be captured into the diagram JSON and re-applied on load so the
canvas reproduces the **exact same geometry**, or do React Flow's measured
dimensions / group sizing / the ELK pipeline reintroduce drift on reload?

## Method

No browser, no dev server, no new packages. The prototype calls the **real**
production functions (`layoutDiagram`, `buildFlow`) plus React Flow's **real**
coordinate-adoption code (`adoptUserNodes`, `updateAbsolutePositions` from
`@xyflow/system`, which runs headlessly) so the coordinate semantics under test
are the ones the app actually uses, not a re-implementation.

Read-only source inspection:

- `src/lib/schema.ts` — `NodeSpec` already has optional `size`, no `position`.
- `src/lib/layout.ts` — ELK root with `elk.hierarchyHandling: INCLUDE_CHILDREN`;
  `walk()` copies `n.x`/`n.y` from each nested `ElkNode` verbatim.
- `src/lib/flow.ts:24-38` — `fixed = !!spec.size`; children get
  `parentId` + `extent: 'parent'`; `position` comes from the ELK placement.
- `src/DiagramPage.tsx:51-96` — mount effect runs `layoutDiagram(diagram)`, then a
  second effect keyed on `useNodesInitialized()` runs `relayout()` (a second
  `layoutDiagram` with measured-size overrides) and calls `setNodes` again.
- `node_modules/@xyflow/system/dist/esm/index.js` — `calculateChildXYZ` /
  `evaluateAbsolutePosition`: for a node with `parentId`, `node.position` is
  **parent-relative**; `internals.positionAbsolute = parent.positionAbsolute +
  node.position` (default `nodeOrigin` `[0,0]`). `getNodeDimensions` prefers
  `measured` → `width`/`height` → `initialWidth`/`initialHeight`.
  `updateAbsolutePositions` recomputes only `internals.positionAbsolute`; it
  never writes `node.position`.
- `src/index.css:25` — global `box-sizing: border-box`, so a wrapper's rendered
  (measured) box equals its `style.width`/`height` (no border/padding drift).

Throwaway files (nothing tracked was modified; `git diff` shows only the
pre-existing `STATE.md` change, and `PRD.md` + `spike/` are untracked):

- `docs/features/2026-10-13-user-layout-versions/spike/version.ts` — the
  serialize/apply transform.
- `docs/features/2026-10-13-user-layout-versions/spike/run.ts` — the harness.
- `docs/features/2026-10-13-user-layout-versions/spike/output.txt` — captured output.

Exact command:

```
npx tsx docs/features/2026-10-13-user-layout-versions/spike/run.ts
```

The harness runs nine phases: (1) adoption before measurement, (2) adoption
after measurement, (3) a synthetic user drag of a root node + a drag of a child
inside a group + a resize of a child + a resize of a group, (4) serialize,
(5) apply and diff, (6) re-run the existing two-pass relayout, (7) positions-only
version, (8) apply size via `style` only (first-frame clamp), (9) a synthetic
group-inside-a-group diagram. The real diagram used is
`src/diagrams/llm-message-flow.json` (30 nodes, 7 groups with children).

**Exact serialization shape used** (sidecar form for the spike; per resolved Q1
this maps 1:1 onto `NodeSpec`, which already has `size`, plus a new `position`):

```json
{ "id": "runner", "position": { "x": 37, "y": 52 }, "size": { "width": 160, "height": 100 } }
```

**Exact apply rule** (`version.ts` → `applyVersion`): for each freshly built
node, if a saved entry has its id, write `position` **verbatim** (it is already
in the correct frame — absolute for roots, parent-relative for children),
set `style.width`/`style.height`, and set `node.width`/`node.height` from
`size`. Every id with no entry keeps its ELK placement.

## Evidence

### 1. Coordinate frame — ELK children are parent-relative, buildFlow stores them verbatim

```
  ELK placement child    x=820.5 y=684  (size 184x118)
  ELK placement runner   x=12 y=34  (size 160x72)
  ELK placement loop     x=483 y=892  (size 634x247.11428571428573)
  ELK placement post     x=482 y=56  (size 140x64)
  buildFlow node  runner   position={"x":12,"y":34} parentId=child extent=parent
  buildFlow node  child    position={"x":820.5,"y":684.0000000000001} type=group
```

`runner.x=12` is relative to `child`, not to the pane. Confirmed by React Flow's
own adoption below (`runner` absolute = `820.5+12, 684+34`).

### 2. First paint: `node.position` is never mutated by measurement

```
## PHASE 1: adoption at first paint, BEFORE measurement (parent sizes unknown)
  runner    position=(12, 34)  positionAbsolute=(820.5, 684)
  child     position=(820.5, 684)   positionAbsolute=(820.5, 684)

## PHASE 2: after measurement — positionAbsolute recovered, position never touched
  runner    position=(12, 34)  positionAbsolute=(832.5, 702)
```

While the group has no measured size, the `extent:'parent'` clamp collapses the
child's *absolute* position onto the parent's top-left — but `node.position`
stays `(12,34)`. Once `measured` arrives, absolute recovers. This is the runtime
behavior reading alone could not settle.

### 3. Capture → serialize → apply is byte-exact, including the two-level nested case

```
## PHASE 5: capture -> serialize -> apply (ELK bypassed for saved ids)
  diffs vs captured: NONE — geometry identical
  byte-identical on second apply: true

## PHASE 9: group inside group — ELK / buildFlow coordinates
  ELK outer  x=24 y=24 (size 188x156)
  ELK inner  x=12 y=34 (size 164x110)
  ELK leaf   x=12 y=34 (size 140x64)
  ELK inner position is relative to outer: buildFlow inner pos={"x":12,"y":34} parentId=outer
  capture -> apply diffs: NONE — two-level nesting round-trips exactly
  leaf abs captured=(31, 81) applied=(31, 81)
```

Zero diffs across all 30 nodes, grouped children, and a group nested in a group
(`outer > inner > leaf`). Fractional ELK values survive JSON round-trip exactly
(e.g. `684.0000000000001`, `247.11428571428573`).

### 4. The existing two-pass relayout overwrites every saved value

```
## PHASE 6: same as PHASE 5, then the existing two-pass relayout runs again
  diffs applied -> relayout: 30 of 30 nodes changed; e.g. user.pos: captured (1245, 822) -> applied (1275, 962); user.abs: captured (1245, 822) -> applied (1275, 962); user.size: captured 140x92 -> applied 0x0; fe.pos: captured (1495, 1003) -> applied (1525, 1211.571429)
```

`DiagramPage.tsx:93-96` fires this second pass unconditionally once nodes are
measured. Its `setNodes(buildFlow(diagram, placements))` (line 84) rebuilds
`position` for **all** nodes, so any saved geometry applied in the mount effect
is discarded. This is not a measurement artifact; it is the pipeline clobbering
the version.

### 5. Sizes are part of the round trip because of the parent-extent clamp

```
## PHASE 7: version records POSITIONS only (sizes fall back to ELK)
  group child size: captured=274x178 -> applied=184x118
  child runner abs: captured=(857.5, 736) -> applied=(844.5, 730)
```

If a resized group's size is not recorded, `extent:'parent'` clamps its children
into the smaller ELK-sized group, moving them (`857.5,736 → 844.5,730`).
Positions alone are insufficient; the resolved Q3 decision (positions **and**
sizes) is required for exactness.

### 6. `style`-only sizing causes a first-frame clamp; setting `node.width/height` avoids it

```
## PHASE 8: apply size via `style` only, no width/height/measured at first paint
  child  pos=(820.5, 684) abs=(820.5, 684) size=0x0
  runner pos=(37, 52) abs=(820.5, 684)  <- abs clamped by unmeasured parent, pos untouched
  after the same sizes arrive as 'measured': runner abs=(857.5, 736) (recovers; position never changed)
```

If the saved size is written only into `style`, the group's dimensions are 0 at
adoption and children are transiently clamped to the group's top-left. Writing
`node.width`/`node.height` makes `getNodeDimensions` return the saved size on the
first adoption, so the clamp is a no-op from frame 0 (this is what makes PHASE 5
exact without populating `measured`).

## Answer

**A version carrying positions **and** sizes round-trips to identical geometry
in the pure pipeline — including nested and doubly-nested groups — provided the
existing auto-layout is intercepted. The drift risk is not measurement; it is
the pipeline.** Specifically:

1. `node.position` for a `parentId` child is **parent-relative**, and ELK already
   returns children in that frame, so saved `position` can be written and
   re-applied verbatim. No coordinate conversion, no rounding, is needed.
2. React Flow's measurement pass (`updateAbsolutePositions`) rewrites only
   `internals.positionAbsolute`, never `node.position`. So measured dimensions do
   **not** move saved nodes.
3. The **one** thing that destroys saved geometry is the existing two-pass
   relayout (`DiagramPage.tsx:93-96`): it re-runs ELK and calls `setNodes` with
   fresh placements for all nodes. A version must either skip both ELK passes
   when it carries geometry, or overlay saved geometry after the final pass.
4. Group size **must** be captured, not just positions: `extent:'parent'` clamps
   children into the group, so a smaller-than-saved group silently shifts them.
5. Apply sizes as `node.width`/`node.height` (plus `style`), not `style` alone, so
   the parent bounds are known on the very first adoption.

### Not settled here — needs a browser (Run 0 Playwright)

- Whether the **real DOM-measured size** equals the applied saved size for every
  node. `box-sizing: border-box` (`src/index.css:25`) and explicit
  `style.width/height` make this true for containers/fixed nodes by construction,
  but auto-height `KindNode`s (`flow.ts:27` uses `minHeight`) depend on text
  layout, and sub-pixel/DPR rounding is unverified. This is a measurement-equality
  question, not a coordinate-frame question.
- The two-pass interception in the real component lifecycle (effect order,
  `useNodesState`, `fitView`), which the harness models only as a pure function
  call sequence.
- Section expand/collapse changing a node's measured height after a save. The
  version captures positions+sizes only (Q3), so a node whose section is toggled
  later renders at a different height; applying the saved size as a fixed height
  freezes it (`fixed = !!spec.size` → `kn--fixed`, content scrolls). That is a
  product behavior to rule on, not coordinate drift.

**Blocker:** none for the core answer; the residual items are inherently
browser-measurement questions and are assigned to Run 0.

## Impact on PRD

Closes the §9 spike unknown. The pure experiment proves the coordinate model and
pipeline interception; it leaves only DOM-measurement equality to Run 0.

Recommended plan rules backed by the evidence:

1. **Artifact (Q1):** add `position: {x, y}` to `NodeSpec`; keep the existing
   `size`. A saved node is `{id, position, size}`. Note the side effect: writing
   `size` flips `fixed = !!spec.size` in `flow.ts:24`, which is exactly the
   behavior needed to freeze a captured size — call it out, since it also changes
   auto-height nodes to content-scrolling fixed nodes.
2. **Load rule:** if the saved version carries geometry, build nodes directly
   from it and **do not run either `layoutDiagram` pass** (skip the `relayout()`
   effect at `DiagramPage.tsx:93-96`). Nodes without saved geometry fall back to
   the ELK placement. `buildFlow` (or a wrapper) must prefer `spec.position` over
   the placement for recorded ids.
3. **Apply rule:** verbatim `position` + set `node.width`/`node.height` and
   `style.width`/`style.height` from `size`. Do **not** rely on `style` alone.
4. **Re-layout/Reset (Q4):** Re-layout must stay disabled/replaced while a
   version is applied, because running it provably overwrites all saved geometry.
5. **Run 0 verification:** add a Playwright assertion that after applying a
   version, `measured` sizes and node positions equal the saved values on a fresh
   page load, and re-load twice for byte-identical geometry. Specifically confirm
   the two-pass relayout never fires for a geometry-bearing version, and record
   whether section-collapse state after save is acceptable per Q3.
