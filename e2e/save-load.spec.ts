import { readFileSync, writeFileSync } from 'node:fs';
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
  open?: string[];
}

interface SavedVersion {
  id: string;
  nodes: SavedNode[];
}

interface Sections {
  state: Record<string, string[]>;
}

interface VersionsModule {
  saveVersion: (id: string, diagram: unknown, nodes: unknown[], sections?: Sections['state']) => SaveOutcome;
  writeVersion: (version: unknown) => boolean;
  clearVersion: (id: string) => boolean;
  readUploadedVersion: (file: File) => Promise<SavedVersion | null>;
  downloadVersion: (id: string, payload: unknown) => boolean;
  serializeVersion: (diagram: unknown, nodes: unknown[], sections?: Sections['state']) => SavedVersion;
  exportDiagram: (diagram: unknown, nodes: unknown[], sections?: Sections['state']) => ExportedDiagram;
  mergeGeometry: (diagram: unknown, version: unknown) => TestDiagram;
}

/** The downloaded artifact: a complete, valid diagram with geometry added. */
interface ExportedDiagram extends TestDiagram {
  specVersion?: string;
  direction?: string;
  nodes: Array<TestSpecNode & { position?: { x: number; y: number }; size?: { width: number; height?: number } }>;
  edges?: Array<Record<string, unknown>>;
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
  color?: string;
  inputs?: unknown[];
  outputs?: unknown[];
  sections?: Array<{ id: string; label: string; open?: boolean; items?: string[] }>;
}

