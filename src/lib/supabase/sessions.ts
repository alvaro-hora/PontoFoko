import type { Session } from "@/types";
import { clampFromUserStart } from "@/lib/app/constants";
import { readAuthToken } from "@/lib/auth/account";
import { getSupabase } from "./client";

function requireToken(): string {
  const token = readAuthToken();
  if (!token) throw new Error("Sessão expirada. Entre de novo.");
  return token;
}

function asSession(raw: unknown): Session {
  return raw as Session;
}

export type StartSessionInput = {
  userId: string;
  blockId: string;
  activityType: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart: Date;
  startPhotoUrl: string | null;
  lateSeconds: number;
  earlySeconds: number;
  sessionDate: string;
};

export type EndSessionInput = {
  sessionId: string;
  userId: string;
  actualEnd: Date;
  endPhotoUrl: string | null;
  durationSeconds: number;
};

export async function fetchSessions(
  _userId: string,
  fromDate: string,
  startDate: string | null,
): Promise<Session[]> {
  const token = requireToken();
  const from = clampFromUserStart(fromDate, startDate);
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("app_fetch_sessions", {
    p_token: token,
    p_from: from,
    p_to: null,
  });
  if (error) throw error;
  const payload = data as { ok?: boolean; error?: string; sessions?: Session[] };
  if (!payload?.ok) throw new Error(payload?.error ?? "Falha ao carregar.");
  return (payload.sessions ?? []) as Session[];
}

export async function fetchSessionsInRange(
  _userId: string,
  fromDate: string,
  toDate: string,
  startDate: string | null,
): Promise<Session[]> {
  if (startDate && toDate < startDate) return [];
  const token = requireToken();
  const from = clampFromUserStart(fromDate, startDate);
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("app_fetch_sessions", {
    p_token: token,
    p_from: from,
    p_to: toDate,
  });
  if (error) throw error;
  const payload = data as { ok?: boolean; error?: string; sessions?: Session[] };
  if (!payload?.ok) throw new Error(payload?.error ?? "Falha ao carregar.");
  return (payload.sessions ?? []) as Session[];
}

export async function fetchActiveSession(
  _userId: string,
  _startDate: string | null,
): Promise<Session | null> {
  const token = requireToken();
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("app_fetch_active", {
    p_token: token,
  });
  if (error) throw error;
  const payload = data as {
    ok?: boolean;
    error?: string;
    session?: Session | null;
  };
  if (!payload?.ok) throw new Error(payload?.error ?? "Falha ao carregar.");
  return payload.session ? asSession(payload.session) : null;
}

export async function startSession(
  input: StartSessionInput,
): Promise<Session> {
  const token = requireToken();
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("app_start_session", {
    p_token: token,
    p_block_id: input.blockId,
    p_activity_type: input.activityType,
    p_planned_start: input.plannedStart,
    p_planned_end: input.plannedEnd,
    p_actual_start: input.actualStart.toISOString(),
    p_start_photo_url: input.startPhotoUrl,
    p_late_seconds: input.lateSeconds,
    p_early_seconds: input.earlySeconds,
    p_session_date: input.sessionDate,
  });
  if (error) throw error;
  const payload = data as {
    ok?: boolean;
    error?: string;
    session?: Session;
  };
  if (!payload?.ok || !payload.session) {
    throw new Error(payload?.error ?? "Não deu para começar.");
  }
  return asSession(payload.session);
}

export async function endSession(input: EndSessionInput): Promise<Session> {
  const token = requireToken();
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("app_end_session", {
    p_token: token,
    p_session_id: input.sessionId,
    p_actual_end: input.actualEnd.toISOString(),
    p_end_photo_url: input.endPhotoUrl,
    p_duration_seconds: input.durationSeconds,
  });
  if (error) throw error;
  const payload = data as {
    ok?: boolean;
    error?: string;
    session?: Session;
  };
  if (!payload?.ok || !payload.session) {
    throw new Error(payload?.error ?? "Não deu para encerrar.");
  }
  return asSession(payload.session);
}

export async function renameUserActivity(
  _userId: string,
  fromName: string,
  toName: string,
): Promise<number> {
  const token = requireToken();
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("app_rename_activity", {
    p_token: token,
    p_from: fromName,
    p_to: toName,
  });
  if (error) throw error;
  const payload = data as { ok?: boolean; error?: string; updated?: number };
  if (!payload?.ok) throw new Error(payload?.error ?? "Falha ao renomear.");
  return payload.updated ?? 0;
}

export type UpsertDaySessionInput = {
  sessionId?: string | null;
  blockId: string;
  activityType: string;
  plannedStart: string;
  plannedEnd: string;
  sessionDate: string;
  actualStart: Date;
  actualEnd: Date;
  observation?: string | null;
};

/** Cria ou corrige um registro de ponto em um dia específico. */
export async function upsertDaySession(
  input: UpsertDaySessionInput,
): Promise<Session> {
  const token = requireToken();
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("app_upsert_day_session", {
    p_token: token,
    p_session_id: input.sessionId ?? null,
    p_block_id: input.blockId,
    p_activity_type: input.activityType,
    p_planned_start: input.plannedStart,
    p_planned_end: input.plannedEnd,
    p_session_date: input.sessionDate,
    p_actual_start: input.actualStart.toISOString(),
    p_actual_end: input.actualEnd.toISOString(),
    p_observation: input.observation ?? null,
  });
  if (error) throw error;
  const payload = data as {
    ok?: boolean;
    error?: string;
    session?: Session;
  };
  if (!payload?.ok || !payload.session) {
    throw new Error(payload?.error ?? "Não deu para salvar o ajuste.");
  }
  return asSession(payload.session);
}

export async function uploadSessionPhoto(
  userId: string,
  blob: Blob,
  path: string,
): Promise<string> {
  requireToken();
  const supabase = getSupabase();
  const fullPath = `${userId}/${path}`;
  const { error } = await supabase.storage
    .from("session-photos")
    .upload(fullPath, blob, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from("session-photos")
    .getPublicUrl(fullPath);
  return data.publicUrl;
}
