import { expect, test, type Page } from '@playwright/test';

/**
 * Run 1 — apply/read path (AC1/AC3/AC4/AC5/AC8).
 *
 * A geometry-bearing version is injected into `localStorage` before the app
 * boots, then the rendered geometry must equal the saved values. The Run 1
 * module `src/lib/versions.ts` is reached ONLY via a NON-LITERAL dynamic import
 * (`VERSIONS_MODULE`), so neither `tsc -b` (which covers `e2e/`) nor Playwright
 * collection resolves a module that does not exist yet. A missing module fails
 * at runtime — that is the expected red baseline.
 *
 * Resolved model (PRD §10): envelope `{ id, nodes: [{ id, position, size? }] }`
 * where `position` is always recorded (absolute for roots, parent-relative for
 * children), `size.width` is always recorded, and `size.height` is recorded
 * only for containers/groups (round-2 refinement).
 */

const FIXTURE_ID = 'e2e-layout-fixture';
const STORAGE_KEY = `render-diagrams:layout-version:${FIXTURE_ID}`;

// Deliberately a variable: a literal specifier would make `tsc`/collection fail
// before Run 1 ships `src/lib/versions.ts`. See the file header.
const VERSIONS_MODULE = '../src/lib/versions';

interface SavedNode {
  id: string;
  position?: { x: number; y: number };
  size?: { width: number; height?: number };
}

interface SavedVersion {
  id: string;
  nodes: SavedNode[];
}

/** Concrete geometry applied to the Run 0 fixture (see `e2e/prepare.ts`). */
const SAVED_VERSION: SavedVersion = {
  id: FIXTURE_ID,
  nodes: [
    { id: 'e2e-leaf', position: { x: 40, y: 60 }, size: { width: 220 } },
    { id: 'e2e-group', position: { x: 320, y: 60 }, size: { width: 260, height: 220 } },
    { id: 'e2e-child-a', position: { x: 24, y: 32 }, size: { width: 160 } },
    { id: 'e2e-child-b', position: { x: 24, y: 120 }, size: { width: 160 } },
    { id: 'e2e-outer', position: { x: 640, y: 60 }, size: { width: 320, height: 300 } },
    { id: 'e2e-inner', position: { x: 20, y: 48 }, size: { width: 240, height: 200 } },
    { id: 'e2e-nested-leaf', position: { x: 24, y: 60 }, size: { width: 170 } },
  ],
};

/**
 * Absolute (viewport-model) positions React Flow must project from the saved,
 * frame-correct values above. Children are saved parent-relative and React Flow
 * renders every wrapper at its absolute position (`internals.positionAbsolute`).
 */
const ABSOLUTE_POSITION: Record<string, { x: number; y: number }> = {
  'e2e-leaf': { x: 40, y: 60 },
  'e2e-group': { x: 320, y: 60 },
  'e2e-child-a': { x: 320 + 24, y: 60 + 32 },
  'e2e-child-b': { x: 320 + 24, y: 60 + 120 },
  'e2e-outer': { x: 640, y: 60 },
  'e2e-inner': { x: 640 + 20, y: 60 + 48 },
  'e2e-nested-leaf': { x: 640 + 20 + 24, y: 60 + 48 + 60 },
};

const CONTAINER_IDS = new Set(['e2e-group', 'e2e-outer', 'e2e-inner']);

interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Inline CSS height the node wrapper carries; `''` means "not fixed". */
  inlineHeight: string;
  inlineMinHeight: string;
}

/** Model position + layout size read from a node wrapper (zoom-independent). */
async function readNode(page: Page, id: string): Promise<NodeGeometry> {
  return page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => {
    const node = el as HTMLElement;
    const match = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(node.style.transform);
    return {
      x: match ? Number(match[1]) : Number.NaN,
      y: match ? Number(match[2]) : Number.NaN,
      width: node.offsetWidth,
      height: node.offsetHeight,
      inlineHeight: node.style.height,
      inlineMinHeight: node.style.minHeight,
    };
  });
}

