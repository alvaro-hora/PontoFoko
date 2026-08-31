/**
 * Testes de métricas + engine (pré-início, pausa, OT, validação…).
 * Uso: npx tsx scripts/qa-metrics.ts
 */
import {
  calculateDashboardMetrics,
  splitSessionTime,
} from "../src/lib/metrics/calculate.ts";
import {
  createEmptyWeeklyRoutine,
  normalizeWeeklyRoutine,
  setWeeklyRoutine,
  validateDayBlocks,
} from "../src/lib/routine/schedule.ts";
import { getRoutineSnapshot } from "../src/lib/routine/engine.ts";

const fails: string[] = [];
function assert(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    fails.push(msg);
  }
}

const today = new Date(2026, 7, 6, 19, 30, 0);
const dow = today.getDay();

const weekly = createEmptyWeeklyRoutine().map((d) =>
  d.dayOfWeek === dow
    ? {
        ...d,
        blocks: [
          {
            id: "b1",
            start: "12:00",
            end: "13:00",
            activity: "Trabalho",
            isBreak: false,
          },
          {
            id: "b2",
            start: "15:00",
            end: "16:00",
            activity: "Estudo",
            isBreak: false,
          },
          {
            id: "b3",
            start: "20:00",
            end: "21:00",
            activity: "Trabalho",
            isBreak: false,
          },
        ],
      }
    : d,
);

setWeeklyRoutine(weekly);

console.log("\n=== QA MÉTRICAS + ENGINE ===\n");

{
  const m = calculateDashboardMetrics([], today, {
    startDate: "2026-08-10",
    metricsEnabled: false,
    paused: false,
  });
  assert(m.daily.plannedSeconds > 0, "preview: tem planejado");
  assert(m.daily.missedSeconds === 0, "preview: zero faltas");
  assert(m.daily.doneSeconds === 0, "preview: zero feito");
}

{
  const m = calculateDashboardMetrics([], today, {
    startDate: "2026-08-10",
    metricsEnabled: true,
    paused: false,
  });
  assert(
    m.daily.plannedSeconds === 0 && m.daily.missedSeconds === 0,
    "antes do início com counting: daily vazio",
  );
}

{
  const afterStart = new Date(2026, 7, 11, 12, 30, 0);
  const m = calculateDashboardMetrics([], afterStart, {
    startDate: "2026-08-10",
    metricsEnabled: true,
    paused: false,
  });
  assert(
    m.monthly.missedSeconds === 0,
    "mês após início: sem faltas inventadas em dias pré-início",
  );
}

{
  const m = calculateDashboardMetrics([], today, {
    startDate: "2026-08-01",
    metricsEnabled: true,
    paused: false,
  });
  assert(m.daily.missedCount === 2, `2 faltas passadas (got ${m.daily.missedCount})`);
  assert(
    m.daily.plannedSeconds === 3 * 3600,
    `meta do dia = 3h (got ${m.daily.plannedSeconds / 3600}h)`,
  );
  assert(
    m.daily.dueSeconds === 2 * 3600,
    `due só 2h vencidas (got ${m.daily.dueSeconds / 3600}h)`,
  );
}

{
  const morning = new Date(2026, 7, 6, 10, 0, 0);
  const m = calculateDashboardMetrics([], morning, {
    startDate: "2026-08-01",
    metricsEnabled: true,
    paused: false,
  });
  assert(
    m.daily.plannedSeconds === 3 * 3600,
    `manhã: meta 3h mesmo sem bloco iniciado (got ${m.daily.plannedSeconds / 3600}h)`,
  );
  assert(m.daily.dueSeconds === 0, "manhã: due 0");
  assert(m.daily.missedSeconds === 0, "manhã: sem faltas");
  assert(m.daily.balanceSeconds === 0, "manhã: resultado 0");
}

