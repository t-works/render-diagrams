# PRD — User Layout Versions

> Status: decisions resolved (round 1) — see §10. Product-only. The planner owns
> blast radius, feasibility, effort, and risks (see `docs/agent-workflow.md`).
> Basis: user story + code read of `src/loader.ts`, `src/lib/schema.ts`,
> `src/lib/layout.ts`, `src/lib/flow.ts`, `src/DiagramPage.tsx`,
> `src/nodes/Node.tsx`, `docs/prd.md`.

## 1. Summary

Diagrams are authored by third-party tools (via the `create-diagram-files`
skill) and therefore contain no position or size information — the app lays
them out automatically with ELK. Once a diagram is read into the app, the user
can already drag and resize nodes in the browser to make the flow clearer, but
that arrangement is thrown away on reload and on every Re-layout. The user wants
to be able to **save the arrangement they adjusted as a version**, so it can be
reloaded and shown again.

## 2. Problem & motivation

Auto-layout produces a correct but generic arrangement. For a specific diagram,
a human often knows a clearer arrangement — moving a node out of a crossing,
widening a box whose label wraps, pulling related nodes together. Today that
work is lost the moment the page reloads or Re-layout runs, so the user either
re-does it every session or lives with the generic layout. The fix is to let the
user persist their adjusted positions/sizes as a saved layout version that the
viewer re-applies on load, without touching the third-party-authored diagram
content and without breaking diagrams that have no saved version.

