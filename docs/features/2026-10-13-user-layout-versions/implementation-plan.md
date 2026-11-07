# Implementation Plan — User Layout Versions

## Overview

This plan implements the product spec in
`docs/features/2026-10-13-user-layout-versions/PRD.md` (§5 acceptance criteria,
§10 resolved decisions incl. the round-2 height refinement and the round-2
autosave ruling) on top of the geometry findings in
`docs/features/2026-10-13-user-layout-versions/spike-1.md`. A "saved version" is
a coordinate-bearing view of one diagram: `position` on every recorded node and
a `size` whose `height` is present only for containers. It is persisted
**automatically (autosaved, debounced) to `localStorage`** keyed by diagram id —
there is no unsaved/dirty state and nothing is discarded on reload. The explicit
user actions are **Download** (`<id>.json`), **Upload**, and **Reset**. On load,
`buildFlow` is authoritative for recorded ids while the **full normal two-pass
ELK pipeline still runs** (ELK only determines unrecorded/stale nodes), so
recorded geometry is stable across both passes without suppressing anything. A
diagram with no version renders through the existing pipeline byte-for-byte
unchanged. The work is split into four dependency-ordered runs (Run 0 bootstraps
the missing Playwright harness and a hermetic fixture, Run 1 lands the
apply/read path and the AC6 baseline guard, Run 2 the autosave/Download/Upload/
Reset path, Run 3 robustness + docs), each within the 8-file soft limit and
independently verifiable.

## Blast radius

Exact files, each marked NEW or MODIFIED with a one-line reason.

Harness (Run 0)

- `package.json` — MODIFIED: add `@playwright/test`, an `e2e` script, a
  `fixtures`/`prevalidate` pair, and make `validate` arg-less (the default moves
  into the validator so `npm run validate -- <dir>` still works — see
  Feasibility).
- `package-lock.json` — MODIFIED: lockfile churn from installing Playwright.
- `playwright.config.ts` — NEW: testDir `e2e`, chromium only, artifacts under
  `node_modules/.tmp` (no new root `.gitignore` entries needed), `webServer`
  command `npm run fixtures && npm run dev` (never a bare `tsx`, so
  `npx playwright test` works when `node_modules/.bin` is not on PATH) on 5173,
  `baseURL` `http://localhost:5173`.
- `tsconfig.e2e.json` — NEW: type-checks `e2e/` with bundler resolution + DOM
  libs + node types, closing the "`tsc -b` only covers `src`" hole.
- `tsconfig.json` — MODIFIED: add the `e2e` project reference so `npx tsc -b`
  covers the specs.
- `e2e/prepare.ts` — NEW: idempotent, directory-creating fixture materializer
  (fixture data inline) that writes the gitignored `src/diagrams/` before Vite
  starts.
- `e2e/smoke.spec.ts` — NEW: harness proof that the app serves, routes to the
  fixture by explicit id, renders the canvas, and enables Re-layout.
- `e2e/layout-version.spec.ts` — NEW: the spike's deferred runtime assertions,
  authored as `test.fixme` with non-literal dynamic imports (see Feasibility),
  activated in Run 1/Run 3.

Apply / read path (Run 1)

- `src/lib/schema.ts` — MODIFIED: add optional `NodeSpec.position` and a
  `NodeSize` type whose `height` is optional (width always recorded).
- `src/lib/flow.ts` — MODIFIED: prefer saved `position`/`size` over the ELK
  placement for recorded ids; set `node.width` always but `node.height` only when
  `spec.size.height` is present (width-only leaves get `style.minHeight` and no
  `node.height`, so React Flow cannot fix their inline height); derive `fixed`
  from an explicit height only.
- `src/lib/layout.ts` — MODIFIED: fill a kind-default height when a recorded
  `size` omits height, so the full ELK pass never receives `undefined`
  dimensions.
- `src/lib/versions.ts` — NEW: storage key, guarded read/parse, precise
  `hasGeometry`, `mergeGeometry` (immutable, id-keyed, unknown ids ignored), and
  the pure serializer.
- `src/DiagramPage.tsx` — MODIFIED: load the version, build the merged graph,
  run the normal two-pass pipeline unconditionally, surface partial coverage as
  a log/notice, and keep the no-version path identical.
