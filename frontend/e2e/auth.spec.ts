import { test, expect } from '@playwright/test';

test.describe('Auth flow', () => {
  test('login page shows sign-in form with link to register', async ({ page }) => {
    await page.goto('/login');

    // The heading should say "Sign in"
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // Email and password inputs are present
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();

    // Link to register page exists
    const registerLink = page.getByRole('link', { name: 'Sign up' });
    await expect(registerLink).toBeVisible();
    await expect(registerLink).toHaveAttribute('href', '/register');
  });

  test('register page shows create-account form with link to login', async ({ page }) => {
    await page.goto('/register');

    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();

    // Form fields
    await expect(page.getByLabel('Full Name')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();

    // Link back to login
    const loginLink = page.getByRole('link', { name: 'Sign in' });
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute('href', '/login');
  });

  test('register with email and password, verify redirect to login', async ({ page }) => {
    // Mock the register API to return success
    await page.route('**/api/v1/auth/register', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'user-1',
          email: 'newuser@example.com',
          full_name: 'New User',
          role: 'user',
          is_active: true,
          created_at: new Date().toISOString(),
        }),
      });
    });

    await page.goto('/register');

    await page.getByLabel('Full Name').fill('New User');
    await page.getByLabel('Email').fill('newuser@example.com');
    await page.getByLabel('Password').fill('securepassword123');

    await page.getByRole('button', { name: 'Create account' }).click();

    // After successful registration, the app navigates to /login
    await expect(page).toHaveURL(/\/login/);
  });

  test('login with credentials, verify redirect to projects', async ({ page }) => {
    // Mock the login API
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'fake-access-token',
          refresh_token: 'fake-refresh-token',
          token_type: 'bearer',
          user: {
            id: 'user-1',
            email: 'testuser@example.com',
            full_name: 'Test User',
            role: 'user',
            is_active: true,
            created_at: new Date().toISOString(),
          },
        }),
      });
    });

    // Mock the /me endpoint for post-login auth check
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

    // Mock the projects list so the redirect target loads
    await page.route('**/api/v1/projects*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.goto('/login');

    await page.getByLabel('Email').fill('testuser@example.com');
    await page.getByLabel('Password').fill('password123');

    await page.getByRole('button', { name: 'Sign in' }).click();

    // After successful login, the app redirects to / (project list, which is the default "from")
    await expect(page).toHaveURL(/^\/$|\/projects/);
  });

  test('shows error on invalid credentials', async ({ page }) => {
    // Mock the login API to return 401
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Invalid email or password' }),
      });
    });

    await page.goto('/login');

    await page.getByLabel('Email').fill('bad@example.com');
    await page.getByLabel('Password').fill('wrongpassword');

    await page.getByRole('button', { name: 'Sign in' }).click();

    // Error message should be visible on the page
    await expect(page.getByText('Invalid email or password')).toBeVisible();
  });
});
