import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface SessionUser { email: string; role: string; }
interface AuthState {
  user: SessionUser | null;
  authEnabled: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null, authEnabled: false, loading: true,
  refresh: async () => {}, logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await res.json();
      setUser(data.user || null);
      setAuthEnabled(!!data.authEnabled);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
    setUser(null);
    window.location.href = '/login';
  }

  useEffect(() => { refresh(); }, []);

  return (
    <AuthContext.Provider value={{ user, authEnabled, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
