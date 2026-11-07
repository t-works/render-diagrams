# Tasks — Navbar actions menu + info drawer

Test level is one of `e2e` | `none`. Fixed gates for the run: `npx tsc -b`,
`npx oxlint`, `npm run validate`, `npx playwright test`.

## Run 1 - Shell rework

- [x] `src/Topbar.tsx` (MODIFIED) - render `<div className="topbar__actions" id="topbar-actions" />`
      as the last child of the header, after the nav, so the diagram page can
      portal its triggers into the right end; leave nav markup untouched -
      satisfies AC1 (test: e2e)
- [x] `src/DiagramPage.tsx` (MODIFIED) - resolve the slot element in an effect
      and `createPortal` the info + actions triggers; hamburger with
      `aria-haspopup="menu"`/`aria-expanded`/`aria-controls`; dropdown
      `role="menu"` rendered only while open with Download, Upload and
      Re-layout/Reset (inline confirm), reusing the existing handlers and test
      ids; close on Escape, outside pointerdown and item activation; ArrowDown/
      Up/Home/End move focus; focus returns to the trigger on close; move
      title + description + legend out of the header into an `aside` drawer with
      a close button (title visible, hidden `h1` kept), `inert`/`aria-hidden` while closed and focus returned to the info
      trigger; keep the hidden file input mounted at page level; keep the title,
      status line, validation panels and canvas in place; cancel a pending Reset
      confirmation whenever the menu closes - satisfies AC1/AC2/AC3/AC4/AC5
      (test: e2e)
- [x] `src/App.css` (MODIFIED) - `.topbar__actions` (pinned right, `margin-left:
      auto`), icon buttons with focus-visible, `.menu`/`.menu__item`/
      `.menu__prompt`/`.menu__danger`, `.drawer` overlay (`position: absolute`
      inside `.page`, which becomes `position: relative; overflow: hidden`),
      slide transition, `prefers-reduced-motion: reduce` override, slimmer
      `.page__header`, drop the now-unused `.page__description` rule and keep
      the legend styles for the drawer - satisfies AC3/AC4/AC6/AC7 (test: none)
- [x] `e2e/nav-shell.spec.ts` (NEW) - triggers at the right end of the topbar and
      absent from the page body; menu contents in order; drawer holds the title,
      description and legend and the page has no header; canvas box and node snapshots
      identical open vs closed; Escape/close/outside-click dismiss with focus
      returned; ArrowDown moves through menu items; 320 px viewport keeps both
      triggers visible and the drawer in bounds; reduced-motion emulation leaves
      no transition duration - satisfies AC1/AC3/AC4/AC5/AC6/AC7 (test: e2e)
- [x] `e2e/smoke.spec.ts` (MODIFIED) - open the actions menu before asserting
      Re-layout is enabled - satisfies AC2/AC8 (test: e2e)
- [x] `e2e/no-version.spec.ts` (MODIFIED) - add an `openActions` helper and open
      the menu in the Re-layout test; behavior assertions unchanged - satisfies
      AC2/AC8 (test: e2e)
- [x] `e2e/save-load.spec.ts` (MODIFIED) - open the menu before Download/Upload/
      Reset; assert Reset-vs-Re-layout inside the menu; keep all autosave,
      round-trip, isolation and Node-only coverage - satisfies AC2/AC8
      (test: e2e)
- [x] `README.md` (MODIFIED) - say the actions live in the topbar's hamburger
      menu and the description/legend in the left info drawer - satisfies AC1/
      AC3 (test: none)
- [x] `docs/prd.md` (MODIFIED) - amend the shell description so the main PRD
      matches the new topbar menu + info drawer - satisfies AC1/AC3 (test: none)

Verification: `npx tsc -b`, `npx oxlint`, `npm run validate`,
`npx playwright test`.

## Acceptance-criteria coverage

| AC | Tests |
|---|---|
| AC1 Actions menu on the right | `nav-shell.spec.ts`; smoke |
| AC2 Parity of actions | `save-load.spec.ts`; `no-version.spec.ts`; smoke |
| AC3 Info in the drawer | `nav-shell.spec.ts` |
| AC4 Overlay, no reflow | `nav-shell.spec.ts` (canvas box + node snapshot) |
| AC5 Keyboard + focus return | `nav-shell.spec.ts`; `save-load.spec.ts` |
| AC6 Narrow width | `nav-shell.spec.ts` |
| AC7 Reduced motion | `nav-shell.spec.ts` |
| AC8 No regression | full suite + fixed gates |
