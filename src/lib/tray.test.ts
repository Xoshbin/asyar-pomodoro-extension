import { describe, expect, it, vi } from 'vitest';
import type { IStatusBarService } from 'asyar-sdk/contracts';
import type { TimerState } from './timerEngine';
import { PomodoroTray, trayTitle } from './tray';

function timerState(overrides: Partial<TimerState> = {}): TimerState {
  return {
    phase: 'focus',
    isRunning: true,
    phaseEndsAt: 1_500_000,
    pausedRemainingSeconds: null,
    totalSeconds: 1_500,
    sessionsCompleted: 0,
    totalSessionsEver: 0,
    ...overrides,
  };
}

describe('trayTitle', () => {
  it('formats a running countdown from the injected clock', () => {
    expect(trayTitle(timerState(), 43_000)).toBe('🍅 24:17');
    expect(trayTitle(timerState(), 47_500)).toBe('🍅 24:13');
  });

  it('shows the frozen remaining time while paused', () => {
    expect(
      trayTitle(
        timerState({
          isRunning: false,
          phaseEndsAt: null,
          pausedRemainingSeconds: 1_453,
        }),
        99_000,
      ),
    ).toBe('⏸ 24:13');
  });

  it('clears the title while idle', () => {
    expect(
      trayTitle(
        timerState({
          phase: 'idle',
          isRunning: false,
          phaseEndsAt: null,
          pausedRemainingSeconds: null,
        }),
        0,
      ),
    ).toBeUndefined();
  });
});

describe('PomodoroTray', () => {
  it('refreshes the running title every second and stops refreshing when paused', () => {
    vi.useFakeTimers();
    try {
      let now = 43_000;
      let current = timerState();
      const statusBar = {
        registerItem: vi.fn(),
        updateItem: vi.fn(),
        unregisterItem: vi.fn(),
      } as unknown as IStatusBarService;
      const tray = new PomodoroTray(statusBar, () => current, () => now);

      tray.sync(current);
      expect(statusBar.registerItem).toHaveBeenCalledWith(
        expect.objectContaining({ title: '🍅 24:17' }),
      );

      now = 44_000;
      vi.advanceTimersByTime(1_000);
      now = 45_000;
      vi.advanceTimersByTime(1_000);
      expect(statusBar.updateItem).toHaveBeenNthCalledWith(
        2,
        'timer-status',
        expect.objectContaining({ title: '🍅 24:15' }),
      );

      current = timerState({
        isRunning: false,
        phaseEndsAt: null,
        pausedRemainingSeconds: 1_455,
      });
      tray.sync(current);
      vi.advanceTimersByTime(2_000);
      expect(statusBar.updateItem).toHaveBeenCalledTimes(3);

      tray.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('unregisters and clears its refresh interval when idle', () => {
    vi.useFakeTimers();
    try {
      const statusBar = {
        registerItem: vi.fn(),
        updateItem: vi.fn(),
        unregisterItem: vi.fn(),
      } as unknown as IStatusBarService;
      let current = timerState();
      const tray = new PomodoroTray(statusBar, () => current, () => 0);
      tray.sync(current);

      current = timerState({ phase: 'idle', isRunning: false, phaseEndsAt: null });
      tray.sync(current);
      vi.advanceTimersByTime(2_000);

      expect(statusBar.unregisterItem).toHaveBeenCalledWith('timer-status');
      expect(statusBar.updateItem).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