/** Deterministic string of every node's model position + layout size. */
async function snapshot(page: Page): Promise<string> {
  const entries = await page.locator('.react-flow__node[data-id]').evaluateAll((els) =>
    els.map((el) => {
      const node = el as HTMLElement;
      const match = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(node.style.transform);
      const x = match ? match[1] : 'NaN';
      const y = match ? match[2] : 'NaN';
      return `${node.dataset.id}:${x},${y},${node.offsetWidth},${node.offsetHeight}`;
    }),
  );
  return entries.sort().join('|');
}

/**
 * Wait until two consecutive snapshots agree (both ELK passes + measurement have
 * settled). A geometry that a pass keeps rewriting would never settle; the
 * subsequent equality assertions then fail, which is the drift guard.
 */
async function waitForStableGeometry(page: Page, timeoutMs = 10_000): Promise<string> {
  const start = Date.now();
  let previous = await snapshot(page);
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(200);
    const next = await snapshot(page);
    if (next.length > 0 && next === previous) return next;
    previous = next;
  }
  return previous;
}

async function injectVersion(page: Page, version: SavedVersion = SAVED_VERSION): Promise<void> {
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value);
    },
    { key: STORAGE_KEY, value: JSON.stringify(version) },
  );
}

async function openFixture(page: Page): Promise<void> {
  await page.goto(`/d/${FIXTURE_ID}`);
  await expect(page.locator('.canvas')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="e2e-leaf"]')).toBeVisible();
}

test('applies saved positions on a fresh load (AC1/AC3)', async ({ page }) => {
  await injectVersion(page);
  await openFixture(page);
  await page.waitForTimeout(500);
  await waitForStableGeometry(page);

  for (const [id, expected] of Object.entries(ABSOLUTE_POSITION)) {
    const geometry = await readNode(page, id);
    expect.soft(geometry.x, `${id} absolute x`).toBe(expected.x);
    expect.soft(geometry.y, `${id} absolute y`).toBe(expected.y);
  }
});

test('records width only for leaves and width+height for containers (AC3, round-2)', async ({ page }) => {
  await injectVersion(page);
  await openFixture(page);
  await waitForStableGeometry(page);

  for (const node of SAVED_VERSION.nodes) {
    const geometry = await readNode(page, node.id);
    expect.soft(geometry.width, `${node.id} measured width`).toBe(node.size?.width);

    if (CONTAINER_IDS.has(node.id)) {
      expect.soft(geometry.height, `${node.id} measured height`).toBe(node.size?.height);
      expect.soft(geometry.inlineHeight, `${node.id} fixed inline height`).toBe(`${node.size?.height}px`);
    } else {
      // Round-2: leaf height is NOT recorded, so the wrapper must not carry a
      // fixed height that would stop it growing when a section expands.
      expect.soft(geometry.inlineHeight, `${node.id} must not be fixed`).toBe('');
    }
  }
});

test('restores a nested group child at the same absolute position (AC3)', async ({ page }) => {
  await injectVersion(page);
  await openFixture(page);
  await waitForStableGeometry(page);

  const inner = await readNode(page, 'e2e-inner');
  expect.soft(inner.x, 'e2e-inner absolute x').toBe(ABSOLUTE_POSITION['e2e-inner'].x);
  expect.soft(inner.y, 'e2e-inner absolute y').toBe(ABSOLUTE_POSITION['e2e-inner'].y);

  const nested = await readNode(page, 'e2e-nested-leaf');
  expect.soft(nested.x, 'e2e-nested-leaf absolute x').toBe(ABSOLUTE_POSITION['e2e-nested-leaf'].x);
  expect.soft(nested.y, 'e2e-nested-leaf absolute y').toBe(ABSOLUTE_POSITION['e2e-nested-leaf'].y);
  // A recorded container height must keep the child inside the group rather
  // than letting `extent: 'parent'` clamp it to a smaller ELK-sized group.
  expect.soft(nested.width, 'e2e-nested-leaf width').toBe(170);
});

test('recorded geometry is stable after both ELK passes run (AC3/AC4)', async ({ page }) => {
  await injectVersion(page);
  await openFixture(page);
  // First ELK pass paints collapsed sizes; the measured pass (nodesInitialized)
  // runs shortly after. Give both time, then require geometry to be settled.
  await page.waitForTimeout(600);
  const first = await waitForStableGeometry(page);

  for (const [id, expected] of Object.entries(ABSOLUTE_POSITION)) {
    const geometry = await readNode(page, id);
    expect.soft(geometry.x, `${id} x after both passes`).toBe(expected.x);
    expect.soft(geometry.y, `${id} y after both passes`).toBe(expected.y);
  }

  // No late pass may move a recorded node after the canvas has settled.
  await page.waitForTimeout(400);
  expect(await snapshot(page)).toBe(first);
});

