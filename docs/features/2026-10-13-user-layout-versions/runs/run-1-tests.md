# Run 1 — Test Builder Report (Schema + geometry-preferred pipeline + apply/read path + AC6 guard)

**Status:** tests written; red baseline captured (expected runtime failures only — compile/collection green).
**Date:** 2026-10-13
**Covers:** AC1, AC3 (incl. round-2 leaf/container height), AC4, AC5, AC6 (baseline), AC8.

## Tests Written

- `e2e/layout-version.spec.ts` — MODIFIED. Run 0's `test.fixme` bodies flipped to
  real tests and filled in with concrete fixture geometry. The Run 1 module is
  reached only through the non-literal dynamic import (`const VERSIONS_MODULE =
  '../src/lib/versions'; await import(VERSIONS_MODULE)`), so the spec is red at
  **runtime** while `tsc -b`/collection stay green.
  - `applies saved positions on a fresh load (AC1/AC3)` — injects a version via
    `page.addInitScript` into `render-diagrams:layout-version:e2e-layout-fixture`,
    then asserts every node's **absolute** model position (read from the node
    wrapper's `translate(...)` transform, zoom-independent) equals the saved value.
  - `records width only for leaves and width+height for containers (AC3, round-2)`
    — measured DOM sizes: containers' `offsetWidth`/`offsetHeight` equal the saved
    width+height and carry a fixed inline height; leaves equal the saved width and
    carry **no** inline height (`style.height === ''`).
  - `restores a nested group child at the same absolute position (AC3)` — the
    `e2e-outer > e2e-inner > e2e-nested-leaf` chain re-projects to the same
    absolute box; guards the `extent:'parent'` clamp when a container height is
    recorded.
  - `recorded geometry is stable after both ELK passes run (AC3/AC4)` — waits past
    `useNodesInitialized()` + `relayout()` (settle: two consecutive identical
    snapshots), asserts saved positions, then re-checks after another 400 ms so a
    late pass cannot move a recorded node.
  - `two consecutive loads of the same version are byte-identical (AC4)` — proves
    the saved arrangement applied before reload, then requires the full
    `id:x,y,width,height` snapshot to be byte-identical after reload.
  - `a version entry with an unknown id is ignored while the rest applies (AC8)` —
    the unknown entry produces no DOM node while the known entries still apply.
  - `a width-only saved leaf grows on section expand (round-2)` — kept as
    `test.fixme`; **Run 3** owns activation (per the plan). Not removed.
  - Node-only (no `page`), all three flips from `test.fixme`:
    - `serializeVersion records width only for leaves, width+height for containers
      (AC3, round-2)` — positions + width always; height only for a `group` / node
      with children.
    - `mergeGeometry is immutable and ignores unknown ids (AC5/AC8)` — returns a
      fresh object graph, leaves the source diagram untouched, ignores version-only
      ids, keeps diagram-only ids on auto-layout (partial coverage).
    - `hasGeometry is precise (AC5)` — `true` for a position or `size.width > 0`;
      `false` for empty/geometry-less/zero-width entries.

- `e2e/no-version.spec.ts` — NEW. AC6 behavioral baseline, expected to pass
  before **and** after Run 1 (guard, not a red test):
  - `auto-layout geometry is deterministic across two loads (AC6)` — two fresh
    loads produce byte-identical auto-layout geometry.
  - `a leaf grows when a collapsed section expands (AC6)` — clicking the fixture
    leaf's collapsed `Notes` section increases its measured height.
  - `Re-layout still works and is repeatable (AC6)` — button enabled, 7 nodes
    remain, and two consecutive Re-layouts are byte-identical.
  - `merely opening the diagram writes no version to localStorage (AC6)` — no
    `render-diagrams:layout-version:*` key appears from opening alone.

Fixture geometry is taken from the Run 0 fixture in
`src/diagrams/e2e-layout-fixture.json` (leaf with sections, `e2e-group` with two
children, `e2e-outer > e2e-inner > e2e-nested-leaf`). All positions are strictly
inside their parents so no `extent:'parent'` clamp is expected once the version
applies.

## Framework & Command

Playwright (chromium only, `workers: 1`), app served by the config's `webServer`
(`npm run fixtures && npm run dev` on `:5173`).

```
npx playwright test e2e/layout-version.spec.ts e2e/no-version.spec.ts
```

Full suite / other gates:

```
npx playwright test
npx tsc -b
npx oxlint e2e
```

## Expected Red Baseline

`npx tsc -b` → **exit 0** (e2e project green; the missing module is only reached
through a non-literal dynamic import, so nothing fails to resolve at compile or
collection time). `npx oxlint e2e` → **exit 0**.

`npx playwright test e2e/layout-version.spec.ts e2e/no-version.spec.ts` →
**9 failed, 1 skipped, 4 passed**.

Red (expected, before the builder's Run 1 changes):

- 6 browser tests in `layout-version.spec.ts`. Reason: `src/lib/versions.ts` does
  not exist and `DiagramPage` does not read a version, so the injected geometry is
  ignored and the app renders ordinary auto-layout. Example:
  `applies saved positions…` — `e2e-leaf absolute x`: expected `40`, received `24`;
  `absolute y`: expected `60`, received `38.5`; `e2e-group absolute x`: expected
  `320`, received `233`. The DOM readers are proven working (real auto-layout
  numbers are read back), so these are genuine geometry mismatches, not harness
  errors.
- 3 Node-only tests. Reason:
  `Cannot find module '…/src/lib/versions' imported from …/e2e/layout-version.spec.ts`
  — a runtime `ERR_MODULE_NOT_FOUND` from the non-literal dynamic import, not a
  compile/collection error.

Green now and must stay green:

- `e2e/no-version.spec.ts` — **4 passed** (AC6 baseline).
- `e2e/smoke.spec.ts` — **2 passed** (full suite: `9 failed, 1 skipped, 6 passed`).

Skipped: the section-expand test (`test.fixme`), owned by Run 3.

**Green-after-Run-1 target:** all 9 failures flip to pass (9 + 4 = 13 executed
tests green, 1 skipped) with `tsc -b`/`oxlint` still green and the no-version
baseline unchanged.

## Blockers

None. The harness from Run 0 is present and runnable; `src/lib/versions.ts` is
expected to be missing at this stage and is the intended red. No application
source was modified. Interface assumptions used by the tests (fixed per the run
task): `serializeVersion(diagram, nodes)`, `mergeGeometry(diagram, version)`,
`hasGeometry(version)`, envelope `{ id, nodes: [{ id, position: {x,y},
size?: {width, height?} }] }`; `serializeVersion` is fed React Flow-shaped nodes
(`id`, `type`, `position`, `width`/`height`/`measured`, `data.spec`) plus the
`diagram`, which covers either container-detection source (spec `parent`/`kind` or
node `type`). If the builder's actual signatures differ, raise it as a blocker
rather than adjusting source.
