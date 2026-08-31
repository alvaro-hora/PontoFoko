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
import { useAuth } from "./AuthProvider";
import type { DayRoutine } from "@/types";
import {
  BREAK_ACTIVITY,
  collectActivitiesFromRoutine,
  createEmptyWeeklyRoutine,
  normalizeActivities,
  normalizeWeeklyRoutine,
  setWeeklyRoutine,
} from "@/lib/routine/schedule";

type RoutineContextValue = {
  weekly: DayRoutine[];
  activities: string[];
  ready: boolean;
  saving: boolean;
  error: string | null;
  reload: () => Promise<void>;
  save: (routine: DayRoutine[], activities?: string[]) => Promise<void>;
  applyLocal: (
    routine: DayRoutine[],
    activities?: string[],
    commit?: boolean,
  ) => void;
};

const RoutineContext = createContext<RoutineContextValue | null>(null);

export function RoutineProvider({ children }: { children: ReactNode }) {
  const { user, ready: authReady, updateProfile } = useAuth();
  const [weekly, setWeekly] = useState<DayRoutine[]>(createEmptyWeeklyRoutine);
  const [activities, setActivities] = useState<string[]>([BREAK_ACTIVITY]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!authReady) return;
    if (!user) {
      setWeekly(createEmptyWeeklyRoutine());
      setActivities([BREAK_ACTIVITY]);
      setWeeklyRoutine(createEmptyWeeklyRoutine());
      setReady(true);
      return;
    }

    const loadedWeekly = normalizeWeeklyRoutine(
      Array.isArray(user.weekly_routine)
        ? (user.weekly_routine as DayRoutine[])
        : createEmptyWeeklyRoutine(),
    );
    const loadedActivities = normalizeActivities([
      ...(user.activities ?? []),
      ...collectActivitiesFromRoutine(loadedWeekly),
      BREAK_ACTIVITY,
    ]);
    setWeekly(loadedWeekly);
    setActivities(loadedActivities);
    setWeeklyRoutine(loadedWeekly);
    setError(null);
    setReady(true);
  }, [authReady, user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const applyLocal = useCallback(
    (
      routine: DayRoutine[],
      nextActivities?: string[],
      commit = false,
    ) => {
      if (!commit) return;
      const normalized = normalizeWeeklyRoutine(routine);
      setWeekly(normalized);
      if (nextActivities) setActivities(normalizeActivities(nextActivities));
      setWeeklyRoutine(normalized);
    },
    [],
  );

  const save = useCallback(
    async (routine: DayRoutine[], nextActivities?: string[]) => {
      if (!user) throw new Error("Entre na sua conta para salvar.");
      setSaving(true);
      setError(null);
      try {
        const acts = normalizeActivities([
          ...(nextActivities ?? activities),
          ...collectActivitiesFromRoutine(routine),
          BREAK_ACTIVITY,
        ]);
        const normalized = normalizeWeeklyRoutine(routine);
        await updateProfile({
          startDate: user.start_date,
          paused: user.paused,
          weeklyRoutine: normalized,
          activities: acts,
        });
        setWeekly(normalized);
        setActivities(acts);
        setWeeklyRoutine(normalized);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha ao salvar.");
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [user, activities, updateProfile],
  );

  const value = useMemo(
    () => ({
      weekly,
      activities,
      ready: ready && authReady,
      saving,
      error,
      reload,
      save,
      applyLocal,
    }),
    [weekly, activities, ready, authReady, saving, error, reload, save, applyLocal],
  );

  return (
    <RoutineContext.Provider value={value}>{children}</RoutineContext.Provider>
  );
}

export function useRoutine() {
  const ctx = useContext(RoutineContext);
  if (!ctx) {
    throw new Error("useRoutine precisa estar dentro de RoutineProvider");
  }
  return ctx;
}
