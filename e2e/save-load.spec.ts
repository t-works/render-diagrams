import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Run 2 — autosave / Download / Upload / Reset (AC1/AC2/AC3/AC5/AC7/AC9/AC10/
 * AC11/AC12).
 *
 * The product rule is autosave, not a dirty state: a drag or a resize ends, the
 * geometry is written to localStorage after a short debounce, and the toolbar
 * announces it. Reset is the only destructive action and it confirms first.
 *
 * Browser tests read node geometry from the wrapper transform (model space, so
 * zoom-independent) — the same measurement the Run 1 specs use.
 */

const FIXTURE_ID = 'e2e-layout-fixture';
const STORAGE_KEY = `render-diagrams:layout-version:${FIXTURE_ID}`;
const FOREIGN_KEY = 'render-diagrams:layout-version:some-other-diagram';

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

interface VersionsModule {
  saveVersion: (id: string, diagram: unknown, nodes: unknown[]) => SaveOutcome;
  writeVersion: (version: unknown) => boolean;
  clearVersion: (id: string) => boolean;
  readUploadedVersion: (file: File) => Promise<SavedVersion | null>;
  downloadVersion: (id: string, version: unknown) => boolean;
  serializeVersion: (diagram: unknown, nodes: unknown[]) => SavedVersion;
}

type SaveOutcome =
  | { status: 'saved'; version: SavedVersion }
  | { status: 'empty' }
  | { status: 'unavailable' };

interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  inlineHeight: string;
}

interface TestSpecNode {
  id: string;
  kind: string;
  label: string;
  parent?: string;
}

interface TestDiagram {
  meta: { id: string; title: string };
  nodes: TestSpecNode[];
  edges?: unknown[];
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

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

/** Wait until two consecutive snapshots agree (both ELK passes have settled). */
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

async function openFixture(page: Page): Promise<void> {
  await page.goto(`/d/${FIXTURE_ID}`);
  await expect(page.locator('.canvas')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="e2e-leaf"]')).toBeVisible();
  await waitForStableGeometry(page);
}

async function storedVersion(page: Page): Promise<SavedVersion | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as SavedVersion;
    } catch {
      return null;
    }
  }, STORAGE_KEY);
}

/** A stored version is expected within one debounce window. */
async function expectSaved(page: Page): Promise<SavedVersion> {
  await expect.poll(() => storedVersion(page), { timeout: 5_000 }).not.toBeNull();
  const version = await storedVersion(page);
  if (!version) throw new Error('expected a saved version');
  return version;
}

/** Drag a node by a screen-space delta, starting from its header area. */
async function dragNode(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const box = await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`node "${id}" is not visible`);
  const startX = box.x + box.width / 2;
  const startY = box.y + 10;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 8 });
  await page.mouse.up();
}

const leafOf = (version: SavedVersion): SavedNode => {
  const node = version.nodes.find((n) => n.id === 'e2e-leaf');
  if (!node) throw new Error('version has no e2e-leaf entry');
  return node;
};

// ---------------------------------------------------------------------------
// Browser coverage
// ---------------------------------------------------------------------------

test('autosaves a drag, replaces it on the next adjustment, and reloads identically (AC1/AC2/AC3/AC9/AC12)', async ({
  page,
}) => {
  await openFixture(page);
  const status = page.getByTestId('layout-status');
  const before = await readNode(page, 'e2e-leaf');

  // No version exists before the user acts; opening wrote nothing (AC6).
  expect(await storedVersion(page)).toBeNull();

  await dragNode(page, 'e2e-leaf', 140, 90);
  await expect(status).toContainText('Layout saved');

  const first = await expectSaved(page);
  expect(first.id).toBe(FIXTURE_ID);

  const moved = await readNode(page, 'e2e-leaf');
  expect(Math.abs(moved.x - before.x)).toBeGreaterThan(40);
  expect(leafOf(first).position?.x).toBeCloseTo(moved.x, 1);
  expect(leafOf(first).position?.y).toBeCloseTo(moved.y, 1);

  // Round-2 shape: leaf width only, container width + height, every node recorded.
  expect(leafOf(first).size?.width).toBeGreaterThan(0);
  expect(leafOf(first).size?.height).toBeUndefined();
  const group = first.nodes.find((n) => n.id === 'e2e-group');
  expect(group?.size?.height).toBeGreaterThan(0);
  expect(first.nodes).toHaveLength(7);

  // Second adjustment replaces the single version — no duplicates, no growth.
  await dragNode(page, 'e2e-leaf', 48, 0);
  await expect
    .poll(async () => leafOf(await expectSaved(page)).position?.x ?? null, { timeout: 5_000 })
    .not.toBe(leafOf(first).position?.x);
  const second = await expectSaved(page);
  expect(second.nodes).toHaveLength(7);
  expect(leafOf(second).position?.x).not.toBeCloseTo(leafOf(first).position!.x, 1);

  // Reload reproduces the last saved geometry; the rendered node grows with the
  // section instead of being frozen to the recorded width.
  await page.reload();
  await expect(page.locator('.canvas')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="e2e-leaf"]')).toBeVisible();
  await waitForStableGeometry(page);
  const restored = await readNode(page, 'e2e-leaf');
  expect(restored.x).toBeCloseTo(leafOf(second).position!.x, 1);
  expect(restored.y).toBeCloseTo(leafOf(second).position!.y, 1);
  expect(restored.inlineHeight).toBe('');
});

