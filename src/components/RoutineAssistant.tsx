"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth, useRoutine } from "@/components/providers";
import { LiveCamera, type LiveCameraHandle } from "@/components/LiveCamera";
import { useExactNow } from "@/hooks/useExactNow";
import { isMetricsEnabled } from "@/lib/app/constants";
import {
  calculateDashboardMetrics,
  nextWorkBlockStartSeconds,
  splitSessionTime,
} from "@/lib/metrics/calculate";
import { getRoutineSnapshot } from "@/lib/routine/engine";
import {
  dateAtTime,
  formatDuration,
  getRoutineForDay,
  getWorkBlocks,
  secondsToClock,
  timeToSeconds,
  toISODate,
} from "@/lib/routine/schedule";
import {
  getWorkBlockAt,
} from "@/lib/routine/transitions";
import { elapsedSeconds, exactDaySeconds, signedElapsedSeconds } from "@/lib/time/exact";
import { notify, requestNotificationPermission } from "@/lib/notifications";
import {
  endSession,
  fetchActiveSession,
  fetchSessions,
  startSession,
  uploadSessionPhoto,
} from "@/lib/supabase/sessions";
import type { DayOfWeek, Session } from "@/types";

function formatLastPunch(session: Session | null): string {
  if (!session) return "Ainda não registrou nada hoje";
  const when = new Date(session.actual_end ?? session.actual_start);
  const verb = session.actual_end ? "terminou" : "começou";
  return `${session.activity_type} — ${verb} ${format(when, "dd/MM 'às' HH:mm:ss", { locale: ptBR })}`;
}

function startActionLabel(activity: string): string {
  return `Começar ${activity}`;
}

function endActionLabel(activity: string): string {
  return `Terminar ${activity}`;
}

function shortActivity(activity: string): string {
  return activity;
}

function notLiveLabel(user: {
  paused: boolean;
  start_date: string | null;
}): string {
  if (user.paused) return "Rotina pausada";
  if (!user.start_date) return "Defina a data de início nos Ajustes";
  const [y, m, d] = user.start_date.split("-");
  return `Libera em ${d}/${m}/${y}`;
}

