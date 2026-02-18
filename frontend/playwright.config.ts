import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * Playwright configuration for the 3D Development Platform frontend.
 *
 * Two projects are defined:
 *   1. "chromium"            — fast functional / interaction E2E tests
 *   2. "visual-regression"   — pixel-level screenshot comparison tests
 *
 * Run only visual-regression tests:
 *   npx playwright test --project visual-regression
 *
 * Update baseline screenshots:
 *   npx playwright test --project visual-regression --update-snapshots
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },

  projects: [
    // -----------------------------------------------------------------
    // Functional E2E tests
    // -----------------------------------------------------------------
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/visual-regression*'],
    },

    // -----------------------------------------------------------------
    // Visual regression tests — screenshot comparison with 2% tolerance
    // -----------------------------------------------------------------
    {
      name: 'visual-regression',
      testMatch: 'visual-regression.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Consistent viewport for deterministic screenshots.
        viewport: { width: 1280, height: 720 },
        // Longer timeout — WebGL scenes can take a while to initialise.
        actionTimeout: 15_000,
        // Disable animations / transitions for stable screenshots.
        // (CSS animations are paused by toHaveScreenshot by default.)
      },
      // Allow more time per test since scenes need to fully render.
      timeout: 60_000,
      expect: {
        toHaveScreenshot: {
          // 2% pixel-level tolerance to absorb WebGL rendering
          // non-determinism (anti-aliasing, float rounding, GPU driver
          // differences across environments).
          maxDiffPixelRatio: 0.02,
          // Threshold for individual pixel colour distance (0–1).
          // A small value keeps comparisons strict while still allowing
          // sub-pixel anti-aliasing differences.
          threshold: 0.2,
        },
      },
      snapshotPathTemplate: path.join(
        '{testDir}',
        '__screenshots__',
        '{projectName}',
        '{testFilePath}',
        '{arg}{ext}',
      ),
    },
  ],

  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
});
