import { useState } from 'react';
import { Loader2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export function OAuthButtons() {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  const handleOAuth = async (provider: 'google' | 'microsoft') => {
    setLoadingProvider(provider);
    try {
      const response = await fetch(`${API_BASE}/api/v1/auth/oauth/${provider}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || `Failed to initiate ${provider} login`);
      }

      // Redirect browser to the OAuth provider's authorization page
      window.location.href = data.authorization_url;
    } catch {
      setLoadingProvider(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Google Button */}
      <button
        type="button"
        disabled={loadingProvider !== null}
        onClick={() => handleOAuth('google')}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 disabled:opacity-50"
      >
        {loadingProvider === 'google' ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.04 24.04 0 0 0 0 21.56l7.98-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
            <path fill="none" d="M0 0h48v48H0z" />
          </svg>
        )}
        Continue with Google
      </button>

      {/* Microsoft Button */}
      <button
        type="button"
        disabled={loadingProvider !== null}
        onClick={() => handleOAuth('microsoft')}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 disabled:opacity-50"
      >
        {loadingProvider === 'microsoft' ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#F25022" />
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
            <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
          </svg>
        )}
        Continue with Microsoft
      </button>
    </div>
  );
}