test('two consecutive loads of the same version are byte-identical (AC4)', async ({ page }) => {
  await injectVersion(page);
  await openFixture(page);
  await page.waitForTimeout(500);
  const first = await waitForStableGeometry(page);

  // AC4 is only meaningful once the saved arrangement is actually applied.
  const leaf = await readNode(page, 'e2e-leaf');
  expect.soft([leaf.x, leaf.y], 'e2e-leaf before reload').toEqual([
    ABSOLUTE_POSITION['e2e-leaf'].x,
    ABSOLUTE_POSITION['e2e-leaf'].y,
  ]);

  await page.reload();
  await expect(page.locator('.canvas')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="e2e-leaf"]')).toBeVisible();
  await page.waitForTimeout(500);
  const second = await waitForStableGeometry(page);

  expect(second).toBe(first);
});

test('a version entry with an unknown id is ignored while the rest applies (AC8)', async ({ page }) => {
  const withUnknown: SavedVersion = {
    id: FIXTURE_ID,
    nodes: [...SAVED_VERSION.nodes, { id: 'e2e-does-not-exist', position: { x: 1, y: 2 } }],
  };
  await injectVersion(page, withUnknown);
  await openFixture(page);
  await waitForStableGeometry(page);

  await expect(page.locator('.react-flow__node[data-id="e2e-does-not-exist"]')).toHaveCount(0);

  const leaf = await readNode(page, 'e2e-leaf');
  expect.soft(leaf.x, 'e2e-leaf x with unknown entry present').toBe(40);
  expect.soft(leaf.y, 'e2e-leaf y with unknown entry present').toBe(60);
});

/**
 * Run 3 owns activation of this assertion (a saved width-only leaf must stay
 * unfixed and grow on section expand while a saved container keeps its recorded
 * height). Kept here as the spike's deferred item so it is not lost.
 */
test.fixme('a width-only saved leaf grows on section expand (round-2)', async ({ page }) => {
  await injectVersion(page);
  await openFixture(page);

  const leaf = page.locator('.react-flow__node[data-id="e2e-leaf"]');
  const before = (await readNode(page, 'e2e-leaf')).height;
  await leaf.locator('summary', { hasText: 'Notes' }).click();
  await expect.poll(async () => (await readNode(page, 'e2e-leaf')).height).toBeGreaterThan(before);
});

// ---------------------------------------------------------------------------
// Node-only coverage for the pure `src/lib/versions.ts` functions (AC3/AC5/AC8).
// No `page`: these run in Node under Playwright, per plan decision 12.
// ---------------------------------------------------------------------------

interface TestSpecNode {
  id: string;
  kind: string;
  label: string;
  parent?: string;
  position?: { x: number; y: number };
  size?: { width: number; height?: number };
}

interface TestDiagram {
  specVersion?: string;
  meta: { id: string; title: string };
  nodes: TestSpecNode[];
  edges?: unknown[];
}

interface VersionsModule {
  serializeVersion: (diagram: TestDiagram, nodes: unknown[]) => SavedVersion;
  mergeGeometry: (diagram: TestDiagram, version: unknown) => TestDiagram;
  hasGeometry: (version: unknown) => boolean;
}

/** React Flow shaped node (geometry lives on the live node, not the spec). */
function flowNode(
  id: string,
  type: string,
  position: { x: number; y: number },
  width: number,
  height: number,
  parentId?: string,
): Record<string, unknown> {
  return {
    id,
    type,
    position,
    width,
    height,
    measured: { width, height },
    data: { spec: { id, kind: type === 'group' ? 'group' : 'task', label: id } },
    ...(parentId ? { parentId } : {}),
  };
}

async function loadVersions(): Promise<VersionsModule> {
  const moduleId = VERSIONS_MODULE;
  return (await import(moduleId)) as VersionsModule;
}

