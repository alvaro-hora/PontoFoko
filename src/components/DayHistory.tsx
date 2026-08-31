"use client";

import { useEffect, useMemo, useState } from "react";
import {
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth, useRoutine } from "@/components/providers";
import {
  formatStartDateLabel,
  isBeforeUserStart,
  isMetricsEnabled,
} from "@/lib/app/constants";
import {
  calculateDashboardMetrics,
  formatSignedDuration,
  nextWorkBlockStartSeconds,
  splitSessionTime,
} from "@/lib/metrics/calculate";
import {
  formatDuration,
  getRoutineForDay,
  getWorkBlocks,
  secondsToClock,
  toISODate,
} from "@/lib/routine/schedule";
import {
  fetchSessionsInRange,
  upsertDaySession,
} from "@/lib/supabase/sessions";
import type {
  DayOfWeek,
  PeriodMetrics,
  RoutineBlock,
  Session,
} from "@/types";
function monthValue(d: Date) {
  return format(d, "yyyy-MM");
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function metricsRefForDay(day: Date, todayIso: string): Date {
  const iso = toISODate(day);
  if (iso === todayIso) return new Date();
  return endOfDay(day);
}

function bestSessionForBlock(
  sessions: Session[],
  blockId: string,
): Session | undefined {
  const matches = sessions.filter(
    (s) =>
      s.block_id === blockId &&
      (s.status === "completed" || s.status === "in_progress"),
  );
  if (matches.length === 0) return undefined;
  return matches.reduce((best, cur) =>
    (cur.duration_seconds ?? 0) > (best.duration_seconds ?? 0) ? cur : best,
  );
}

function timeOnDay(isoDate: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map((n) => Number(n) || 0);
  const d = parseISO(`${isoDate}T12:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}

function hhmmFromIso(iso: string | null | undefined, fallback: string): string {
  if (!iso) return fallback;
  return format(new Date(iso), "HH:mm");
}

type DayRow = {
  iso: string;
  weekday: string;
  dateLabel: string;
  sessions: Session[];
  metrics: PeriodMetrics;
  isToday: boolean;
  completedCount: number;
  openCount: number;
  workCount: number;
};

type PunchEditTarget = {
  block: RoutineBlock;
  session: Session | null;
};

export function DayHistory() {
  const { user } = useAuth();
  const { weekly } = useRoutine();
  const currentMonth = monthValue(new Date());
  const minMonth = user?.start_date?.slice(0, 7) ?? currentMonth;
  const [month, setMonth] = useState(() => {
    const current = monthValue(new Date());
    return current < minMonth ? minMonth : current;
  });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ url: string; label: string } | null>(
    null,
  );

  useEffect(() => {
    const nextMin = user?.start_date?.slice(0, 7) ?? monthValue(new Date());
    setMonth((prev) => (prev < nextMin ? nextMin : prev));
  }, [user?.start_date]);

  const range = useMemo(() => {
    const base = parseISO(`${month}-01`);
    const from = startOfMonth(base);
    const to = endOfMonth(base);
    return {
      from: toISODate(from),
      to: toISODate(to),
      fromDate: from,
      toDate: to,
      label: capitalize(format(from, "MMMM 'de' yyyy", { locale: ptBR })),
    };
  }, [month]);

  async function reloadSessions(keepSelected = true) {
    if (!user) return;
    const data = await fetchSessionsInRange(
      user.id,
      range.from,
      range.to,
      user.start_date,
    );
    setSessions(data);
    if (!keepSelected) setSelectedDate(null);
  }

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchSessionsInRange(
          user!.id,
          range.from,
          range.to,
          user!.start_date,
        );
        if (cancelled) return;
        setSessions(data);
        setSelectedDate(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao carregar.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.start_date, range.from, range.to]);

  const countingLive = isMetricsEnabled(user);
  const waitingStart = Boolean(user?.start_date) && !countingLive;
  const startLabel = formatStartDateLabel(user?.start_date);

  const days = useMemo(() => {
    if (!user?.start_date) return [];

    const todayIso = toISODate(new Date());
    const allDays = eachDayOfInterval({
      start: range.fromDate,
      end: range.toDate > new Date() ? new Date() : range.toDate,
    }).reverse();

    return allDays
      .map((day) => {
        const iso = toISODate(day);
        if (isBeforeUserStart(iso, user.start_date)) return null;
        const daySessions = sessions.filter((s) => s.session_date === iso);
        const ref = metricsRefForDay(day, todayIso);
        const metrics = calculateDashboardMetrics(daySessions, ref, {
          startDate: user.start_date,
          metricsEnabled: countingLive,
          paused: Boolean(user.paused) && iso === todayIso,
        }).daily;
        const work = getWorkBlocks(
          getRoutineForDay(day.getDay() as DayOfWeek).blocks,
        );
        if (work.length === 0 && daySessions.length === 0) return null;

        const completedCount = daySessions.filter(
          (s) => s.status === "completed",
        ).length;
        const openCount = daySessions.filter(
          (s) => s.status === "in_progress",
        ).length;

        return {
          iso,
          weekday: capitalize(format(day, "EEEE", { locale: ptBR })),
          dateLabel: format(day, "d 'de' MMMM 'de' yyyy", { locale: ptBR }),
          sessions: daySessions,
          metrics,
          isToday: iso === todayIso,
          completedCount,
          openCount,
          workCount: work.length,
        } satisfies DayRow;
      })
      .filter(Boolean) as DayRow[];
  }, [range.fromDate, range.toDate, sessions, weekly, user, countingLive]);

  if (!user) {
    return <div className="dashboard-loading">Carregando…</div>;
  }

  if (!user.start_date) {
    return (
      <div className="ponto">
        <h1 className="page-title">Dias</h1>
        <p className="empty-move">Defina a data de início nos Ajustes</p>
      </div>
    );
  }

  const selected = days.find((d) => d.iso === selectedDate) ?? null;
  const maxMonth =
    monthValue(new Date()) < minMonth ? minMonth : monthValue(new Date());

  return (
    <div className="ponto">
      <div className="hist-head">
        <div>
          <h1 className="page-title" style={{ marginBottom: "0.25rem" }}>
            Dias
          </h1>
          <p className="period-caption">{range.label}</p>
        </div>
        <label className="month-filter">
          <span>Mês</span>
          <input
            type="month"
            value={month}
            min={minMonth}
            max={maxMonth}
            onChange={(e) => {
              const next = e.target.value;
              setMonth(next < minMonth ? minMonth : next);
            }}
          />
        </label>
      </div>

      {loading && <div className="dashboard-loading">Carregando…</div>}
      {error && <div className="inline-error">{error}</div>}

      {!loading && !error && waitingStart && (
        <p className="status-banner status-banner-wait" role="status">
          A rotina ainda não começou
          {startLabel ? ` — libera em ${startLabel}` : ""}. O histórico de dias
          começa nessa data.
        </p>
      )}

      {!loading && !error && days.length === 0 && !waitingStart && (
        <p className="empty-move">Nenhum dia com rotina neste mês.</p>
      )}

      {!loading && !error && days.length === 0 && waitingStart && (
        <p className="empty-move">Nada para listar até a data de início.</p>
      )}

      {!loading && !selected && (
        <ul className="day-list">
          {days.map((day) => (
            <li key={day.iso}>
              <button
                type="button"
                className="day-row"
                onClick={() => setSelectedDate(day.iso)}
              >
                <div className="day-row-text">
                  <strong>
                    {day.weekday}
                    {day.isToday ? " · hoje" : ""}
                  </strong>
                  <span className="day-date">{day.dateLabel}</span>
                  <span>
                    {day.openCount > 0 && day.completedCount === 0
                      ? "1 em andamento"
                      : day.openCount > 0
                        ? `${day.completedCount} registro(s) · ${day.openCount} em andamento`
                        : day.completedCount === 0
                          ? "Nenhum registro"
                          : day.completedCount === 1
                            ? "1 registro"
                            : `${day.completedCount} registros`}
                    {" · meta "}
                    {formatDuration(day.metrics.plannedSeconds)}
                  </span>
                </div>
                <div className="day-row-stats">
                  <div className="day-stat">
                    <em>Feito</em>
                    <strong className="mono">
                      {formatDuration(day.metrics.doneSeconds)}
                    </strong>
                  </div>
                  <div className="day-stat">
                    <em>Faltou</em>
                    <strong className="mono is-neg">
                      {formatDuration(day.metrics.missedSeconds)}
                    </strong>
                  </div>
                  <div className="day-stat">
                    <em>A mais</em>
                    <strong className="mono is-pos">
                      {formatDuration(day.metrics.overtimeSeconds)}
                    </strong>
                  </div>
                  <span className="chev">›</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <DayDetail
          day={selected}
          onBack={() => setSelectedDate(null)}
          onOpenPhoto={(url, label) => setPhoto({ url, label })}
          onSessionsChanged={async () => {
            try {
              await reloadSessions(true);
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Falha ao atualizar.",
              );
            }
          }}
        />
      )}

      {photo && (
        <div
          className="photo-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => setPhoto(null)}
        >
          <div
            className="photo-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="photo-modal-head">
              <strong>{photo.label}</strong>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPhoto(null)}
              >
                Fechar
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={photo.label} />
          </div>
        </div>
      )}
    </div>
  );
}

function DayDetail({
  day,
  onBack,
  onOpenPhoto,
  onSessionsChanged,
}: {
  day: DayRow;
  onBack: () => void;
  onOpenPhoto: (url: string, label: string) => void;
  onSessionsChanged: () => Promise<void>;
}) {
  const dayDate = parseISO(`${day.iso}T12:00:00`);
  const work = getWorkBlocks(
    getRoutineForDay(dayDate.getDay() as DayOfWeek).blocks,
  );
  const [editTarget, setEditTarget] = useState<PunchEditTarget | null>(null);

  const blockIds = new Set(work.map((b) => b.id));
  const orphanSessions = day.sessions
    .filter(
      (s) =>
        (s.status === "completed" || s.status === "in_progress") &&
        !blockIds.has(s.block_id),
    )
    .sort(
      (a, b) =>
        new Date(a.actual_start).getTime() - new Date(b.actual_start).getTime(),
    );

  const saldo =
    day.metrics.doneSeconds +
    day.metrics.overtimeSeconds -
    day.metrics.dueSeconds;

  return (
    <div className="day-detail">
      <button type="button" className="back-link" onClick={onBack}>
        ← Voltar
      </button>

      <header className="day-detail-head">
        <h2 className="page-title" style={{ marginBottom: "0.2rem" }}>
          {day.weekday}
        </h2>
        <p className="period-caption">{day.dateLabel}</p>
      </header>

      <section className="card">
        <h3 className="card-title">Resumo do dia</h3>
        <ul className="hours-list">
          <li>
            <span>Feito no horário</span>
            <strong className="mono">
              {formatDuration(day.metrics.doneSeconds)}
            </strong>
          </li>
          <li>
            <span>Feito a mais</span>
            <strong className="mono is-pos">
              {formatDuration(day.metrics.overtimeSeconds)}
            </strong>
          </li>
          <li>
            <span>Faltou</span>
            <strong className="mono is-neg">
              {formatDuration(day.metrics.missedSeconds)}
            </strong>
          </li>
          <li>
            <span>Meta do dia</span>
            <strong className="mono">
              {formatDuration(day.metrics.plannedSeconds)}
            </strong>
          </li>
          <li className="saldo-row">
            <span>Resultado</span>
            <strong className={`mono ${saldo < 0 ? "is-neg" : "is-pos"}`}>
              {formatSignedDuration(saldo)}
            </strong>
          </li>
        </ul>
      </section>

      {day.metrics.byActivity
        .filter((row) => row.plannedSeconds > 0 || row.doneSeconds > 0)
        .map((row) => {
          const rowSaldo =
            row.doneSeconds + row.overtimeSeconds - row.dueSeconds;
          return (
            <section key={row.activity} className="card activity-card">
              <h3 className="card-title">{row.activity}</h3>
              <ul className="hours-list">
                <li>
                  <span>Feito no horário</span>
                  <strong className="mono">
                    {formatDuration(row.doneSeconds)}
                  </strong>
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
                </li>
                <li>
                  <span>Meta</span>
                  <strong className="mono">
                    {formatDuration(row.plannedSeconds)}
                  </strong>
                </li>
                <li className="saldo-row">
                  <span>Resultado</span>
                  <strong
                    className={`mono ${rowSaldo < 0 ? "is-neg" : "is-pos"}`}
                  >
                    {formatSignedDuration(rowSaldo)}
                  </strong>
                </li>
              </ul>
            </section>
          );
        })}

      <section className="card">
        <h3 className="card-title">Pontos do dia</h3>
        <p className="period-caption" style={{ marginBottom: "0.75rem" }}>
          Ajuste horário ou marque como batido só neste dia.
        </p>
        {work.length === 0 && orphanSessions.length === 0 ? (
          <p className="empty-move">Nada para ajustar neste dia.</p>
        ) : (
          <ul className="session-history">
            {work.map((block) => {
              const session = bestSessionForBlock(day.sessions, block.id);
              return (
                <PunchRow
                  key={block.id}
                  dayDate={dayDate}
                  work={work}
                  block={block}
                  session={session ?? null}
                  onOpenPhoto={onOpenPhoto}
                  onEdit={() =>
                    setEditTarget({ block, session: session ?? null })
                  }
                />
              );
            })}
            {orphanSessions.map((session) => {
              const synthetic: RoutineBlock = {
                id: session.block_id,
                start: session.planned_start,
                end: session.planned_end,
                activity: session.activity_type,
                isBreak: false,
              };
              return (
                <PunchRow
                  key={session.id}
                  dayDate={dayDate}
                  work={work}
                  block={synthetic}
                  session={session}
                  orphan
                  onOpenPhoto={onOpenPhoto}
                  onEdit={() =>
                    setEditTarget({ block: synthetic, session })
                  }
                />
              );
            })}
          </ul>
        )}
      </section>

      {editTarget && (
        <PunchEditModal
          dayIso={day.iso}
          block={editTarget.block}
          session={editTarget.session}
          onClose={() => setEditTarget(null)}
          onSaved={async () => {
            setEditTarget(null);
            await onSessionsChanged();
          }}
        />
      )}
    </div>
  );
}

function PunchRow({
  dayDate,
  work,
  block,
  session,
  orphan = false,
  onOpenPhoto,
  onEdit,
}: {
  dayDate: Date;
  work: RoutineBlock[];
  block: RoutineBlock;
  session: Session | null;
  orphan?: boolean;
  onOpenPhoto: (url: string, label: string) => void;
  onEdit: () => void;
}) {
  const split =
    session?.actual_end != null
      ? splitSessionTime({
          day: dayDate,
          plannedStart: session.planned_start,
          plannedEnd: session.planned_end,
          actualStart: new Date(session.actual_start),
          actualEnd: new Date(session.actual_end),
          nextWorkStartSeconds: nextWorkBlockStartSeconds(work, block.id),
        })
      : null;

  const statusLabel = !session
    ? "Não batido"
    : session.status === "in_progress"
      ? "Em andamento"
      : session.source === "manual"
        ? "Batido (manual)"
        : session.source === "adjusted"
          ? "Batido (ajustado)"
          : "Batido";

  return (
    <li className="session-history-item">
      <div className="session-history-main">
        <strong>
          {block.activity}
          {orphan ? " · fora da rotina atual" : ""}
        </strong>
        <p className="mono">
          Previsto {block.start}–{block.end}
        </p>
        <p>
          <span
            className={`punch-status ${
              !session
                ? "is-miss"
                : session.status === "in_progress"
                  ? "is-open"
                  : "is-ok"
            }`}
          >
            {statusLabel}
          </span>
        </p>
        {session && (
          <>
            <p className="mono">
              Começou {format(new Date(session.actual_start), "HH:mm:ss")}
              {session.actual_end
                ? ` · terminou ${format(new Date(session.actual_end), "HH:mm:ss")}`
                : session.status === "in_progress"
                  ? " · ainda aberto"
                  : ""}
            </p>
            {split && (
              <p className="session-chips">
                <span>Feito {formatDuration(split.doneSeconds)}</span>
                {split.overtimeSeconds > 0 && (
                  <span className="is-pos">
                    A mais {formatDuration(split.overtimeSeconds)}
                  </span>
                )}
                {split.missedSeconds > 0 && (
                  <span className="is-neg">
                    Faltou {formatDuration(split.missedSeconds)}
                  </span>
                )}
                {session.duration_seconds != null && (
                  <span>
                    No cronômetro {secondsToClock(session.duration_seconds)}
                  </span>
                )}
              </p>
            )}
            {session.observation && (
              <p className="punch-note">Obs.: {session.observation}</p>
            )}
          </>
        )}
        <div className="punch-row-actions">
          <button type="button" className="btn btn-sm" onClick={onEdit}>
            {session ? "Ajustar" : "Marcar como batido"}
          </button>
        </div>
      </div>
      {session && (
        <div className="session-thumbs">
          {session.start_photo_url && (
            <button
              type="button"
              className="thumb-btn"
              onClick={() =>
                onOpenPhoto(
                  session.start_photo_url!,
                  `Começo · ${block.activity}`,
                )
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={session.start_photo_url} alt="Começo" />
              <span>Começo</span>
            </button>
          )}
          {session.end_photo_url && (
            <button
              type="button"
              className="thumb-btn"
              onClick={() =>
                onOpenPhoto(session.end_photo_url!, `Fim · ${block.activity}`)
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={session.end_photo_url} alt="Fim" />
              <span>Fim</span>
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function PunchEditModal({
  dayIso,
  block,
  session,
  onClose,
  onSaved,
}: {
  dayIso: string;
  block: RoutineBlock;
  session: Session | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [startTime, setStartTime] = useState(
    hhmmFromIso(session?.actual_start, block.start),
  );
  const [endTime, setEndTime] = useState(
    hhmmFromIso(session?.actual_end, block.end),
  );
  const [observation, setObservation] = useState(session?.observation ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const actualStart = timeOnDay(dayIso, startTime);
    const actualEnd = timeOnDay(dayIso, endTime);
    if (!(actualEnd > actualStart)) {
      setError("O fim precisa ser depois do começo.");
      return;
    }
    setSaving(true);
    try {
      await upsertDaySession({
        sessionId: session?.id ?? null,
        blockId: block.id,
        activityType: block.activity,
        plannedStart: block.start,
        plannedEnd: block.end,
        sessionDate: dayIso,
        actualStart,
        actualEnd,
        observation,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="photo-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="punch-edit-title"
      onClick={onClose}
    >
      <div
        className="photo-modal-card punch-edit-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="photo-modal-head">
          <strong id="punch-edit-title">
            {session ? "Ajustar ponto" : "Marcar como batido"}
          </strong>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="punch-edit-body">
          <p className="punch-edit-meta">
            <strong>{block.activity}</strong>
            <span className="mono">
              {dayIso} · previsto {block.start}–{block.end}
            </span>
          </p>

          <div className="punch-edit-grid">
            <label className="settings-field">
              Começo (neste dia)
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>
            <label className="settings-field">
              Fim (neste dia)
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </label>
          </div>

          <label className="settings-field">
            Observação
            <textarea
              rows={3}
              maxLength={500}
              placeholder="Ex.: esqueci de bater; horário real foi este"
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
            />
          </label>

          {error && <div className="inline-error">{error}</div>}

          <div className="settings-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