test('autosaves a resize and keeps a leaf width-only (AC2/AC3)', async ({ page }) => {
  await openFixture(page);
  const before = await readNode(page, 'e2e-leaf');

  // Select the node so the resizer becomes visible, then drag its SE handle.
  await page.locator('.react-flow__node[data-id="e2e-leaf"]').click({ position: { x: 16, y: 8 } });
  const handle = page.locator(
    '.react-flow__node[data-id="e2e-leaf"] .react-flow__resize-control.handle.bottom.right',
  );
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error('resize handle has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();

  const saved = await expectSaved(page);
  const leaf = leafOf(saved);
  expect(leaf.size?.width ?? 0).toBeGreaterThan(before.width + 20);
  // A leaf never records height, even after an explicit resize (sections keep growing).
  expect(leaf.size?.height).toBeUndefined();

  const resized = await readNode(page, 'e2e-leaf');
  expect(resized.width).toBeCloseTo(leaf.size!.width, 0);

  // A live resize gives the leaf an explicit height until it is re-applied; the
  // saved version is width-only, so a reload leaves the height content-driven
  // (no fixed inline height) and the section can still grow it.
  await page.reload();
  await expect(page.locator('.react-flow__node[data-id="e2e-leaf"]')).toBeVisible();
  await waitForStableGeometry(page);
  const reloaded = await readNode(page, 'e2e-leaf');
  expect(reloaded.width).toBeCloseTo(leaf.size!.width, 0);
  expect(reloaded.inlineHeight).toBe('');
});

test('Reset confirms, clears the version, and restores auto-layout (AC7/AC9)', async ({ page }) => {
  await openFixture(page);
  const status = page.getByTestId('layout-status');
  const baseline = await readNode(page, 'e2e-leaf');

  await dragNode(page, 'e2e-leaf', 160, 100);
  const saved = await expectSaved(page);
  const dragged = await readNode(page, 'e2e-leaf');
  expect(dragged.x).not.toBeCloseTo(baseline.x, 0);

  // The version exists, so the destructive action is offered (and confirms).
  const reset = page.getByTestId('reset');
  await expect(reset).toBeVisible();
  await expect(page.getByRole('button', { name: 'Re-layout' })).toHaveCount(0);

  await reset.click();
  await expect(page.getByTestId('reset-confirm')).toBeVisible();

  // Cancel leaves everything untouched.
  await page.getByTestId('reset-cancel').click();
  await expect(page.getByTestId('reset-confirm')).toHaveCount(0);
  expect(leafOf((await expectSaved(page))).position?.x).toBeCloseTo(
    leafOf(saved).position!.x,
    1,
  );

  await reset.click();
  await page.getByTestId('reset-confirm').click();
  await expect(status).toContainText('back to auto-layout');
  await expect.poll(() => storedVersion(page), { timeout: 5_000 }).toBeNull();

  // Auto-layout is back: the leaf returns to its pre-drag ELK position.
  await expect
    .poll(async () => (await readNode(page, 'e2e-leaf')).x, { timeout: 10_000 })
    .toBeCloseTo(baseline.x, 0);
  const afterReset = await readNode(page, 'e2e-leaf');
  expect(afterReset.y).toBeCloseTo(baseline.y, 0);
  expect(Math.abs(afterReset.x - dragged.x)).toBeGreaterThan(40);

  // Re-layout is offered again and storage stays empty after a reload.
  await expect(page.getByRole('button', { name: 'Re-layout' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.react-flow__node[data-id="e2e-leaf"]')).toBeVisible();
  await waitForStableGeometry(page);
  expect(await storedVersion(page)).toBeNull();
});

test('Download then Upload round-trips the geometry (AC10/AC11)', async ({ page }) => {
  await openFixture(page);
  const status = page.getByTestId('layout-status');

  await dragNode(page, 'e2e-leaf', 120, 70);
  const saved = await expectSaved(page);
  const expected = leafOf(saved).position!;

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
  expect(download.suggestedFilename()).toBe(`${FIXTURE_ID}.json`);
  const filePath = await download.path();
  expect(filePath).not.toBeNull();
  await expect(status).toContainText(`Downloaded ${FIXTURE_ID}.json`);

  // Reset back to auto-layout, then re-apply the exported artifact.
  await page.getByTestId('reset').click();
  await page.getByTestId('reset-confirm').click();
  await expect.poll(() => storedVersion(page), { timeout: 5_000 }).toBeNull();
  await expect
    .poll(async () => (await readNode(page, 'e2e-leaf')).x, { timeout: 10_000 })
    .not.toBeCloseTo(expected.x, 1);

  await page.getByTestId('upload-input').setInputFiles(filePath!);
  await expect(status).toContainText('Applied layout');
  await expect
    .poll(async () => (await readNode(page, 'e2e-leaf')).x, { timeout: 10_000 })
    .toBeCloseTo(expected.x, 1);

  const restored = await readNode(page, 'e2e-leaf');
  expect(restored.y).toBeCloseTo(expected.y, 1);
  const persisted = await expectSaved(page);
  expect(leafOf(persisted).position?.x).toBeCloseTo(expected.x, 1);
  expect(leafOf(persisted).size?.height).toBeUndefined();
});

test('a version stored for another diagram id is ignored (AC5)', async ({ page }) => {
  const foreign: SavedVersion = {
    id: 'some-other-diagram',
    nodes: [
      { id: 'e2e-leaf', position: { x: 40, y: 60 }, size: { width: 220 } },
      { id: 'e2e-group', position: { x: 320, y: 60 }, size: { width: 260, height: 220 } },
    ],
  };
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value);
    },
    { key: FOREIGN_KEY, value: JSON.stringify(foreign) },
  );

  await openFixture(page);
  const leaf = await readNode(page, 'e2e-leaf');

  // Nothing from the foreign version is applied, and nothing is written to this
  // diagram's key just by opening it.
  expect(await storedVersion(page)).toBeNull();
  expect(await page.evaluate((key) => window.localStorage.getItem(key), FOREIGN_KEY)).not.toBeNull();
  expect(Math.abs(leaf.x - 40) > 1 || Math.abs(leaf.y - 60) > 1).toBe(true);
  await expect(page.getByRole('button', { name: 'Re-layout' })).toBeVisible();
});

test('Uploading a layout for another diagram is refused (AC5/AC11)', async ({ page }) => {
  await openFixture(page);
  const other = test.info().outputPath('other-diagram-layout.json');
  writeFileSync(
    other,
    `${JSON.stringify(
      {
        id: 'some-other-diagram',
        nodes: [{ id: 'e2e-leaf', position: { x: 40, y: 60 }, size: { width: 220 } }],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  await page.getByTestId('upload-input').setInputFiles(other);
  await expect(page.getByTestId('layout-status')).toContainText('not this diagram');
  expect(await storedVersion(page)).toBeNull();
});

test('controls are keyboard reachable and the status region is live (AC10)', async ({ page }) => {
  await openFixture(page);
  const status = page.getByTestId('layout-status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveAttribute('role', 'status');

  for (const name of ['Re-layout', 'Download', 'Upload']) {
    const control = page.getByRole('button', { name });
    await control.focus();
    await expect(control).toBeFocused();
  }

  // Download with nothing adjusted exports the current auto-layout rather than
  // failing: the confirmation is visible (AC10).
  await page.getByTestId('download').click();
  await expect(status).toContainText(`Downloaded ${FIXTURE_ID}.json`);

  await dragNode(page, 'e2e-leaf', 60, 40);
  const saved = await expectSaved(page);
  expect(leafOf(saved).position).toBeDefined();

  // The destructive control confirms first and moves focus deliberately.
  await page.getByTestId('reset').focus();
  await expect(page.getByTestId('reset')).toBeFocused();
  await page.getByTestId('reset').click();
  await expect(page.getByTestId('reset-confirm')).toBeFocused();
  await page.getByTestId('reset-cancel').click();
  await expect(page.getByTestId('reset')).toBeFocused();
});

// ---------------------------------------------------------------------------
// Node-only coverage for the storage / import accessors (AC2/AC5/AC12).
// ---------------------------------------------------------------------------

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** Minimal localStorage stand-in; `window` exists only once stubbed here. */
function stubStorage(overrides: Partial<StorageLike> = {}): Map<string, string> {
  const map = new Map<string, string>();
  const localStorage: StorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    ...overrides,
  };
  (globalThis as unknown as { window: { localStorage: StorageLike } }).window = { localStorage };
  return map;
}

async function loadVersions(): Promise<VersionsModule> {
  const moduleId = VERSIONS_MODULE;
  return (await import(moduleId)) as VersionsModule;
}

function fixtureDiagram(): TestDiagram {
  return {
    meta: { id: FIXTURE_ID, title: 'Fixture' },
    nodes: [
      { id: 'e2e-leaf', kind: 'task', label: 'Leaf' },
      { id: 'e2e-group', kind: 'group', label: 'Group' },
      { id: 'e2e-child', kind: 'task', label: 'Child', parent: 'e2e-group' },
    ],
    edges: [],
  };
}

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

const flowNodes = (leafX: number): Record<string, unknown>[] => [
  flowNode('e2e-leaf', 'task', { x: leafX, y: 60 }, 220, 96),
  flowNode('e2e-group', 'group', { x: 320, y: 60 }, 260, 220),
  flowNode('e2e-child', 'task', { x: 24, y: 32 }, 160, 64, 'e2e-group'),
];

test('Node-only: saveVersion writes only its own key and replaces the earlier version (AC2/AC5/AC12)', async () => {
  const store = stubStorage();
  const versions = await loadVersions();

  const first = versions.saveVersion(FIXTURE_ID, fixtureDiagram(), flowNodes(40));
  expect(first.status).toBe('saved');
  expect(store.has(STORAGE_KEY)).toBe(true);
  expect(store.has('render-diagrams:layout-version:diagram-b')).toBe(false);

  const reread = await versions.readUploadedVersion(
    new File([store.get(STORAGE_KEY)!], `${FIXTURE_ID}.json`, { type: 'application/json' }),
  );
  expect(leafOf(reread!).position?.x).toBe(40);

  // A second save replaces (single version, no append/duplicate).
  const second = versions.saveVersion(FIXTURE_ID, fixtureDiagram(), flowNodes(240));
  expect(second.status).toBe('saved');
  const stored = JSON.parse(store.get(STORAGE_KEY)!) as SavedVersion;
  expect(stored.nodes).toHaveLength(3);
  expect(leafOf(stored).position?.x).toBe(240);

  expect(versions.clearVersion(FIXTURE_ID)).toBe(true);
  expect(store.size).toBe(0);
});

test('Node-only: a storage failure degrades instead of throwing (AC2/AC9)', async () => {
  stubStorage({
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  });
  const versions = await loadVersions();

  expect(versions.saveVersion(FIXTURE_ID, fixtureDiagram(), flowNodes(40)).status).toBe('unavailable');
  expect(versions.clearVersion(FIXTURE_ID)).toBe(false);
  expect(versions.writeVersion({ id: FIXTURE_ID, nodes: [] })).toBe(false);
});

test('Node-only: readUploadedVersion rejects unreadable or malformed files (AC11)', async () => {
  const versions = await loadVersions();

  expect(await versions.readUploadedVersion(new File(['not json'], 'x.json'))).toBeNull();
  expect(await versions.readUploadedVersion(new File(['{"nodes":[]}'], 'x.json'))).toBeNull();
  expect(await versions.readUploadedVersion(new File(['{"id":"a","nodes":"nope"}'], 'x.json'))).toBeNull();

  const ok = await versions.readUploadedVersion(
    new File(['{"id":"a","nodes":[{"id":"n","position":{"x":1,"y":2}}]}'], 'a.json'),
  );
  expect(ok?.id).toBe('a');
  expect(ok?.nodes[0].position).toEqual({ x: 1, y: 2 });
});