- `e2e/layout-version.spec.ts` — MODIFIED: activate the geometry assertions
  (width-only leaves, width+height containers, nested child absolute position,
  byte-identical loads, recorded geometry stable after both passes) plus
  Node-only unit tests for the pure `versions` functions.
- `e2e/no-version.spec.ts` — NEW: AC6 behavioral baseline — no stored version
  means auto-layout geometry, a leaf grows on section expand, and Re-layout works.
- `docs/prd.md` — MODIFIED: amend every coordinate/size lock ("No coordinates in
  JSON at all" §0/§5.3; UI editing non-goal §3; §5.7 "no coordinates or sizes";
  the deliberate-removal rationale prose ~lines 182-185 and ~341) so the
  committed PRD authorizes persisted user geometry while diagram content stays
  coordinate-free and is not self-contradicting.

Autosave / portability path (Run 2)

- `src/lib/versions.ts` — MODIFIED: `saveVersion` (debounced caller), `clearVersion`,
  `downloadVersion`, `readUploadedVersion`, and a guarded storage accessor.
- `src/lib/validate.ts` — MODIFIED: validate `position` and a width-only `size`.
- `skills/create-diagram-files/scripts/validate.ts` — MODIFIED: mirror the
  `position` / optional-height rules and extend `--self-test`.
- `src/DiagramPage.tsx` — MODIFIED: debounced autosave on drag/resize end,
  Download / Upload / Reset controls, accessible confirmation via aria-live,
  and no dirty indicator.
- `src/App.css` — MODIFIED: toolbar, status/live-region, and control focus styles.
- `e2e/save-load.spec.ts` — NEW: autosave→reload identity, scope isolation,
  Reset, Download→Upload round-trip, re-save replacement, feedback.
- `README.md` — MODIFIED: document autosave/localStorage + Download/Upload/Reset;
  remove the "no coordinates" absolute.
- `skills/create-diagram-files/references/schema.md` — MODIFIED: document
  `position` and width-only `size`.

Robustness / docs (Run 3)

- `src/lib/versions.ts` — MODIFIED: reject malformed versions, classify
  unknown-id/partial-coverage/corrupt conditions into a warning result.
- `src/DiagramPage.tsx` — MODIFIED: non-blocking notice (aria-live) for
  invalid/stale/partial versions and storage-unavailable, Download fallback.
- `e2e/robustness.spec.ts` — NEW: corrupt fallback, unknown-id ignore, partial
  coverage, localStorage-unavailable/quota, cross-diagram isolation.
- `e2e/layout-version.spec.ts` — MODIFIED: activate the section-expand test (saved
  leaf grows / saved container keeps height and scrolls) and record the
  partial-coverage behavior.
- `skills/create-diagram-files/SKILL.md` — MODIFIED: reconcile the "no
  coordinates/sizes" rule with the persisted-geometry default and the
  `src/diagrams` default directory.

## Feasibility

The feature fits the current architecture with one new module
(`src/lib/versions.ts`) and small, surgical changes to three pure functions.

- **The pipeline is no longer intercepted by suppression.** `DiagramPage.tsx`
  runs `layoutDiagram` on mount and a second measured pass keyed on
  `useNodesInitialized()`; both call `setNodes(buildFlow(...))`. Making
  `buildFlow` authoritative for recorded ids means the second pass cannot
  overwrite saved geometry even though it runs. This is simpler and safer than
  the previous suppress-the-pass design: there is one code path for every
  diagram, ELK always produces placements for unrecorded/stale nodes, and no
  counter/flag is needed. The e2e proves recorded geometry is stable *after*
  both passes rather than proving a pass did not run.
- **Autosave is a write-side concern only.** `onNodesChange` already exists
  (React Flow controlled mode); a small wrapper persists the whole current node
  list after a user drag/resize ends, debounced. Measurement-only dimension
  changes are ignored, so merely opening a diagram never creates a version and
  Q4's "no geometry → full auto-layout" fallback remains reachable. There is no
  dirty state to reconcile, no discard path, and reload is just a re-read.
- **Coordinate frames are already correct.** ELK returns children
  parent-relative and `buildFlow` stores them verbatim, and React Flow's
  `updateAbsolutePositions` rewrites only `internals.positionAbsolute`, never
  `node.position` (spike §1-2). Saved `position` is written back verbatim with
  no conversion or rounding; fractional ELK values survive the JSON round trip.
