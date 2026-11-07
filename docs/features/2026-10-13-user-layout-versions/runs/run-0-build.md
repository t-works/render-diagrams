# Run 0 — Test harness bootstrap + reproducible e2e fixture + gate repair

**Status:** complete — all Run 0 verification gates green.
**Date:** 2026-10-13
**Covers:** AC6 (gates/backward compatibility); authors the harness for AC1/AC3/AC4.

## Completed

Mapped to the Run 0 task items in `tasks.md`:

- **Playwright harness stood up** — `playwright.config.ts` created: `testDir: e2e`,
  a single `chromium` project built from `devices['Desktop Chrome']`, artifacts
  under `node_modules/.tmp/playwright-results` (already gitignored, no new root
  ignore rules), `reporter: 'list'`, `workers: 1`, `fullyParallel: false`,
  `baseURL http://localhost:5173`, and a `webServer` running
  `npm run fixtures && npm run dev` on port 5173 (never a bare `tsx`).
- **npm scripts + dependency** — `package.json` gained `@playwright/test`, plus
  `e2e`, `fixtures`, and `prevalidate` scripts; `validate` is now the arg-less
  `tsx skills/create-diagram-files/scripts/validate.ts`. `npm run validate -- <dir>`
  still overrides and was verified.
- **Lockfile** — `package-lock.json` updated by `npm install -D @playwright/test`
  (added `@playwright/test`, `playwright`, `playwright-core`).
- **e2e type-checking** — `tsconfig.e2e.json` extends `tsconfig.app.json`,
  `include: ["e2e"]`, distinct `tsBuildInfoFile`, `types: ["node"]`, and
  `lib: ["ES2023","DOM","DOM.Iterable"]`; referenced from `tsconfig.json`, so
  `tsc -b` now covers the specs.
- **Fixture materializer** — `e2e/prepare.ts` is idempotent, creates
  `src/diagrams/` (gitignored), writes the payload inline (no ninth file), and
  never deletes user diagrams. The fixture (`meta.id`/stem `e2e-layout-fixture`,
  no collision with the four local diagrams) contains a leaf with expandable
  sections (`e2e-leaf`), a group with children (`e2e-group` →
  `e2e-child-a`/`e2e-child-b`), and a group nested in a group
  (`e2e-outer` → `e2e-inner` → `e2e-nested-leaf`).
- **Smoke spec** — `e2e/smoke.spec.ts` proves the app serves, `/d/e2e-layout-fixture`
  renders `.canvas`/`.react-flow` with at least one `[data-id]` node, and
  Re-layout is enabled. It tolerates extra diagrams and never asserts a global
  count.
- **Deferred assertions** — `e2e/layout-version.spec.ts` authors the spike's
  browser-deferred items (fresh-load application, width-only leaves vs
  width+height containers, nested absolute position, no drift across two loads,
  stability after both ELK passes, section-expand behaviour, unknown-id
  tolerance, Node-only `serializeVersion`/`mergeGeometry`/`hasGeometry`) as
  `test.fixme`. `src/lib/versions` is reached only via a **non-literal** dynamic
  import inside skipped bodies, so collection and `tsc` stay green before Run 1.
- **Validator default repaired** — `skills/create-diagram-files/scripts/validate.ts`
  now defaults to `src/diagrams` (not `diagrams`), and `prevalidate` materializes
  the fixture, so `npm run validate` is green on a fresh checkout while an
  explicit directory still overrides.
- **No feature behavior touched** — `src/lib/**` and `src/DiagramPage.tsx` are
  unchanged.

## Files Changed

- `playwright.config.ts` — NEW. Chromium-only harness, list reporter, artifacts
  under `node_modules/.tmp`, port-5173 `webServer` (`fixtures && dev`), workers 1.
- `package.json` — MODIFIED. Added `@playwright/test` devDependency; added `e2e`,
  `fixtures`, `prevalidate`; `validate` is arg-less.
- `package-lock.json` — MODIFIED. Locks `@playwright/test@1.64.0` (+ transitive
  `playwright`, `playwright-core`).
