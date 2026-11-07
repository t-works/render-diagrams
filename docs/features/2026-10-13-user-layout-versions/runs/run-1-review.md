# Run 1 — Run Review (Schema + geometry-preferred pipeline + apply/read path + AC6 guard)

**Reviewer:** run-reviewer (independent)
**Date:** 2026-10-13
**Builder report:** `runs/run-1-build.md`
**Method:** re-derived from the working tree; all four gates executed by the
reviewer. No files under review were edited.

## Verdict

COMPLETE

## Acceptance Criteria

- **AC1 (adjustable geometry / regression guard) — PASS.**
  Evidence: the drag/resize surface is untouched (`git diff --name-only --
  src/nodes/` is empty; `src/nodes/Node.tsx:69,95` still render `NodeResizer`,
  `src/DiagramPage.tsx:183` still wires `onNodesChange`), and Run 1's apply path
  honors recorded positions/sizes.
  Command: `npx playwright test e2e/layout-version.spec.ts` → `ok 1 applies
  saved positions on a fresh load (AC1/AC3)`. The full drag→persist loop is Run 2.

- **AC3 (reload reproduces positions/sizes incl. round-2 height rule) — PASS.**
  Command: `npx playwright test e2e/layout-version.spec.ts`
  - `ok 1 applies saved positions on a fresh load (AC1/AC3)`
  - `ok 2 records width only for leaves and width+height for containers (AC3, round-2)`
  - `ok 3 restores a nested group child at the same absolute position (AC3)`
  Independent code check (`npx tsx /tmp/check-flow.mjs`): a width-only spec emits
  `width=240 height=undefined style={"width":240,"minHeight":64} fixed=false`; a
  full-size container emits `width=200 height=80 style={width:200,height:80}
  fixed=true`. Confirms `node.height` is left unset for width-only leaves
  (`src/lib/flow.ts:23-47`).

- **AC4 (determinism / no drift) — PASS.**
  Command: `npx playwright test e2e/layout-version.spec.ts` →
  `ok 4 recorded geometry is stable after both ELK passes run (AC3/AC4)` and
  `ok 5 two consecutive loads of the same version are byte-identical (AC4)`.
  The specs compare full `id:x,y,width,height` snapshots across reloads.

- **AC5 (scope isolation, read layer) — PASS (Run-1 scope).**
  Independent check (`npx tsx /tmp/check-keys.mjs`):
  `versionStorageKey('diagram-a')` vs `('diagram-b')` → `distinct: true`
  (`render-diagrams:layout-version:<id>`), and
  `src/DiagramPage.tsx:50` reads `loadVersion(loaded.id)`.
  Node-only `mergeGeometry is immutable and ignores unknown ids (AC5/AC8)` passes.
  Full browser A/B isolation (`save-load.spec.ts`) is Run 2 per the plan.

- **AC6 (backward compatibility / no-version baseline) — PASS.**
  Command: `npx playwright test e2e/no-version.spec.ts` → 4/4 pass
  (`auto-layout geometry is deterministic across two loads`,
  `a leaf grows when a collapsed section expands`,
  `Re-layout still works and is repeatable`, `merely opening the diagram writes no
  version to localStorage`).
  Independent byte-identity check (`npx tsx /tmp/compare-flow.mjs`): for a diagram
  with no `position`/`size`, new `buildFlow` output is structurally identical to a
  faithful re-implementation of `HEAD:src/lib/flow.ts` → `identical: true`; and
  `npx tsx /tmp/check-flow.mjs` shows no `width`/`height` keys on any no-size
  node. Existing diagrams validate (5 checked).

- **AC8 (invalid / stale version does not break the page) — PASS (Run-1 scope).**
  Command: `npx playwright test e2e/layout-version.spec.ts` →
  `ok 6 a version entry with an unknown id is ignored while the rest applies (AC8)`.
  Independent parser check (`npx tsx /tmp/check-keys.mjs`): malformed envelope →
  `null`, non-object → `null`, malformed entries skipped, `NaN` position dropped.
  The full corrupt/partial-coverage *warning UI* is Run 3.

## Gate Results

- `npx tsc -b` — **exit 0** (no diagnostics).
- `npx oxlint` — **exit 0** (no diagnostics).
- `npm run validate` — **exit 0**: `5 diagram(s) checked` (delegation-flow,
  e2e-layout-fixture, information-flow, llm-message-flow, memory-flow).