- **Sizes.** Group size is mandatory because `extent: 'parent'` clamps children
  into an undersized group (spike §5); applying sizes via `node.width`/`node.height`
  in addition to `style` avoids the first-frame clamp (spike §6). Width-only
  leaves must set `node.width` + `style.minHeight` and leave `node.height`
  **unset**: React Flow treats a set `node.height` as a fixed inline height, so a
  width-only leaf would stop growing when a section expands. The round-2
  decision keeps leaves unfixed by never recording a leaf height, which requires
  changing `fixed = !!spec.size` (`flow.ts:24`) to depend on an explicit height
  only. `layout.ts` still needs the kind-default fill for width-only entries so
  ELK's own pass has numeric dimensions.
- **Schema / migration.** Both schema additions are optional
  (`position?:`, `size.height?:`), no existing diagram has `position` or a
  width-only `size` (the validator currently rejects the latter),
  `/src/diagrams/` is gitignored, and localStorage is greenfield. No migration
  and no committed artifact change is required.
- **Persistence.** `DiagramPage.tsx` is the only place with a mutable node list,
  so autosave reads `getNodes()` and serializes; Download/Upload reuse the same
  serializer/parser. The key reuses `LoadedDiagram.id` (== `meta.id`), giving
  per-diagram scoping for free. localStorage access is wrapped in a guarded
  accessor so private-mode/quota failures degrade to Download-only rather than
  crashing.
- **Validator default, not npm arg.** `npm run validate -- <dir>` breaks if the
  npm script hard-codes a directory (npm appends the arg after it, so the
  hard-coded default wins). The plan instead changes the validator fallback at
  `skills/create-diagram-files/scripts/validate.ts:~232`
  (`process.argv[2] ?? 'src/diagrams'`) and leaves the npm script arg-less.
  `prevalidate` runs `e2e/prepare.ts` so a fresh checkout (where gitignored
  `src/diagrams/` is absent) still has a directory to validate. **No CI config
  exists in the repo**, so this is a local/agent-workflow guarantee; note it in
  the README.
- **Validators.** `src/lib/validate.ts` and the self-contained
  `skills/create-diagram-files/scripts/validate.ts` are duplicated; both must be
  relaxed identically (accept `position`, make `size.height` optional) for a
  downloaded/committed version to pass `npm run validate`, and the skill's
  `--self-test` gains a position + width-only case. This is additive; existing
  diagrams are unaffected.
- **e2e type-checking.** `tsconfig.e2e.json` extends the app config and includes
  `e2e/`, referenced from the root project list, so `npx tsc -b` covers specs.
  Run 0's `test.fixme` bodies import Run 1 modules only through a **non-literal
  specifier** (`const p = '../src/lib/versions'; await import(p)`) so neither
  `tsc` nor Playwright collection resolves a module that does not exist yet.
- **Spike answer.** Spike 1 is resolved: positions + sizes round-trip byte-exact
  including doubly-nested groups; the only drift source was the two-pass
  pipeline, which the authoritative-`buildFlow` rule neutralizes. Residual
  browser-only items (DOM-measured equality, effect ordering, section expand
  after save) are assigned to Run 0/Run 3, not left open. **No spike item
  remains open.**

Environment finding (pre-existing defect, fixed in Run 0): `npm run validate`
exits 1 today because the script defaults to `./diagrams` while the README
documents `src/diagrams/`. `npx tsx skills/create-diagram-files/scripts/validate.ts
src/diagrams` passes (4/4). Run 0 moves the default into the validator and adds
`prevalidate` so the fixed gate is meaningful on a fresh checkout.

e2e reproducibility finding: `/src/diagrams/` is gitignored, so a fresh checkout
has no diagrams and the app renders "No diagrams yet". Run 0 commits the fixture
data inside `e2e/prepare.ts` and materializes it into `src/diagrams/` via the
webServer command before Vite starts. The fixture uses id/file stem
`e2e-layout-fixture` (no collision with the four locally present diagrams:
delegation-flow, information-flow, llm-message-flow, memory-flow); specs always
navigate by that explicit id and tolerate extra diagrams.

