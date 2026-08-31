"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AppUser } from "@/lib/app/constants";
import { isUserLive } from "@/lib/app/constants";
import {
  fetchProfile,
  login as accountLogin,
  logout as accountLogout,
  readAuthToken,
  saveProfile,
} from "@/lib/auth/account";
import type { DayRoutine } from "@/types";

type AuthContextValue = {
  user: AppUser | null;
  token: string | null;
  ready: boolean;
  live: boolean;
  offline: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateProfile: (input: {
    startDate: string | null;
    paused: boolean;
    weeklyRoutine: DayRoutine[];
    activities: string[];
  }) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    const current = readAuthToken();
    setToken(current);
    if (!current) {
      setUser(null);
      setOffline(false);
      setReady(true);
      return;
    }
    try {
      const profile = await fetchProfile(current);
      setOffline(false);
      setUser(profile);
      if (!profile) setToken(null);
    } catch {
      setOffline(true);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await accountLogin(username, password);
    if (!result.ok) throw new Error(result.error);
    setOffline(false);
    setToken(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    await accountLogout();
    setToken(null);
    setUser(null);
    setOffline(false);
  }, []);

  const updateProfile = useCallback(
    async (input: {
      startDate: string | null;
      paused: boolean;
      weeklyRoutine: DayRoutine[];
      activities: string[];
    }) => {
      const next = await saveProfile(input);
      setUser(next);
      setOffline(false);
    },
    [],
  );

  const live = useMemo(
    () => isUserLive(user, new Date(nowTick)),
    [user, nowTick],
  );

  const value = useMemo(
    () => ({
      user,
      token,
      ready,
      live,
      offline,
      login,
      logout,
      refresh,
      updateProfile,
    }),
    [user, token, ready, live, offline, login, logout, refresh, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de AuthProvider");
  return ctx;
}
