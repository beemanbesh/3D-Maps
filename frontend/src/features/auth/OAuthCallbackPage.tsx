import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { authApi } from '@/services/api';
import { useAuthStore } from '@/store';

/**
 * Handles the OAuth2 redirect callback.
 * The backend redirects here with access_token and refresh_token as query params.
 * This page stores the tokens and fetches the user profile, then navigates to the app.
 */
export function OAuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setUser } = useAuthStore();

  useEffect(() => {
    const accessToken = searchParams.get('access_token');
    const refreshToken = searchParams.get('refresh_token');

    if (!accessToken || !refreshToken) {
      toast.error('OAuth login failed: missing tokens');
      navigate('/login', { replace: true });
      return;
    }

    // Store tokens
    localStorage.setItem('access_token', accessToken);
    localStorage.setItem('refresh_token', refreshToken);

    // Fetch user profile and redirect
    authApi
      .me()
      .then((user) => {
        setUser(user);
        toast.success(`Welcome, ${user.full_name || user.email}!`);
        navigate('/', { replace: true });
      })
      .catch(() => {
        toast.error('Failed to load user profile after OAuth login');
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        navigate('/login', { replace: true });
      });
  }, [searchParams, navigate, setUser]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <Loader2 size={32} className="mx-auto animate-spin text-primary-600" />
        <p className="mt-4 text-sm text-gray-500">Completing sign in...</p>
      </div>
    </div>
  );
}
