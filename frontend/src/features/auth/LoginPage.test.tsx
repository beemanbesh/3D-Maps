import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './LoginPage';

// Mock the API module
vi.mock('@/services/api', () => ({
  authApi: {
    login: vi.fn(),
    me: vi.fn(),
  },
}));

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LoginPage', () => {
  it('renders login form', () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeDefined();
    expect(screen.getByLabelText('Email')).toBeDefined();
    expect(screen.getByLabelText('Password')).toBeDefined();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDefined();
  });

  it('has link to register page', () => {
    renderLogin();
    const link = screen.getByText('Sign up');
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('/register');
  });

  it('requires email and password fields', () => {
    renderLogin();
    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    expect(emailInput.required).toBe(true);
    expect(passwordInput.required).toBe(true);
  });

  it('calls login API on form submission', async () => {
    const { authApi } = await import('@/services/api');
    (authApi.login as ReturnType<typeof vi.fn>).mockResolvedValue({
      access_token: 'tok',
      user: { id: '1', email: 'test@example.com', full_name: 'Test User', role: 'editor', is_active: true },
    });

    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(authApi.login).toHaveBeenCalledWith('test@example.com', 'password123');
    });
  });

  it('shows error message on failed login', async () => {
    const { authApi } = await import('@/services/api');
    (authApi.login as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { data: { detail: 'Invalid credentials' } },
    });

    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'bad@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeDefined();
    });
  });

  it('disables submit button while loading', async () => {
    const { authApi } = await import('@/services/api');
    let resolveLogin: (v: unknown) => void;
    (authApi.login as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { resolveLogin = resolve; })
    );

    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');

    const button = screen.getByRole('button', { name: /sign in/i });
    await user.click(button);

    // Button should be disabled while loading
    expect(button).toHaveProperty('disabled', true);

    // Resolve the login
    resolveLogin!({
      access_token: 'tok',
      user: { id: '1', email: 'test@example.com', full_name: 'Test', role: 'editor', is_active: true },
    });
  });
});
