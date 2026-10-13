import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setCsrf } from './api';
import { User } from './types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null as never);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    api<{ user: User; csrfToken: string }>('/api/auth/me')
      .then((r) => { setCsrf(r.csrfToken); setUser(r.user); })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    const onExpired = () => { setUser(null); qc.clear(); };
    window.addEventListener('session-expired', onExpired);
    return () => window.removeEventListener('session-expired', onExpired);
  }, [qc]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ user: User; csrfToken: string }>('/api/auth/login', { method: 'POST', body: { email, password } });
    setCsrf(r.csrfToken);
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setCsrf('');
    setUser(null);
    qc.clear();
  }, [qc]);

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}