- `tsconfig.e2e.json` — NEW. Extends `tsconfig.app.json`; `include: ["e2e"]`;
  distinct `tsBuildInfoFile`; `types: ["node"]`; DOM libs.
- `tsconfig.json` — MODIFIED. Added `{ "path": "./tsconfig.e2e.json" }`.
- `e2e/prepare.ts` — NEW. Idempotent, directory-creating inline-fixture
  materializer for the gitignored `src/diagrams/`.
- `e2e/smoke.spec.ts` — NEW. App-serves + fixture-renders + Re-layout-enabled
  smoke checks.
- `e2e/layout-version.spec.ts` — NEW. Spike's deferred assertions as `test.fixme`
  with non-literal dynamic imports for the future Run 1 module.
- `skills/create-diagram-files/scripts/validate.ts` — MODIFIED. Default directory
  `diagrams` → `src/diagrams` (plus header comment).

## Tests

- **Unit (Node-only, deferred):** the `serializeVersion` / `mergeGeometry` /
  `hasGeometry` cases are authored in `e2e/layout-version.spec.ts` but kept as
  `test.fixme`; Run 1 activates them. Result: **8 skipped** (no execution).
- **e2e:** `e2e/smoke.spec.ts` — **2 passed**. `e2e/layout-version.spec.ts` —
  **8 skipped** (fixme confirmed). Full suite `npx playwright test` —
  **2 passed, 8 skipped, 0 failed**.

## Gate Results

| Gate | Command | Result |
|---|---|---|
| Type-check | `npx tsc -b` | ✅ exit 0 (projects: app, node, e2e, root) |
| Lint | `npx oxlint` | ✅ exit 0 |
| Validate | `npm run validate` | ✅ exit 0 — `prevalidate` wrote the fixture; 5 diagrams checked (4 local + `e2e-layout-fixture.json`) |
| e2e smoke | `npx playwright test e2e/smoke.spec.ts` | ✅ 2 passed |
| e2e full | `npx playwright test` | ✅ 2 passed, 8 skipped |
| npm script | `npm run e2e -- e2e/smoke.spec.ts` | ✅ 2 passed |

Extra checks: `npm run fixtures` re-run reports “already present” (idempotent);
`npm run validate -- src/diagrams` passes; `npm run validate -- no-such-dir`
exits 1, proving the override path is not hardcoded.

## Versions installed

- `@playwright/test` / `playwright`: **1.64.0**
- Chromium (Chrome for Testing): **156.0.8078.4** (Playwright revision `1248`)
- Chromium headless shell: **156.0.8078.4**
- Bundled `ffmpeg-1013`, `winldd-1007`
- Node **v24.21.0**, npm **12.2.0**

## Deviations & Notes

- **No deviations** from the Run 0 file set. `src/lib/**` and
  `src/DiagramPage.tsx` were not touched.
- **Fixture location.** Per the “no ninth file” instruction the fixture data is
  inline in `e2e/prepare.ts`; the materialized artifact is the gitignored
  `src/diagrams/e2e-layout-fixture.json` (stem `e2e-layout-fixture`). No
  `e2e/fixtures/` directory was created.
- **Deferred version envelope.** The injected-version shape in
  `e2e/layout-version.spec.ts` (`{ id, nodes: [{ id, position, size }] }`) is the
  Run 0 sketch of the resolved model. Run 1 owns the exact `parseVersion`
  envelope and will finalize these bodies when it activates them; the tests are
  skipped today so the shape cannot fail the gate.
- **Environment problem:** `npm install` warned that it blocked the
  `esbuild@0.28.2` postinstall (`install-scripts` not covered by `allowScripts`).
  Vite dev still started and served correctly (smoke green), so it is not
  blocking; if a later run sees esbuild binary issues, run
  `npm install-scripts approve esbuild` (or `npm install`).
- **Reviewer should verify:** that `npm run validate` is the arg-less command and
  `prevalidate` runs `fixtures`; that the fixture’s three required shapes are
  present; and that the non-literal dynamic import is the only path to a Run 1
  module (so collection stays green).
