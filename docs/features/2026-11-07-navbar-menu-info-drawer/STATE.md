# STATE — navbar-menu-info-drawer

Feature dir: `docs/features/2026-11-07-navbar-menu-info-drawer/`
Process: `docs/agent-workflow.md`

## Phase
`implementation` — plan frozen 2026-11-07; Run 1 complete (review pending).

## Open questions round
0 of 2 — the brief fixes the shape (PRD §8/§10); no question round opened.
Plan review: not run (single-run shell change, folded into the run's gates).

## Runs
| Run | Title | Status | Review |
|---|---|---|---|
| 1 | Shell rework: topbar menu + info drawer | COMPLETE | review pending |

## Decisions log
| # | Decision | Source | Date |
|---|---|---|---|
| 1 | Hamburger on the right holds Re-layout/Reset, Download, Upload | user | 2026-11-07 |
| 2 | Description + legend move to a left slide-in panel; title stays | user | 2026-11-07 |
| 3 | The panel overlays the diagram area (no canvas reflow) | user | 2026-11-07 |
| 4 | Reset confirmation becomes menu state | orchestrator | 2026-11-07 |
| 5 | Validation panels and title stay in the page flow | orchestrator | 2026-11-07 |
| 6 | Hidden upload input stays mounted at page level | orchestrator | 2026-11-07 |
| 7 | `inert` drawer (not conditional render) so the slide plays both ways | orchestrator | 2026-11-07 |

## Orchestrator notes
- Previous feature (user-layout-versions) is at Run 3 pending; this feature
  touches only the shell and does not depend on it.
- E2E churn was expected: the three existing specs drove the action buttons
  directly. They gained one `openActions` helper; no behavioral assertion was
  dropped.
- Builder finding 1: the first drawer pass was absolute inside `.page`, so it
  covered the title and status line too. Wrapped canvas + drawer in
  `.page__body` (relative, `flex: 1`) so the drawer overlays exactly the diagram
  area, per the brief; the AC4 test asserts the drawer box equals the canvas box.
- Builder finding 2: the info drawer is portaled-trigger + in-page panel; the
  slot lookup needs one post-mount render (effect), so `set-state-in-effect` is
  locally disabled with a reason rather than lifted into `App`.
- Gates: `npx tsc -b`, `npx oxlint`, `npm run validate`, `npx playwright test`
  (32 passed / 1 skipped — the skip is the existing Run 3 fixme).
