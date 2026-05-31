import { createContext, useContext } from 'react';

export const AuthContext = createContext(null);

/** Current user from Layout (same payload as GET /auth/me). */
export function useAuthUser() {
  return useContext(AuthContext);
}
