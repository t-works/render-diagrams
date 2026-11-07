import { expect, test, type Page } from '@playwright/test';

/**
 * Shell rework — topbar actions menu + left info drawer (AC1/AC3/AC4/AC5/
 * AC6/AC7).
 *
 * The diagram page portals its two triggers into the topbar slot, so the actions
 * live on the right of the navbar and the description/legend live in a drawer
 * that overlays the canvas. This spec owns the shell itself; action parity is
 * covered by the smoke/no-version/save-load suites.
 */

const FIXTURE_ID = 'e2e-layout-fixture';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function openFixture(page: Page): Promise<void> {
  await page.goto(`/d/${FIXTURE_ID}`);
  await expect(page.locator('.canvas')).toBeVisible();
  await expect(page.getByTestId('actions-toggle')).toBeVisible();
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  return box;
}

async function nodeSnapshot(page: Page): Promise<string> {
  const entries = await page.locator('.react-flow__node[data-id]').evaluateAll((els) =>
    els.map((el) => {
      const node = el as HTMLElement;
      const match = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(node.style.transform);
      return `${node.dataset.id}:${match?.[1] ?? 'NaN'},${match?.[2] ?? 'NaN'},${node.offsetWidth},${node.offsetHeight}`;
    }),
  );
  return entries.sort().join('|');
}

test('triggers sit at the right end of the topbar and the page body has no actions (AC1)', async ({ page }) => {
  await openFixture(page);

  const topbar = await boxOf(page, '.topbar');
  const info = await boxOf(page, '[data-testid="info-toggle"]');
  const actions = await boxOf(page, '[data-testid="actions-toggle"]');

  for (const trigger of [info, actions]) {
    expect(trigger.y).toBeGreaterThanOrEqual(topbar.y);
    expect(trigger.y + trigger.height).toBeLessThanOrEqual(topbar.y + topbar.height);
  }
  // Actions are the right-most control; info sits immediately to its left.
  expect(actions.x).toBeGreaterThan(info.x + info.width - 1);
  expect(actions.x + actions.width).toBeGreaterThan(topbar.x + topbar.width - 80);

  // No action button and no legend left in the page body.
  await expect(page.getByRole('button', { name: 'Download' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Re-layout' })).toHaveCount(0);
  await expect(page.locator('.page__header .legend')).toHaveCount(0);
  await expect(page.locator('.page__header .page__description')).toHaveCount(0);

  // The info trigger and the actions trigger are both reachable.
  await page.getByTestId('info-toggle').focus();
  await expect(page.getByTestId('info-toggle')).toBeFocused();
  await page.getByTestId('actions-toggle').focus();
  await expect(page.getByTestId('actions-toggle')).toBeFocused();
});

test('the menu holds Download, Upload and Re-layout, and Escape returns focus (AC2/AC5)', async ({ page }) => {
  await openFixture(page);
  const toggle = page.getByTestId('actions-toggle');

  await toggle.click();
  const menu = page.getByTestId('actions-menu');
  await expect(menu).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  const items = menu.getByRole('menuitem');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveText('Download');
  await expect(items.nth(1)).toHaveText('Upload');
  await expect(items.nth(2)).toHaveText('Re-layout');
  await expect(items.nth(0)).toBeFocused();

  // Arrow keys move through the items without leaving the menu.
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.nth(2)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.nth(0)).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('description and legend live in the drawer, hidden and inert while closed (AC3)', async ({ page }) => {
  await openFixture(page);
  const drawer = page.getByTestId('info-drawer');
  const toggle = page.getByTestId('info-toggle');

  // Closed: present in the DOM (for the slide) but out of the a11y tree and tab order.
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(drawer).toHaveAttribute('aria-hidden', 'true');
  expect(await drawer.evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  await expect(page.locator('.drawer__description')).toHaveCount(1);
  await expect(page.locator('.drawer .legend__item')).toHaveCount(2);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(drawer).toHaveAttribute('aria-hidden', 'false');
  expect(await drawer.evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  await expect(page.locator('.drawer__description')).toContainText('Deterministic fixture');
  await expect(page.getByTestId('info-close')).toBeFocused();

  // The close button dismisses and returns focus to its trigger.
  await page.getByTestId('info-close').click();
  await expect(drawer).toHaveAttribute('aria-hidden', 'true');
  await expect(toggle).toBeFocused();
});

test('the drawer overlays the diagram without reflowing it (AC4)', async ({ page }) => {
  await openFixture(page);
  await page.waitForTimeout(500);

  const canvasBefore = await boxOf(page, '.canvas');
  const nodesBefore = await nodeSnapshot(page);

  await page.getByTestId('info-toggle').click();
  await expect(page.getByTestId('info-drawer')).toHaveAttribute('aria-hidden', 'false');
  await page.waitForTimeout(350); // past the slide transition

  expect(await boxOf(page, '.canvas')).toEqual(canvasBefore);
  expect(await nodeSnapshot(page)).toBe(nodesBefore);

  // The panel actually sits over the canvas area (same origin, positive width).
  const drawer = await boxOf(page, '[data-testid="info-drawer"]');
  expect(drawer.x).toBeCloseTo(canvasBefore.x, 0);
  expect(drawer.y).toBeCloseTo(canvasBefore.y, 0);
  expect(drawer.width).toBeGreaterThan(200);
  expect(drawer.height).toBeCloseTo(canvasBefore.height, 0);

  await page.getByTestId('info-close').click();
  await page.waitForTimeout(350);
  expect(await boxOf(page, '.canvas')).toEqual(canvasBefore);
  expect(await nodeSnapshot(page)).toBe(nodesBefore);
});

test('Escape and an outside click dismiss the drawer (AC5)', async ({ page }) => {
  await openFixture(page);
  const drawer = page.getByTestId('info-drawer');
  const toggle = page.getByTestId('info-toggle');

  await toggle.click();
  await expect(drawer).toHaveAttribute('aria-hidden', 'false');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveAttribute('aria-hidden', 'true');
  await expect(toggle).toBeFocused();

  await toggle.click();
  await expect(drawer).toHaveAttribute('aria-hidden', 'false');
  const canvas = await boxOf(page, '.canvas');
  // Click the diagram to the right of the open panel, not through it.
  await page.mouse.click(canvas.x + canvas.width - 40, canvas.y + 40);
  await expect(drawer).toHaveAttribute('aria-hidden', 'true');
});

test('a 320px viewport keeps both triggers visible and the drawer in bounds (AC6)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openFixture(page);

  const info = await boxOf(page, '[data-testid="info-toggle"]');
  const actions = await boxOf(page, '[data-testid="actions-toggle"]');
  expect(info.x).toBeGreaterThanOrEqual(0);
  expect(actions.x + actions.width).toBeLessThanOrEqual(320);

  await page.getByTestId('info-toggle').click();
  await expect(page.getByTestId('info-drawer')).toHaveAttribute('aria-hidden', 'false');
  await page.waitForTimeout(350);

  const drawer = await boxOf(page, '[data-testid="info-drawer"]');
  expect(drawer.x).toBeGreaterThanOrEqual(0);
  expect(drawer.x + drawer.width).toBeLessThanOrEqual(320);
  expect(drawer.width).toBeGreaterThan(180);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('reduced motion removes the drawer transition (AC7)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFixture(page);
  await page.getByTestId('info-toggle').click();

  const duration = await page
    .getByTestId('info-drawer')
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration).toBe('0s');
});
