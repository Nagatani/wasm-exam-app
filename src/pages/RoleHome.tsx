import { Navigate } from '../lib/router';
import { useAuth } from '../contexts/useAuth';

export function RoleHome() {
  const { profile } = useAuth();

  if (profile?.role === 'TEACHER') {
    return <Navigate to="/teacher" replace />;
  }
  return <Navigate to="/student" replace />;
}
