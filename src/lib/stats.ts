import type { HistoryEntry } from './timerEngine';
import { startOfToday } from './time';

export interface TodayStats {
  focusMinutes: number;
  focusFormatted: string;
  completedSessions: number;
  interruptedSessions: number;
  breakMinutes: number;
  streakDays: number;
  dailyGoalSessions: number;
  dailyGoalPercent: number;
}

export function formatDuration(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  if (rounded < 60) {
    return `${rounded}m`;
  }
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function formatTimeRange(completedAt: number, durationMinutes: number): string {
  const durationMs = Math.round(durationMinutes * 60 * 1000);
  const startedAt = completedAt - durationMs;
  const start = new Date(startedAt);
  const end = new Date(completedAt);

  const fmt = (d: Date) => {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  return `${fmt(start)} – ${fmt(end)}`;
}

export function calculateStreak(history: readonly HistoryEntry[], now: number): number {
  const completedFocus = history.filter(
    (h) => h.phase === 'focus' && !h.wasInterrupted,
  );
  if (completedFocus.length === 0) return 0;

  const dateKey = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const activeDates = new Set(completedFocus.map((h) => dateKey(h.completedAt)));
  const todayKey = dateKey(now);

  const oneDayMs = 24 * 60 * 60 * 1000;
  let checkTime = now;
  let streak = 0;

  // If today has completed session, start streak from today.
  // Otherwise check if yesterday had a completed session so streak isn't lost yet today.
  if (activeDates.has(todayKey)) {
    streak++;
    checkTime -= oneDayMs;
  } else {
    const yesterdayKey = dateKey(now - oneDayMs);
    if (!activeDates.has(yesterdayKey)) {
      return 0;
    }
    // Count from yesterday
    checkTime -= oneDayMs;
  }

  while (activeDates.has(dateKey(checkTime))) {
    streak++;
    checkTime -= oneDayMs;
  }

  return streak;
}

export function computeTodayStats(
  history: readonly HistoryEntry[],
  now: number,
  dailyGoalSessions = 8,
): TodayStats {
  const todayTs = startOfToday(now);

  const todayEntries = history.filter((h) => h.completedAt >= todayTs);

  let focusMinutes = 0;
  let completedSessions = 0;
  let interruptedSessions = 0;
  let breakMinutes = 0;

  for (const entry of todayEntries) {
    if (entry.phase === 'focus') {
      if (entry.wasInterrupted) {
        interruptedSessions++;
        focusMinutes += entry.durationMinutes;
      } else {
        completedSessions++;
        focusMinutes += entry.durationMinutes;
      }
    } else {
      breakMinutes += entry.durationMinutes;
    }
  }

  const roundedFocus = Math.round(focusMinutes);
  const roundedBreak = Math.round(breakMinutes);
  const streakDays = calculateStreak(history, now);
  const dailyGoalPercent = Math.min(
    100,
    Math.round((completedSessions / Math.max(1, dailyGoalSessions)) * 100),
  );

  return {
    focusMinutes: roundedFocus,
    focusFormatted: formatDuration(roundedFocus),
    completedSessions,
    interruptedSessions,
    breakMinutes: roundedBreak,
    streakDays,
    dailyGoalSessions,
    dailyGoalPercent,
  };
}
