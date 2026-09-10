import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types/user';

interface ProtectedRouteProps {
  children: ReactNode;
  role?: UserRole;
  // Routes that stay reachable even when the account must change its password
  // (the change-password page itself).
  allowPasswordChangePending?: boolean;
}

export function ProtectedRoute({ children, role, allowPasswordChangePending }: ProtectedRouteProps) {
  const { profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mp-bg text-mp-muted">
        読み込み中...
      </div>
    );
  }

  if (!profile) {
    return <Navigate to="/login" replace />;
  }

  if (
    profile.mustChangePassword &&
    !allowPasswordChangePending &&
    location.pathname !== '/change-password'
  ) {
    return <Navigate to="/change-password" replace />;
  }

  if (role && profile.role !== role) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