{
  // Bloco aberto + sessão atrasada: Faltou estável entre ticks de ms
  setWeeklyRoutine(weekly);
  const sessions = [
    {
      id: "late",
      block_id: "b1",
      activity_type: "Trabalho",
      planned_start: "12:00",
      planned_end: "13:00",
      actual_start: new Date(2026, 7, 6, 12, 0, 10, 50).toISOString(),
      actual_end: null,
      duration_seconds: null,
      start_photo_url: null,
      end_photo_url: null,
      status: "in_progress" as const,
      late_seconds: 10,
      early_seconds: 0,
      session_date: "2026-08-06",
      created_at: "",
    },
  ];
  const values = new Set<number>();
  for (const ms of [0, 100, 250, 500, 750, 999]) {
    const nowTick = new Date(2026, 7, 6, 12, 20, 0, ms);
    const m = calculateDashboardMetrics(sessions, nowTick, {
      startDate: "2026-08-01",
      metricsEnabled: true,
      paused: false,
    });
    values.add(m.daily.missedSeconds);
  }
  assert(
    values.size === 1 && values.has(10),
    `faltou estável em 10s (got ${[...values].join(",")})`,
  );
}

{
  const midBlock = new Date(2026, 7, 6, 15, 30, 0);
  const m = calculateDashboardMetrics([], midBlock, {
    startDate: "2026-08-01",
    metricsEnabled: true,
    paused: true,
  });
  assert(m.daily.missedCount === 1, `pausa: 1 falta encerrada (got ${m.daily.missedCount})`);
}

{
  const sessions = [
    {
      id: "1",
      block_id: "b1",
      activity_type: "Trabalho",
      planned_start: "12:00",
      planned_end: "13:00",
      actual_start: new Date(2026, 7, 6, 12, 0, 0).toISOString(),
      actual_end: new Date(2026, 7, 6, 13, 0, 0).toISOString(),
      duration_seconds: 3600,
      start_photo_url: null,
      end_photo_url: null,
      status: "completed" as const,
      late_seconds: 0,
      early_seconds: 0,
      session_date: "2026-08-06",
      created_at: "",
    },
  ];
  const m = calculateDashboardMetrics(sessions, today, {
    startDate: "2026-08-01",
    metricsEnabled: true,
    paused: false,
  });
  assert(m.daily.completedBlocks === 1, "1 bloco completo");
  assert(m.daily.missedCount === 1, "ainda 1 falta (estudo 15-16)");
  assert(
    m.daily.balanceSeconds ===
      m.daily.doneSeconds + m.daily.overtimeSeconds - m.daily.dueSeconds,
    "balance = done+ot-due",
  );
  assert(
    m.daily.balanceSeconds === -3600,
    `resultado −1h (1h feita, 2h due) got ${m.daily.balanceSeconds}`,
  );
}

{
  const day = new Date(2026, 7, 6);
  const split = splitSessionTime({
    day,
    plannedStart: "12:00",
    plannedEnd: "13:00",
    actualStart: new Date(2026, 7, 6, 12, 0, 0),
    actualEnd: new Date(2026, 7, 6, 16, 0, 0),
    nextWorkStartSeconds: 15 * 3600,
  });
  assert(split.doneSeconds === 3600, "OT: 1h done na janela");
  assert(
    split.overtimeSeconds === 2 * 3600,
    `OT capped até 15:00 = 2h (got ${split.overtimeSeconds / 3600}h)`,
  );
}

{
  const sessions = [
    {
      id: "short",
      block_id: "b1",
      activity_type: "Trabalho",
      planned_start: "12:00",
      planned_end: "13:00",
      actual_start: new Date(2026, 7, 6, 12, 0, 0).toISOString(),
      actual_end: new Date(2026, 7, 6, 12, 10, 0).toISOString(),
      duration_seconds: 600,
      start_photo_url: null,
      end_photo_url: null,
      status: "completed" as const,
      late_seconds: 0,
      early_seconds: 0,
      session_date: "2026-08-06",
      created_at: "",
    },
    {
      id: "long",
      block_id: "b1",
      activity_type: "Trabalho",
      planned_start: "12:00",
      planned_end: "13:00",
      actual_start: new Date(2026, 7, 6, 12, 0, 0).toISOString(),
      actual_end: new Date(2026, 7, 6, 13, 0, 0).toISOString(),
      duration_seconds: 3600,
      start_photo_url: null,
      end_photo_url: null,
      status: "completed" as const,
      late_seconds: 0,
      early_seconds: 0,
      session_date: "2026-08-06",
      created_at: "",
    },
  ];
  const m = calculateDashboardMetrics(sessions, today, {
    startDate: "2026-08-01",
    metricsEnabled: true,
    paused: false,
  });
  assert(m.daily.doneSeconds >= 3500, "best session (longa) usada no done");
  assert(m.daily.completedBlocks === 1, "1 completed block mesmo com 2 sessões");
}

