import { Page, expect } from '@playwright/test';

/**
 * Visual regression test helpers for the 3D Development Platform.
 *
 * These utilities handle the asynchronous nature of WebGL rendering
 * in React Three Fiber, ensuring that screenshots are taken only after
 * the scene has fully initialised and stabilised.
 */

// ---------------------------------------------------------------------------
// waitForCanvasReady
// ---------------------------------------------------------------------------

/**
 * Wait for the `<canvas>` element to appear in the DOM and for a WebGL
 * rendering context to be available on it.  This is the minimum bar
 * before any screenshot makes sense — without a context the canvas is
 * just an empty rectangle.
 *
 * @param page  Playwright page handle
 * @param opts  Optional overrides (timeout in ms)
 */
export async function waitForCanvasReady(
  page: Page,
  opts: { timeout?: number } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 20_000;

  // 1. The <canvas> must be visible in the viewport.
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout });

  // 2. Verify a WebGL context exists on the canvas.
  //    React Three Fiber typically creates a WebGL2 context, but we
  //    accept WebGL 1 as well.
  await page.waitForFunction(
    () => {
      const c = document.querySelector('canvas');
      if (!c) return false;
      const gl =
        c.getContext('webgl2') ||
        c.getContext('webgl') ||
        c.getContext('experimental-webgl');
      return !!gl;
    },
    { timeout },
  );
}

// ---------------------------------------------------------------------------
// waitForSceneLoaded
// ---------------------------------------------------------------------------

/**
 * Wait until the Three.js / R3F scene has finished its initial render
 * pass and the frame loop has settled.
 *
 * We achieve this by waiting for at least two `requestAnimationFrame`
 * cycles *after* the canvas is ready.  This gives React Three Fiber
 * enough time to mount the scene graph, set up post-processing, and
 * perform the first meaningful paint.
 *
 * @param page  Playwright page handle
 * @param opts  Optional overrides
 */
