// Pure text-builder for Pomodoro session summaries. No DOM, no I/O — safe
// to import from worker (copy-summary action handler) or view (in-view Copy
// button). All inputs are injected, including `now`, so the output is
// deterministic under test.

import type { HistoryEntry } from './timerEngine';

export interface SummaryOptions {
  /** Current time in ms — determines what counts as "today". */
  now: number;
  /** Most recent first (insertion order matches worker's unshift pattern). */
  history: readonly HistoryEntry[];
  /** How many "Recent sessions" lines to include. 0 disables the block. */
  recentLimit?: number;
  /**
   * Formatter for clock times in the Recent sessions block. Injected so we
   * don't depend on the runtime's locale — tests pass a deterministic stub.
   */
  formatClockTime?: (ts: number) => string;
  /** Formatter for the calendar date in the header. Same reasoning. */
  formatDate?: (ts: number) => string;
}

function defaultClockTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function defaultDate(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function phaseLabel(phase: HistoryEntry['phase']): string {
  if (phase === 'focus') return '🍅 Focus';
  if (phase === 'short-break') return '☕ Short break';
  return '🛋️ Long break';
}

export function buildSummaryText(opts: SummaryOptions): string {
  const {
    now,
    history,
    recentLimit = 5,
    formatClockTime = defaultClockTime,
    formatDate = defaultDate,
  } = opts;

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayTs = todayStart.getTime();

  const todayFocus = history.filter(
    (r) => r.phase === 'focus' && r.completedAt >= todayTs && !r.wasInterrupted,
  );
  const totalMins = Math.round(
    todayFocus.reduce((acc, r) => acc + r.durationMinutes, 0),
  );

  const lines = [
    `🍅 Pomodoro Summary — ${formatDate(now)}`,
    `• Focus sessions: ${todayFocus.length}`,
    `• Total focus time: ${totalMins} minutes`,
  ];

  if (recentLimit > 0 && history.length > 0) {
    const recent = history.slice(0, recentLimit).map((r) => {
      const when = formatClockTime(r.completedAt);
      const label = phaseLabel(r.phase);
      const mins = Math.round(r.durationMinutes);
      const interrupted = r.wasInterrupted ? ' (interrupted)' : '';
      return `  ${when} — ${label} ${mins}min${interrupted}`;
    });
    lines.push('', 'Recent sessions:', ...recent);
  }

  return lines.join('\n');
}