interface TestDiagram {
  specVersion?: string;
  direction?: string;
  meta: { id: string; title: string; description?: string };
  nodes: TestSpecNode[];
  edges?: Array<Record<string, unknown>>;
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

/** Layout actions live in the topbar menu; open it before clicking one. */
async function openActions(page: Page): Promise<void> {
  await page.getByTestId('actions-toggle').click();
  await expect(page.getByTestId('actions-menu')).toBeVisible();
}

async function storedVersion(page: Page): Promise<SavedVersion | null> {  return page.evaluate((key) => {
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

/** `[label, open]` for each section of one node, in document order. */
async function sectionState(page: Page, nodeId: string): Promise<Array<[string, boolean]>> {
  return page.locator(`.react-flow__node[data-id="${nodeId}"] details`).evaluateAll((els) =>
    els.map((el) => [
      (el.querySelector('summary')?.textContent ?? '').trim(),
      (el as HTMLDetailsElement).open,
    ]) as Array<[string, boolean]>,
  );
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
  const before = await readNode(page, 'e2e-leaf');

  // No version exists before the user acts; opening wrote nothing (AC6).
  expect(await storedVersion(page)).toBeNull();

  await dragNode(page, 'e2e-leaf', 140, 90);
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
  const baseline = await readNode(page, 'e2e-leaf');

  await dragNode(page, 'e2e-leaf', 160, 100);
  const saved = await expectSaved(page);
  const dragged = await readNode(page, 'e2e-leaf');
  expect(dragged.x).not.toBeCloseTo(baseline.x, 0);

  // The version exists, so the destructive action is offered (and confirms).
  await openActions(page);
  const reset = page.getByTestId('reset');
  await expect(reset).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Re-layout' })).toHaveCount(0);

  await reset.click();
  await expect(page.getByTestId('reset-confirm')).toBeVisible();

  // Cancel leaves everything untouched and keeps the menu (and focus) usable.
  await page.getByTestId('reset-cancel').click();
  await expect(page.getByTestId('reset-confirm')).toHaveCount(0);
  await expect(page.getByTestId('reset')).toBeFocused();
  expect(leafOf((await expectSaved(page))).position?.x).toBeCloseTo(
    leafOf(saved).position!.x,
    1,
  );

  await page.getByTestId('reset').click();
  await page.getByTestId('reset-confirm').click();
  await expect.poll(() => storedVersion(page), { timeout: 5_000 }).toBeNull();

  // Auto-layout is back: the leaf returns to its pre-drag ELK position.
  await expect
    .poll(async () => (await readNode(page, 'e2e-leaf')).x, { timeout: 10_000 })
    .toBeCloseTo(baseline.x, 0);
  const afterReset = await readNode(page, 'e2e-leaf');
  expect(afterReset.y).toBeCloseTo(baseline.y, 0);
  expect(Math.abs(afterReset.x - dragged.x)).toBeGreaterThan(40);

  // Re-layout is offered again and storage stays empty after a reload.
  await openActions(page);
  await expect(page.getByRole('menuitem', { name: 'Re-layout' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.react-flow__node[data-id="e2e-leaf"]')).toBeVisible();
  await waitForStableGeometry(page);
  expect(await storedVersion(page)).toBeNull();
});

test('Download then Upload round-trips the geometry (AC10/AC11)', async ({ page }) => {
  await openFixture(page);

  await dragNode(page, 'e2e-leaf', 120, 70);
  const saved = await expectSaved(page);
  const expected = leafOf(saved).position!;

  await openActions(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
  expect(download.suggestedFilename()).toBe(`${FIXTURE_ID}.json`);
  const filePath = await download.path();
  expect(filePath).not.toBeNull();

  // The download is the complete diagram, not just the geometry envelope: content,
  // meta, direction and edges survive, and geometry is added on top.
  const exported = JSON.parse(readFileSync(filePath!, 'utf8')) as ExportedDiagram;
  expect(exported.meta.id).toBe(FIXTURE_ID);
  expect(exported.meta.title).toBe('E2E Layout Fixture');
  expect(exported.meta.description).toContain('Deterministic fixture');
  expect(exported.specVersion).toBe('1');
  expect(exported.direction).toBe('LR');
  expect(exported.edges).toHaveLength(3);
  expect(exported.nodes).toHaveLength(7);

  const exportedLeaf = exported.nodes.find((node) => node.id === 'e2e-leaf');
  expect(exportedLeaf?.label).toBe('Leaf with sections');
  expect(exportedLeaf?.sections).toHaveLength(2);
  expect(exportedLeaf?.position?.x).toBeCloseTo(expected.x, 1);
  expect(exportedLeaf?.size?.width).toBeGreaterThan(0);
  expect(exportedLeaf?.size?.height).toBeUndefined();

  const exportedGroup = exported.nodes.find((node) => node.id === 'e2e-group');
  expect(exportedGroup?.size?.height).toBeGreaterThan(0);

  // Reset back to auto-layout, then re-apply the exported artifact through the
  // menu's Upload item (the hidden input is page-level, so the picker survives
  // the menu closing).
  await openActions(page);
  await page.getByTestId('reset').click();
  await page.getByTestId('reset-confirm').click();
  await expect.poll(() => storedVersion(page), { timeout: 5_000 }).toBeNull();
  await expect
    .poll(async () => (await readNode(page, 'e2e-leaf')).x, { timeout: 10_000 })
    .not.toBeCloseTo(expected.x, 1);

  await openActions(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('upload').click()]);
  await chooser.setFiles(filePath!);
  await expect(page.getByTestId('layout-error')).toHaveCount(0);
  await expect
    .poll(async () => (await readNode(page, 'e2e-leaf')).x, { timeout: 10_000 })
    .toBeCloseTo(expected.x, 1);

  const restored = await readNode(page, 'e2e-leaf');
  expect(restored.y).toBeCloseTo(expected.y, 1);
  const persisted = await expectSaved(page);
  expect(leafOf(persisted).position?.x).toBeCloseTo(expected.x, 1);
  expect(leafOf(persisted).size?.height).toBeUndefined();
});

test('autosaves expanded sections and restores them after a reload (AC3/AC10)', async ({ page }) => {
  await openFixture(page);
  const leaf = page.locator('.react-flow__node[data-id="e2e-leaf"]');

  // The fixture authors `details` open and `notes` collapsed.
  expect(await sectionState(page, 'e2e-leaf')).toEqual([
    ['Details', true],
    ['Notes', false],
  ]);

  await leaf.locator('details', { hasText: 'Notes' }).locator('summary').click();
  await leaf.locator('details', { hasText: 'Details' }).locator('summary').click();

  const saved = await expectSaved(page);
  expect(leafOf(saved).open).toEqual(['notes']);

  // Expansion is part of the saved view, not transient DOM state.
  await page.reload();
  await openFixture(page);
  expect(await sectionState(page, 'e2e-leaf')).toEqual([
    ['Details', false],
    ['Notes', true],
  ]);

  // A later drag re-saves the same expansion (it must not fall back to the file).
  await dragNode(page, 'e2e-leaf', 60, 40);
  const afterDrag = await expectSaved(page);
  expect(leafOf(afterDrag).open).toEqual(['notes']);
  expect(await sectionState(page, 'e2e-leaf')).toEqual([
    ['Details', false],
    ['Notes', true],
  ]);
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
  await openActions(page);
  await expect(page.getByRole('menuitem', { name: 'Re-layout' })).toBeVisible();
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
  await expect(page.getByTestId('layout-error')).toContainText('not this diagram');
  expect(await storedVersion(page)).toBeNull();
});

test('controls are keyboard reachable (AC10)', async ({ page }) => {
  await openFixture(page);

  // The triggers are focusable; opening with the keyboard moves focus into the
  // menu, ArrowDown walks it, and Escape returns focus to the trigger.
  const toggle = page.getByTestId('actions-toggle');
  await toggle.focus();
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('download')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('upload')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Re-layout' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('actions-menu')).toHaveCount(0);
  await expect(toggle).toBeFocused();

  const info = page.getByTestId('info-toggle');
  await info.focus();
  await expect(info).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('info-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(info).toBeFocused();

  // Download with nothing adjusted exports the current auto-layout rather than
  // failing (a successful export is intentionally silent).
  await openActions(page);
  await page.getByTestId('download').click();
  await expect(page.getByTestId('layout-error')).toHaveCount(0);

  await dragNode(page, 'e2e-leaf', 60, 40);
  const saved = await expectSaved(page);
  expect(leafOf(saved).position).toBeDefined();

  // The destructive control confirms first and moves focus deliberately.
  await openActions(page);
  await page.getByTestId('reset').focus();
  await expect(page.getByTestId('reset')).toBeFocused();
  await page.keyboard.press('Enter');
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
    specVersion: '1',
    direction: 'LR',
    meta: { id: FIXTURE_ID, title: 'Fixture', description: 'Fixture description' },
    nodes: [
      {
        id: 'e2e-leaf',
        kind: 'task',
        label: 'Leaf',
        color: 'teal',
        outputs: [{ id: 'out' }],
        sections: [
          { id: 'details', label: 'Details', open: true, items: ['one'] },
          { id: 'notes', label: 'Notes', items: ['two'] },
        ],
      },
      { id: 'e2e-group', kind: 'group', label: 'Group' },
      { id: 'e2e-child', kind: 'task', label: 'Child', parent: 'e2e-group' },
    ],
    edges: [{ id: 'e1', source: 'e2e-leaf', target: 'e2e-child' }],
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

test('Node-only: exportDiagram keeps the content and adds geometry (AC11)', async () => {
  const versions = await loadVersions();
  const diagram = fixtureDiagram();
  const before = structuredClone(diagram);

  const exported = versions.exportDiagram(diagram, flowNodes(40), { 'e2e-leaf': ['notes'] });

  // Content untouched by the export.
  expect(exported.meta).toEqual(diagram.meta);
  expect(exported.direction).toBe('LR');
  expect(exported.specVersion).toBe('1');
  expect(exported.edges).toEqual(diagram.edges);
  expect(exported.nodes.find((node) => node.id === 'e2e-leaf')?.sections).toEqual([
    { id: 'details', label: 'Details', open: false, items: ['one'] },
    { id: 'notes', label: 'Notes', open: true, items: ['two'] },
  ]);

  // Geometry added: leaf width only, container width + height.
  const leaf = exported.nodes.find((node) => node.id === 'e2e-leaf');
  expect(leaf?.position).toEqual({ x: 40, y: 60 });
  expect(leaf?.size).toEqual({ width: 220 });
  expect(exported.nodes.find((node) => node.id === 'e2e-group')?.size).toEqual({ width: 260, height: 220 });

  // Immutable: the authored diagram is not mutated.
  expect(diagram).toEqual(before);

  // The exported diagram re-imports (meta.id is the id source).
  const parsed = await versions.readUploadedVersion(
    new File([JSON.stringify(exported)], `${FIXTURE_ID}.json`, { type: 'application/json' }),
  );
  expect(parsed?.id).toBe(FIXTURE_ID);
  expect(parsed?.nodes.find((node) => node.id === 'e2e-leaf')?.position).toEqual({ x: 40, y: 60 });
});

test('Node-only: a version records expanded sections and applies them back (AC10)', async () => {
  const versions = await loadVersions();
  const diagram = fixtureDiagram();

  // The file has `details` open; the reader collapsed it and opened `notes`.
  const version = versions.serializeVersion(diagram, flowNodes(40), { 'e2e-leaf': ['notes'] });
  expect(leafOf(version).open).toEqual(['notes']);

  // A node with no sections records nothing.
  expect(version.nodes.find((node) => node.id === 'e2e-child')?.open).toBeUndefined();

  const merged = versions.mergeGeometry(diagram, version);
  const leaf = merged.nodes.find((node) => node.id === 'e2e-leaf');
  expect(leaf?.sections).toEqual([
    { id: 'details', label: 'Details', open: false, items: ['one'] },
    { id: 'notes', label: 'Notes', open: true, items: ['two'] },
  ]);

  // "Everything collapsed" is a recorded state, not "no state".
  const collapsed = versions.serializeVersion(diagram, flowNodes(40), { 'e2e-leaf': [] });
  expect(leafOf(collapsed).open).toEqual([]);
  expect(versions.mergeGeometry(diagram, collapsed).nodes[0].sections?.every((s) => s.open === false)).toBe(true);

  // Immutable: the authored diagram keeps its own flags.
  expect(diagram.nodes[0].sections?.[0].open).toBe(true);
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
