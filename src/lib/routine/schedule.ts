import type { DayOfWeek, DayRoutine, RoutineBlock } from "@/types";
import { toISODate } from "@/lib/time/dates";

export { toISODate };

const weekdayBlocks: RoutineBlock[] = [
  { id: "wd-emprego-1", start: "09:30", end: "10:30", activity: "Emprego Dev", isBreak: false },
  { id: "wd-break-1", start: "10:30", end: "10:45", activity: "Descanso", isBreak: true },
  { id: "wd-emprego-2", start: "10:45", end: "11:45", activity: "Emprego Dev", isBreak: false },
  { id: "wd-break-2", start: "11:45", end: "12:00", activity: "Descanso", isBreak: true },
  { id: "wd-emprego-3", start: "12:00", end: "13:00", activity: "Emprego Dev", isBreak: false },
  { id: "wd-estudo-1", start: "15:00", end: "16:00", activity: "Estudo GCM", isBreak: false },
  { id: "wd-break-3", start: "16:00", end: "16:15", activity: "Descanso", isBreak: true },
  { id: "wd-estudo-2", start: "16:15", end: "17:15", activity: "Estudo GCM", isBreak: false },
];

const saturdayBlocks: RoutineBlock[] = [
  { id: "sat-emp-1", start: "09:15", end: "10:15", activity: "Empreendimento", isBreak: false },
  { id: "sat-emprego-1", start: "15:30", end: "16:20", activity: "Emprego Dev", isBreak: false },
  { id: "sat-break-1", start: "16:20", end: "16:25", activity: "Descanso", isBreak: true },
  { id: "sat-emprego-2", start: "16:25", end: "17:15", activity: "Emprego Dev", isBreak: false },
  { id: "sat-break-2", start: "17:15", end: "17:20", activity: "Descanso", isBreak: true },
  { id: "sat-emprego-3", start: "17:20", end: "18:00", activity: "Emprego Dev", isBreak: false },
];

const sundayBlocks: RoutineBlock[] = [
  { id: "sun-emp-1", start: "09:00", end: "10:00", activity: "Empreendimento", isBreak: false },
  { id: "sun-break-1", start: "10:00", end: "10:30", activity: "Descanso", isBreak: true },
  { id: "sun-emprego-1", start: "10:30", end: "11:30", activity: "Emprego Dev", isBreak: false },
  { id: "sun-break-2", start: "11:30", end: "11:45", activity: "Descanso", isBreak: true },
  { id: "sun-emprego-2", start: "11:45", end: "12:45", activity: "Emprego Dev", isBreak: false },
  { id: "sun-break-3", start: "12:45", end: "13:00", activity: "Descanso", isBreak: true },
  { id: "sun-emprego-3", start: "13:00", end: "14:00", activity: "Emprego Dev", isBreak: false },
];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
  0: "Domingo",
};

export const DAY_ORDER: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];

export const BREAK_ACTIVITY = "Descanso";

export const DEFAULT_ACTIVITIES: string[] = [
  "Emprego Dev",
  "Estudo GCM",
  "Empreendimento",
  BREAK_ACTIVITY,
];

export function isBreakActivity(activity: string): boolean {
  return activity.trim().toLowerCase() === BREAK_ACTIVITY.toLowerCase();
}

export function normalizeActivities(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  if (!out.some((a) => isBreakActivity(a))) {
    out.push(BREAK_ACTIVITY);
  }
  return out;
}

export function collectActivitiesFromRoutine(routine: DayRoutine[]): string[] {
  return normalizeActivities(routine.flatMap((d) => d.blocks.map((b) => b.activity)));
}

export function createEmptyWeeklyRoutine(): DayRoutine[] {
  return DAY_ORDER.map((dow) => ({
    dayOfWeek: dow,
    label: DAY_LABELS[dow],
    blocks: [],
  }));
}

export function createDefaultWeeklyRoutine(): DayRoutine[] {
  return [
    {
      dayOfWeek: 1,
      label: "Segunda",
      blocks: cloneBlocks(weekdayBlocks, 1),
    },
    { dayOfWeek: 2, label: "Terça", blocks: cloneBlocks(weekdayBlocks, 2) },
    { dayOfWeek: 3, label: "Quarta", blocks: cloneBlocks(weekdayBlocks, 3) },
    { dayOfWeek: 4, label: "Quinta", blocks: cloneBlocks(weekdayBlocks, 4) },
    { dayOfWeek: 5, label: "Sexta", blocks: cloneBlocks(weekdayBlocks, 5) },
    { dayOfWeek: 6, label: "Sábado", blocks: cloneBlocks(saturdayBlocks, 6) },
    { dayOfWeek: 0, label: "Domingo", blocks: cloneBlocks(sundayBlocks, 0) },
  ];
}

