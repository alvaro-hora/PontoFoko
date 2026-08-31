import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import type {
  ActivityBreakdown,
  DashboardMetrics,
  DayOfWeek,
  MissedBlock,
  PeriodMetrics,
  RoutineBlock,
  Session,
} from "@/types";
import { isBeforeUserStart } from "@/lib/app/constants";
import {
  dateAtTime,
  getRoutineForDay,
  getWorkBlocks,
  timeToSeconds,
  toISODate,
} from "@/lib/routine/schedule";
import { daySeconds, elapsedSeconds } from "@/lib/time/exact";

function emptyMetrics(): PeriodMetrics {
  return {
    plannedSeconds: 0,
    dueSeconds: 0,
    doneSeconds: 0,
    overtimeSeconds: 0,
    balanceSeconds: 0,
    missedSeconds: 0,
    missedCount: 0,
    completedBlocks: 0,
    plannedBlocks: 0,
    byActivity: [],
    missedBlocks: [],
  };
}

function sessionsForDay(
  sessions: Session[],
  isoDate: string,
  now: Date,
): Session[] {
  return sessions
    .filter((s) => s.session_date === isoDate)
    .filter((s) => s.status === "completed" || s.status === "in_progress")
    .map((s) => {
      if (s.status !== "in_progress") return s;
      return {
        ...s,
        actual_end: now.toISOString(),
        duration_seconds: Math.max(
          0,
          Math.floor(
            (now.getTime() - new Date(s.actual_start).getTime()) / 1000,
          ),
        ),
        status: "completed" as const,
      };
    });
}

function sessionsOnDate(sessions: Session[], isoDate: string): Session[] {
  return sessions.filter(
    (s) => s.session_date === isoDate && s.status === "completed",
  );
}

function bestSessionForBlock(
  sessions: Session[],
  blockId: string,
): Session | undefined {
  const matches = sessions.filter((s) => s.block_id === blockId);
  if (matches.length === 0) return undefined;
  return matches.reduce((best, cur) =>
    (cur.duration_seconds ?? 0) > (best.duration_seconds ?? 0) ? cur : best,
  );
}

/** Próximo bloco de trabalho após o atual (segundos desde meia-noite). */
export function nextWorkBlockStartSeconds(
  workBlocks: RoutineBlock[],
  currentBlockId: string,
): number {
  const idx = workBlocks.findIndex((b) => b.id === currentBlockId);
  if (idx >= 0 && idx < workBlocks.length - 1) {
    return timeToSeconds(workBlocks[idx + 1].start);
  }
  return 24 * 3600;
}

/**
 * done = sobreposição com a janela prevista.
 * overtime = após o fim previsto, até o próximo bloco.
 */
export function splitSessionTime(params: {
  day: Date;
  plannedStart: string;
  plannedEnd: string;
  actualStart: Date;
  actualEnd: Date;
  nextWorkStartSeconds: number;
}): { doneSeconds: number; overtimeSeconds: number; missedSeconds: number } {
  const plannedStartSec = timeToSeconds(params.plannedStart);
  const plannedEndSec = timeToSeconds(params.plannedEnd);
  const plannedDur = plannedEndSec - plannedStartSec;

  const startMs = params.actualStart.getTime();
  const endMs = params.actualEnd.getTime();
  if (endMs <= startMs) {
    return { doneSeconds: 0, overtimeSeconds: 0, missedSeconds: plannedDur };
  }

  const dayStart = new Date(params.day);
  dayStart.setHours(0, 0, 0, 0);

  const plannedStartMs = dateAtTime(params.day, params.plannedStart).getTime();
  const plannedEndMs = dateAtTime(params.day, params.plannedEnd).getTime();
  const nextCapMs =
    dayStart.getTime() + params.nextWorkStartSeconds * 1000;

  const doneStart = Math.max(startMs, plannedStartMs);
  const doneEnd = Math.min(endMs, plannedEndMs);
  const doneSeconds = Math.max(0, Math.floor((doneEnd - doneStart) / 1000));

  const otStart = Math.max(startMs, plannedEndMs);
  const otEnd = Math.min(endMs, nextCapMs);
  const overtimeSeconds = Math.max(0, Math.floor((otEnd - otStart) / 1000));

  const missedSeconds = Math.max(0, plannedDur - doneSeconds);

  return { doneSeconds, overtimeSeconds, missedSeconds };
}