## Architecture decisions

1. **Recorded box is `NodeSpec.size` with optional height** (Q1, Q3 round-2).
   `NodeSpec.size` becomes `{ width: number; height?: number }`; a leaf records
   `{ width }`, a container records `{ width, height }`. `Size` (both required)
   stays for kind defaults, measured overrides, and ELK input.
2. **`fixed` means "has an explicit height"** (round-2, spike §6). `fixed =
   spec.size?.height !== undefined`, and `{.kn--fixed}` styling follows it.
   Existing diagrams always have both fields, so this is behavior-preserving;
   width-only leaves stay auto-height and grow with their sections.
3. **`buildFlow` is authoritative for recorded geometry; the full two-pass ELK
   pipeline always runs** (Q1, Q4, reviewer item 4). For each spec it uses
   `spec.position ?? placement.position` and `spec.size?.width ?? placement.width
   ?? kind default`. Height is split deliberately:
   - when `spec.size?.height !== undefined` (containers), set **both**
     `node.height` and the style height;
   - when the spec is **width-only** (leaves), set `node.width` and
     `style.minHeight`, and leave `node.height` **unset** — React Flow applies a
     set `node.height` as a fixed inline height, so a width-only leaf would stop
     growing when a section expands (breaking the round-2 decision);
   - with no `spec.size`, fall back to `placement.height ?? kind default`.
   ELK only determines nodes without recorded geometry. There is **no
   relayout-suppression, no full-coverage ELK skip, and no `data-relayouts`
   counter**. Existing diagrams have neither field, so output is byte-identical.
4. **A version is merged onto the live diagram by node id, immutably** (Q1, Q6).
   `mergeGeometry(diagram, version)` returns a new `Diagram` with cloned nodes,
   keeping current content and copying only `position`/`size` from matching ids;
   it never mutates `loaded.diagram` (otherwise Reset could not clear geometry
   once merged). The merge runs **once per loaded diagram** via `useMemo` keyed
   on the loaded diagram + version identity, so the merged `diagram` object
   identity stays stable across renders and the existing `useEffect([diagram,
   ...])` layout effect does not re-run every render. Version-only ids are
   ignored (AC8); diagram-only ids keep auto-layout (partial coverage). A
   content edit after a save is never clobbered.
5. **`hasGeometry` is precise** (Q4, reviewer item 9): a version has geometry iff
   at least one recorded node has a `position` or a `size.width > 0`. A version
   with no geometry falls back to full auto-layout.
6. **Autosave; there is no unsaved state** (Q7b, reviewer item 1). A user drag or
   resize end schedules a debounced (≈300 ms) persist of the whole current node
   list; adjustments survive reload/navigation automatically. There is no dirty
   indicator, no Save button, and no discard-on-reload. Measurement-only
   dimension changes are ignored so opening a diagram writes nothing. Save
   feedback (AC10) is a status announcement, not an explicit action.
