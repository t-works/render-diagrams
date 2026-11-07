# Multi-agent feature workflow

How features are specified, planned, built, and verified in this repo using the
`isolated_subagent` + `question` extensions and specialized agents (all project-level
under `.pi/`).

## Directory convention

```
docs/features/YYYY-MM-DD-<feature-slug>/
  STATE.md                 # live phase/run tracker (orchestrator-owned)
  PRD.md                   # us-analyst (product only)
  spike-N.md               # spike (optional, only if PRD says "Spike needed: yes")
  implementation-plan.md   # planner (owns blast radius/feasibility/effort/risks)
  tasks.md                 # planner
  runs/
    run-1-tests.md         # test-builder report
    run-1-build.md         # builder report
    run-1-review.md        # run-reviewer report
```

Use `YYYY-MM-DD` — **not** `DD:MM:YYYY`. Colons are illegal in Windows paths and
the format does not sort lexically.

## Agents

| Agent | Writes | Purpose |
|---|---|---|
| `scout` | nothing | Read-only recon, compressed context |
| `us-analyst` | `PRD.md` | Product-only US -> PRD: goals, ACs, constraint-check, open questions |
| `spike` | `spike-N.md` | Timeboxed experiment resolving ONE unknown (conditional) |
| `planner` | `implementation-plan.md`, `tasks.md` | Blast radius, feasibility, effort, risks, runs (<= 8 files each) |
| `plan-reviewer` | nothing | Adversarial review of PRD/plan |
| `test-builder` | test files only | e2e tests for one run (before build) |
| `builder` | source + unit tests | Implements one run, runs the local gate |
| `run-reviewer` | nothing | Independently verifies one run |

All agents run with **isolated context** (fresh `pi -p --no-session`). Every
handoff must be a file on disk or text in the task prompt — never conversation
memory. That is why `STATE.md` and `runs/*.md` exist.

Invoke via the `isolated_subagent` tool, e.g. a single step (note `agentScope`):

```
isolated_subagent { agentScope: "both", agent: "us-analyst",
  task: "Feature dir: docs/features/... . User story: ... .
  Read docs/prd.md and the code. Write PRD.md." }
```

Or a chain with `{previous}` to pass one agent's report to the next.

## Phase 1 — US to implementation plan

Product decisions and engineering consequences are separate artifacts:
`PRD.md` is product-only; `implementation-plan.md` owns blast radius,
feasibility, effort, and risks (the planner reads the code anyway).

1. **scout** (optional) — recon of the touched area.
2. **us-analyst** -> `<FEATURE_DIR>/PRD.md`: product only (goals, non-goals,
   acceptance criteria, change description, edge cases), a short
   **Constraint-check** (only facts that change what the user must decide),
   numbered open questions with single-choice options + recommended defaults,
   and a final **Spike needed: yes/no** naming the one unknown.
3. **spike** (conditional) — only if the PRD says `Spike needed: yes`.
   Timeboxed experiment answering that unknown with real evidence ->
   `<FEATURE_DIR>/spike-N.md`. If still unresolved, escalate to the user as a
   question (step 4) instead of guessing.
4. **orchestrator** — ask the user each open question (use the `question` tool:
   one question, options). Edit PRD.md to record the chosen answers inline.
   Cap at **2 rounds** of questions.
5. **planner** -> `implementation-plan.md` + `tasks.md`. The plan owns blast
   radius (exact files), architecture approach, feasibility, effort S/M/L,
   risks, and runs split when scope exceeds ~8 files.
6. **plan-reviewer** — verdict APPROVE / APPROVE WITH CHANGES / NEEDS REWORK.
   - NEEDS REWORK, or new **user-facing** questions -> back to step 4 (max 2 loops).
   - Non-blocking findings -> orchestrator resolves them in-plan and records the
     decision; do not bounce back to the user.
7. Orchestrator freezes the plan and sets `STATE.md` to `implementation`.

## Phase 2 — Run execution (repeat per run, in dependency order)

**Run 0 — test harness bootstrap (mandatory when no e2e harness exists).**
Deliverables: `@playwright/test` as a devDependency, `playwright.config.ts`
with a `webServer` that runs `npm run dev` (Vite, port 5173) and a `baseURL`,
an `e2e/` directory, and an `npm run e2e` script. The builder implements it;
the run-reviewer verifies it by running a smoke test. Every feature plan must
place any needed harness work in Run 0, before feature runs.

1. **orchestrator** reads `implementation-plan.md` + `PRD.md`, opens the next
   run in `STATE.md`, and hands it to **test-builder**.
2. **test-builder** writes e2e tests for the run's acceptance criteria and
   reports the red baseline -> `runs/run-N-tests.md`.
3. **builder** implements the run + unit tests and runs the local gate
   (`tsc -b`, `oxlint`, `validate`, e2e) -> `runs/run-N-build.md`.
4. **run-reviewer** independently re-runs the tests/gate and verifies each
   acceptance criterion -> `runs/run-N-review.md`.
5. **orchestrator**:
   - `COMPLETE` -> mark run done in `STATE.md`; start the next run.
   - `COMPLETE WITH FOLLOW-UPS` -> record follow-ups, mark done if non-blocking.
   - `FAILED` -> send the run-reviewer's **Required Fixes** back to **builder**
     (step 3) only. Re-run **test-builder** (step 2) only if the acceptance
     criteria themselves changed. Cap the loop at **3 attempts**, then stop and
     escalate to the user.

## Definition of done (whole feature)

- All runs marked COMPLETE in `STATE.md`.
- `npx tsc -b`, `npx oxlint`, `npm run validate`, and the e2e suite all pass.
- Existing diagrams still render and validate.
- PRD acceptance criteria all evidenced by `runs/run-*-review.md`.

## Fixed gates

| Check | Command |
|---|---|
| Types | `npx tsc -b` |
| Lint | `npx oxlint` |
| Diagram schema | `npm run validate` |
| e2e | `npx playwright test` (or `npm run e2e`) |

## Repo layout (self-contained)

All workflow resources are project-level and committed with the repo:

```
.pi/
  extensions/
    isolated-subagent/  # isolated_subagent tool (spawns isolated pi processes)
      index.ts
      agents.ts
    question.ts     # single-question multiple-choice UI
  agents/*.md       # the 8 agent definitions
```

No user-level (`~/.pi/agent/`) resources are required.

## Agent scope

Agent definitions live in **`.pi/agents/`**. The `isolated_subagent` extension defaults
to `agentScope: "user"`, so every invocation MUST pass `agentScope: "both"`
(or `"project"`) to find them. Project agents override same-named user agents.

## Project trust

Project `.pi/` resources (both the extensions and the agents) load only after
pi grants **project trust**. Without it, `isolated_subagent` and `question` do not exist
and no agent can run.

- This machine: a trust decision for this repo is already saved in
  `~/.pi/agent/trust.json`.
- Fresh machine: trust once interactively via the prompt or `/trust`, or pass
  `--approve` for non-interactive runs. `defaultProjectTrust` in
  `~/.pi/agent/settings.json` forces it globally but is not recommended.
- The tool also asks before running project-local agents unless the project is
  trusted; pass `confirmProjectAgents: false` for trusted local use.
