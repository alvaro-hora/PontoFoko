export type ActivityType = string;

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type RoutineBlock = {
  id: string;
  start: string;
  end: string;
  activity: ActivityType;
  isBreak: boolean;
};

export type DayRoutine = {
  dayOfWeek: DayOfWeek;
  label: string;
  blocks: RoutineBlock[];
};

export type BlockStatus =
  | "upcoming"
  | "active"
  | "break"
  | "gap"
  | "late"
  | "should_have_started"
  | "on_time"
  | "finished_day"
  | "empty_day"
  | "before_day";

export type RoutineSnapshot = {
  now: Date;
  dayLabel: string;
  currentBlock: RoutineBlock | null;
  nextBlock: RoutineBlock | null;
  previousBlock: RoutineBlock | null;
  status: BlockStatus;
  secondsUntilNext: number | null;
  secondsIntoBlock: number | null;
  secondsRemainingInBlock: number | null;
  isLate: boolean;
  lateBySeconds: number;
  isOnTime: boolean;
  isBreak: boolean;
  shouldHaveStarted: boolean;
  message: string;
};

export type SessionStatus = "in_progress" | "completed" | "abandoned";

export type SessionSource = "live" | "manual" | "adjusted";

export type Session = {
  id: string;
  user_id?: string;
  block_id: string;
  activity_type: string;
  planned_start: string;
  planned_end: string;
  actual_start: string;
  actual_end: string | null;
  duration_seconds: number | null;
  start_photo_url: string | null;
  end_photo_url: string | null;
  status: SessionStatus;
  late_seconds: number;
  early_seconds: number;
  session_date: string;
  created_at: string;
  observation?: string | null;
  source?: SessionSource | null;
};

export type MissedBlock = {
  blockId: string;
  activity: string;
  plannedStart: string;
  plannedEnd: string;
  plannedSeconds: number;
  date: string;
};

export type ActivityBreakdown = {
  activity: string;
  plannedSeconds: number;
  dueSeconds: number;
  doneSeconds: number;
  missedSeconds: number;
  overtimeSeconds: number;
};

export type PeriodMetrics = {
  plannedSeconds: number;
  dueSeconds: number;
  doneSeconds: number;
  overtimeSeconds: number;
  balanceSeconds: number;
  missedSeconds: number;
  missedCount: number;
  completedBlocks: number;
  plannedBlocks: number;
  byActivity: ActivityBreakdown[];
  missedBlocks: MissedBlock[];
};

export type DashboardMetrics = {
  daily: PeriodMetrics;
  weekly: PeriodMetrics;
  monthly: PeriodMetrics;
  todaySessions: Session[];
};
