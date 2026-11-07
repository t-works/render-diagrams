# STATE — user-layout-versions

Feature dir: `docs/features/2026-10-13-user-layout-versions/`
Process: `docs/agent-workflow.md`

## Phase
`implementation` — plan frozen (2026-10-13)

## Open questions round
2 of 2 — all original questions + spike/plan-review questions answered (PRD §10)
Plan review: APPROVE WITH CHANGES, loop 2; 6 non-blocking findings applied.

## Runs
| Run | Title | Status | Review |
|---|---|---|---|
| 0 | Test harness bootstrap + reproducible e2e fixture + gate repair | COMPLETE | run-reviewer: COMPLETE WITH FOLLOW-UPS |
| 1 | Schema + geometry-preferred pipeline + apply/read path | COMPLETE | run-reviewer: COMPLETE |
| 2 | Save / Download / Upload / Reset + persistence + feedback | pending | - |
| 3 | Robustness, edge states, section behavior | pending | - |

## Decisions log
| # | Decision | Source | Date |
|---|---|---|---|
| 1 | Version = diagram JSON with geometry mutated in place (no overlay artifact) | user | 2026-10-13 |
| 2 | Persist via localStorage + download/upload | user | 2026-10-13 |
| 3 | Capture positions always, width always, container height only | user | 2026-10-13 |
| 4 | Saved geometry replaces auto-layout; full two-pass for unrecorded nodes | user | 2026-10-13 |
| 5 | Portable format; committing optional | user | 2026-10-13 |
| 6 | Strictly additive; no `position` = byte-identical | user | 2026-10-13 |
| 7 | Autosave adjustments to localStorage; Download exports; Reset clears | user | 2026-10-13 |
| 8 | Leaf height never recorded (auto); container height required | user + spike | 2026-10-13 |
| 9 | Partial coverage: run full ELK two-pass; buildFlow authoritative for recorded ids | user + review | 2026-10-13 |

## Spike
- `spike-1.md` — geometry round-trips byte-exact (incl. nested groups). Drift
  source was the two-pass relayout; superseded by authoritative `buildFlow`.
  Concrete `node.width/height` needed to avoid first-frame group clamp; group
  size mandatory. Residual DOM-measurement equality assigned to Run 0/Run 1 e2e.
- `spike/` — throwaway prototype + captured output (evidence, not committed code).

## Orchestrator notes
- Reordered the flow to ask open questions before the spike (spike runtime proof
  needs the Run 0 Playwright harness).
- Plan-review loop 1 raised the unsaved-change contradiction + missing AC6 test;
  user chose autosave; planner revised. Loop 2 approved with changes; 6 findings
  resolved in-plan (no further review loop, per workflow cap).
- Run 1 executed 2026-10-13: test-builder red baseline (9 failed/1 skipped/6
  passed) → builder (all gates green, 15 passed/1 skipped) → run-reviewer
  COMPLETE with no required fixes. `src/lib/versions.ts` landed (schema,
  geometry-preferred `flow`, `layout` height fill, `DiagramPage` read/apply,
  `docs/prd.md` lock amendments). Two non-blocking observations deferred to
  Run 2: `src/lib/validate.ts` still requires `size.height` until Run 2 relaxes
  it; authored two-field `size` now also emits `node.width`/`node.height`
  (intended, no in-repo trigger).
