import { createContext } from 'react';
import type { UserProfile } from '../types/user';

// Kept apart from AuthContext.tsx (the provider component) and useAuth.ts
// so each module exports either components or non-components, never both —
// React Fast Refresh only hot-swaps component-only modules.
export interface AuthContextValue {
  profile: UserProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
