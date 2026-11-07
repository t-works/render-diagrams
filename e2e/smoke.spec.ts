import { expect, test } from '@playwright/test';

/**
 * Smoke test for the Run 0 harness. It proves the app serves, the
 * `e2e-layout-fixture` materialized by `e2e/prepare.ts` is routable, and the
 * canvas renders nodes. It deliberately tolerates extra diagrams (the four
 * local dev diagrams may or may not be present) and never asserts a global
 * diagram count.
 */
const FIXTURE_ID = 'e2e-layout-fixture';

test.describe('smoke', () => {
  test('serves the app shell', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('.app')).toBeVisible();
  });

  test('renders the fixture canvas with at least one node and an enabled Re-layout', async ({ page }) => {
    await page.goto(`/d/${FIXTURE_ID}`);

    await expect(page.locator('.canvas')).toBeVisible();
    await expect(page.locator('.react-flow')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Re-layout' })).toBeEnabled();

    // Never assert a global count: only that this fixture rendered its own nodes.
    await expect(page.locator('.react-flow__node[data-id]').first()).toBeVisible();
    await expect(page.locator('.react-flow__node[data-id="e2e-leaf"]')).toBeVisible();
  });
});
