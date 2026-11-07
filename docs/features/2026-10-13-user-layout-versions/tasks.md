# Tasks — User Layout Versions

Test level is one of `e2e` | `unit` | `none`. "unit" here means pure-function
coverage executed by Playwright in Node (no `page`); there is no separate unit
runner. Every item names the file(s) it changes and the PRD acceptance criterion
it satisfies. Fixed gates for every run: `npx tsc -b` (now covers `e2e/`),
`npx oxlint`, `npm run validate`, `npx playwright test`.

Round-2 rulings baked in: **autosave to localStorage, no unsaved/dirty state,
nothing discarded on reload**; explicit actions are **Download / Upload / Reset**;
partial coverage runs the **full normal two-pass ELK** with `buildFlow`
authoritative for recorded ids (no relayout suppression, no `data-relayouts`).

## Run 0 - Test harness bootstrap + reproducible e2e fixture + gate repair

- [x] `playwright.config.ts` (NEW) - testDir `e2e`, chromium only, artifacts
      under `node_modules/.tmp` with a list reporter (no new root ignore rules),
      `webServer` command `npm run fixtures && npm run dev` (never a bare `tsx`,
      so `npx playwright test` works when `node_modules/.bin` is not on PATH) on
      port 5173, `baseURL` `http://localhost:5173`, workers 1 for determinism -
      satisfies AC6 (gate) (test: e2e)
- [x] `package.json` (MODIFIED) - add `@playwright/test` devDependency; add
      `"e2e": "playwright test"`, `"fixtures": "tsx e2e/prepare.ts"`, and
      `"prevalidate": "npm run fixtures"`; change `"validate"` to the arg-less
      `tsx skills/create-diagram-files/scripts/validate.ts` - satisfies AC6
      (test: e2e)
- [x] `package-lock.json` (MODIFIED) - lock the Playwright dependency - satisfies
      AC6 (test: none)
- [x] `tsconfig.e2e.json` (NEW) - extend `tsconfig.app.json`, `include: ["e2e"]`,
      distinct `tsBuildInfoFile`, `types: ["node"]`, `lib` incl. DOM, so `tsc -b`
      type-checks the specs - satisfies AC6 (test: none)
- [x] `tsconfig.json` (MODIFIED) - add `{ "path": "./tsconfig.e2e.json" }` to
      references - satisfies AC6 (test: none)
- [x] `e2e/prepare.ts` (NEW) - idempotent, directory-creating materializer that
      writes the fixture into gitignored `src/diagrams/` (data inline, so Run 0
      needs no ninth file); never deletes user diagrams. The fixture payload
      (canonically `e2e/fixtures/e2e-layout-fixture.json`) MUST contain (a) a
      leaf with expandable sections, (b) a group with children, and (c) a group
      nested inside a group; Run 1 and Run 3 depend on these shapes and must not
      have to edit this Run 0 file. `meta.id`/stem `e2e-layout-fixture`, no
      collision with the four local diagrams - satisfies AC6 (test: none)
- [x] `e2e/smoke.spec.ts` (NEW) - app serves, `/d/e2e-layout-fixture` renders the
      canvas and at least one `[data-id]` node, Re-layout is enabled; tolerates
      extra diagrams and never asserts a global diagram count - satisfies AC6
      (test: e2e)
- [x] `e2e/layout-version.spec.ts` (NEW) - author the spike's deferred assertions
      as `test.fixme`; any Run 1 module is reached only via a non-literal dynamic
      import inside a skipped body so collection/`tsc` cannot fail before those
      files exist - satisfies AC1/AC3/AC4 (test: e2e)
- [x] `skills/create-diagram-files/scripts/validate.ts` (MODIFIED) - default
      directory `diagrams` -> `src/diagrams` so the arg-less `npm run validate`
      gate passes; `-- <dir>` still overrides; the position/optional-height rules
      land in Run 2 - satisfies AC6 (test: none)

Verification: `npx tsc -b`, `npx oxlint`, `npm run validate`,
`npx playwright test e2e/smoke.spec.ts` (green; fixme specs skipped;
`npx playwright install chromium` once if browsers are absent).

## Run 1 - Schema + geometry-preferred pipeline + apply/read path + AC6 guard

- [x] `src/lib/schema.ts` (MODIFIED) - add `NodePosition {x,y}` and
      `NodeSpec.position?`; add `NodeSize {width; height?}` and use it for
      `NodeSpec.size` (keep `Size` with required height for kind defaults and
      ELK input) - satisfies AC3 + §10 round-2 (test: unit)