function cloneBlocks(
  blocks: RoutineBlock[],
  dayOfWeek: DayOfWeek,
): RoutineBlock[] {
  return blocks.map((b) => ({ ...b, id: `d${dayOfWeek}-${b.id}` }));
}

let activeWeeklyRoutine: DayRoutine[] = createEmptyWeeklyRoutine();

export function setWeeklyRoutine(routine: DayRoutine[]): void {
  activeWeeklyRoutine = normalizeWeeklyRoutine(routine);
}

export function getRoutineForDay(dayOfWeek: DayOfWeek): DayRoutine {
  const found = activeWeeklyRoutine.find((d) => d.dayOfWeek === dayOfWeek);
  if (!found) {
    return { dayOfWeek, label: DAY_LABELS[dayOfWeek] ?? "Dia", blocks: [] };
  }
  return found;
}

export function getWorkBlocks(blocks: RoutineBlock[]): RoutineBlock[] {
  return blocks.filter((b) => !b.isBreak);
}

export function plannedSecondsForBlocks(blocks: RoutineBlock[]): number {
  return getWorkBlocks(blocks).reduce((sum, block) => {
    return sum + timeToSeconds(block.end) - timeToSeconds(block.start);
  }, 0);
}

export function timeToSeconds(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 3600 + m * 60;
}

export function secondsToClock(totalSeconds: number): string {
  const abs = Math.abs(Math.floor(totalSeconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatDuration(totalSeconds: number): string {
  const abs = Math.abs(Math.floor(totalSeconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, "0")}min ${String(s).padStart(2, "0")}s`;
  }
  return `${m}min ${String(s).padStart(2, "0")}s`;
}

export function formatHours(totalSeconds: number): string {
  const hours = totalSeconds / 3600;
  return `${hours.toFixed(1)}h`;
}

export function dateAtTime(base: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

export function activityColor(activity: string): string {
  switch (activity) {
    case "Emprego Dev":
      return "var(--accent-dev)";
    case "Estudo GCM":
      return "var(--accent-study)";
    case "Empreendimento":
      return "var(--accent-venture)";
    case "Descanso":
      return "var(--accent-break)";
    default:
      return "var(--accent)";
  }
}

export function newBlockId(prefix = "blk"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function sortBlocks(blocks: RoutineBlock[]): RoutineBlock[] {
  return [...blocks].sort(
    (a, b) => timeToSeconds(a.start) - timeToSeconds(b.start),
  );
}

export function normalizeWeeklyRoutine(input: DayRoutine[]): DayRoutine[] {
  const byDay = new Map<DayOfWeek, DayRoutine>();
  const usedIds = new Set<string>();

  for (const day of input) {
    const dow = day.dayOfWeek as DayOfWeek;
    byDay.set(dow, {
      dayOfWeek: dow,
      label: DAY_LABELS[dow] ?? day.label,
      blocks: sortBlocks(
        (day.blocks ?? []).map((b) => {
          let id = (b.id || "").trim() || newBlockId(`d${dow}`);
          if (usedIds.has(id)) id = newBlockId(`d${dow}`);
          usedIds.add(id);
          const activity = (b.activity || BREAK_ACTIVITY).trim() || BREAK_ACTIVITY;
          return {
            id,
            start: b.start,
            end: b.end,
            activity,
            isBreak: Boolean(b.isBreak) || isBreakActivity(activity),
          };
        }),
      ),
    });
  }

  return DAY_ORDER.map((dow) => {
    return (
      byDay.get(dow) ?? {
        dayOfWeek: dow,
        label: DAY_LABELS[dow],
        blocks: [],
      }
    );
  });
}

export function validateDayBlocks(blocks: RoutineBlock[]): string | null {
  for (const block of blocks) {
    if (!/^\d{2}:\d{2}$/.test(block.start) || !/^\d{2}:\d{2}$/.test(block.end)) {
      return "Use horários no formato HH:MM.";
    }
    if (timeToSeconds(block.end) <= timeToSeconds(block.start)) {
      return `“${block.activity}” precisa terminar depois de começar (${block.start}).`;
    }
  }

  const sorted = sortBlocks(blocks);
  for (let i = 1; i < sorted.length; i++) {
    if (timeToSeconds(sorted[i].start) < timeToSeconds(sorted[i - 1].end)) {
      return `Há sobreposição entre ${sorted[i - 1].start}–${sorted[i - 1].end} e ${sorted[i].start}–${sorted[i].end}.`;
    }
  }
  return null;
}

export const LATE_TOLERANCE_SECONDS = 5 * 60;
export const PUNCTUAL_WINDOW_SECONDS = 5 * 60;
export const ADHERENCE_STREAK_THRESHOLD = 0.8;
