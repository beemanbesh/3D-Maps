import { test, expect } from '@playwright/test';
import {
  navigateToViewer,
  waitForSceneLoaded,
  setViewerSettings,
  setColorScheme,
} from './fixtures/visual-test-helpers';

/**
 * Visual regression test suite for the 3D Viewer.
 *
 * Every test uses Playwright's `toHaveScreenshot()` with a 2% pixel
 * diff tolerance (`maxDiffPixelRatio: 0.02`) to account for minor
 * non-determinism in WebGL rendering across runs (anti-aliasing, float
 * precision, GPU driver differences, etc.).
 *
 * Baseline images are stored under `e2e/__screenshots__/` and should be
 * committed to the repository.  Re-generate them with:
 *
 *   npx playwright test --project visual-regression --update-snapshots
 */

// Shared screenshot options applied to every assertion.
const SCREENSHOT_OPTS = {
  maxDiffPixelRatio: 0.02,
  // Give the GPU an extra moment between comparison retries.
  animations: 'disabled' as const,
};

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------

test.describe('Visual Regression — 3D Viewer', () => {

  // -------------------------------------------------------------------
  // 1. Initial render
  // -------------------------------------------------------------------

  test('viewer initial render matches baseline', async ({ page }) => {
    await navigateToViewer(page);

    await expect(page).toHaveScreenshot('viewer-initial-render.png', SCREENSHOT_OPTS);
  });

  // -------------------------------------------------------------------
  // 2. Viewer with buildings loaded
  // -------------------------------------------------------------------

  test('viewer with buildings loaded matches baseline', async ({ page }) => {
    const buildings = [
      {
        id: 'bldg-1',
        name: 'Tower A',
        height_meters: 45,
        floor_count: 12,
        floor_height_meters: 3.5,
        roof_type: 'flat',
        model_url: null,
        construction_phase: 1,
        specifications: {},
      },
      {
        id: 'bldg-2',
        name: 'Tower B',
        height_meters: 60,
        floor_count: 16,
        floor_height_meters: 3.5,
        roof_type: 'gabled',
        model_url: null,
        construction_phase: 1,
        specifications: {},
      },
      {
        id: 'bldg-3',
        name: 'Podium',
        height_meters: 15,
        floor_count: 4,
        floor_height_meters: 3.75,
        roof_type: 'flat',
        model_url: null,
        construction_phase: 2,
        specifications: {},
      },
    ];

    await navigateToViewer(page, 'proj-1', { buildings });

    await expect(page).toHaveScreenshot('viewer-buildings-loaded.png', SCREENSHOT_OPTS);
  });

  // -------------------------------------------------------------------
  // 3. Camera modes
  // -------------------------------------------------------------------

  test.describe('camera modes', () => {
    test.beforeEach(async ({ page }) => {
      await navigateToViewer(page);
    });

    test('orbit mode (default) matches baseline', async ({ page }) => {
      // Orbit is the default — just verify the baseline.
      await setViewerSettings(page, { cameraMode: 'orbit' });

      await expect(page).toHaveScreenshot('viewer-camera-orbit.png', SCREENSHOT_OPTS);
    });

    test('aerial camera preset matches baseline', async ({ page }) => {
      await setViewerSettings(page, { cameraPreset: 'aerial' });

      await expect(page).toHaveScreenshot('viewer-camera-aerial.png', SCREENSHOT_OPTS);
    });

    test('street camera preset matches baseline', async ({ page }) => {
      await setViewerSettings(page, { cameraPreset: 'street' });

      await expect(page).toHaveScreenshot('viewer-camera-street.png', SCREENSHOT_OPTS);
    });

    test('front camera preset matches baseline', async ({ page }) => {
      await setViewerSettings(page, { cameraPreset: 'front' });

      await expect(page).toHaveScreenshot('viewer-camera-front.png', SCREENSHOT_OPTS);
    });

    test('45-degree camera preset matches baseline', async ({ page }) => {
      await setViewerSettings(page, { cameraPreset: 'corner' });

      await expect(page).toHaveScreenshot('viewer-camera-45deg.png', SCREENSHOT_OPTS);
    });
  });

  // -------------------------------------------------------------------
  // 4. Map background layer
  // -------------------------------------------------------------------

  test.describe('map background', () => {
    test('satellite map layer matches baseline', async ({ page }) => {
      await navigateToViewer(page, 'proj-1', {
        location: { latitude: 40.7128, longitude: -74.006, address: '123 Main St, New York' },
      });

      // Mock Mapbox tile requests so we get a deterministic background.
      await page.route('**/api.mapbox.com/**', async (route) => {
        // Return a 1x1 transparent PNG for tile requests to keep the
        // test deterministic and offline-capable.
        const transparentPng = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
          'base64',
        );
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: transparentPng,
        });
      });

      await setViewerSettings(page, { mapLayer: 'satellite' });

      await expect(page).toHaveScreenshot('viewer-map-satellite.png', SCREENSHOT_OPTS);
    });

    test('streets map layer matches baseline', async ({ page }) => {
      await navigateToViewer(page, 'proj-1', {
        location: { latitude: 40.7128, longitude: -74.006, address: '123 Main St, New York' },
      });

      await page.route('**/api.mapbox.com/**', async (route) => {
        const transparentPng = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
          'base64',
        );
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: transparentPng,
        });
      });

      await setViewerSettings(page, { mapLayer: 'streets' });

      await expect(page).toHaveScreenshot('viewer-map-streets.png', SCREENSHOT_OPTS);
    });

    test('no map (default off) matches baseline', async ({ page }) => {
      await navigateToViewer(page);

      await setViewerSettings(page, { mapLayer: 'none' });

      await expect(page).toHaveScreenshot('viewer-map-off.png', SCREENSHOT_OPTS);
    });
  });

  // -------------------------------------------------------------------
  // 5. Dark mode vs light mode
  // -------------------------------------------------------------------

  test.describe('colour scheme', () => {
    test('light mode matches baseline', async ({ page }) => {
      await setColorScheme(page, 'light');
      await navigateToViewer(page);

      await expect(page).toHaveScreenshot('viewer-light-mode.png', SCREENSHOT_OPTS);
    });

    test('dark mode matches baseline', async ({ page }) => {
      await setColorScheme(page, 'dark');
      await navigateToViewer(page);

      await expect(page).toHaveScreenshot('viewer-dark-mode.png', SCREENSHOT_OPTS);
    });
  });

  // -------------------------------------------------------------------
  // 6. Layer toggles
  // -------------------------------------------------------------------

  test.describe('layer visibility', () => {
    test.beforeEach(async ({ page }) => {
      await navigateToViewer(page);
    });

    test('grid hidden matches baseline', async ({ page }) => {
      await setViewerSettings(page, { showGrid: false });

      await expect(page).toHaveScreenshot('viewer-grid-hidden.png', SCREENSHOT_OPTS);
    });

    test('shadows disabled matches baseline', async ({ page }) => {
      await setViewerSettings(page, { showShadows: false });

      await expect(page).toHaveScreenshot('viewer-shadows-off.png', SCREENSHOT_OPTS);
    });
  });

  // -------------------------------------------------------------------
  // 7. Controls panel visibility
  // -------------------------------------------------------------------

  test('controls panel visible on desktop matches baseline', async ({ page }) => {
    await navigateToViewer(page);

    // The controls panel should be visible on desktop viewports.
    await expect(page.getByText('Camera', { exact: false })).toBeVisible();
    await expect(page.getByText('Layers')).toBeVisible();

    await expect(page).toHaveScreenshot('viewer-controls-panel.png', SCREENSHOT_OPTS);
  });
});
