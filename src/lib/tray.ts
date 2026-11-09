import type { IStatusBarItem, IStatusBarService } from 'asyar-sdk/contracts';
import { formatTime, type TimerPhase, type TimerState } from './timerEngine';

export const POMODORO_TRAY_ITEM_ID = 'timer-status';

function trayIconFor(phase: TimerPhase): string {
  if (phase === 'focus') return '🍅';
  if (phase === 'short-break') return '☕';
  if (phase === 'long-break') return '🛋️';
  return '🍅';
}

function remainingSeconds(state: TimerState, nowMs: number): number {
  if (state.isRunning && state.phaseEndsAt !== null) {
    return Math.max(0, Math.ceil((state.phaseEndsAt - nowMs) / 1000));
  }
  if (state.pausedRemainingSeconds !== null) return state.pausedRemainingSeconds;
  return state.totalSeconds;
}

export function trayTitle(state: TimerState, nowMs: number): string | undefined {
  if (state.phase === 'idle') return undefined;
  const prefix = state.pausedRemainingSeconds === null ? trayIconFor(state.phase) : '⏸';
  return `${prefix} ${formatTime(remainingSeconds(state, nowMs))}`;
}

function trayItem(state: TimerState, nowMs: number): IStatusBarItem {
  const time = formatTime(remainingSeconds(state, nowMs));
  return {
    id: POMODORO_TRAY_ITEM_ID,
    icon: trayIconFor(state.phase),
    text: state.pausedRemainingSeconds === null ? time : `⏸ ${time}`,
    title: trayTitle(state, nowMs),
  };
}

export class PomodoroTray {
  private registered = false;
  private refreshId: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly statusBar: IStatusBarService,
    private readonly getState: () => TimerState,
    private readonly now: () => number,
  ) {}

  sync(state: TimerState): void {
    this.stopRefresh();
    if (state.phase === 'idle') {
      this.unregister();
      return;
    }

    this.render(state);
    if (state.isRunning) {
      this.refreshId = setInterval(() => this.syncFromClock(), 1_000);
    }
  }

  dispose(): void {
    this.stopRefresh();
    this.unregister();
  }

  private syncFromClock(): void {
    const state = this.getState();
    if (!state.isRunning || state.phase === 'idle') {
      this.sync(state);
      return;
    }
    this.render(state);
  }

  private render(state: TimerState): void {
    const item = trayItem(state, this.now());
    if (this.registered) {
      this.statusBar.updateItem(POMODORO_TRAY_ITEM_ID, {
        icon: item.icon,
        text: item.text,
        title: item.title,
      });
      return;
    }
    this.statusBar.registerItem(item);
    this.registered = true;
  }

  private stopRefresh(): void {
    if (this.refreshId === undefined) return;
    clearInterval(this.refreshId);
    this.refreshId = undefined;
  }

  private unregister(): void {
    if (!this.registered) return;
    this.statusBar.unregisterItem(POMODORO_TRAY_ITEM_ID);
    this.registered = false;
  }
}
