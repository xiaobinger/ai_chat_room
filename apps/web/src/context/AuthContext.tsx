import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicUser } from '@tianma/contracts';
import { api, clearToken, getToken, onUnauthorized, setToken } from '../lib/api';

type Session = PublicUser & { email: string };
type AuthResponse = { token: string; user: PublicUser };

interface AuthValue {
  user: Session | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName: string): Promise<void>;
  logout(): void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Session | null>(null);
  // 未决态必须暴露给界面：不这样做的话，刷新受保护页面时会先闪一下登录页
  const [loading, setLoading] = useState(Boolean(getToken()));

  const restore = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api<Session>('GET', '/auth/me'));
    } catch {
      setUser(null); // 401 已由 api() 清掉 token
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void restore();
    onUnauthorized(() => setUser(null));
    return () => onUnauthorized(null);
  }, [restore]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      async login(email, password) {
        const result = await api<AuthResponse>('POST', '/auth/login', { email, password });
        setToken(result.token);
        setUser(await api<Session>('GET', '/auth/me'));
      },
      async register(email, password, displayName) {
        const result = await api<AuthResponse>('POST', '/auth/register', { email, password, displayName });
        setToken(result.token);
        setUser(await api<Session>('GET', '/auth/me'));
      },
      logout() {
        clearToken();
        setUser(null);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return value;
}
