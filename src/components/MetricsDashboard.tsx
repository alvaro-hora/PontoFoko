"use client";

import { useEffect, useMemo, useState } from "react";
import { format, startOfMonth, subMonths } from "date-fns";
import { useAuth, useRoutine } from "@/components/providers";
import { useExactNow } from "@/hooks/useExactNow";
import {
  calculateDashboardMetrics,
  formatPeriodLabel,
  formatSignedDuration,
  nextWorkBlockStartSeconds,
  splitSessionTime,
} from "@/lib/metrics/calculate";
import {
  formatDuration,
  getRoutineForDay,
  getWorkBlocks,
  secondsToClock,
  timeToSeconds,
  toISODate,
} from "@/lib/routine/schedule";
import { formatStartDateLabel, isMetricsEnabled } from "@/lib/app/constants";
import { fetchSessions } from "@/lib/supabase/sessions";
import { exactDaySeconds } from "@/lib/time/exact";
import type { ActivityBreakdown, DayOfWeek, Session } from "@/types";

type PeriodKey = "daily" | "weekly" | "monthly";

export function MetricsDashboard() {
  const now = useExactNow("second");
  const { user } = useAuth();
  const { weekly } = useRoutine();
  const metricsOn = isMetricsEnabled(user, now);
  const startLabel = formatStartDateLabel(user?.start_date);
  const waitingStart = Boolean(user?.start_date) && !metricsOn;
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodKey>("daily");
  const labels = formatPeriodLabel(now);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const from = format(subMonths(startOfMonth(new Date()), 1), "yyyy-MM-dd");
        const data = await fetchSessions(user!.id, from, user!.start_date);
        if (cancelled) return;
        setSessions(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao carregar.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [user?.id, user?.start_date]);

  const metrics = useMemo(
    () =>
      calculateDashboardMetrics(sessions, now, {
        startDate: user?.start_date ?? null,
        metricsEnabled: metricsOn,
        paused: Boolean(user?.paused),
      }),
    [sessions, now, weekly, user?.start_date, user?.paused, metricsOn],
  );

  const todayIso = toISODate(now);
  const todaySessions = useMemo(
    () => sessions.filter((s) => s.session_date === todayIso),
    [sessions, todayIso],
  );

  const workBlocks = useMemo(
    () => getWorkBlocks(getRoutineForDay(now.getDay() as DayOfWeek).blocks),
    [now, weekly],
  );

  if (!user) return <div className="dashboard-loading">Carregando…</div>;

  // Sem data de início: não precisa esperar sessões
  if (!user.start_date) {
    return (
      <div className="ponto">
        <h1 className="page-title">Pontualidade</h1>
        <p className="status-banner status-banner-wait" role="status">
          Defina a data de início nos Ajustes para começar a contar.
        </p>
        <p className="empty-move">
          Sem data de início a pontualidade ainda não conta.
        </p>
      </div>
    );
  }

  if (loading) return <div className="dashboard-loading">Carregando…</div>;
  if (error) {
    return <div className="inline-error">{error}</div>;
  }

  const current = metrics[period];
  const periodLabel =
    period === "daily"
      ? labels.day
      : period === "weekly"
        ? labels.week
        : labels.month;

  return (
    <div className="ponto">
      <h1 className="page-title">Pontualidade</h1>

      {waitingStart && (
        <p className="status-banner status-banner-wait" role="status">
          A rotina ainda não começou
          {startLabel ? ` — libera em ${startLabel}` : ""}. Até lá só aparece o
          planejado, sem falta nem saldo.
        </p>
      )}

      {user.paused && metricsOn && (
        <p className="status-banner status-banner-paused" role="status">
          Rotina pausada — ponto bloqueado; o histórico já feito permanece.
        </p>
      )}

      <div className="period-tabs" role="tablist" aria-label="Período">
        {(
          [
            ["daily", "Hoje"],
            ["weekly", "Semana"],
            ["monthly", "Mês"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={period === key}
            className={period === key ? "period-tab is-active" : "period-tab"}
            onClick={() => setPeriod(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="period-caption">{periodLabel}</p>

      {period === "daily" && (
        <TodaySchedule
          now={now}
          workBlocks={workBlocks}
          todaySessions={todaySessions}
          counting={metricsOn}
          preview={!metricsOn}
          paused={Boolean(user.paused)}
        />
      )}

      {current.byActivity.length === 0 ? (
        <p className="empty-move">
          Sem horários planejados neste período. Monte a rotina em Ajustes.
        </p>
      ) : (
        current.byActivity.map((row) => (
          <ActivityCard key={row.activity} row={row} preview={!metricsOn} />
        ))
      )}
    </div>
  );
}

function TodaySchedule({
  now,
  workBlocks,
  todaySessions,
  counting,
  preview,
  paused,
}: {
  now: Date;
  workBlocks: ReturnType<typeof getWorkBlocks>;
  todaySessions: Session[];
  counting: boolean;
  preview: boolean;
  paused: boolean;
}) {
  const nowExact = exactDaySeconds(now);
  const activeSession =
    todaySessions.find((s) => s.status === "in_progress") ?? null;

  return (
    <section className="card">
      <h2 className="card-title">Seus horários de hoje</h2>
      {workBlocks.length === 0 ? (
        <p className="empty-move">Nenhum horário planejado para hoje.</p>
      ) : (
        <ul className="block-rows">
          {workBlocks.map((block) => {
            if (preview) {
              return (
                <li key={block.id}>
                  <span className="mono">
                    {block.start}–{block.end}
                  </span>
                  <span>{block.activity}</span>
                  <strong className="mono">—</strong>
                </li>
              );
            }

            const active = activeSession?.block_id === block.id;
            const completed = todaySessions.find(
              (s) => s.block_id === block.id && s.status === "completed",
            );
            const planned =
              timeToSeconds(block.end) - timeToSeconds(block.start);
            const started = nowExact >= timeToSeconds(block.start);
            const ended = nowExact >= timeToSeconds(block.end);
            const stillOpen = started && !ended;

            let right = "—";
            let cls = "";

            if (active || completed?.actual_end) {
              const source = active ? activeSession! : completed!;
              const endAt = active ? now : new Date(completed!.actual_end!);
              const split = splitSessionTime({
                day: now,
                plannedStart: source.planned_start,
                plannedEnd: source.planned_end,
                actualStart: new Date(source.actual_start),
                actualEnd: endAt,
                nextWorkStartSeconds: nextWorkBlockStartSeconds(
                  workBlocks,
                  block.id,
                ),
              });

              if (active) {
                right = secondsToClock(
                  split.doneSeconds + split.overtimeSeconds,
                );
                cls = "is-now";
              } else if (split.missedSeconds > 0) {
                right = formatSignedDuration(-split.missedSeconds);
                cls = "is-neg";
              } else if (split.overtimeSeconds > 0) {
                right = `+${formatDuration(split.overtimeSeconds)}`;
                cls = "is-pos";
              } else {
                right = formatDuration(split.doneSeconds);
                cls = "is-ok";
              }
            } else if (!started) {
              right = "—";
            } else if (ended && counting) {
              // Falta já ocorrida permanece mesmo se pausar depois
              right = formatSignedDuration(-planned);
              cls = "is-neg";
            } else if (stillOpen && paused) {
              right = "—";
            } else if (stillOpen && counting) {
              right = "—";
            }

            return (
              <li key={block.id} className={cls}>
                <span className="mono">
                  {block.start}–{block.end}
                </span>
                <span>{block.activity}</span>
                <strong className="mono">{right}</strong>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ActivityCard({
  row,
  preview = false,
}: {
  row: ActivityBreakdown;
  preview?: boolean;
}) {
  const saldo =
    row.doneSeconds + row.overtimeSeconds - row.dueSeconds;

  if (preview) {
    return (
      <section className="card activity-card">
        <h2 className="card-title">{row.activity}</h2>
        <ul className="hours-list">
          <li className="saldo-row">
            <span>Planejado no período</span>
            <strong className="mono">
              {formatDuration(row.plannedSeconds)}
            </strong>
          </li>
        </ul>
      </section>
    );
  }

  return (
    <section className="card activity-card">
      <h2 className="card-title">{row.activity}</h2>

      <ul className="hours-list">
        <li>
          <span>Feito no horário</span>
          <strong className="mono">{formatDuration(row.doneSeconds)}</strong>
        </li>
        <li>
          <span>Feito a mais</span>
          <strong className="mono is-pos">
            {formatDuration(row.overtimeSeconds)}
          </strong>
        </li>
        <li>
          <span>Faltou</span>
          <strong className="mono is-neg">
            {formatDuration(row.missedSeconds)}
          </strong>
          {row.missedSeconds > 0 && (
            <div className="miss-bar" aria-hidden>
              <span
                style={{
                  width: `${
                    row.dueSeconds > 0
                      ? Math.min(
                          100,
                          (row.missedSeconds / row.dueSeconds) * 100,
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
          )}
        </li>
        <li className="saldo-row">
          <span>Resultado</span>
          <strong className={`mono ${saldo < 0 ? "is-neg" : "is-pos"}`}>
            {formatSignedDuration(saldo)}
          </strong>
        </li>
      </ul>

      <p className="activity-foot mono">
        Meta do período: {formatDuration(row.plannedSeconds)}
      </p>
    </section>
  );
}
