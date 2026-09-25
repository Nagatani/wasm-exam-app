import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { fetchMe } from '../api/auth';
import type { UserProfile } from '../types/user';
import { AuthContext } from './authContextValue';

// The hook lives in ./useAuth, the context object in ./authContextValue.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const user = await fetchMe();
    setProfile(user);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ profile, loading, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
