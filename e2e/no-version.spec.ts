import { expect, test, type Page } from '@playwright/test';

/**
 * Run 1 — AC6 backward-compatibility baseline.
 *
 * With NO stored layout version the diagram must render exactly as it did
 * before the feature: deterministic ELK auto-layout, a leaf that grows when a
 * section expands, a working Re-layout button, and no version written to
 * `localStorage` merely by opening the page (autosave only fires on user
 * drag/resize - Run 2).
 *
 * This suite is a regression guard: it is expected to pass both before and
 * after Run 1 ships.
 */

const FIXTURE_ID = 'e2e-layout-fixture';
const VERSION_KEY_PREFIX = 'render-diagrams:layout-version:';

interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function readNode(page: Page, id: string): Promise<NodeGeometry> {
  return page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => {
    const node = el as HTMLElement;
    const match = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(node.style.transform);
    return {
      x: match ? Number(match[1]) : Number.NaN,
      y: match ? Number(match[2]) : Number.NaN,
      width: node.offsetWidth,
      height: node.offsetHeight,
    };
  });
}

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
  // Past the first + measured ELK passes.
  await page.waitForTimeout(500);
}

/** The layout actions live in the topbar menu; open it before clicking one. */
async function openActions(page: Page): Promise<void> {
  await page.getByTestId('actions-toggle').click();
  await expect(page.getByTestId('actions-menu')).toBeVisible();
}

async function storedVersionKeys(page: Page): Promise<string[]> {
  return page.evaluate((prefix: string) => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    return keys;
  }, VERSION_KEY_PREFIX);
}

test('auto-layout geometry is deterministic across two loads (AC6)', async ({ page }) => {
  await openFixture(page);
  const first = await waitForStableGeometry(page);
  expect(first.length).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator('.canvas')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="e2e-leaf"]')).toBeVisible();
  await page.waitForTimeout(500);
  const second = await waitForStableGeometry(page);

  expect(second).toBe(first);
});

test('a leaf grows when a collapsed section expands (AC6)', async ({ page }) => {
  await openFixture(page);
  await waitForStableGeometry(page);

  const before = (await readNode(page, 'e2e-leaf')).height;
  await page.locator('.react-flow__node[data-id="e2e-leaf"] summary', { hasText: 'Notes' }).click();

  await expect
    .poll(async () => (await readNode(page, 'e2e-leaf')).height, {
      message: 'expanding the Notes section should grow the auto-height leaf',
    })
    .toBeGreaterThan(before);
});

test('Re-layout still works and is repeatable (AC6)', async ({ page }) => {
  await openFixture(page);
  await waitForStableGeometry(page);

  await openActions(page);
  const relayout = page.getByRole('menuitem', { name: 'Re-layout' });
  await expect(relayout).toBeEnabled();

  await relayout.click();
  await waitForStableGeometry(page);
  await expect(page.locator('.react-flow__node[data-id]')).toHaveCount(7);

  await openActions(page);
  await relayout.click();
  const afterFirst = await waitForStableGeometry(page);
  await openActions(page);
  await relayout.click();
  const afterSecond = await waitForStableGeometry(page);

  expect(afterSecond).toBe(afterFirst);
});

test('merely opening the diagram writes no version to localStorage (AC6)', async ({ page }) => {
  await openFixture(page);
  await waitForStableGeometry(page);

  expect(await storedVersionKeys(page)).toEqual([]);
});