- `npx playwright test` — **exit 0**: `1 skipped / 15 passed (16 collected)`,
  26.1s. Only skip is the Run-3-owned
  `a width-only saved leaf grows on section expand (round-2)` (`test.fixme`).

## Regressions

- None observed.
- No-version `buildFlow` output is byte-identical to the pre-feature algorithm
  (independent runtime comparison, see AC6).
- No existing diagram uses `position` or `size` (grep over `src/diagrams/` found
  none), so the `fixed = recordedHeight !== undefined` change is
  behavior-preserving for all authored diagrams.
- Observation (not a defect, no in-repo trigger): a hand-authored diagram with a
  **two-field** `size` now additionally emits `node.width`/`node.height` where the
  old code emitted neither. No committed diagram uses `size`, and the plan
  (decision 1/2) intends recorded size to be authoritative, so this is accepted.
- Observation (planned, not a defect): `src/lib/validate.ts:109` still requires a
  positive `size.height`, so a width-only version committed as a file would be
  rejected until Run 2 relaxes both validators. `npm run validate` passes because
  no on-disk diagram carries a width-only size; the relaxation is explicitly Run 2.

## Scope & Plan Fidelity

- **Files.** The builder's edits are confined to the declared Run 1 set:
  `src/lib/schema.ts`, `src/lib/flow.ts`, `src/lib/layout.ts`, `src/lib/versions.ts`
  (new), `src/DiagramPage.tsx`, `docs/prd.md`. File mtimes confirm ordering: the
  e2e specs were last written by the test-builder at 21:39/21:40, before the
  builder touched source at 21:44–21:47 — **e2e specs untouched by the builder**,
  matching its claim. `git diff --stat` also shows Run 0's uncommitted harness
  files (`package.json`, `package-lock.json`, `tsconfig.json`,
  `skills/.../validate.ts`) and `STATE.md`; those predate the builder (20:37–20:38)
  and belong to Run 0, so they are not Run 1 scope creep. `git diff --name-only --
  src/nodes/` is empty.
- **No TODO/debug leftovers.** `grep -rn "TODO\|FIXME\|XXX\|console.log\|debugger"`
  over the five changed source files → no matches. The two `console.info` calls in
  `DiagramPage.tsx` are the explicit Run-1 log surface for partial coverage/unknown
  ids (Run 3 promotes them to an aria-live notice), per plan decision 10.
- **Plan fidelity checkpoints.**
  - `buildFlow` authoritative for recorded ids while the full two-pass ELK still
    runs: `DiagramPage.tsx:60-76` runs `layoutDiagram` unconditionally and the
    measured `relayout` pass remains; e2e test 4 proves stability *after* both
    passes. ✓
  - `fixed = spec.size?.height !== undefined`: `src/lib/flow.ts:30`. ✓
  - Width-only leaves leave `node.height` unset: `src/lib/flow.ts:40-43`, proven
    at runtime. ✓
  - `mergeGeometry` immutable/id-keyed/unknown-ids-ignored: `src/lib/versions.ts:96-109`,
    covered by the Node-only test. ✓
  - No-version path unchanged: `DiagramPage.tsx:51-53` returns `loaded.diagram`
    identity when there is no version or no geometry; runtime byte-compare passes. ✓
  - `hasGeometry` precise (position or `width > 0`): `src/lib/versions.ts:87-91`,
    unit-tested. ✓
  - `sizeOf` fills a kind-default height for a width-only size: `src/lib/layout.ts:19-27`. ✓
  - `docs/prd.md` amendments cover all four prior coordinate/size locks
    (lines 14, 110, 186, 347); no `No coordinates ... at all` claim remains. The
    plan's "§5.7" reference is actually the §5.8 skill rule (line 341→347) and was
    amended; content-wise the intent is satisfied.
- **Deviations.** None material. The builder's "no e2e test edits" claim is
  corroborated by mtimes and by the fact that the test-builder's declared
  interfaces (`serializeVersion(diagram, nodes)`, `mergeGeometry(diagram, version)`,
  `hasGeometry(version)`, `loadVersion(id)`, envelope shape) match the shipped
  `src/lib/versions.ts` exactly.

## Required Fixes (if FAILED)

none
