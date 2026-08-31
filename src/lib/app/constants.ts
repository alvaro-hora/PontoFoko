import { toISODate } from "@/lib/time/dates";

export type AppUser = {
  id: string;
  username: string;
  display_name: string;
  start_date: string | null;
  paused: boolean;
  weekly_routine: unknown;
  activities: string[];
};

export function toISODateLocal(date = new Date()): string {
  return toISODate(date);
}

export function isUserLive(
  user: Pick<AppUser, "start_date" | "paused"> | null | undefined,
  now = new Date(),
): boolean {
  if (!user || user.paused || !user.start_date) return false;
  return toISODateLocal(now) >= user.start_date;
}

export function isMetricsEnabled(
  user: Pick<AppUser, "start_date"> | null | undefined,
  now = new Date(),
): boolean {
  if (!user?.start_date) return false;
  return toISODateLocal(now) >= user.start_date;
}

export function formatStartDateLabel(
  startDate: string | null | undefined,
): string | null {
  if (!startDate) return null;
  const [y, m, d] = startDate.split("-");
  if (!y || !m || !d) return startDate;
  return `${d}/${m}/${y}`;
}

export function clampFromUserStart(
  fromDate: string,
  startDate: string | null | undefined,
): string {
  if (!startDate) return fromDate;
  return fromDate < startDate ? startDate : fromDate;
}

export function isBeforeUserStart(
  isoDate: string,
  startDate: string | null | undefined,
): boolean {
  if (!startDate) return true;
  return isoDate < startDate;
}
