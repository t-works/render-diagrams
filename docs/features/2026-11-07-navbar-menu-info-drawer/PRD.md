# PRD — Navbar actions menu + info drawer

Feature dir: `docs/features/2026-11-07-navbar-menu-info-drawer/`
Process: `docs/agent-workflow.md`

## 1. Summary

Move the page's action buttons into a hamburger menu at the right end of the
topbar, and move the diagram's description and legend into a left-hand panel
that slides in over the diagram area. The canvas keeps the full page area; the
shell gains one place for actions and one for context instead of a static
header row.

## 2. Problem & motivation

The page header currently competes with the diagram: title, description, legend
and three buttons sit in a row above the canvas and take vertical space on every
diagram, even though the legend is reference material and the actions are used
occasionally. On narrow windows the legend wraps and pushes the canvas down. The
topbar's right side is unused.

Routing the actions through one menu and the reference material through a drawer
gives the canvas the space back without hiding anything, and gives the shell a
single, predictable place for each kind of control.

## 3. Goals

1. The layout/version action buttons live behind a single hamburger menu on the
   right side of the navbar. No action button remains in the page body.
2. Description and legend are reachable from a left slide-in panel that opens
   over the diagram area.
3. The panel overlays the canvas: opening or closing it never reflows, resizes
   or repositions the diagram, and never changes node geometry.
4. Everything the buttons do today still works from the menu, unchanged:
   Re-layout, Reset (with confirmation), Download, Upload, autosave, storage
   scope, feedback.
5. All new controls are keyboard reachable and labeled; the panel and menu are
   dismissible with Escape and return focus to their trigger.

## 4. Non-goals

- No new actions, and no change to layout-version behavior, persistence,
  validation, or ELK.
- No editing of diagram content (unchanged from the main PRD).
- No routing changes, no new page, no persistence of menu/drawer open state.
- No mobile bottom sheet, swipe gestures, or responsive navigation rail; the
  same two triggers work at narrow widths.
- Validation error/warning panels stay where they are (above the canvas); they
  are not moved into the drawer.

## 5. Acceptance criteria

1. **Actions menu, right side** — Given a rendered diagram, when the page is
   shown, then the topbar's right end contains a hamburger button and the page
   body contains no Download/Upload/Re-layout/Reset button and no legend.
2. **Parity of actions** — Given the menu is opened, then it offers
   Re-layout (or Reset layout when a saved version exists), Download and Upload;
   each performs exactly its current behavior, including the inline Reset
   confirmation, autosave on drag/resize, per-diagram storage scope, and the
   aria-live status line.
3. **Info in the drawer** — Given a diagram with a description and/or legend,
   when the info panel is opened, then that description and legend appear inside
   the left panel; when it is closed, its content is not in the tab order and not
   exposed to assistive technology.
4. **Overlay, not reflow** — Given the diagram canvas, when the drawer opens and
   closes, then the canvas bounding box and every node's model position and size
   are unchanged.
5. **Keyboard** — Given keyboard-only use, when the user reaches the topbar
   triggers, then both are focusable and labeled; the menu opens with
   Enter/Space and ArrowDown moves through its items; Escape closes the menu or
   drawer and returns focus to the trigger that opened it; the drawer's close
   button also returns focus to its trigger.
6. **Narrow width** — Given a 320 px wide viewport, both triggers stay visible,
   the drawer fits within the viewport without horizontal scrolling, and the
   canvas still renders.
7. **Reduced motion** — Given `prefers-reduced-motion: reduce`, the drawer and
   menu appear without a slide/fade transition.
8. **No regression** — The existing e2e suites (smoke, no-version, layout-version,
   save-load) pass with selectors updated for the new shell, and
   `tsc -b`/`oxlint`/`validate` stay green.

## 6. Change description

**Before:** page header row = title + description on the left, legend + action
buttons on the right.

**After:**

- **Topbar** — nav links unchanged on the left; the right end gains two icon
  buttons: an info button and a hamburger (“Diagram actions”). The page header
  keeps only the diagram title.
- **Menu** — Download, Upload and Re-layout/Reset live in a dropdown anchored to
  the hamburger. Reset still asks for confirmation before clearing; that
  confirmation is a menu state (prompt + Reset/Cancel items), so the destructive
  path is unchanged.
- **Drawer** — a left panel slides over the page area with the diagram
  description and the kind legend, and a close button. No scrim; clicking the
  diagram, pressing Escape, or pressing the close button dismisses it.
- **Canvas** — same size before and after; the drawer is an overlay, not a
  layout participant.

**Edge cases and empty/error states**

- No description and no legend (e.g. no known kinds): the drawer shows a short
  “No additional information for this diagram.” line and the info trigger stays
  present.
- Diagram invalid (`loaded.errors` non-empty): the canvas/actions are absent as
  today; the info trigger still opens whatever description exists, and the
  error panel is unchanged.
- Saved version exists but storage is unavailable: menu items and their messages
  behave exactly as today (Download still works).
- Menu reopened after a Reset confirmation was abandoned: the confirmation is
  not sticky — it resets when the menu closes.
- Drawer open while navigating to another diagram: the panel state belongs to
  the diagram page, so it resets closed on navigation (no persistence).
- Upload file picker: the hidden input stays mounted at page level so closing
  the menu does not cancel an in-flight selection.

## 7. Constraint-check

- Static Vite + React SPA, no backend: nothing here requires persistence or a
  server; the drawer/menu state is ephemeral.
- No new dependencies: a portal into a topbar slot plus DOM state is enough.
- The topbar is rendered above the router, so per-diagram actions reach it via a
  React portal into a slot element the topbar renders. This is the only
  engineering consequence of putting actions in the navbar.
- Existing e2e specs drive the buttons by role/test id; they must open the menu
  first. That is test churn, not product change.

## 8. Open questions

None outstanding — the brief fixes the shape:

| # | Question | Answer |
|---|---|---|
| 1 | What goes in the hamburger menu? | The existing layout/version actions only; nav links stay visible. |
| 2 | What goes in the drawer? | Description + legend. The title stays as the page heading. |
| 3 | Does the panel push the canvas or overlay it? | Overlay the diagram area; no reflow. |
| 4 | One trigger or two? | Two: info, then hamburger, at the right end of the topbar. |

## 9. Spike needed

**no.** This is a markup/CSS/focus move of existing controls; the only risk is
selector churn in the e2e suite, which the gates catch directly.

## 10. Resolved decisions (round 1)

| # | Decision | Source | Date |
|---|---|---|---|
| 1 | Hamburger menu on the right holds Re-layout/Reset, Download, Upload | user | 2026-11-07 |
| 2 | Description + legend move to a left slide-in panel; title stays as the page heading | user | 2026-11-07 |
| 3 | The panel overlays the diagram area (no canvas reflow) | user | 2026-11-07 |
| 4 | Reset confirmation becomes menu state; no separate dialog | orchestrator | 2026-11-07 |
| 5 | Validation panels stay in the page flow | orchestrator | 2026-11-07 |
| 6 | Hidden upload input stays mounted at page level | orchestrator | 2026-11-07 |
| 7 | No menu/drawer state persistence; both reset on navigation | orchestrator | 2026-11-07 |
