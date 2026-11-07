import { defineConfig, devices } from '@playwright/test';

// A dedicated port: 5173 is Vite's default and is routinely occupied by a
// different checkout on this machine, which would make Playwright reuse that
// app and test the wrong diagrams. `--strictPort` makes a clash fail loudly.
const PORT = 5180;
const baseURL = `http://localhost:${PORT}`;

/**
 * Single-runner harness. `npm run fixtures` materializes the gitignored
 * `src/diagrams/e2e-layout-fixture.json` before Vite starts, so a fresh
 * checkout can run the suite with no manual setup. Artifacts live under
 * `node_modules/.tmp/` (already gitignored) so the repo root stays clean.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: 'node_modules/.tmp/playwright-results',
  reporter: 'list',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Never a bare `tsx`: Playwright starts this with the project root as cwd,
    // and `npm run` puts node_modules/.bin on PATH for the fixtures step.
    command: `npm run fixtures && npm run dev -- --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
