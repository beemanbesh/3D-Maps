import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { ProjectListPage } from '@/features/projects/ProjectListPage';
import { ProjectViewPage } from '@/features/projects/ProjectViewPage';
import { ViewerPage } from '@/features/projects/ViewerPage';
import { SharedProjectPage } from '@/features/projects/SharedProjectPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { OAuthCallbackPage } from '@/features/auth/OAuthCallbackPage';
import { useAuthStore } from '@/store';
import { authApi } from '@/services/api';

export default function App() {
  const { setUser, setLoading } = useAuthStore();

  // On mount, check if we have a valid token and load user
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token) {
      authApi
        .me()
        .then((user) => setUser(user))
        .catch(() => {
          setUser(null);
        });
    } else {
      setLoading(false);
    }
  }, [setUser, setLoading]);

  return (
    <Routes>
      {/* Auth routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/oauth/callback" element={<OAuthCallbackPage />} />

      {/* App routes — require authentication */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/" element={<ProjectListPage />} />
        <Route path="/projects/:id" element={<ProjectViewPage />} />
      </Route>
      {/* Viewer is full-screen, no layout wrapper */}
      <Route path="/projects/:id/viewer" element={<ProtectedRoute><ViewerPage /></ProtectedRoute>} />
      {/* Shared project view (public link) */}
      <Route path="/shared/:token" element={<SharedProjectPage />} />
    </Routes>
  );
}