function fixtureDiagram(): TestDiagram {
  return {
    specVersion: '1',
    meta: { id: FIXTURE_ID, title: 'Fixture' },
    nodes: [
      { id: 'e2e-leaf', kind: 'task', label: 'Leaf' },
      { id: 'e2e-group', kind: 'group', label: 'Group' },
      { id: 'e2e-child', kind: 'task', label: 'Child', parent: 'e2e-group' },
      { id: 'e2e-orphan', kind: 'task', label: 'Orphan' },
    ],
    edges: [],
  };
}

test('Node-only: serializeVersion records width only for leaves, width+height for containers (AC3, round-2)', async () => {
  const versions = await loadVersions();
  const nodes = [
    flowNode('e2e-leaf', 'task', { x: 40, y: 60 }, 220, 96),
    flowNode('e2e-group', 'group', { x: 320, y: 60 }, 260, 220),
    flowNode('e2e-child', 'task', { x: 24, y: 32 }, 160, 64, 'e2e-group'),
  ];

  const version = versions.serializeVersion(fixtureDiagram(), nodes);
  expect(version.id).toBe(FIXTURE_ID);

  const byId = new Map(version.nodes.map((node) => [node.id, node]));
  expect(byId.get('e2e-leaf')?.position).toEqual({ x: 40, y: 60 });
  expect(byId.get('e2e-leaf')?.size?.width).toBe(220);
  expect(byId.get('e2e-leaf')?.size?.height).toBeUndefined();

  expect(byId.get('e2e-group')?.position).toEqual({ x: 320, y: 60 });
  expect(byId.get('e2e-group')?.size).toEqual({ width: 260, height: 220 });

  expect(byId.get('e2e-child')?.position).toEqual({ x: 24, y: 32 });
  expect(byId.get('e2e-child')?.size?.width).toBe(160);
  expect(byId.get('e2e-child')?.size?.height).toBeUndefined();
});

test('Node-only: mergeGeometry is immutable and ignores unknown ids (AC5/AC8)', async () => {
  const versions = await loadVersions();
  const diagram = fixtureDiagram();
  const before = structuredClone(diagram);

  const version: SavedVersion = {
    id: FIXTURE_ID,
    nodes: [
      { id: 'e2e-leaf', position: { x: 40, y: 60 }, size: { width: 220 } },
      { id: 'e2e-group', position: { x: 320, y: 60 }, size: { width: 260, height: 220 } },
      { id: 'e2e-unknown', position: { x: 1, y: 2 } },
    ],
  };

  const merged = versions.mergeGeometry(diagram, version);

  // Immutable: a fresh object graph and the source diagram untouched.
  expect(merged).not.toBe(diagram);
  expect(merged.nodes).not.toBe(diagram.nodes);
  expect(diagram).toEqual(before);
  expect(merged.nodes.map((node) => node.id)).toEqual(['e2e-leaf', 'e2e-group', 'e2e-child', 'e2e-orphan']);

  const leaf = merged.nodes.find((node) => node.id === 'e2e-leaf');
  expect(leaf?.position).toEqual({ x: 40, y: 60 });
  expect(leaf?.size).toEqual({ width: 220 });

  const group = merged.nodes.find((node) => node.id === 'e2e-group');
  expect(group?.position).toEqual({ x: 320, y: 60 });
  expect(group?.size).toEqual({ width: 260, height: 220 });

  // Partial coverage: a diagram-only node keeps auto-layout (no geometry).
  const orphan = merged.nodes.find((node) => node.id === 'e2e-orphan');
  expect(orphan?.position).toBeUndefined();
  expect(orphan?.size).toBeUndefined();
});

test('Node-only: hasGeometry is precise (AC5)', async () => {
  const versions = await loadVersions();
  const envelope = (nodes: SavedNode[]): SavedVersion => ({ id: FIXTURE_ID, nodes });

  expect(versions.hasGeometry(envelope([{ id: 'e2e-leaf', position: { x: 40, y: 60 } }]))).toBe(true);
  expect(versions.hasGeometry(envelope([{ id: 'e2e-leaf', size: { width: 220 } }]))).toBe(true);
  expect(versions.hasGeometry(envelope([{ id: 'e2e-leaf' }]))).toBe(false);
  expect(versions.hasGeometry(envelope([{ id: 'e2e-leaf', size: { width: 0 } }]))).toBe(false);
  expect(versions.hasGeometry(envelope([]))).toBe(false);
});