7. **The explicit actions are Download, Upload, Reset** (Q2, Q5, Q7, reviewer
   item 1). **Download** writes the current serialized version as `<id>.json`
   (if no version/geometry exists it shows "No adjustments to download" and does
   nothing). **Upload** parses a previously exported `<id>.json`, merges it, and
   autosaves it (an upload with no adjustments still applies and persists the
   file's geometry). **Reset** clears the version after confirmation and returns
   to auto-layout.
8. **Reset replaces Re-layout only while a version is applied** (Q4, AC6, AC7).
   Without a version the button remains "Re-layout" and behaves exactly as
   today; with a version it becomes "Reset saved layout" (confirm → `clearVersion`
   → re-run the normal ELK pipeline).
9. **`localStorage` is the default home; Download/Upload is the portable format**
   (Q2, Q5). Key `render-diagrams:layout-version:<diagramId>`; re-saving replaces
   the single stored version (AC12); committing the file is optional and out of
   scope. Access goes through a guarded accessor (item 8); on failure/corruption
   autosave silently degrades, the status region warns, and Download remains the
   durable route.
10. **Invalid/stale versions never blank the page** (AC8). The parser rejects
    malformed shapes; unknown ids are ignored; partial coverage runs the normal
    two-pass ELK for the rest. Run 1 emits a console log/notice for partial
    coverage; Run 3 promotes it to a non-blocking, aria-live warning.
11. **Validation stays additive and the duplicated validators move together**
    (Q5, Q6, reviewer item 3). `position` is `{x: number, y: number}` and `size`
    is width-required / height-optional in both copies; the validator's default
    directory becomes `src/diagrams` so the npm script stays arg-free.
12. **One test runner.** There is no unit runner and the fixed gates only name
    Playwright. Pure functions (`mergeGeometry`, serializer, `hasGeometry`,
    parser) are covered by Node-only Playwright tests colocated in
    `e2e/layout-version.spec.ts` (no `page`), so "unit" coverage needs no extra
    dependency.
13. **e2e is type-checked** via a dedicated `tsconfig.e2e.json` referenced from
    the root project list (reviewer item 11); Run 0's skipped bodies use
    non-literal dynamic imports so the project stays green before Run 1 modules
    exist (item 10).
14. **Run 0 also repairs the validate default and materializes diagrams**
    (reviewer items 3, 12). `prepare.ts` creates `src/diagrams/`, is idempotent,
    and writes a collision-free fixture; `prevalidate` makes `npm run validate`
    reproducible on a fresh checkout. No CI config exists to wire this into.

## Effort

Overall **M-L**. The domain is small and the risky part (geometry fidelity) is
already de-risked by the spike; the change touches the central layout pipeline
plus new persistence and UI, and must not perturb the no-version path.

- **Run 0 — M**: installs and configures a harness from zero, an e2e tsconfig,
  the fixture/reproducibility problem, and a pre-existing gate fix.
- **Run 1 — L**: highest-risk run (schema, `flow`, `layout`, new `versions`
  module, `DiagramPage` lifecycle, AC6 baseline). Everything downstream depends
  on it.
- **Run 2 — M**: mostly additive autosave + UI + persistence on top of a proven
  apply path; the two validators must change together.
- **Run 3 — S**: edge-state handling, storage-failure surface, and docs on
  established plumbing.

## Risks

- **DOM-measured size ≠ saved size** (sub-pixel/DPR, auto-height text). Mitigate
  with the Run 1 e2e assertions (containers' measured width/height equal saved),
  `box-sizing: border-box`, and applying sizes via `node.width`/`node.height` +
  `style`.
- **A layout pass silently overwrites saved geometry.** Mitigate by making
  `buildFlow` authoritative (decision 3) and asserting recorded geometry is
  stable *after* both ELK passes in e2e (not by suppressing a pass).
- **Width-only sizes flip nodes to fixed or freeze their height.** Mitigate with
  decisions 2 and 3: leave `node.height` unset for width-only leaves (use
  `style.minHeight`) so React Flow cannot apply a fixed inline height, and add an
  e2e test that a saved leaf still grows when its section expands.
- **Recorded group height dropped → children shift through `extent: 'parent'`.**
  Mitigate by always recording container height and asserting nested child
  **absolute** positions (not only parent-relative) after reload.
- **Autosave writes measurement churn or loops.** Mitigate by persisting only on
  user drag/resize end, debouncing, and asserting that opening a diagram without
  interaction leaves no version in storage.
- **localStorage unavailable/quota/cleared.** Mitigate with the guarded accessor,
  a visible warning, the Download/Upload durable route, and a Run 3 e2e test
  (item 8).
- **`mergeGeometry` mutating the shared diagram makes Reset ineffective.**
  Mitigate by returning a new `Diagram` with cloned nodes (decision 4) and an
  e2e reset test.
- **Fresh checkout/CI has no diagrams (gitignored) and no CI config.** Mitigate
  with the fixture inline in `e2e/prepare.ts`, the `prevalidate` script, and
  specs that navigate by explicit id and tolerate extra diagrams.
- **Playwright browsers absent.** Mitigate by documenting/installing
  `npx playwright install chromium` as part of Run 0 verification.
- **`npm run validate` currently exits 1.** Mitigate by moving the default into
  the validator plus `prevalidate` in Run 0 and proving `npm run validate` passes
  before feature work starts.
- **Two validator copies drift.** Mitigate by changing both in Run 2 and running
  the validator `--self-test` plus `npm run validate`.
- **Committed `<id>.json` with inline geometry defeats Reset.** Q5 permits a user
  to commit a downloaded version into `src/diagrams/`; because `buildFlow`
  honors `spec.position`, clearing localStorage cannot return that diagram to
  auto-layout. Accepted under Q5 (Reset clears the *stored* version, not
  committed file geometry) and noted here so it is not later discovered as a
  bug.
- **e2e type-check hole.** Mitigate with `tsconfig.e2e.json` referenced from the
  root (decision 13); the Run 0 `test.fixme` bodies use non-literal dynamic
  imports so the project never resolves missing modules.
- **Accessibility regressions in the new toolbar.** Mitigate with labelled
  controls, keyboard/focus handling, and an aria-live status region (item 7),
  asserted in Run 2 e2e.

## Runs

### Run 0 — Test harness bootstrap + reproducible e2e fixture + gate repair

**Goal.** Stand up the missing Playwright harness, make the e2e suite runnable on
a fresh checkout, close the e2e type-check hole, and make `npm run validate`
green. Author (but keep skipped) the spike's deferred runtime assertions.

**Files.** `package.json`, `package-lock.json`, `playwright.config.ts`,
`tsconfig.e2e.json`, `tsconfig.json`, `e2e/prepare.ts`, `e2e/smoke.spec.ts`,
`e2e/layout-version.spec.ts`, `skills/create-diagram-files/scripts/validate.ts`
(default-directory fix only; the position/optional-height rules land in Run 2).
(9 files — one over the soft limit; the validator default fix is a Run 0
prerequisite for a green `npm run validate` gate.)

**Depends on.** Nothing.

**How to verify.** `npm run e2e` (or `npx playwright test`) passes the smoke test;
`npx playwright test e2e/layout-version.spec.ts` reports the future assertions as
skipped (`test.fixme`), so the gate is green; `npm run validate` reports the
fixture clean (plus the four local diagrams when present) on a fresh checkout;
`npx tsc -b` (now including `e2e`) and `npx oxlint` pass.

**Rollback.** Revert the run's commit; remove `playwright.config.ts`,
`tsconfig.e2e.json`, and `e2e/`; restore the previous `package.json`,
`tsconfig.json`, and lockfile. No runtime or data impact.

**Verification.** `npm run validate`, `npx tsc -b`, `npx oxlint`,
`npx playwright test e2e/smoke.spec.ts`. Covers AC6 (gates) and authors the
harness for AC1/AC3/AC4.

### Run 1 — Schema + geometry-preferred pipeline + apply/read path + AC6 guard

**Goal.** A geometry-bearing version in localStorage reproduces exact geometry
and is never overwritten by either ELK pass; no-version diagrams remain
byte-identical to the pre-feature baseline.

**Files.** `src/lib/schema.ts`, `src/lib/flow.ts`, `src/lib/layout.ts`,
`src/lib/versions.ts`, `src/DiagramPage.tsx`, `e2e/layout-version.spec.ts`,
`e2e/no-version.spec.ts`, `docs/prd.md`.

**Depends on.** Run 0.

**How to verify.** `npx playwright test e2e/layout-version.spec.ts` proves:
measured positions equal injected saved values on a fresh load; leaves record
**width only** and containers record width+height; a nested group child's
**absolute** position matches after reload; two consecutive loads are
byte-identical; recorded geometry is stable after both ELK passes run; an
unknown id is ignored. Node-only tests in the same file cover
`serializeVersion`/`mergeGeometry`/`hasGeometry`. `e2e/no-version.spec.ts` proves
the AC6 baseline (no stored version → auto-layout geometry, leaf grows on section
expand, Re-layout works, no version written by merely opening). Smoke still
passes.

**Rollback.** Revert the run's commit. Versions only live in localStorage, so
runtime data is unaffected; existing diagrams fall back to the old pipeline.

**Verification.** `npx tsc -b`, `npx oxlint`, `npm run validate`,
`npx playwright test`. Covers AC1, AC3, AC4, AC5 (key), AC6 (baseline), AC8
(unknown ids); realizes spike recommendations 1-3 and PRD §5 AC2/AC9's
autosave-on-reload premise at the read layer.

### Run 2 — Autosave / Download / Upload / Reset + persistence + feedback

**Goal.** Adjusting any node autosaves the arrangement, survives a reload,
exports/imports `<id>.json`, and resets to auto-layout with visible, accessible
feedback.

**Files.** `src/lib/versions.ts`, `src/lib/validate.ts`,
`skills/create-diagram-files/scripts/validate.ts`, `src/DiagramPage.tsx`,
`src/App.css`, `e2e/save-load.spec.ts`, `README.md`,
`skills/create-diagram-files/references/schema.md`.

**Depends on.** Run 1.

**How to verify.** `npx playwright test e2e/save-load.spec.ts`: drag/resize →
geometry is autosaved (debounced) → status confirmation announced → reload →
geometry identical; Download yields `<id>.json` incl. leaf width-only and
container width+height; a version for diagram A does not affect diagram B;
Reset confirms, clears, and restores ELK; Download then Upload re-applies the
same geometry; a second adjustment replaces the first version; controls are
keyboard-focusable and the status region is aria-live. Validator `--self-test`
(incl. position + width-only) and `npm run validate` pass.

**Rollback.** Revert the run's commit and clear the version key from
localStorage if desired; no committed diagram data is touched.

**Verification.** `npx tsc -b`, `npx oxlint`, `npm run validate`,
`npx playwright test`. Covers AC2, AC5, AC7, AC9 (autosave persistence), AC10,
AC11, AC12.

### Run 3 — Robustness, edge states, storage failures, docs

**Goal.** Malformed, stale, or partial versions never blank the page and are
surfaced to the user; storage-unavailable degrades to Download; the
section-expand consequence of the round-2 decision is documented and tested.

**Files.** `src/lib/versions.ts`, `src/DiagramPage.tsx`,
`e2e/robustness.spec.ts`, `e2e/layout-version.spec.ts`,
`skills/create-diagram-files/SKILL.md`.

**Depends on.** Run 2.

**How to verify.** `npx playwright test e2e/robustness.spec.ts`: a corrupt
version falls back to auto-layout with a warning; an unknown id is ignored while
the rest applies; a partial version auto-lays-out missing nodes and warns;
with localStorage unavailable/quota-exceeded the guarded accessor does not throw
and Download still works; two diagrams stay isolated. `e2e/layout-version.spec.ts`
proves a saved **width-only leaf carries no `node.height`** so it grows on
section expand (measured height increases) while a saved container keeps its
recorded height and scrolls, and records the partial-coverage behavior.

**Rollback.** Revert the run's commit; the platform keeps working with Run 2
behavior.

**Verification.** `npx tsc -b`, `npx oxlint`, `npm run validate`,
`npx playwright test`. Covers AC7 (storage edge), AC8, AC9 (reset clears), and
the round-2 section-expand refinement.

## Sequencing & milestones

- Run 0 → Run 1 → Run 2 → Run 3 strictly serial: each run builds on the
  previous run's files (`versions.ts` and `DiagramPage.tsx` are touched by Runs
  1-3, so parallel work on them would conflict).
- Milestone A (Run 0): gates green, e2e type-checked, and a reproducible
  hermetic e2e harness.
- Milestone B (Run 1): saved geometry survives both ELK passes, and the
  no-version baseline is guarded — the core risk.
- Milestone C (Run 2): user-visible autosave/download/upload/reset loop with
  accessible feedback.
- Milestone D (Run 3): failure modes, storage degradation, and docs.
- Parallelizable within a run: the e2e spec authoring (test-builder) can proceed
  from the plan while the builder implements, since both target the same files
  in a run but the workflow serializes test-builder → builder.
- Not parallelizable: `src/lib/versions.ts` and `src/DiagramPage.tsx` across
  Runs 1-3.

## Out of scope

- Multiple named layout versions per diagram (Q1c).
- Any hidden draft/unsaved layer (Q7c) or explicit Save button (Q7a).
- Committing versions into `/src/diagrams/` or changing the gitignore rule (Q5).
- Persisting section collapsed/expanded state (Q3d).
- URL-fragment layout sharing (Q2d) and a Vite write endpoint (Q2b).
- Backend, collaboration, conflict merging, or cross-device sync.
- Any change to ELK behavior or rendering for diagrams with no saved version.
- Adding a second test runner (e.g. Vitest) — all tests run under Playwright.
- Migrating existing diagrams (Q6c) or emitting coordinates from the authoring
  skill.
