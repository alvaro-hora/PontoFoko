"use client";

import { useEffect, useState } from "react";
import { scheduleLiveTick, scheduleSecondTick } from "@/lib/time/exact";

export function useExactNow(mode: "second" | "live" = "live"): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    return mode === "second" ? scheduleSecondTick(tick) : scheduleLiveTick(tick);
  }, [mode]);

  return now;
}
