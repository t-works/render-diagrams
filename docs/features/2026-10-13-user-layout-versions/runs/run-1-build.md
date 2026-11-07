# Run 1 — Build Report (Schema + geometry-preferred pipeline + apply/read path + AC6 guard)

**Status:** complete — all four fixed gates green; the red baseline flipped to
`15 passed / 1 skipped` (16 collected).
**Date:** 2026-10-13
**Covers:** AC1, AC3 (incl. round-2 leaf/container height), AC4, AC5, AC6
(baseline), AC8.

## Completed

- **Schema** (`src/lib/schema.ts`) — added `NodePosition {x, y}` and
  `NodeSpec.position?`; added `NodeSize {width, height?}` and switched
  `NodeSpec.size` to it; kept `Size` with a required `height` for kind defaults
  and ELK input.
- **Geometry-preferred pipeline** (`src/lib/flow.ts`) — `spec.position` now wins
  over the ELK placement; `node.width` and the `style` width are set for
  recorded geometry; `node.height` plus the `style` height are set **only** when
  `spec.size?.height !== undefined` (containers); width-only leaves get
  `node.width` + `style.minHeight` with `node.height` left **unset**; `fixed =
  spec.size?.height !== undefined`. No recorded `size` ⇒ no `node.width` /
  `node.height` keys at all, so the no-version output is byte-identical.
- **ELK dimension fill** (`src/lib/layout.ts`) — `sizeOf` now composes
  `{ width: spec.size?.width ?? kindDefault.width, height: spec.size?.height ??
  kindDefault.height }`, so a width-only recorded leaf never hands ELK an
  `undefined` dimension.
- **Saved-version module** (`src/lib/versions.ts`, NEW) — key
  `render-diagrams:layout-version:<id>`; guarded `loadVersion`; pure
  `parseVersion` shape check (malformed entries skipped, malformed envelope ⇒
  `null`); precise `hasGeometry` (true iff a node has a position or
  `size.width > 0`); immutable `mergeGeometry(diagram, version)` by node id
  (unknown ids ignored, source diagram untouched); pure
  `serializeVersion(diagram, nodes)` (position always, width always, container
  height only). Envelope is `{ id, nodes: [{ id, position: {x,y}, size?:
  {width, height?} }] }`.
- **Apply/read path** (`src/DiagramPage.tsx`) — loads the version once via
  `useMemo([loaded.id])` and merges it once via `useMemo([loaded.diagram,
  version])`, so the merged `diagram` identity is stable and the existing
  `useEffect([diagram, …])` layout effect cannot re-run every render. The normal
  two-pass ELK pipeline runs **unconditionally**; `buildFlow` keeps recorded
  geometry stable across both passes. No version (or a geometry-less version)
  keeps the original `diagram` identity and the exact old path. Partial coverage
  / unknown ids are logged via a `useEffect` (Run 3 promotes this to an aria-live
  notice).

## Files Changed

- `src/lib/schema.ts` — MODIFIED: `NodePosition`, `NodeSize`, `NodeSpec.position`,
  `NodeSpec.size: NodeSize`; `Size` unchanged (required height).
- `src/lib/flow.ts` — MODIFIED: recorded position/size authoritative; `fixed`
  from explicit height only; width-only leaves unfixed; explicit node
  `width`/`height` only for recorded geometry.
- `src/lib/layout.ts` — MODIFIED: `sizeOf` fills the kind-default height for a
  width-only recorded `size`.
- `src/lib/versions.ts` — NEW: storage key, `parseVersion`, `loadVersion`,
  `hasGeometry`, `mergeGeometry`, `serializeVersion`.
- `src/DiagramPage.tsx` — MODIFIED: version load + merge `useMemo`s; unconditional
  two-pass ELK retained; coverage/id log effect.
- `docs/prd.md` — MODIFIED: amended all coordinate/size locks (§0 layout row, §3
  UI authoring non-goal, §5.3 "no coordinates" + `size` invariant, §5.3
  deliberate-removal rationale prose, §5.8 "no coordinates or sizes" skill rule)
  so authored content stays coordinate-free while persisted user geometry is
  authorized. Removed dangling `§10` cross-references (docs/prd.md has no §10).

No changes were made to `e2e/layout-version.spec.ts`, `e2e/no-version.spec.ts`,
or any other file: the test-builder's interface assumptions matched the planned
signatures exactly, so the source was adapted to the tests.

## Tests

- **Node-only (Playwright/Node, no `page`) — 3 passed**
  - `serializeVersion` records position + width always and height only for
    containers (`e2e-group`), leaves width-only.
  - `mergeGeometry` returns a fresh object graph, leaves the source diagram deep-
    equal to a clone taken before, ignores unknown ids, and leaves a
    diagram-only node without geometry.
  - `hasGeometry` precision: position ⇒ true, `size.width: 220` ⇒ true, neither
    ⇒ false, `size.width: 0` ⇒ false, empty ⇒ false.
- **Browser e2e (`layout-version.spec.ts`) — 6 passed, 1 skipped**
  - saved absolute positions applied on a fresh load; measured width (leaves) /
    width+height (containers) with a fixed inline height on containers and **no**
    inline height on leaves; nested `e2e-outer > e2e-inner > e2e-nested-leaf`
    absolute positions; recorded geometry stable after both ELK passes; two
    consecutive loads byte-identical; unknown id ignored while the rest applies.
  - Skipped: `a width-only saved leaf grows on section expand` (`test.fixme`,
    Run 3 owns activation).
- **AC6 baseline (`no-version.spec.ts`) — 4 passed**: deterministic auto-layout
  across two loads; leaf grows on section expand; Re-layout enabled/repeatable
  with 7 nodes; merely opening writes no version key.
- **Smoke — 2 passed** (unchanged).

## Gate Results

- `npx tsc -b` — **exit 0**
- `npx oxlint` — **exit 0**
- `npm run validate` — **exit 0** (5 diagrams checked, incl. the e2e fixture)
- `npx playwright test` — **exit 0**: `1 skipped / 15 passed` (16 collected).
  The red baseline was `9 failed / 1 skipped / 6 passed`; all 9 red tests now
  pass and smoke + no-version are still green.

## Deviations & Notes

- **No test edits.** The test-builder report's declared interface
  (`serializeVersion(diagram, nodes)`, `mergeGeometry(diagram, version)`,
  `hasGeometry(version)`, `loadVersion(id)`, envelope shape) was implemented
  exactly; `e2e/layout-version.spec.ts` is untouched.
- **`docs/prd.md` cross-references.** The enumerated amendments referenced "§10",
  but `docs/prd.md` has no §10; I used plain-text references to the
  user-layout-versions PRD/feature instead of a dangling section number.
- The `serializeVersion` container test is satisfied either by `spec.kind ===
  'group'` or by "has children"; the implementation uses both.
- The version is read synchronously from `localStorage` during render inside
  `useMemo`; it is read-only in Run 1 (autosave/Download/Upload/Reset are Run 2),
  so there is no write path and no re-read loop.
- `hasGeometry` gates the merge, so a stored version with no geometry keeps the
  original `diagram` identity and full auto-layout (Q4).
- **Run-reviewer should verify:** the no-version path still produces the exact
  same `buildFlow` output shape (no `node.width`/`node.height` keys) — asserted
  behaviorally by `no-version.spec.ts`, and the `fixed` semantics moved from
  `!!spec.size` to `spec.size?.height !== undefined` (behavior-preserving for all
  authored diagrams, which have no `size` or a two-field `size`).
