# Implementation Plan — Navbar actions menu + info drawer

## Overview

A shell-only change: move the three layout/version buttons into a dropdown
anchored to a new hamburger at the right end of the topbar, and move the
description + legend into a left overlay drawer. No state model, storage or
layout code changes. The diagram page keeps its validation panels and canvas; the
title moves into the drawer and the status row is removed.

## Blast radius

| File | Change |
|---|---|
| `src/Topbar.tsx` | Render an empty `#topbar-actions` slot at the right end (after the nav). |
| `src/DiagramPage.tsx` | Portal the info + actions triggers into the slot; dropdown menu with the existing handlers; drawer markup with the title, description and legend (no page header; a visually hidden `h1` keeps the outline); keep the hidden file input mounted at page level; menu/drawer focus + Escape/outside-click handling; drop the status row in favour of a failure-only overlay notice. |
| `src/App.css` | Topbar actions slot, icon buttons (the Info trigger is labeled), menu, drawer, `.sr-only`; remove the unused header rules; reduced-motion overrides. |
| `e2e/nav-shell.spec.ts` (new) | Shell ACs: triggers, menu contents, drawer contents, overlay/no-reflow, keyboard + focus return, narrow width, reduced motion. |
| `e2e/smoke.spec.ts` | Open the menu before asserting Re-layout is enabled. |
| `e2e/no-version.spec.ts` | Open the menu in the Re-layout test. |
| `e2e/save-load.spec.ts` | Open the menu before Download/Upload/Reset; reset/confirm assertions move into the menu. |
| `README.md` | Say the actions live in the topbar menu and the info in the drawer. |
| `docs/prd.md` | Amend the shell description (§5.2 / UI) so the main PRD matches. |

No change to `src/lib/*`, storage keys, validation, or ELK.

## Feasibility

- **Portal path.** `Topbar` renders above the router, so it cannot receive the
  page's action callbacks as props. The page portals its triggers into a slot
  element the topbar renders (`document.getElementById` in an effect). React
  portals work across the DOM boundary with the same context, so no provider or
  lifting is needed.
- **Menu.** `role="menu"` + `role="menuitem"` buttons, rendered only while open.
  Arrow keys cycle, Escape closes, outside pointerdown closes, activation
  closes. Focus moves to the first item on open and back to the trigger on
  close. No focus trap: a menu is not modal.
- **Reset.** The current inline confirm becomes two menu states. `confirmingReset`
  resets whenever the menu closes, so reopening never shows a stale prompt.
- **Drawer.** Always mounted, `inert` + `aria-hidden` while closed (React 19
  supports the boolean `inert` prop), `translateX(-101%)` → `0` with a 200 ms
  transition, overridden by `prefers-reduced-motion`. `position: absolute`
  inside `.page` (which becomes `position: relative; overflow: hidden`), so the
  canvas is never reflowed.
- **Upload.** The hidden `<input type="file">` moves out of the menu to the page
  root so unmounting the menu cannot drop a pending selection.
- **Selectors.** Existing test ids (`download`, `upload`, `upload-input`,
  `reset`, `reset-confirm`, `reset-cancel`, `layout-status`) are kept inside the
  menu; new ones: `actions-toggle`, `actions-menu`, `info-toggle`, `info-drawer`,
  `info-close`.

## Architecture decisions

1. **Two triggers, not one.** Info is not an "action" and should not be two
   clicks away; it gets its own icon button immediately left of the hamburger.
2. **Menu content is the existing action list**, minus the legend; nav links stay
   in the topbar so switching diagrams is unchanged.
3. **The drawer overlays**, so opening it is free of diagram side effects
   (AC4), and the canvas keeps its full area after the header slims down.
4. **No scrim.** A scrim would block the canvas; "click the diagram to dismiss"
   is handled by an outside-pointerdown listener and is cheaper.
5. **Title in the drawer, `h1` kept for the outline.** The visible title moves
   with the description; a visually hidden `h1` stays in the page so the document
   still has a heading while the drawer is closed.
6. **Labeled Info trigger.** An icon-only trigger was mistaken for decoration;
   the button shows the word "Info" next to the glyph.
5. **`inert` over conditional rendering** for the drawer, so the slide transition
   can play both ways while closed content stays out of the tab order.

## Effort

**S.** One small component addition, ~150 lines in `DiagramPage.tsx`, ~120 lines
of CSS, one new spec plus selector updates in three existing specs. Well under
the ~8-file run limit if tests count separately; one run is enough.

## Risks

| Risk | Mitigation |
|---|---|
| Actions become unreachable for keyboard users | Trigger is a labeled button; menu has arrow-key navigation, Escape, focus return (AC5 test). |
| Canvas geometry changes when the header slims | Assert bounding box + node snapshots open vs closed (AC4). |
| E2E churn hides a real regression | Update selectors mechanically via one `openActions()` helper; keep every behavioral assertion. |
| `inert` typing/support | React 19 boolean prop, Chromium target; assert `aria-hidden`/tab behavior rather than the attribute. |
| Hidden file input lost on menu close | Input mounted at page level; Upload item only calls `.click()`. |
| Drawer covering the only close affordance on tiny screens | Close button inside the drawer, Escape, and outside click; width `min(380px, 88vw)`. |
| No visible page title once the header is gone | Visually hidden `h1`, drawer title, and the active nav link all name the diagram. |
| An icon-only Info trigger is not discoverable | Visible "Info" label (AC1 asserts the accessible name). |

## Runs

### Run 1 — Shell rework

**Files.** `src/Topbar.tsx`, `src/DiagramPage.tsx`, `src/App.css`,
`e2e/nav-shell.spec.ts` (new), `e2e/smoke.spec.ts`, `e2e/no-version.spec.ts`,
`e2e/save-load.spec.ts`, `README.md`, `docs/prd.md`.

**How to verify.** `e2e/nav-shell.spec.ts` proves the triggers exist on the
right end of the topbar, the menu holds Re-layout/Download/Upload, the legend and
description render only in the drawer, opening the drawer leaves the canvas box
and node geometry untouched, Escape/close/outside-click dismiss with focus
returned, a 320 px viewport keeps both triggers and the drawer in bounds, and
reduced motion has no transition. The updated smoke/no-version/save-load specs
prove action parity. Gates: `npx tsc -b`, `npx oxlint`, `npm run validate`,
`npx playwright test`.

**Rollback.** Revert the run's commit; the previous header/toolbar and its specs
return unchanged.

## Out of scope

- New actions, editing, persistence of shell state, mobile-specific patterns.
- Moving validation panels or the title into the drawer.
- Changing layout-version semantics or storage.