function computePeriod(
  days: Date[],
  sessions: Session[],
  now: Date,
  startDate: string | null,
  countingEnabled: boolean,
  paused: boolean,
): PeriodMetrics {
  if (days.length === 0) return emptyMetrics();

  const todayIso = toISODate(now);
  const nowExact = daySeconds(now);

  let plannedSeconds = 0;
  let dueSeconds = 0;
  let doneSeconds = 0;
  let overtimeSeconds = 0;
  let missedSeconds = 0;
  let missedCount = 0;
  let completedBlocks = 0;
  let plannedBlocks = 0;
  const missedBlocks: MissedBlock[] = [];
  const activityMap = new Map<
    string,
    {
      planned: number;
      due: number;
      done: number;
      missed: number;
      overtime: number;
    }
  >();

  function bump(
    activity: string,
    patch: Partial<{
      planned: number;
      due: number;
      done: number;
      missed: number;
      overtime: number;
    }>,
  ) {
    const cur = activityMap.get(activity) ?? {
      planned: 0,
      due: 0,
      done: 0,
      missed: 0,
      overtime: 0,
    };
    activityMap.set(activity, {
      planned: cur.planned + (patch.planned ?? 0),
      due: cur.due + (patch.due ?? 0),
      done: cur.done + (patch.done ?? 0),
      missed: cur.missed + (patch.missed ?? 0),
      overtime: cur.overtime + (patch.overtime ?? 0),
    });
  }

  for (const day of days) {
    const iso = toISODate(day);
    const work = getWorkBlocks(
      getRoutineForDay(day.getDay() as DayOfWeek).blocks,
    );
    const daySessions = sessionsForDay(sessions, iso, now);
    const beforeStart = isBeforeUserStart(iso, startDate);

    if (work.length === 0) {
      if (
        countingEnabled &&
        !beforeStart &&
        iso <= todayIso &&
        daySessions.length > 0
      ) {
        for (const session of daySessions) {
          if (!session.actual_end) continue;
          completedBlocks += 1;
          const startSec = timeToSeconds(session.planned_start);
          const endSec = timeToSeconds(session.planned_end);
          const nextCap = 24 * 3600;
          const split = splitSessionTime({
            day,
            plannedStart: session.planned_start,
            plannedEnd: session.planned_end,
            actualStart: new Date(session.actual_start),
            actualEnd: new Date(session.actual_end),
            nextWorkStartSeconds: nextCap,
          });
          const plannedDur = Math.max(0, endSec - startSec);
          plannedBlocks += 1;
          plannedSeconds += plannedDur;
          dueSeconds += plannedDur;
          doneSeconds += split.doneSeconds;
          overtimeSeconds += split.overtimeSeconds;
          missedSeconds += split.missedSeconds;
          bump(session.activity_type, {
            planned: plannedDur,
            due: plannedDur,
            done: split.doneSeconds,
            missed: split.missedSeconds,
            overtime: split.overtimeSeconds,
          });
        }
      }
      continue;
    }

    if (!countingEnabled) {
      for (const block of work) {
        const blockDuration =
          timeToSeconds(block.end) - timeToSeconds(block.start);
        plannedBlocks += 1;
        plannedSeconds += blockDuration;
        bump(block.activity, { planned: blockDuration });
      }
      continue;
    }

    if (beforeStart) continue;

    if (iso > todayIso) continue;

    const isToday = iso === todayIso;

    for (const block of work) {
      const blockStart = timeToSeconds(block.start);
      const blockEnd = timeToSeconds(block.end);
      const blockDuration = blockEnd - blockStart;
      const isFuture = isToday && nowExact < blockStart;
      const blockStillOpen = isToday && nowExact < blockEnd;
      const owedDuration = isFuture
        ? 0
        : blockStillOpen
          ? elapsedSeconds(dateAtTime(day, block.start), now)
          : blockDuration;

      plannedBlocks += 1;
      plannedSeconds += blockDuration;
      bump(block.activity, { planned: blockDuration });

      if (isFuture) continue;

      dueSeconds += owedDuration;
      bump(block.activity, { due: owedDuration });

      if (paused && isToday && blockStillOpen) {
        const session = bestSessionForBlock(daySessions, block.id);
        const nextStart = nextWorkBlockStartSeconds(work, block.id);
        if (session?.actual_end) {
          completedBlocks += 1;
          const split = splitSessionTime({
            day,
            plannedStart: session.planned_start,
            plannedEnd: session.planned_end,
            actualStart: new Date(session.actual_start),
            actualEnd: new Date(session.actual_end),
            nextWorkStartSeconds: nextStart,
          });
          doneSeconds += split.doneSeconds;
          overtimeSeconds += split.overtimeSeconds;
          bump(block.activity, {
            done: split.doneSeconds,
            overtime: split.overtimeSeconds,
          });
        }
        continue;
      }

      const session = bestSessionForBlock(daySessions, block.id);
      const nextStart = nextWorkBlockStartSeconds(work, block.id);

      if (session?.actual_end) {
        completedBlocks += 1;
        const split = splitSessionTime({
          day,
          plannedStart: session.planned_start,
          plannedEnd: session.planned_end,
          actualStart: new Date(session.actual_start),
          actualEnd: new Date(session.actual_end),
          nextWorkStartSeconds: nextStart,
        });

        let missedForBlock: number;
        if (blockStillOpen) {
          const actualEndMs = new Date(session.actual_end).getTime();
          const coversNow = actualEndMs >= now.getTime() - 250;
          if (coversNow) {
            const plannedStartMs = dateAtTime(day, block.start).getTime();
            const startMs = Math.max(
              new Date(session.actual_start).getTime(),
              plannedStartMs,
            );
            const lateSeconds = Math.max(
              0,
              Math.floor((startMs - plannedStartMs) / 1000),
            );
            missedForBlock = Math.min(owedDuration, lateSeconds);
          } else {
            missedForBlock = Math.max(0, owedDuration - split.doneSeconds);
          }
        } else {
          missedForBlock = split.missedSeconds;
        }

        doneSeconds += split.doneSeconds;
        overtimeSeconds += split.overtimeSeconds;
        missedSeconds += missedForBlock;
        bump(block.activity, {
          done: split.doneSeconds,
          missed: missedForBlock,
          overtime: split.overtimeSeconds,
        });
      } else if (!blockStillOpen) {
        missedCount += 1;
        missedSeconds += blockDuration;
        bump(block.activity, { missed: blockDuration });
        missedBlocks.push({
          blockId: block.id,
          activity: block.activity,
          plannedStart: block.start,
          plannedEnd: block.end,
          plannedSeconds: blockDuration,
          date: iso,
        });
      } else {
        missedSeconds += owedDuration;
        bump(block.activity, { missed: owedDuration });
      }
    }
  }

  const byActivity: ActivityBreakdown[] = [...activityMap.entries()]
    .map(([activity, v]) => ({
      activity,
      plannedSeconds: v.planned,
      dueSeconds: v.due,
      doneSeconds: v.done,
      missedSeconds: v.missed,
      overtimeSeconds: v.overtime,
    }))
    .filter(
      (row) =>
        row.plannedSeconds > 0 ||
        row.doneSeconds > 0 ||
        row.missedSeconds > 0 ||
        row.overtimeSeconds > 0,
    )
    .sort((a, b) => a.activity.localeCompare(b.activity, "pt-BR"));

  return {
    plannedSeconds,
    dueSeconds,
    doneSeconds,
    overtimeSeconds,
    balanceSeconds: doneSeconds + overtimeSeconds - dueSeconds,
    missedSeconds,
    missedCount,
    completedBlocks,
    plannedBlocks,
    byActivity,
    missedBlocks,
  };
}

