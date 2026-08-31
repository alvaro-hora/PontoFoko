import type { DayRoutine } from "@/types";
import type { AppUser } from "@/lib/app/constants";
import { getSupabase } from "@/lib/supabase/client";

const TOKEN_KEY = "pontofoko.auth.token.v1";

export type LoginResult =
  | { ok: true; token: string; user: AppUser }
  | { ok: false; error: string };

function mapUser(raw: Record<string, unknown>): AppUser {
  return {
    id: String(raw.id),
    username: String(raw.username),
    display_name: String(raw.display_name),
    start_date: (raw.start_date as string | null) ?? null,
    paused: Boolean(raw.paused),
    weekly_routine: raw.weekly_routine,
    activities: Array.isArray(raw.activities)
      ? (raw.activities as string[])
      : ["Descanso"],
  };
}

export function readAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function writeAuthToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (!token) window.localStorage.removeItem(TOKEN_KEY);
  else window.localStorage.setItem(TOKEN_KEY, token);
}

export async function login(
  username: string,
  password: string,
): Promise<LoginResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("app_login", {
    p_username: username,
    p_password: password,
  });
  if (error) return { ok: false, error: error.message };
  const payload = data as {
    ok?: boolean;
    error?: string;
    token?: string;
    user?: Record<string, unknown>;
  };
  if (!payload?.ok || !payload.token || !payload.user) {
    return { ok: false, error: payload?.error ?? "Falha no login." };
  }
  writeAuthToken(payload.token);
  return { ok: true, token: payload.token, user: mapUser(payload.user) };
}

export async function logout(): Promise<void> {
  const token = readAuthToken();
  writeAuthToken(null);
  if (!token) return;
  try {
    const supabase = getSupabase();
    await supabase.rpc("app_logout", { p_token: token });
  } catch {
    // ignore
  }
}

export async function fetchProfile(
  token = readAuthToken(),
): Promise<AppUser | null> {
  if (!token) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("app_get_profile", {
    p_token: token,
  });
  // Erro de rede / API: não apaga o token
  if (error) throw error;
  const payload = data as {
    ok?: boolean;
    error?: string;
    user?: Record<string, unknown>;
  };
  if (!payload?.ok || !payload.user) {
    writeAuthToken(null);
    return null;
  }
  return mapUser(payload.user);
}

export async function saveProfile(input: {
  startDate: string | null;
  paused: boolean;
  weeklyRoutine: DayRoutine[];
  activities: string[];
}): Promise<AppUser> {
  const token = readAuthToken();
  if (!token) throw new Error("Sessão expirada. Entre de novo.");
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("app_save_profile", {
    p_token: token,
    p_start_date: input.startDate,
    p_paused: input.paused,
    p_weekly_routine: input.weeklyRoutine,
    p_activities: input.activities,
  });
  if (error) throw error;
  const payload = data as {
    ok?: boolean;
    error?: string;
    user?: Record<string, unknown>;
  };
  if (!payload?.ok || !payload.user) {
    throw new Error(payload?.error ?? "Não deu para salvar.");
  }
  return mapUser(payload.user);
}
