import { useState } from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { Box, LogIn, LogOut, User, Menu, X } from 'lucide-react';
import { useAuthStore } from '@/store';

export function Layout() {
  const { user, isAuthenticated, logout } = useAuthStore();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    setMobileMenuOpen(false);
    navigate('/login');
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2">
            <Box className="h-7 w-7 text-primary-600 sm:h-8 sm:w-8" />
            <span className="text-lg font-bold text-gray-900 sm:text-xl">3D Dev Platform</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-4 sm:flex">
            <Link to="/" className="text-sm font-medium text-gray-600 hover:text-gray-900">
              Projects
            </Link>
            {isAuthenticated ? (
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-sm text-gray-600">
                  <User size={14} />
                  {user?.full_name || user?.email}
                </span>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-1 rounded-lg bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-100"
              >
                <LogIn size={14} />
                Sign in
              </Link>
            )}
          </nav>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 sm:hidden"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile dropdown */}
        {mobileMenuOpen && (
          <div className="border-t border-gray-100 bg-white px-4 pb-4 pt-2 sm:hidden">
            <Link
              to="/"
              onClick={() => setMobileMenuOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Projects
            </Link>
            {isAuthenticated ? (
              <>
                <div className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600">
                  <User size={14} />
                  {user?.full_name || user?.email}
                </div>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </>
            ) : (
              <Link
                to="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="mt-1 flex items-center gap-1 rounded-lg bg-primary-50 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100"
              >
                <LogIn size={14} />
                Sign in
              </Link>
            )}
          </div>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
