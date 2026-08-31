"use client";

import { useEffect, useState } from "react";
import { elapsedSeconds, scheduleLiveTick } from "@/lib/time/exact";
import { secondsToClock } from "@/lib/routine/schedule";

type LiveTimerProps = {
  startedAt: Date | string;
  label?: string;
};

export function LiveTimer({ startedAt, label = "Tempo decorrido" }: LiveTimerProps) {
  const [elapsed, setElapsed] = useState(() => elapsedSeconds(startedAt));

  useEffect(() => {
    return scheduleLiveTick(() => setElapsed(elapsedSeconds(startedAt)));
  }, [startedAt]);

  return (
    <div className="live-timer">
      <span className="live-timer-label">{label}</span>
      <span className="live-timer-value mono">{secondsToClock(elapsed)}</span>
    </div>
  );
}

type CountdownProps = {
  remainingSeconds: number;
  label?: string;
  warnAt?: number;
};

export function Countdown({
  remainingSeconds,
  label = "Tempo restante",
  warnAt = 60,
}: CountdownProps) {
  const urgent = remainingSeconds <= warnAt && remainingSeconds > 0;
  const done = remainingSeconds <= 0;

  return (
    <div className={`countdown ${urgent ? "is-urgent" : ""} ${done ? "is-done" : ""}`}>
      <span className="countdown-label">{label}</span>
      <span className="countdown-value mono">
        {secondsToClock(Math.max(0, remainingSeconds))}
      </span>
    </div>
  );
}
