import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function RoleHome() {
  const { profile } = useAuth();

  if (profile?.role === 'TEACHER') {
    return <Navigate to="/teacher" replace />;
  }
  return <Navigate to="/student" replace />;
}