export function calculateDashboardMetrics(
  sessions: Session[],
  now = new Date(),
  options?: {
    startDate?: string | null;
    metricsEnabled?: boolean;
    paused?: boolean;
  },
): DashboardMetrics {
  const startDate = options?.startDate ?? null;
  const countingEnabled = options?.metricsEnabled ?? false;
  const paused = options?.paused ?? false;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  return {
    daily: computePeriod(
      [dayStart],
      sessions,
      now,
      startDate,
      countingEnabled,
      paused,
    ),
    weekly: computePeriod(
      eachDayOfInterval({ start: weekStart, end: weekEnd }),
      sessions,
      now,
      startDate,
      countingEnabled,
      paused,
    ),
    monthly: computePeriod(
      eachDayOfInterval({ start: monthStart, end: monthEnd }),
      sessions,
      now,
      startDate,
      countingEnabled,
      paused,
    ),
    todaySessions: sessionsOnDate(sessions, toISODate(now)),
  };
}

export function formatPeriodLabel(now = new Date()): {
  day: string;
  week: string;
  month: string;
} {
  return {
    day: format(now, "EEEE, d MMM", { locale: ptBR }),
    week: `${format(startOfWeek(now, { weekStartsOn: 1 }), "d MMM", { locale: ptBR })} – ${format(endOfWeek(now, { weekStartsOn: 1 }), "d MMM", { locale: ptBR })}`,
    month: format(now, "MMMM yyyy", { locale: ptBR }),
  };
}

export function formatSignedDuration(totalSeconds: number): string {
  const abs = Math.abs(Math.floor(totalSeconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const body =
    h > 0
      ? `${h}h ${String(m).padStart(2, "0")}min ${String(s).padStart(2, "0")}s`
      : `${m}min ${String(s).padStart(2, "0")}s`;
  if (totalSeconds < 0) return `−${body}`;
  if (totalSeconds > 0) return `+${body}`;
  return body;
}