{
  setWeeklyRoutine(createEmptyWeeklyRoutine());
  const sessions = [
    {
      id: "orphan",
      block_id: "old",
      activity_type: "Antiga",
      planned_start: "10:00",
      planned_end: "11:00",
      actual_start: new Date(2026, 7, 6, 10, 0, 0).toISOString(),
      actual_end: new Date(2026, 7, 6, 11, 0, 0).toISOString(),
      duration_seconds: 3600,
      start_photo_url: null,
      end_photo_url: null,
      status: "completed" as const,
      late_seconds: 0,
      early_seconds: 0,
      session_date: "2026-08-06",
      created_at: "",
    },
  ];
  const m = calculateDashboardMetrics(sessions, today, {
    startDate: "2026-08-01",
    metricsEnabled: true,
    paused: false,
  });
  assert(m.daily.doneSeconds > 0, "sessão sem bloco na rotina ainda conta");
  assert(m.daily.completedBlocks === 1, "completedBlocks com rotina vazia");
  setWeeklyRoutine(weekly);
}

{
  assert(
    validateDayBlocks([
      { id: "1", start: "10:00", end: "09:00", activity: "X", isBreak: false },
    ]) != null,
    "valida fim <= início",
  );
  assert(
    validateDayBlocks([
      { id: "1", start: "10:00", end: "11:00", activity: "A", isBreak: false },
      { id: "2", start: "10:30", end: "11:30", activity: "B", isBreak: false },
    ]) != null,
    "valida overlap",
  );
  assert(
    validateDayBlocks([
      { id: "1", start: "10:00", end: "11:00", activity: "A", isBreak: false },
      { id: "2", start: "11:00", end: "12:00", activity: "B", isBreak: false },
    ]) == null,
    "adjacentes OK",
  );
}

{
  const n = normalizeWeeklyRoutine([
    {
      dayOfWeek: 1,
      label: "Segunda",
      blocks: [
        { id: "same", start: "09:00", end: "10:00", activity: "A", isBreak: false },
      ],
    },
    {
      dayOfWeek: 2,
      label: "Terça",
      blocks: [
        { id: "same", start: "09:00", end: "10:00", activity: "A", isBreak: false },
      ],
    },
  ]);
  const ids = n.flatMap((d) => d.blocks.map((b) => b.id));
  assert(new Set(ids).size === ids.length, "normalize gera ids únicos na semana");
}

{
  setWeeklyRoutine(createEmptyWeeklyRoutine());
  const snap = getRoutineSnapshot(today);
  assert(snap.status === "empty_day", "dia sem blocos = empty_day");
  setWeeklyRoutine(weekly);
  const snap2 = getRoutineSnapshot(today);
  assert(snap2.status !== "empty_day", "com blocos não é empty_day");
}

{
  const wed = new Date(2026, 7, 5, 18, 0, 0);
  const multi = createEmptyWeeklyRoutine().map((d) => {
    if (d.dayOfWeek === 3 || d.dayOfWeek === 4) {
      return {
        ...d,
        blocks: [
          {
            id: `w-${d.dayOfWeek}`,
            start: "10:00",
            end: "11:00",
            activity: "Trabalho",
            isBreak: false,
          },
        ],
      };
    }
    return d;
  });
  setWeeklyRoutine(multi);
  const m = calculateDashboardMetrics([], wed, {
    startDate: "2026-08-01",
    metricsEnabled: true,
    paused: false,
  });
  assert(m.daily.missedSeconds === 3600, "weekly test: daily miss 1h");
  assert(m.weekly.plannedSeconds >= 3600, "weekly tem planned");
  setWeeklyRoutine(weekly);
}

console.log(`\nFALHAS: ${fails.length}`);
if (fails.length) {
  fails.forEach((f) => console.log(" -", f));
  process.exit(1);
}
console.log("Métricas + engine OK.");