- [x] `src/lib/flow.ts` (MODIFIED) - prefer `spec.position` over the placement;
      set `node.width` for recorded nodes plus `style`; set `node.height` and
      `style.height` **only** when `spec.size?.height !== undefined`
      (containers); for **width-only leaves** set `node.width` + `style.minHeight`
      and leave `node.height` **unset** (a set `node.height` is a fixed inline
      height that stops the leaf growing when a section expands); define
      `fixed = spec.size?.height !== undefined`; leaves stay unfixed; keep
      no-version output byte-identical - satisfies AC1/AC3/AC6 (test: unit + e2e)
- [x] `src/lib/layout.ts` (MODIFIED) - `sizeOf` fills the kind-default height when
      a recorded `size` omits it, so the full ELK pass never gets undefined
      dimensions; positions remain ELK-derived for unrecorded ids - satisfies
      AC3/AC6/AC8 (test: unit)
- [x] `src/lib/versions.ts` (NEW) - storage key
      `render-diagrams:layout-version:<id>`; guarded `loadVersion` + pure
      `parseVersion` shape check; `hasGeometry` = any recorded `position` or
      `size.width > 0`; immutable `mergeGeometry(diagram, version)` by node id
      (unknown ids ignored, never mutates the input diagram), and pure
      `serializeVersion(diagram, nodes)` (position always, width always,
      containers' height only) - satisfies AC3/AC5/AC6/AC8/AC12 (test: unit)
- [x] `src/DiagramPage.tsx` (MODIFIED) - load the version and merge it once via
      `useMemo` keyed on the loaded diagram + version identity so the merged
      `diagram` object identity stays stable and the existing
      `useEffect([diagram, ...])` layout effect does not re-run layout every
      render; run the **normal two-pass ELK unconditionally**, rely on
      `buildFlow` to keep recorded geometry stable across both passes, keep the
      no-version path identical, and log/notice partial coverage - satisfies
      AC1/AC3/AC4/AC6/AC8 (test: e2e)
- [x] `e2e/layout-version.spec.ts` (MODIFIED) - activate: inject a version via
      `addInitScript`, assert measured positions equal saved values on a fresh
      load; assert **width-only** for leaves and **width+height** for
      containers; assert a nested group child's **absolute** position matches;
      reload twice for byte-identical geometry; assert recorded geometry is
      stable after both ELK passes; assert an unknown id is ignored; Node-only
      cases cover `serializeVersion`/`mergeGeometry`/`hasGeometry` - satisfies
      AC1/AC3/AC4/AC5/AC6/AC8 (test: unit + e2e)
- [x] `e2e/no-version.spec.ts` (NEW) - AC6 behavioral regression: open the
      fixture with no stored version; assert auto-layout geometry is
      deterministic (two loads identical), a leaf grows on section expand,
      Re-layout still works, and merely opening writes no version - satisfies
      AC6 (test: e2e)
- [x] `docs/prd.md` (MODIFIED) - amend **all** coordinate/size locks, not just
      §0/§3/§5.3: the "No coordinates in JSON at all" claims (§0 table, §5.3),
      the UI authoring/editing non-goal (§3), the §5.7 "no coordinates or sizes"
      invariant, and the deliberate-removal rationale prose (~lines 182-185 and
      ~341), so the committed PRD authorizes persisted user geometry while
      authored diagram content stays coordinate-free and is not
      self-contradicting - satisfies AC2/AC3 (test: none)

Verification: `npx tsc -b`, `npx oxlint`, `npm run validate`,
`npx playwright test`.

## Run 2 - Autosave / Download / Upload / Reset + persistence + feedback + docs

- [x] `src/lib/versions.ts` (MODIFIED) - `saveVersion(id, diagram, nodes)`
      (debounced by the caller), `clearVersion(id)`, `downloadVersion(id, ...)`
      (`<id>.json` Blob, no-op + message when there is no geometry),
      `readUploadedVersion(file)`; guarded storage accessor that never throws on
      unavailable/quota - satisfies AC2/AC5/AC7/AC9/AC10/AC11 (test: unit + e2e)
- [x] `src/lib/validate.ts` (MODIFIED) - validate `position` as finite
      `{x:number,y:number}`; make `size` require a positive width and accept an
      omitted height - satisfies AC6/AC8/AC11 (test: unit)
- [x] `skills/create-diagram-files/scripts/validate.ts` (MODIFIED) - mirror the
      `position` / optional-height rules and extend `--self-test` with a
      position + width-only case - satisfies AC6/AC11 (test: unit)
- [x] `src/DiagramPage.tsx` (MODIFIED) - debounced autosave on user drag/resize
      end (ignore measurement-only changes), Download / Upload / Reset controls
      with labels + keyboard focus handling, Reset confirmation, aria-live status
      confirmation, and no dirty indicator; Reset clears the version and re-runs
      the normal ELK pipeline - satisfies AC2/AC7/AC9/AC10/AC11 (test: e2e)
- [x] `src/App.css` (MODIFIED) - toolbar, focus-visible, and status/aria-live
      styles - satisfies AC10 (test: none)
- [x] `e2e/save-load.spec.ts` (NEW) - drag/resize autosaves (debounced) with a
      visible/announced confirmation; reload reproduces geometry identically; a
      version for diagram A leaves diagram B on auto-layout; Reset confirms,
      clears, and restores ELK; Download→Upload re-applies geometry; a second
      adjustment replaces the first version; controls are keyboard reachable -
      satisfies AC1/AC2/AC3/AC5/AC7/AC9/AC10/AC11/AC12 (test: e2e)
- [x] `README.md` (MODIFIED) - document autosave + localStorage plus
      Download/Upload/Reset; remove the absolute "no coordinates" claim and note
      the validator default/`prevalidate` behavior - satisfies AC2/AC6/AC10
      (test: none)
- [x] `skills/create-diagram-files/references/schema.md` (MODIFIED) - document
      `position` and width-only `size`, and that heights are container-only -
      satisfies AC3 (test: none)

Verification: `npx tsc -b`, `npx oxlint`, `npm run validate`,
`npx playwright test`.

## Run 3 - Robustness, edge states, storage failures, section behavior + docs

- [ ] `src/lib/versions.ts` (MODIFIED) - reject malformed versions without
      throwing; classify unknown-id, partial-coverage, and corrupt-version
      conditions into a warning result - satisfies AC8 (test: unit)
- [ ] `src/DiagramPage.tsx` (MODIFIED) - render a non-blocking aria-live notice
      for invalid/stale/partial versions and storage-unavailable; fall back to
      auto-layout when the version is unusable; keep Download available when
      storage is unavailable - satisfies AC7/AC8/AC9/AC10 (test: e2e)
- [ ] `e2e/robustness.spec.ts` (NEW) - corrupt version falls back with a warning;
      unknown id ignored while the rest applies; partial version auto-lays-out
      missing nodes and warns; localStorage unavailable/quota-exceeded does not
      throw and Download still works; diagrams remain isolated - satisfies
      AC5/AC7/AC8/AC9 (test: e2e)
- [ ] `e2e/layout-version.spec.ts` (MODIFIED) - activate and document the
      section-expand test: a saved **width-only leaf has no fixed inline height**
      (`node.height` unset; only `style.minHeight`) and its measured height grows
      when a section expands, while a saved container keeps its recorded height
      and scrolls; record the partial-coverage behavior - satisfies AC3/AC6 +
      §10 round-2 (test: e2e)
- [ ] `skills/create-diagram-files/SKILL.md` (MODIFIED) - reconcile the "no
      coordinates/sizes" rule with the persisted-geometry default and the
      `src/diagrams` validator default - satisfies AC6/AC11 (test: none)

Verification: `npx tsc -b`, `npx oxlint`, `npm run validate`,
`npx playwright test`.

## Acceptance-criteria coverage

| AC | Runs / tests |
|---|---|
| AC1 Adjustable geometry | Run 1 `layout-version.spec.ts`, Run 2 `save-load.spec.ts` (e2e) |
| AC2 Autosave + Download | Run 2 `versions.ts`, `DiagramPage.tsx`, `save-load.spec.ts` |
| AC3 Reload reproduces | Run 1 `layout-version.spec.ts`; Run 2 `save-load.spec.ts` |
| AC4 Determinism / no drift | Run 1 `layout-version.spec.ts` (two loads identical) |
| AC5 Scope isolation | Run 1 `versions.ts` key (unit); Run 2 A/B; Run 3 isolation |
| AC6 Backward compatibility | Run 0 gates; Run 1 `no-version.spec.ts`; all gates |
| AC7 Reset to auto-layout | Run 2 `DiagramPage.tsx` + `save-load.spec.ts`; Run 3 storage edge |
| AC8 Invalid / stale | Run 1 unknown ids; Run 3 parser + notice + `robustness.spec.ts` |
| AC9 Adjustments persist; Reset clears | Run 2 autosave/reload + Reset; Run 3 reset-clear |
| AC10 Save feedback | Run 2 aria-live status + `save-load.spec.ts` |
| AC11 Portability | Run 2 Download/Upload + both validators + `save-load.spec.ts` |
| AC12 Version identity (re-save replaces) | Run 2 `saveVersion` + `save-load.spec.ts` |
