import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';
import { Role, User } from './types';

interface Session {
  token: string;
  user: User;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, role: Role) => Promise<User>;
  register: (details: { fullName: string; email: string; password: string; role: 'student' | 'mentor' }) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Where each role lands after signing in. */
export function homePathFor(role: Role): string {
  if (role === 'faculty_admin') return '/lecturer';
  if (role === 'mentor') return '/mentor';
  return '/student';
}

// The database role for lecturers is 'faculty_admin'; the interface calls them lecturers
export const roleLabel: Record<Role, string> = {
  student: 'Student',
  mentor: 'Peer mentor',
  faculty_admin: 'Lecturer',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => getToken() !== null);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  // Restore the session after a page reload
  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (getToken()) {
      api<{ user: User }>('/auth/me')
        .then(({ user }) => setUser(user))
        .catch(() => logout())
        .finally(() => setLoading(false));
    }
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const startSession = useCallback((session: Session) => {
    setToken(session.token);
    setUser(session.user);
    return session.user;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    logout,
    login: async (email, password, role) =>
      startSession(await api<Session>('/auth/login', { method: 'POST', body: { email, password, role } })),
    register: async (details) =>
      startSession(await api<Session>('/auth/register', { method: 'POST', body: details })),
  }), [user, loading, logout, startSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** The signed-in user, for components that only render behind a protected route. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('useUser called without a signed-in user');
  return user;
}
