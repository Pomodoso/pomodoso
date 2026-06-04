import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.tsx';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  requirePro?: boolean;
}

export function ProtectedRoute({ children, requirePro = false }: Props) {
  const { session, entitlements, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-neutral-400 text-sm">Loading…</span>
      </div>
    );
  }

  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (requirePro && !entitlements.features.dashboard) {
    return <Navigate to="/upgrade" replace />;
  }

  return <>{children}</>;
}
