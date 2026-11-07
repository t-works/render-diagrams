/**
 * Materializes the deterministic e2e fixture into the gitignored `src/diagrams/`.
 *
 * `/src/diagrams/` is gitignored, so a fresh checkout has no diagrams and the app
 * renders "No diagrams yet". This script (run by `npm run fixtures`, which the
 * Playwright `webServer` command and the `prevalidate` hook both chain) writes the
 * one fixture the e2e suite needs. It never deletes anything and is safe to run
 * repeatedly: an unchanged fixture is left untouched.
 *
 * The payload is inlined here (rather than a separate `e2e/fixtures/*.json` file)
 * so Run 0 stays within its declared file set. Its shapes are load-bearing for
 * later runs and MUST NOT be trimmed:
 *   - `e2e-leaf`        leaf node with expandable `<details>` sections
 *   - `e2e-group`       group with two child nodes
 *   - `e2e-outer` > `e2e-inner` > `e2e-nested-leaf`  group nested in a group
 *
 * `meta.id` and the file stem are both `e2e-layout-fixture`, which does not
 * collide with the locally present diagrams (delegation-flow, information-flow,
 * llm-message-flow, memory-flow).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const diagramsDir = join(repoRoot, 'src', 'diagrams');
const outputPath = join(diagramsDir, 'e2e-layout-fixture.json');

/** Canonical fixture id: file stem, `meta.id`, and the `/d/:id` route segment. */
export const FIXTURE_ID = 'e2e-layout-fixture';

export const FIXTURE = {
  specVersion: '1',
  meta: {
    id: FIXTURE_ID,
    title: 'E2E Layout Fixture',
    order: 99,
    description:
      'Deterministic fixture for the layout-version e2e suite: a leaf with expandable sections, a group with children, and a group nested inside a group.',
  },
  direction: 'LR',
  nodes: [
    {
      id: 'e2e-leaf',
      kind: 'task',
      label: 'Leaf with sections',
      color: 'teal',
      inputs: [{ id: 'in', label: 'in' }],
      outputs: [{ id: 'out', label: 'out' }],
      sections: [
        {
          id: 'details',
          label: 'Details',
          open: true,
          items: ['First expandable item', 'Second expandable item'],
        },
        { id: 'notes', label: 'Notes', items: ['Collapsed by default'] },
      ],
    },
    { id: 'e2e-group', kind: 'group', label: 'Group with children', color: 'slate' },
    {
      id: 'e2e-child-a',
      kind: 'task',
      parent: 'e2e-group',
      label: 'Child A',
      color: 'blue',
      inputs: [{ id: 'in' }],
      outputs: [{ id: 'out' }],
    },
    {
      id: 'e2e-child-b',
      kind: 'task',
      parent: 'e2e-group',
      label: 'Child B',
      color: 'blue',
      inputs: [{ id: 'in' }],
      outputs: [{ id: 'out' }],
    },
    { id: 'e2e-outer', kind: 'group', label: 'Outer group', color: 'violet' },
    { id: 'e2e-inner', kind: 'group', parent: 'e2e-outer', label: 'Inner group', color: 'pink' },
    {
      id: 'e2e-nested-leaf',
      kind: 'task',
      parent: 'e2e-inner',
      label: 'Nested leaf',
      color: 'green',
      inputs: [{ id: 'in' }],
      outputs: [{ id: 'out' }],
    },
  ],
  edges: [
    { id: 'e2e-edge-1', source: 'e2e-leaf', target: 'e2e-child-a' },
    { id: 'e2e-edge-2', source: 'e2e-child-a', target: 'e2e-child-b' },
    { id: 'e2e-edge-3', source: 'e2e-child-b', target: 'e2e-nested-leaf' },
  ],
};

const fixtureJson = `${JSON.stringify(FIXTURE, null, 2)}\n`;

function materialize(): void {
  mkdirSync(diagramsDir, { recursive: true });
  const upToDate = existsSync(outputPath) && readFileSync(outputPath, 'utf8') === fixtureJson;
  if (upToDate) {
    console.log(`✓ e2e fixture already present: ${relative(repoRoot, outputPath)}`);
    return;
  }
  writeFileSync(outputPath, fixtureJson, 'utf8');
  console.log(`✓ e2e fixture written: ${relative(repoRoot, outputPath)}`);
}

materialize();