Worth building now because the viewer is otherwise feature-complete (rendering,
sections, auto-layout, Re-layout) and the one thing keeping it from being
comfortable to *read* is that manual arrangement is ephemeral. It also revisits
two decisions locked in `docs/prd.md` ("No coordinates in JSON at all"; "No
authoring/editing in the UI"), so those locks need an explicit product ruling
(see Open questions).

## 3. Goals

1. A user can adjust node positions and/or sizes in the browser and explicitly
   **save that arrangement** for the current diagram.
2. When a saved arrangement exists, opening that diagram **reproduces the saved
   arrangement** deterministically, on every load, without re-running the manual
   adjustment.
3. A saved version is scoped to one diagram and cannot affect any other diagram.
4. A diagram with no saved version renders **exactly as it does today**
   (auto-layout), with no change to validation or existing behavior.
5. The user can return a diagram to auto-layout (i.e. abandon the saved
   arrangement) through a visible, reversible action.
6. The saved arrangement survives the round trip: save → reload → identical
   canvas geometry.

## 4. Non-goals (this feature)

- Editing diagram **content** (labels, kinds, edges, sections, colors) in the
  UI — only user-set geometry/layout state is saved.
- A general-purpose editor, collaborative/multi-user editing, or conflict
  merging between simultaneous editors.
- Changing the third-party/agent authoring contract so that agents emit
  coordinates (the diagram content stays coordinate-free).
- New layout algorithms or changes to ELK behavior for diagrams with no saved
  version.
- Real-time sync across browsers or devices beyond whatever the chosen
  persistence mechanism gives for free.
- Reworking validation rules for diagram *content* (see "portability" question
  for any new artifact's validation).

## 5. Acceptance criteria

> Several criteria are written to hold under any answer to the Open questions.
> Where a criterion depends on a specific choice, it names the question.

1. **Adjustable geometry (already true, regression guard)** — Given a rendered
   diagram, when the user drags a node and resizes a node or group, then the
   canvas reflects the new position/size before any save.
2. **Persistence** — Given the user has adjusted at least one node, then the app
   automatically persists the adjusted geometry to localStorage keyed by the
   source diagram (surviving reload/navigation), and the user can Download the
   version as `<id>.json`.
3. **Reload reproduces the arrangement** — Given a saved layout version for a
   diagram, when that diagram is loaded (fresh page load or navigation), then
   every node recorded in the version is placed at the saved position and, where
   recorded (§10 round-2 refinement: always width, height only for containers),
   the saved size; the result is identical across repeated loads.
4. **Determinism / no drift** — Given the same saved layout version, when the
   diagram is loaded twice, then node coordinates are byte-identical between the
   two loads (no dependence on timing, DOM measurement order, or prior
   auto-layout).
5. **Scope isolation** — Given two diagrams A and B, when a version is saved for
   A, then loading B is unaffected and B's auto-layout is unchanged.
6. **Backward compatibility** — Given a diagram with no saved layout version,
   when it is loaded, then its rendering, edges, sections, legend, and the
   existing Re-layout button behave exactly as before this feature, and the
   existing validation/build gates still pass.
7. **Reset to auto-layout** — Given a diagram with a saved version applied, when
   the user invokes the reset action, then the diagram returns to ELK
   auto-layout and the user is told what happens to the saved version (per
   Question 4).
8. **Invalid / stale version does not break the page** — Given a saved version
   that is unreadable, references an unknown node id, or is missing a recorded
   node, when the diagram loads, then the diagram still renders and the problem
   is surfaced to the user rather than crashing; unknown entries are ignored.
9. **Adjustments persist across reload** — Given a diagram with manual
   adjustments, when the user reloads or navigates away and returns, then the
   adjusted geometry is still applied (restored from localStorage). Reset clears
   it.
10. **Save feedback** — Given a successful save, when the action completes, then
    the user sees a visible confirmation, and the artifact is retrievable per the
    chosen persistence mechanism (Question 2).
11. **Portability (conditional on Question 5)** — If the version must be
    shareable/committable, then given a saved version, when it is transferred to
    another checkout/machine, then loading the same diagram applies the same
    layout without manual steps.
12. **Version identity (conditional on Question 1)** — Given the chosen model
    (single override, in-place mutation, or multiple named versions), when the
    user saves again, then the previously saved state is handled per that model
    (replaced, appended, or listed) with no duplicate/stale version applied.

## 6. Change description

**Before:** opening a diagram always runs ELK auto-layout; drag/resize works but
is discarded on reload/re-layout.

**After:** the diagram page gains layout-version behavior:

- **Adjusting** — unchanged: selecting a node/group shows the resizer; dragging
  and resizing work as they do today.
- **Saving** — geometry is persisted automatically to localStorage as the user
  adjusts (no separate unsaved state). A visible action exports the current
  version as a downloadable `<id>.json`, and an Upload action re-imports it. The
  user gets visible confirmation and the artifact is scoped to one diagram.
- **Loading** — if a valid saved version exists for the diagram, the app applies
  it instead of (or as the starting point over) ELK auto-layout, so the user sees
  their own arrangement. The page still shows the header, description/legend,
  minimap, controls, and working section expand/collapse.
- **Resetting** — a visible action returns the diagram to auto-layout. Its label
  and its effect on the saved version depend on Question 4 (e.g. "Re-layout"
  re-runs ELK and discards the version after confirmation, or becomes "Reset
  saved layout").
- **Recovering** — a malformed or stale saved version never blanks the page: the
  diagram falls back to auto-layout and shows a non-blocking error/warning.

**Edge cases and empty/error states**

- No saved version → identical to today's auto-layout; no new empty-state UI
  required beyond the Save action being available.
- Saved version references a node id that no longer exists in the diagram
  (diagram content changed) → that entry is ignored; remaining entries apply;
  user is warned.
- Saved version omits a node that exists in the diagram → the omitted node is
  placed by auto-layout (or at a defined default), per Question 4; no crash.
- Saved version file exists but is unreadable/corrupt → auto-layout fallback +
  error notice.
- Multiple diagrams → each version is keyed to exactly one diagram; no
  cross-talk.
- Groups/nested nodes → recorded geometry must re-project correctly so children
  land inside the group as the user arranged them (coordinate convention is a
  technical detail the planner owns, but the product outcome is "looks the same
  after reload").
- Save with no adjustments made → defined behavior (either a no-op message or
  saving the current auto-layout as the version), per Question 1/7.
- Re-layout after loading a saved version → defined behavior per Question 4.

## 7. Constraint-check

- Static Vite + React SPA with **no backend**, so there is no server to write a
  file to → the persistence mechanism is a user decision
  (`src/App.tsx`, `package.json`, `vite.config.ts`).
- Diagram content is loaded from `src/diagrams/*.json` via `import.meta.glob`,
  and `/src/diagrams/` is **gitignored** → a version stored beside the diagrams
  would not be committable without changing the ignore rule (`src/loader.ts`,
  `.gitignore`).
- `docs/prd.md` locks "**No coordinates in JSON at all**" and lists UI
  authoring/editing as a **non-goal** → this feature reopens both, so the user
  must rule on whether those locks are amended or worked around
  (`docs/prd.md` §0, §3, §5.3).
- `NodeSpec` has an optional `size` but **no position** → a saved arrangement
  cannot be expressed in the current diagram schema as-is (`src/lib/schema.ts`).
- Drag/resize already exist in the browser (`NodeResizer` + `useNodesState` /
  `onNodesChange`) but are never persisted → the feature is about persistence,
  not about enabling editing (`src/nodes/Node.tsx`, `src/DiagramPage.tsx`).
- Layout is recomputed by ELK on mount and by Re-layout, and `buildFlow`
  rebuilds every node's position/style from the computed placements → any saved
  geometry must intercept this pipeline or it will be overwritten
  (`src/lib/layout.ts`, `src/lib/flow.ts`, `src/DiagramPage.tsx`).
- Nested nodes are positioned **relative to their parent group** and groups are
  sized by ELK → the version must record geometry in a way that re-projects
  identically for grouped nodes (`src/lib/flow.ts`, `src/lib/layout.ts`).
- No `localStorage`, session storage, URL-param, or hash state is used anywhere
  in `src/` today → persistence is greenfield, so all options are on the table.
- Validation (`src/lib/validate.ts`) only checks the diagram content schema; a
  separate layout artifact (if any) would need its own validity rules, or none.

## 8. Open questions

> Each question is single-choice. Recommended default is marked **(recommended)**.

1. **What exactly is a "version"?**
   - (a) A separate **layout-override artifact** keyed by diagram id, leaving
     the third-party diagram JSON untouched **(recommended)**.
   - (b) **Mutate the diagram JSON** in place by writing positions/sizes into its
     nodes.
   - (c) Support **multiple named layout versions** per diagram, with one active.
   - Impact: (a) keeps the agent-authored file coordinate-free and allows
     multiple layouts later; (b) is simplest but violates the "no coordinates"
     lock and mixes generated and human data; (c) is the most flexible but adds
     selection/management UI and more state to define.

2. **Where is the version persisted, given there is no backend?**
   - (a) **Download a JSON file / upload it to load** (works identically in dev
     and prod) **(recommended)**.
   - (b) A **dev-server write endpoint** (Vite plugin) that writes the file into
     the project during development.
   - (c) **Browser storage (localStorage) plus an export/download action**.
   - (d) Encode the layout in the **URL fragment** (shareable link, no file).
   - Impact: (a) is portable and static-host friendly but multi-step to save;
     (b) gives one-click save in dev but does nothing on a static deploy; (c) is
     zero-friction in one browser but invisible to other users/machines and
     fragile to clearing storage; (d) is instantly shareable but bloats URLs and
     is lost if not exported.

3. **What state does a version capture?**
   - (a) **Positions + sizes** of nodes/groups **(recommended)** — matches the
     user story's "position/sizing adjusted".
   - (b) Positions only.
   - (c) Sizes only.
   - (d) Positions + sizes **plus** per-section collapsed/expanded state.
   - Impact: (a) covers the stated need; (b)/(c) leave half the manual work
     unpersisted; (d) also freezes reading state and grows the artifact, but
     gives a fully reproducible view.

4. **Relationship to auto-layout: does loading a saved version disable ELK auto-layout and the Re-layout button?**
   - (a) **Saved version fully replaces auto-layout**; auto-layout runs only when
     no version exists, and "Re-layout" is repurposed to reset/replace the
     version (with confirmation) **(recommended)**.
   - (b) Saved version is the **starting point**, but Re-layout still re-runs ELK
     and overwrites the saved positions on screen.
   - (c) Saved version applies to its recorded nodes only; all other nodes are
     auto-laid-out around them, and Re-layout re-runs ELK for the rest.
   - Impact: (a) is deterministic and easy to reason about, with a clear escape
     hatch; (b) risks silently destroying the saved arrangement; (c) is the most
     forgiving when the diagram gains new nodes but makes layout results harder
     to predict and reproduce exactly.

5. **Portability/sharing: must a saved version work for another user and be committable to the repo?**
   - (a) **Yes — the version is a portable, plain artifact that can be committed
     and shared** (requires resolving the gitignore conflict) **(recommended)**.
   - (b) **No — it is personal/local only** and never needs to move.
   - (c) **Optional — the format is portable, but committing it is not required.**
   - Impact: (a) makes layouts reproducible for the whole team and pushes toward
     a file-based artifact plus a rule for where it lives relative to the
     gitignored `src/diagrams/`; (b) permits browser-storage-only designs but
     loses the work on another machine; (c) keeps the format stable while
     deferring the commit story.

6. **Backward compatibility: must existing diagrams keep rendering unchanged?**
   - (a) **Yes — strictly additive; no version means byte-identical behavior to
     today** **(recommended)**.
   - (b) Every diagram gets an empty/default version artifact on first load.
   - (c) Existing diagrams require a one-time migration.
   - Impact: (a) is safest and keeps the validation/build gates untouched;
     (b) generates side artifacts the user did not ask for; (c) adds migration
     work and risk to diagrams that render fine today.

7. **How is a version saved, and what happens to unsaved adjustments?**
   - (a) **Explicit Save action; unsaved adjustments are discarded on reload /
     navigation, optionally with a warning** **(recommended)**.
   - (b) **Autosave** every drag/resize; nothing is ever unsaved.
   - (c) Explicit Save, but **unsaved adjustments are preserved across reloads**
     (session-local draft) until saved or reset.
   - Impact: (a) is predictable and cheap but can lose work the user forgot to
     save; (b) is frictionless but writes constantly and makes "reset"
     ambiguous; (c) protects work but introduces a second, hidden state layer
     (draft vs saved) the user must understand.

## 9. Spike needed

**yes.**

- **The one unknown:** whether a user-adjusted layout — positions and sizes,
  including nodes nested inside groups — can be captured and then re-applied on
  load so the canvas reproduces the **exact same geometry**, or whether React
  Flow's measured dimensions, group sizing, and the ELK pipeline reintroduce
  drift on reload.
- **Evidence that would resolve it:** a throwaway prototype that captures the
  current node geometry, writes it in the proposed artifact shape, reloads it
  (bypassing ELK), and compares the resulting node coordinates/sizes against the
  captured values — ideally for a diagram that contains a nested group. Reading
  the code cannot settle this because the outcome depends on React Flow's
  runtime measurement behavior interacting with the existing two-pass layout.
- This unknown is independent of the persistence and "what is a version"
  questions; the prototype can use whatever local shape the spike finds easiest.

## 10. Resolved decisions (round 1)

Integrated from the user's answers. Where an answer was qualified, the resulting
rule is stated explicitly.

| # | Question | Decision |
|---|---|---|
| 1 | What is a "version" | **Mutate the diagram JSON in place**: a version is the diagram JSON with `position`/`size` written into its nodes. No separate override artifact. |
| 2 | Persistence | **localStorage + download/upload.** The version is stored in browser localStorage keyed by diagram id and restored on load; Download exports `<id>.json`; Upload re-imports it. |
| 3 | Captured state | **Positions always; width always; height only for containers/groups.** Leaf auto-height is NOT recorded (sections keep growing). Round-2 refinement — see below. |
| 4 | Auto-layout relationship | **A saved version replaces auto-layout only when it carries positions and sizes; otherwise auto-layout.** A version with no geometry falls back to full ELK layout. |
| 5 | Portability | **Optional.** The format is portable and can be committed, but committing is not required. `/src/diagrams/` stays gitignored; localStorage is the default home. |
| 6 | Backward compatibility | **Strictly additive.** Diagrams without `position` behave exactly as today. |
| 7 | Save / unsaved | **localStorage + Download (autosave).** Adjustments are persisted to localStorage automatically and survive reload/navigation; there is no separate unsaved state. Download exports the version; Reset clears it and re-runs auto-layout. |

### Resulting product rules

- A "saved version" is a **coordinate-bearing copy of one diagram's JSON**, keyed
  to exactly one diagram. Re-saving replaces the previous version (single
  version; no named-version management).
- **On load:** if a saved version exists and carries geometry, recorded nodes
  use it; unrecorded nodes fall back to the **full normal ELK two-pass**
  (`buildFlow` is authoritative for recorded ids, so the measured pass cannot
  overwrite them); if the version carries no geometry at all, full auto-layout
  runs.
- **Reset:** a visible action clears the saved version (localStorage) after
  confirmation and re-runs ELK auto-layout. When a version is applied, this
  replaces the current Re-layout behavior.
- **Invalid/stale version** never blanks the page: fall back to auto-layout with
  a non-blocking notice.
- **Upload** is the inverse of Download: a previously exported `<id>.json` can
  be loaded and applied.

### Deferred / flagged for the plan

- **Partial coverage** (resolved, plan-review loop 1): recorded nodes use saved
  geometry; unrecorded nodes run the full normal ELK two-pass. `buildFlow` is
  authoritative for recorded ids, so the measured pass cannot overwrite them.

### Round 2 refinement — saved height (spike finding)

The spike showed that recording a `size` trips the existing `fixed = !!spec.size`
path (`src/lib/flow.ts:24`), which freezes a node and makes its expandable
sections scroll. Resolution:

- **Positions**: always recorded, verbatim (absolute for roots, parent-relative
  for children).
- **Width**: always recorded (the user cares about width).
- **Height**: recorded **only for containers/groups**. The spike proved group
  size is mandatory: with `extent:'parent'`, a group whose height is not recorded
  shifts its children on load. Leaf/auto-height nodes record **no height** and
  keep growing with their sections.
- Consequence: a loaded version reproduces positions and widths exactly; leaf
  heights are content-derived and deterministic for unchanged content and
  collapse state. This supersedes the blanket "positions + sizes" wording in Q3.
- The planner must keep leaves unfixed (no explicit height → `fixed` stays false)
  while containers carry a full size.
