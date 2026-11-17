import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatTimeRange,
  calculateStreak,
  computeTodayStats,
} from './stats';
import type { HistoryEntry } from './timerEngine';

describe('formatDuration', () => {
  it('formats under an hour as minutes', () => {
    expect(formatDuration(25)).toBe('25m');
    expect(formatDuration(5)).toBe('5m');
    expect(formatDuration(0)).toBe('0m');
  });

  it('formats exact hours', () => {
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(120)).toBe('2h');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(85)).toBe('1h 25m');
    expect(formatDuration(130)).toBe('2h 10m');
  });
});

describe('formatTimeRange', () => {
  it('computes start time from completedAt and duration', () => {
    // 2026-05-20 10:30:00 UTC/local
    const end = new Date(2026, 4, 20, 10, 30, 0).getTime();
    const result = formatTimeRange(end, 25);
    expect(result).toBe('10:05 – 10:30');
  });
});

describe('calculateStreak', () => {
  const oneDay = 24 * 60 * 60 * 1000;
  const now = new Date(2026, 4, 20, 14, 0, 0).getTime();

  it('returns 0 when no completed focus sessions', () => {
    expect(calculateStreak([], now)).toBe(0);
    const interrupted: HistoryEntry[] = [
      { id: '1', phase: 'focus', durationMinutes: 10, completedAt: now, wasInterrupted: true },
    ];
    expect(calculateStreak(interrupted, now)).toBe(0);
  });

  it('counts 1 day when completed today', () => {
    const history: HistoryEntry[] = [
      { id: '1', phase: 'focus', durationMinutes: 25, completedAt: now - 1000, wasInterrupted: false },
    ];
    expect(calculateStreak(history, now)).toBe(1);
  });

  it('counts consecutive past days', () => {
    const history: HistoryEntry[] = [
      { id: '1', phase: 'focus', durationMinutes: 25, completedAt: now - 1000, wasInterrupted: false },
      { id: '2', phase: 'focus', durationMinutes: 25, completedAt: now - oneDay, wasInterrupted: false },
      { id: '3', phase: 'focus', durationMinutes: 25, completedAt: now - 2 * oneDay, wasInterrupted: false },
    ];
    expect(calculateStreak(history, now)).toBe(3);
  });
});

describe('computeTodayStats', () => {
  it('aggregates today focus, sessions, and breaks', () => {
    const now = new Date(2026, 4, 20, 14, 0, 0).getTime();
    const todayMorning = new Date(2026, 4, 20, 9, 30, 0).getTime();
    const yesterday = now - 24 * 60 * 60 * 1000;

    const history: HistoryEntry[] = [
      { id: '1', phase: 'focus', durationMinutes: 25, completedAt: todayMorning, wasInterrupted: false },
      { id: '2', phase: 'short-break', durationMinutes: 5, completedAt: todayMorning + 5 * 60000, wasInterrupted: false },
      { id: '3', phase: 'focus', durationMinutes: 50, completedAt: todayMorning + 60 * 60000, wasInterrupted: false },
      { id: '4', phase: 'focus', durationMinutes: 10, completedAt: todayMorning + 90 * 60000, wasInterrupted: true },
      // Yesterday entry should be excluded from today stats
      { id: '5', phase: 'focus', durationMinutes: 25, completedAt: yesterday, wasInterrupted: false },
    ];

    const stats = computeTodayStats(history, now, 4);
    expect(stats.completedSessions).toBe(2);
    expect(stats.interruptedSessions).toBe(1);
    expect(stats.focusMinutes).toBe(85);
    expect(stats.focusFormatted).toBe('1h 25m');
    expect(stats.breakMinutes).toBe(5);
    expect(stats.dailyGoalPercent).toBe(50);
  });
});