export function RoutineAssistant() {
  const cameraRef = useRef<LiveCameraHandle>(null);
  const now = useExactNow("live");
  const { user, live } = useAuth();
  const { weekly } = useRoutine();
  const metricsOn = isMetricsEnabled(user, now);
  const snapshot = useMemo(() => getRoutineSnapshot(now), [now, weekly]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [todaySessions, setTodaySessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const warnedOneMin = useRef(false);
  const warnedEnd = useRef(false);
  const lastBreakId = useRef<string | null>(null);
  const transitionLock = useRef(false);
  const lastRolledBlockId = useRef<string | null>(null);

  useEffect(() => {
    void requestNotificationPermission();
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const from = format(startOfMonth(new Date()), "yyyy-MM-dd");
        const [active, sessions] = await Promise.all([
          fetchActiveSession(user!.id, user!.start_date),
          fetchSessions(user!.id, from, user!.start_date),
        ]);
        if (cancelled) return;
        setActiveSession(active);
        const today = toISODate(new Date());
        setTodaySessions(sessions.filter((s) => s.session_date === today));
      } catch (err) {
        if (!cancelled) {
          setActionError(
            err instanceof Error ? err.message : "Falha ao carregar.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.start_date]);

  useEffect(() => {
    if (!snapshot.isBreak || !snapshot.currentBlock) {
      warnedOneMin.current = false;
      warnedEnd.current = false;
      return;
    }
    if (lastBreakId.current !== snapshot.currentBlock.id) {
      lastBreakId.current = snapshot.currentBlock.id;
      warnedOneMin.current = false;
      warnedEnd.current = false;
    }
    const remaining = snapshot.secondsRemainingInBlock ?? 0;
    if (remaining <= 60 && remaining > 0 && !warnedOneMin.current) {
      warnedOneMin.current = true;
      notify("PontoFoko", "Descanso acaba em 1 minuto.", "break-1min");
    }
    if (remaining <= 0 && !warnedEnd.current) {
      warnedEnd.current = true;
      const next = snapshot.nextBlock;
      notify(
        "PontoFoko",
        next ? `Próximo: ${next.activity}.` : "Descanso encerrado.",
        "break-end",
      );
    }
  }, [snapshot]);

  const dayRoutine = useMemo(
    () => getRoutineForDay(now.getDay() as DayOfWeek),
    [now, weekly],
  );
  const workBlocks = useMemo(
    () => getWorkBlocks(dayRoutine.blocks),
    [dayRoutine.blocks],
  );
  const sessionsForMetrics = useMemo(() => {
    const list = [...todaySessions];
    if (activeSession && !list.some((s) => s.id === activeSession.id)) {
      list.push(activeSession);
    } else if (activeSession) {
      return list.map((s) => (s.id === activeSession.id ? activeSession : s));
    }
    return list;
  }, [todaySessions, activeSession]);

  const balance = useMemo(
    () =>
      calculateDashboardMetrics(sessionsForMetrics, now, {
        startDate: user?.start_date ?? null,
        metricsEnabled: metricsOn,
        paused: Boolean(user?.paused),
      }).daily,
    [sessionsForMetrics, now, user?.start_date, user?.paused, metricsOn],
  );

  const lastPunch = useMemo(() => {
    if (activeSession) return activeSession;
    const sorted = [...todaySessions].sort(
      (a, b) =>
        new Date(b.actual_end ?? b.actual_start).getTime() -
        new Date(a.actual_end ?? a.actual_start).getTime(),
    );
    return sorted[0] ?? null;
  }, [activeSession, todaySessions]);

  const focusBlock = useMemo(() => {
    const currentWork = getWorkBlockAt(workBlocks, exactDaySeconds(now));

    if (activeSession) {
      if (
        currentWork &&
        currentWork.activity === activeSession.activity_type
      ) {
        return currentWork;
      }
      return (
        dayRoutine.blocks.find((b) => b.id === activeSession.block_id) ??
        currentWork ??
        snapshot.currentBlock
      );
    }

    if (currentWork) return currentWork;
    if (snapshot.isBreak) return snapshot.nextBlock;
    return snapshot.currentBlock ?? snapshot.nextBlock;
  }, [activeSession, dayRoutine.blocks, snapshot, workBlocks, now]);

  const status = useMemo(() => {
    const currentWork = getWorkBlockAt(workBlocks, exactDaySeconds(now));

    if (activeSession) {
      if (!live && user?.paused) {
        return {
          label: `Em andamento: ${activeSession.activity_type} — termine mesmo pausado`,
          tone: "work" as const,
        };
      }
      if (snapshot.isBreak || (!currentWork && snapshot.status === "gap")) {
        return {
          label: "Você está no intervalo — o tempo extra está contando",
          tone: "break" as const,
        };
      }
      return {
        label: `Em andamento: ${activeSession.activity_type}`,
        tone: "work" as const,
      };
    }

    if (
      currentWork &&
      snapshot.status !== "before_day" &&
      !snapshot.isBreak
    ) {
      if (snapshot.isLate) {
        return {
          label: `Atrasado — toque no botão para começar ${shortActivity(currentWork.activity)}`,
          tone: "late",
        };
      }
      return {
        label: `Hora de ${shortActivity(currentWork.activity)} — toque no botão para começar`,
        tone: "ok",
      };
    }

    if (snapshot.isBreak && snapshot.currentBlock) {
      const until = snapshot.currentBlock.end;
      const next = snapshot.nextBlock;
      return {
        label: next
          ? `Descanso até ${until} — depois vem ${shortActivity(next.activity)}`
          : `Descanso até ${until}`,
        tone: "break",
      };
    }

    if (snapshot.isLate) {
      return {
        label: "Atrasado — toque no botão para começar",
        tone: "late",
      };
    }

    if (snapshot.status === "before_day") {
      return {
        label: snapshot.nextBlock
          ? `A rotina começa às ${snapshot.nextBlock.start}`
          : "Sem rotina para hoje",
        tone: "off",
      };
    }

    if (snapshot.status === "empty_day") {
      return {
        label: "Sem rotina para hoje — monte em Ajustes",
        tone: "off",
      };
    }

    if (snapshot.status === "finished_day") {
      return { label: "Rotina de hoje concluída", tone: "off" };
    }

    if (snapshot.status === "gap") {
      return {
        label: snapshot.nextBlock
          ? `Pausa agora — próximo bloco às ${snapshot.nextBlock.start}`
          : "Pausa entre blocos",
        tone: "off",
      };
    }

    return {
      label: "Tudo certo com o horário",
      tone: "ok",
    };
  }, [activeSession, snapshot, workBlocks, now, live, user?.paused]);

  useEffect(() => {
    if (!user || !live || !activeSession || busy || loading || transitionLock.current) {
      return;
    }

    const currentWork = getWorkBlockAt(workBlocks, exactDaySeconds(now));
    if (!currentWork) return;
    if (currentWork.id === activeSession.block_id) {
      lastRolledBlockId.current = currentWork.id;
      return;
    }
    if (lastRolledBlockId.current === currentWork.id) return;

    transitionLock.current = true;

    void (async () => {
      try {
        const switchAt = dateAtTime(now, currentWork.start);
        const endAt =
          switchAt.getTime() > new Date(activeSession.actual_start).getTime()
            ? switchAt
            : now;

        const durationSeconds = elapsedSeconds(
          activeSession.actual_start,
          endAt,
        );

        const completed = await endSession({
          sessionId: activeSession.id,
          userId: user.id,
          actualEnd: endAt,
          endPhotoUrl: null,
          durationSeconds,
        });

        setTodaySessions((prev) => [
          completed,
          ...prev.filter((s) => s.id !== completed.id),
        ]);
        setActiveSession(null);
        lastRolledBlockId.current = currentWork.id;
        notify(
          "PontoFoko",
          `Horário anterior encerrado. Toque em “${startActionLabel(currentWork.activity)}” para seguir. Se não começar, esse tempo conta como faltante.`,
          "transition",
        );
      } catch (err) {
        setActionError(
          err instanceof Error
            ? err.message
            : "Não deu para encerrar o horário anterior.",
        );
      } finally {
        transitionLock.current = false;
      }
    })();
  }, [user, live, activeSession, busy, loading, now, workBlocks]);

  const nowExact = exactDaySeconds(now);

  const blockHasStarted = (block: { start: string }) =>
    nowExact >= timeToSeconds(block.start);

  const canPunchIn =
    live &&
    !activeSession &&
    !!focusBlock &&
    !focusBlock.isBreak &&
    snapshot.status !== "finished_day" &&
    blockHasStarted(focusBlock);

  const actionButton = useMemo(() => {
    if (!user) {
      return {
        label: "Carregando…",
        enabled: false,
        kind: "wait" as const,
      };
    }

    if (busy) {
      return { label: "Registrando…", enabled: false, kind: "busy" as const };
    }

    if (activeSession) {
      return {
        label: endActionLabel(activeSession.activity_type),
        enabled: true,
        kind: "out" as const,
      };
    }

    if (!live) {
      return {
        label: notLiveLabel(user),
        enabled: false,
        kind: "wait" as const,
      };
    }

    if (snapshot.status === "empty_day") {
      return {
        label: "Sem rotina — vá em Ajustes",
        enabled: false,
        kind: "idle" as const,
      };
    }

    if (snapshot.isBreak && snapshot.currentBlock) {
      return {
        label: `Descanso até ${snapshot.currentBlock.end}`,
        enabled: false,
        kind: "break" as const,
      };
    }

    if (snapshot.status === "finished_day") {
      return {
        label: "Rotina de hoje já acabou",
        enabled: false,
        kind: "done" as const,
      };
    }

    if (snapshot.status === "before_day" && snapshot.nextBlock) {
      return {
        label: `Pode começar às ${snapshot.nextBlock.start}`,
        enabled: false,
        kind: "wait" as const,
      };
    }

    if (focusBlock && !focusBlock.isBreak && !blockHasStarted(focusBlock)) {
      return {
        label: `Pode começar às ${focusBlock.start}`,
        enabled: false,
        kind: "wait" as const,
      };
    }

    if (focusBlock && !focusBlock.isBreak && blockHasStarted(focusBlock)) {
      return {
        label: startActionLabel(focusBlock.activity),
        enabled: true,
        kind: "in" as const,
      };
    }

    if (snapshot.status === "gap" && snapshot.nextBlock) {
      const next = snapshot.nextBlock;
      return {
        label: next.isBreak
          ? `Próximo às ${next.start}`
          : `Próximo: ${shortActivity(next.activity)} às ${next.start}`,
        enabled: false,
        kind: "wait" as const,
      };
    }

    return {
      label: "Nada para registrar agora",
      enabled: false,
      kind: "idle" as const,
    };
  }, [user, activeSession, busy, focusBlock, snapshot, nowExact, live]);

  if (!user) {
    return <div className="dashboard-loading">Carregando…</div>;
  }

  const registerPunch = async () => {
    setActionError(null);

    if (!live && !activeSession) {
      setActionError(notLiveLabel(user));
      return;
    }

    if (activeSession) {
    } else if (!canPunchIn || !focusBlock) {
      setActionError(
        focusBlock && !blockHasStarted(focusBlock)
          ? `Ainda não — você só pode começar a partir das ${focusBlock.start}.`
          : "Não tem nada para começar neste momento.",
      );
      return;
    }

    setBusy(true);
    try {
      const blob = await cameraRef.current?.capture();
      if (!blob) throw new Error("Espere a câmera ligar e tente de novo.");

      const stamp = Date.now();

      if (!activeSession) {
        if (!focusBlock || focusBlock.isBreak) {
          throw new Error("Não tem horário de trabalho para começar agora.");
        }

        const actualStart = new Date();
        const plannedStart = dateAtTime(actualStart, focusBlock.start);
        if (actualStart.getTime() < plannedStart.getTime()) {
          throw new Error(
            `Ainda não — você só pode começar a partir das ${focusBlock.start}.`,
          );
        }
        const lateSeconds = Math.max(
          0,
          signedElapsedSeconds(plannedStart, actualStart),
        );

        let photoUrl: string | null = null;
        let photoFailed = false;
        try {
          photoUrl = await uploadSessionPhoto(
            user.id,
            blob,
            `${toISODate(actualStart)}/${focusBlock.id}-start-${stamp}.jpg`,
          );
        } catch {
          photoFailed = true;
        }

        const session = await startSession({
          userId: user.id,
          blockId: focusBlock.id,
          activityType: focusBlock.activity,
          plannedStart: focusBlock.start,
          plannedEnd: focusBlock.end,
          actualStart,
          startPhotoUrl: photoUrl,
          lateSeconds,
          earlySeconds: 0,
          sessionDate: toISODate(actualStart),
        });
        setActiveSession(session);
        lastRolledBlockId.current = focusBlock.id;
        cameraRef.current?.celebrate("Começou!");
        if (photoFailed) {
          setActionError("Ponto registrado, mas a foto não foi enviada.");
        }
        notify(
          "PontoFoko",
          `${focusBlock.activity} começou às ${actualStart.toLocaleTimeString("pt-BR")}`,
          "punch-in",
        );
      } else {
        const actualEnd = new Date();
        const day = new Date(activeSession.session_date + "T12:00:00");
        const nextStart = nextWorkBlockStartSeconds(
          workBlocks,
          activeSession.block_id,
        );
        const split = splitSessionTime({
          day,
          plannedStart: activeSession.planned_start,
          plannedEnd: activeSession.planned_end,
          actualStart: new Date(activeSession.actual_start),
          actualEnd,
          nextWorkStartSeconds: nextStart,
        });
        const durationSeconds = elapsedSeconds(
          activeSession.actual_start,
          actualEnd,
        );

        let photoUrl: string | null = null;
        let photoFailed = false;
        try {
          photoUrl = await uploadSessionPhoto(
            user.id,
            blob,
            `${activeSession.session_date}/${activeSession.block_id}-end-${stamp}.jpg`,
          );
        } catch {
          photoFailed = true;
        }

        const completed = await endSession({
          sessionId: activeSession.id,
          userId: user.id,
          actualEnd,
          endPhotoUrl: photoUrl,
          durationSeconds,
        });
        setActiveSession(null);
        lastRolledBlockId.current = null;
        setTodaySessions((prev) => [
          completed,
          ...prev.filter((s) => s.id !== completed.id),
        ]);
        cameraRef.current?.celebrate("Pronto!");
        if (photoFailed) {
          setActionError("Ponto registrado, mas a foto não foi enviada.");
        }
        notify(
          "PontoFoko",
          split.overtimeSeconds > 0
            ? `${activeSession.activity_type} terminou · ${formatDuration(split.overtimeSeconds)} a mais`
            : `${activeSession.activity_type} terminou · ${formatDuration(durationSeconds)} no total`,
          "punch-out",
        );
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Não deu para registrar. Tente de novo.",
      );
      cameraRef.current?.resetPreview();
    } finally {
      setBusy(false);
    }
  };

  const elapsedActive = activeSession
    ? elapsedSeconds(activeSession.actual_start, now)
    : 0;

  return (
    <div className="ponto">
      <h1 className="page-title">Ponto</h1>

      <section className="card punch-main">
        <div className="clock-block">
          <div className="big-clock mono">
            {now.toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </div>
          <p
            className={`status-line tone-${
              live || activeSession ? status.tone : "off"
            }`}
          >
            {live || activeSession ? status.label : notLiveLabel(user)}
          </p>
          {(focusBlock || activeSession) && (
            <p className="block-line">
              {activeSession
                ? `Horário previsto ${focusBlock?.start ?? activeSession.planned_start}–${focusBlock?.end ?? activeSession.planned_end}`
                : focusBlock
                  ? `Horário previsto ${focusBlock.start}–${focusBlock.end}`
                  : ""}
              {activeSession
                ? ` · já faz ${secondsToClock(elapsedActive)}`
                : ""}
            </p>
          )}
        </div>

        <LiveCamera ref={cameraRef} enabled={live || Boolean(activeSession)} />

        <button
          type="button"
          className={`btn btn-lg ${
            actionButton.kind === "out"
              ? "btn-danger"
              : actionButton.kind === "in"
                ? "btn-primary"
                : "btn-ghost"
          }`}
          onClick={() => void registerPunch()}
          disabled={busy || loading || !actionButton.enabled}
        >
          {actionButton.label}
        </button>

        {actionError && <p className="inline-error">{actionError}</p>}

        <div className="last-punch">
          <span>Última vez que você registrou</span>
          <strong>{formatLastPunch(lastPunch)}</strong>
        </div>
      </section>

      <section className="card saldo-mini">
        <div>
          <span>Feito</span>
          <strong className="mono">
            {formatDuration(metricsOn ? balance.doneSeconds : 0)}
          </strong>
        </div>
        <div>
          <span>Faltou</span>
          <strong className="mono is-neg">
            {formatDuration(metricsOn ? balance.missedSeconds : 0)}
          </strong>
        </div>
        <div>
          <span>A mais</span>
          <strong className="mono is-pos">
            {formatDuration(metricsOn ? balance.overtimeSeconds : 0)}
          </strong>
        </div>
      </section>
    </div>
  );
}