export async function waitForSceneLoaded(
  page: Page,
  opts: { timeout?: number; stableFrames?: number } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 25_000;
  const stableFrames = opts.stableFrames ?? 5;

  // First make sure the canvas + WebGL context are present.
  await waitForCanvasReady(page, { timeout });

  // Wait for N consecutive animation frames to ensure the render loop
  // has stabilised (geometry uploaded, textures loaded, etc.).
  await page.waitForFunction(
    (frames: number) => {
      return new Promise<boolean>((resolve) => {
        let count = 0;
        function tick() {
          count++;
          if (count >= frames) {
            resolve(true);
          } else {
            requestAnimationFrame(tick);
          }
        }
        requestAnimationFrame(tick);
      });
    },
    stableFrames,
    { timeout },
  );

  // Add a small extra settle time for GPU compositing to finish.
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// navigateToViewer
// ---------------------------------------------------------------------------

/**
 * Navigate to the 3D viewer page for a given project, setting up all
 * required API mocks so the page loads without a running backend.
 *
 * @param page       Playwright page handle
 * @param projectId  The project id to navigate to (default: 'proj-1')
 * @param opts       Optional overrides for mock data
 */
export async function navigateToViewer(
  page: Page,
  projectId = 'proj-1',
  opts: {
    buildings?: Array<Record<string, unknown>>;
    location?: { latitude: number; longitude: number; address?: string } | null;
    timeout?: number;
  } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 25_000;

  // ---------- Auth mocks ----------

  await page.addInitScript(() => {
    localStorage.setItem('access_token', 'fake-access-token');
    localStorage.setItem('refresh_token', 'fake-refresh-token');
  });

  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'user-1',
        email: 'testuser@example.com',
        full_name: 'Test User',
        role: 'user',
        is_active: true,
        created_at: new Date().toISOString(),
      }),
    });
  });

  // ---------- Project mock ----------

  const buildings = opts.buildings ?? [
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
  ];

  const location = opts.location === undefined ? null : opts.location;

  await page.route(`**/api/v1/projects/${projectId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: projectId,
        name: 'Riverside Development',
        description: 'Phase 1 of the riverside residential complex.',
        status: 'draft',
        location,
        buildings,
        documents: [],
        construction_phases: [],
        created_at: '2025-06-01T10:00:00Z',
        updated_at: '2025-06-15T14:30:00Z',
      }),
    });
  });

  // ---------- Secondary API mocks ----------

  await page.route('**/api/v1/annotations/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/v1/context/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  // ---------- Navigate and wait ----------

  await page.goto(`/projects/${projectId}/viewer`);
  await waitForSceneLoaded(page, { timeout });
}

// ---------------------------------------------------------------------------
// setViewerSettings
// ---------------------------------------------------------------------------

/**
 * Modify viewer settings by interacting with the controls panel.
 *
 * The function maps friendly setting names to the actual UI interactions
 * required to change them.  This keeps visual regression tests
 * declarative and resilient to minor layout changes.
 */
export async function setViewerSettings(
  page: Page,
  settings: {
    cameraMode?: 'orbit' | 'firstPerson' | 'flyThrough';
    mapLayer?: 'none' | 'satellite' | 'streets' | 'terrain';
    showGrid?: boolean;
    showShadows?: boolean;
    showExistingBuildings?: boolean;
    showLandscaping?: boolean;
    showRoads?: boolean;
    showMeasurements?: boolean;
    cameraPreset?: 'aerial' | 'street' | 'corner' | 'front';
  },
): Promise<void> {
  // Camera mode -------------------------------------------------------
  if (settings.cameraMode) {
    const labels: Record<string, string> = {
      orbit: 'Orbit',
      firstPerson: 'Walk',
      flyThrough: 'Fly',
    };
    const btn = page.getByRole('button', { name: labels[settings.cameraMode] });
    await btn.click();
    // Allow animation / state change to settle.
    await page.waitForTimeout(300);
  }

  // Camera preset -----------------------------------------------------
  if (settings.cameraPreset) {
    const presetLabels: Record<string, string> = {
      aerial: 'Aerial',
      street: 'Street',
      corner: '45',  // "45°" label
      front: 'Front',
    };
    const btn = page.getByRole('button', { name: presetLabels[settings.cameraPreset] });
    await btn.click();
    // Wait for camera tween to complete.
    await page.waitForTimeout(1000);
  }

  // Map layer ---------------------------------------------------------
  if (settings.mapLayer) {
    const label = settings.mapLayer === 'none' ? 'Off' : settings.mapLayer;
    const btn = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') });
    await btn.click();
    await page.waitForTimeout(500);
  }

  // Toggle switches ---------------------------------------------------
  const toggleMap: Record<string, string> = {
    showGrid: 'Grid',
    showShadows: 'Shadows',
    showExistingBuildings: 'Existing Buildings',
    showLandscaping: 'Landscaping',
    showRoads: 'Roads',
    showMeasurements: 'Measurements',
  };

  for (const [key, label] of Object.entries(toggleMap)) {
    const value = settings[key as keyof typeof settings];
    if (value === undefined) continue;

    // We click the toggle; if the current state does not match the
    // desired state we click again.  Since these are stateful toggles
    // we just click once — the test should set them from a known
    // initial state (the default viewer settings).
    const toggle = page.getByRole('button', { name: label });
    // Determine current state from the active class.
    const isActive = await toggle.evaluate((el) =>
      el.classList.contains('bg-primary-50') || el.classList.contains('bg-primary-100'),
    );
    if ((value && !isActive) || (!value && isActive)) {
      await toggle.click();
      await page.waitForTimeout(300);
    }
  }

  // Let the scene re-render after all settings changes.
  await waitForSceneLoaded(page, { stableFrames: 3 });
}

// ---------------------------------------------------------------------------
// setColorScheme
// ---------------------------------------------------------------------------

/**
 * Emulate dark or light colour scheme via Playwright.
 *
 * This uses Playwright's built-in `emulateMedia` API to set
 * `prefers-color-scheme`.  The application must respect the media query
 * for this to have a visual effect.  For applications that use a
 * class-based dark mode (e.g. Tailwind `dark:` variant), we also toggle
 * the `dark` class on `<html>`.
 */
export async function setColorScheme(
  page: Page,
  scheme: 'dark' | 'light',
): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });

  // Toggle Tailwind dark class for applications that rely on it.
  await page.evaluate((s) => {
    if (s === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, scheme);

  // Allow CSS transitions / re-renders to settle.
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// takeStableScreenshot
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper around `page.screenshot()` that first waits for
 * the scene to stabilise.  Returns the screenshot buffer for use with
 * `expect(buffer).toMatchSnapshot()` or similar assertions.
 *
 * Prefer using `toHaveScreenshot()` directly in tests (which handles
 * snapshot storage) — this helper is for cases where you need the raw
 * buffer.
 */
export async function takeStableScreenshot(
  page: Page,
  opts: { fullPage?: boolean } = {},
): Promise<Buffer> {
  await waitForSceneLoaded(page, { stableFrames: 3 });
  return await page.screenshot({ fullPage: opts.fullPage ?? false });
}
