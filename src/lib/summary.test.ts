import { describe, it, expect } from 'vitest';
import { buildSummaryText } from './summary';
import type { HistoryEntry } from './timerEngine';

const D = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(y, m - 1, d, h, mi).getTime();

// Deterministic formatters so assertions don't depend on the locale of CI.
const formatClockTime = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const formatDate = () => '2026-04-24';

describe('buildSummaryText', () => {
  it('renders the header with zeros when history is empty', () => {
    const out = buildSummaryText({
      now: D(2026, 4, 24, 14),
      history: [],
      formatClockTime,
      formatDate,
    });
    expect(out).toBe(
      [
        '🍅 Pomodoro Summary — 2026-04-24',
        '• Focus sessions: 0',
        '• Total focus time: 0 minutes',
      ].join('\n'),
    );
  });

  it('counts today-only non-interrupted focus sessions', () => {
    const history: HistoryEntry[] = [
      { id: '1', phase: 'focus',       durationMinutes: 25, completedAt: D(2026, 4, 24, 13), wasInterrupted: false },
      { id: '2', phase: 'focus',       durationMinutes: 24, completedAt: D(2026, 4, 24, 12), wasInterrupted: false },
      { id: '3', phase: 'focus',       durationMinutes: 10, completedAt: D(2026, 4, 24, 11), wasInterrupted: true  },
      { id: '4', phase: 'focus',       durationMinutes: 25, completedAt: D(2026, 4, 23, 14), wasInterrupted: false },
      { id: '5', phase: 'short-break', durationMinutes: 5,  completedAt: D(2026, 4, 24, 11), wasInterrupted: false },
    ];
    const out = buildSummaryText({
      now: D(2026, 4, 24, 14),
      history,
      recentLimit: 0,
      formatClockTime,
      formatDate,
    });
    expect(out).toContain('• Focus sessions: 2');
    expect(out).toContain('• Total focus time: 49 minutes');
  });

  it('emits a Recent sessions block with up to recentLimit rows', () => {
    const history: HistoryEntry[] = [
      { id: 'a', phase: 'focus',       durationMinutes: 25, completedAt: D(2026, 4, 24, 13, 15), wasInterrupted: false },
      { id: 'b', phase: 'short-break', durationMinutes: 5,  completedAt: D(2026, 4, 24, 12, 45), wasInterrupted: true  },
      { id: 'c', phase: 'long-break',  durationMinutes: 15, completedAt: D(2026, 4, 24, 12, 0),  wasInterrupted: false },
    ];
    const out = buildSummaryText({
      now: D(2026, 4, 24, 14),
      history,
      recentLimit: 2,
      formatClockTime,
      formatDate,
    });
    const rows = out.split('\n');
    expect(rows).toContain('Recent sessions:');
    expect(rows.filter((r) => r.startsWith('  '))).toHaveLength(2);
    expect(out).toContain('13:15 — 🍅 Focus 25min');
    expect(out).toContain('12:45 — ☕ Short break 5min (interrupted)');
  });

  it('omits the Recent sessions block when recentLimit is 0', () => {
    const history: HistoryEntry[] = [
      { id: 'a', phase: 'focus', durationMinutes: 25, completedAt: D(2026, 4, 24, 13), wasInterrupted: false },
    ];
    const out = buildSummaryText({
      now: D(2026, 4, 24, 14),
      history,
      recentLimit: 0,
      formatClockTime,
      formatDate,
    });
    expect(out).not.toContain('Recent sessions:');
  });
});
