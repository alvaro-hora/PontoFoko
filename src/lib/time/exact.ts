export function elapsedSeconds(
  from: Date | string | number,
  to: Date | number = Date.now(),
): number {
  const start = typeof from === "number" ? from : new Date(from).getTime();
  const end = typeof to === "number" ? to : to.getTime();
  return Math.max(0, Math.floor((end - start) / 1000));
}

export function signedElapsedSeconds(
  from: Date | string | number,
  to: Date | number = Date.now(),
): number {
  const start = typeof from === "number" ? from : new Date(from).getTime();
  const end = typeof to === "number" ? to : to.getTime();
  return Math.floor((end - start) / 1000);
}

export function exactDaySeconds(date: Date): number {
  return (
    date.getHours() * 3600 +
    date.getMinutes() * 60 +
    date.getSeconds() +
    date.getMilliseconds() / 1000
  );
}

export function daySeconds(date: Date): number {
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

export function scheduleSecondTick(callback: () => void): () => void {
  let timeoutId = 0;
  let cancelled = false;

  const arm = () => {
    if (cancelled) return;
    const now = Date.now();
    const delay = Math.max(16, 1000 - (now % 1000));
    timeoutId = window.setTimeout(() => {
      callback();
      arm();
    }, delay);
  };

  callback();
  arm();

  return () => {
    cancelled = true;
    window.clearTimeout(timeoutId);
  };
}

export function scheduleLiveTick(
  callback: () => void,
  everyMs = 250,
): () => void {
  callback();
  const id = window.setInterval(callback, everyMs);
  return () => window.clearInterval(id);
}
