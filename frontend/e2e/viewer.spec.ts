import { test, expect, Page } from '@playwright/test';

/**
 * Helper: mock auth endpoints and seed localStorage with a fake token
 * so the ProtectedRoute grants access to the viewer.
 */
async function authenticateUser(page: Page) {
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
}

/**
 * Helper: mock all API endpoints the ViewerPage queries on load.
 */
async function mockViewerAPIs(page: Page) {
  await page.route('**/api/v1/projects/proj-1', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'proj-1',
        name: 'Riverside Development',
        description: 'Phase 1 of the riverside residential complex.',
        status: 'draft',
        location: null,
        buildings: [
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
        ],
        documents: [],
        construction_phases: [],
        created_at: '2025-06-01T10:00:00Z',
        updated_at: '2025-06-15T14:30:00Z',
      }),
    });
  });

  await page.route('**/api/v1/annotations/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  // The collaboration websocket will fail silently in tests — that is fine.
}

test.describe('3D Viewer', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateUser(page);
    await mockViewerAPIs(page);
  });

  test('viewer page loads with a canvas element', async ({ page }) => {
    await page.goto('/projects/proj-1/viewer');

    // The viewer renders a full-screen container
    await expect(page.locator('div.relative.h-screen.w-screen')).toBeVisible();

    // The Three.js / R3F scene renders into a <canvas>
    // Allow extra time since WebGL initialization can be slow
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });
  });

  test('viewer controls panel is visible on desktop', async ({ page }) => {
    await page.goto('/projects/proj-1/viewer');

    // The controls panel contains a "Camera" section heading
    await expect(page.getByText('Camera', { exact: false })).toBeVisible({ timeout: 10_000 });

    // The "Layers" section should also be present
    await expect(page.getByText('Layers')).toBeVisible();

    // Camera mode buttons
    await expect(page.getByRole('button', { name: 'Orbit' })).toBeVisible();

    // Layer toggles
    await expect(page.getByText('Existing Buildings')).toBeVisible();
    await expect(page.getByText('Grid')).toBeVisible();
  });

  test('keyboard shortcuts modal opens with "?" key', async ({ page }) => {
    await page.goto('/projects/proj-1/viewer');

    // Wait for the viewer to finish loading
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });

    // Press "?" (Shift + /) to open the keyboard shortcuts modal
    await page.keyboard.press('Shift+/');

    // The modal heading
    await expect(page.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeVisible();

    // Some shortcut content should be visible
    await expect(page.getByText('Move camera')).toBeVisible();
    await expect(page.getByText('Toggle this help')).toBeVisible();

    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Keyboard Shortcuts' })).not.toBeVisible();
  });

  test('screenshot button exists in the top bar', async ({ page }) => {
    await page.goto('/projects/proj-1/viewer');

    // The screenshot button contains "Screenshot" text (hidden on mobile, visible on desktop)
    const screenshotButton = page.getByRole('button', { name: /Screenshot/i });
    await expect(screenshotButton).toBeVisible({ timeout: 10_000 });

    // Clicking it should open the resolution sub-menu
    await screenshotButton.click();

    // The sub-menu shows resolution options
    await expect(page.getByText('1x Resolution')).toBeVisible();
    await expect(page.getByText('2x Resolution')).toBeVisible();
    await expect(page.getByText('4x Resolution')).toBeVisible();
  });
});
