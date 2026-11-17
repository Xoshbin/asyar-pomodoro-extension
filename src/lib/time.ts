// ---------------------------------------------------------------------------
// time.ts — the two time formats the ledger needs, kept pure and injected.
//
// `startOfToday` decides what "today" means for the daily ledger; it takes the
// clock as an argument so a test can pin it. `formatClockTime` is the 12-hour
// wall-clock reading used at the right edge of a session row.
// ---------------------------------------------------------------------------

/** Local midnight of the day that contains `now` (Unix ms). */
export function startOfToday(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** `10:45 AM` — locale-aware, minute precision. */
export function formatClockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}