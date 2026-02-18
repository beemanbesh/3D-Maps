import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from './index';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

beforeEach(() => {
  localStorageMock.clear();
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });
});

describe('AuthStore', () => {
  it('starts unauthenticated', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(true);
  });

  it('sets user and marks as authenticated', () => {
    const user = { id: '1', email: 'a@b.com', full_name: 'Test', role: 'editor', is_active: true };
    useAuthStore.getState().setUser(user);
    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLoading).toBe(false);
  });

  it('sets null user to unauthenticated', () => {
    const user = { id: '1', email: 'a@b.com', full_name: null, role: 'editor', is_active: true };
    useAuthStore.getState().setUser(user);
    useAuthStore.getState().setUser(null);
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('logout clears tokens from localStorage', () => {
    localStorageMock.setItem('access_token', 'tok1');
    localStorageMock.setItem('refresh_token', 'tok2');
    const user = { id: '1', email: 'a@b.com', full_name: null, role: 'editor', is_active: true };
    useAuthStore.getState().setUser(user);

    useAuthStore.getState().logout();
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(localStorageMock.getItem('access_token')).toBeNull();
    expect(localStorageMock.getItem('refresh_token')).toBeNull();
  });

  it('setLoading updates loading state', () => {
    useAuthStore.getState().setLoading(false);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });
});
