// ---------------------------------------------------------------------------
// timerEngine.ts — Pomodoro timer state machine, worker-side.
//
// Ownership: runs inside the Tier 2 worker iframe. Persists through the
// launcher-brokered extension state store (svc.state) under two keys —
// "timer" and "history" — scoped automatically to this extension.
//
// Writer rule: worker writes state ONLY on transitions (start/pause/resume/
// stop/skip/phase-advance/clearHistory). NEVER on a clock interval. The view
// derives remainingSeconds locally from phaseEndsAt + Date.now() via a
// view-scoped setInterval. Any svc.state.set call from this module must
// correspond to a real transition.
//
// Scheduling: setTimeout (via the injected Scheduler) fires phaseEndsAt
// deterministically under steady state. The 60-second `tick` command is a
// safety net for iframe suspension — calling backgroundTick() advances the
// phase if now has passed phaseEndsAt and the primary scheduler callback
// never ran.
// ---------------------------------------------------------------------------

export type TimerPhase = 'idle' | 'focus' | 'short-break' | 'long-break';

export interface TimerState {
  phase: TimerPhase;
  isRunning: boolean;
  /** Unix ms at which the running phase ends. null while paused or idle. */
  phaseEndsAt: number | null;
  /** Seconds left at the moment of pause. null while running or idle. */
  pausedRemainingSeconds: number | null;
  /** Duration of the current phase, in seconds. Used for progress-ring max. */
  totalSeconds: number;
  sessionsCompleted: number;
  totalSessionsEver: number;
}

export interface HistoryEntry {
  id: string;
  phase: 'focus' | 'short-break' | 'long-break';
  durationMinutes: number;
  completedAt: number;
  wasInterrupted: boolean;
}

export interface TimerSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
}

export interface StateStoreView {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface PreferencesView {
  readonly values: Readonly<Record<string, unknown>>;
}

export interface SchedulingHandle {
  clear(): void;
}

export interface Scheduler {
  after(delayMs: number, cb: () => void | Promise<void>): SchedulingHandle;
}

export interface TimerEngineDeps {
  state: StateStoreView;
  preferences: PreferencesView;
  now: () => number;
  /** Injectable for tests; defaults to setTimeout. */
  scheduler?: Scheduler;
  /** Injectable for tests; defaults to crypto.randomUUID. */
  generateId?: () => string;
  /**
   * Fires when a phase completes naturally (not via skip/stop). The worker
   * wires this to the notification service. Intentionally not fired on the
   * silent-advance path in init() — we don't know how late we are.
   */
  onPhaseComplete?: (
    completed: TimerPhase,
    next: TimerPhase,
    snapshot: TimerState,
  ) => void;
}

const MAX_HISTORY = 50;
const KEY_TIMER = 'timer';
const KEY_HISTORY = 'history';

export const DEFAULT_STATE: TimerState = Object.freeze({
  phase: 'idle',
  isRunning: false,
  phaseEndsAt: null,
  pausedRemainingSeconds: null,
  totalSeconds: 0,
  sessionsCompleted: 0,
  totalSessionsEver: 0,
});

const defaultScheduler: Scheduler = {
  after(delayMs, cb) {
    const id = setTimeout(() => {
      void cb();
    }, delayMs);
    return {
      clear: () => clearTimeout(id),
    };
  },
};

export class TimerEngine {
  private state: TimerState = { ...DEFAULT_STATE };
  private history: HistoryEntry[] = [];
  private phaseEndHandle: SchedulingHandle | null = null;
  private transitionListener: ((s: TimerState) => void) | null = null;

  constructor(private deps: TimerEngineDeps) {}

  async init(): Promise<void> {
    try {
      const rawHistory = await this.deps.state.get(KEY_HISTORY);
      if (Array.isArray(rawHistory)) {
        this.history = rawHistory as HistoryEntry[];
      }
    } catch {
      // Start empty on deserialization failure.
    }

    try {
      const rawState = await this.deps.state.get(KEY_TIMER);
      if (rawState && typeof rawState === 'object') {
        this.state = { ...DEFAULT_STATE, ...(rawState as Partial<TimerState>) };
      }
    } catch {
      this.state = { ...DEFAULT_STATE };
    }

    if (
      this.state.isRunning &&
      this.state.phaseEndsAt !== null &&
      this.deps.now() >= this.state.phaseEndsAt
    ) {
      await this.advanceAfterCompletion(this.state.phase, {
        recordHistory: null,
        fireNotification: false,
        forceManualAdvance: true,
      });
    } else if (this.state.isRunning && this.state.phaseEndsAt !== null) {
      this.scheduleEnd();
    }

    if (this.state.phase === 'idle' && !this.state.isRunning) {
      this.state.totalSeconds = this.settings().focusMinutes * 60;
    }

    await this.persistState();
    this.broadcast();
  }

  getState(): TimerState {
    return { ...this.state };
  }

  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  getSettings(): TimerSettings {
    return this.settings();
  }

  onTransition(cb: (s: TimerState) => void): () => void {
    this.transitionListener = cb;
    return () => {
      if (this.transitionListener === cb) this.transitionListener = null;
    };
  }

  async start(): Promise<void> {
    if (this.state.isRunning) return;
    const now = this.deps.now();
    const s = this.settings();

    if (this.state.phase === 'idle') {
      this.state.phase = 'focus';
      this.state.totalSeconds = s.focusMinutes * 60;
      this.state.phaseEndsAt = now + this.state.totalSeconds * 1000;
    } else if (this.state.pausedRemainingSeconds !== null) {
      this.state.phaseEndsAt = now + this.state.pausedRemainingSeconds * 1000;
      this.state.pausedRemainingSeconds = null;
    } else {
      // Idle-at-phase: the previous phase completed without auto-start.
      this.state.phaseEndsAt = now + this.state.totalSeconds * 1000;
    }

    this.state.isRunning = true;
    this.scheduleEnd();
    await this.persistState();
    this.broadcast();
  }

  async resume(): Promise<void> {
    return this.start();
  }

  async pause(): Promise<void> {
    if (!this.state.isRunning) return;
    if (this.state.phaseEndsAt === null) return;

    const remaining = Math.max(
      0,
      Math.ceil((this.state.phaseEndsAt - this.deps.now()) / 1000),
    );
    this.state.isRunning = false;
    this.state.pausedRemainingSeconds = remaining;
    this.state.phaseEndsAt = null;
    this.clearScheduledEnd();

    await this.persistState();
    this.broadcast();
  }

  async stop(): Promise<void> {
    if (this.state.phase === 'idle') {
      const s = this.settings();
      this.state.totalSeconds = s.focusMinutes * 60;
      await this.persistState();
      this.broadcast();
      return;
    }

    const elapsed = this.computeElapsedSeconds();
    if (elapsed > 10) {
      this.pushHistory({
        phase: this.state.phase as HistoryEntry['phase'],
        durationMinutes: elapsed / 60,
        wasInterrupted: true,
      });
      await this.persistHistory();
    }

    this.clearScheduledEnd();

    const s = this.settings();
    this.state = {
      ...DEFAULT_STATE,
      sessionsCompleted: this.state.sessionsCompleted,
      totalSessionsEver: this.state.totalSessionsEver,
      totalSeconds: s.focusMinutes * 60,
    };

    await this.persistState();
    this.broadcast();
  }

  async skip(): Promise<void> {
    if (this.state.phase === 'idle') {
      return this.start();
    }

    const elapsed = this.computeElapsedSeconds();
    const recordHistory: Omit<HistoryEntry, 'id' | 'completedAt'> | null =
      elapsed > 10
        ? {
            phase: this.state.phase as HistoryEntry['phase'],
            durationMinutes: elapsed / 60,
            wasInterrupted: true,
          }
        : null;

    await this.advanceAfterCompletion(this.state.phase, {
      recordHistory,
      fireNotification: false,
      forceManualAdvance: true,
    });
  }

  async clearHistory(): Promise<void> {
    this.history = [];
    await this.persistHistory();
    this.broadcast();
  }

  async backgroundTick(): Promise<void> {
    if (!this.state.isRunning) return;
    if (this.state.phaseEndsAt === null) return;
    if (this.deps.now() < this.state.phaseEndsAt) return;
    await this.onScheduledPhaseEnd();
  }

  async preferencesChanged(): Promise<void> {
    if (!this.state.isRunning && this.state.phase === 'idle') {
      this.state.totalSeconds = this.settings().focusMinutes * 60;
      await this.persistState();
      this.broadcast();
    } else {
      this.broadcast();
    }
  }

  destroy(): void {
    this.clearScheduledEnd();
    this.transitionListener = null;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private settings(): TimerSettings {
    const p = this.deps.preferences.values;
    const clamp = (v: unknown, min: number, max: number, d: number): number => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return d;
      return Math.max(min, Math.min(max, v));
    };
    const bool = (v: unknown, d: boolean): boolean =>
      typeof v === 'boolean' ? v : d;
    return {
      focusMinutes: clamp(p.focusMinutes, 1, 60, 25),
      shortBreakMinutes: clamp(p.shortBreakMinutes, 1, 15, 5),
      longBreakMinutes: clamp(p.longBreakMinutes, 1, 30, 15),
      sessionsBeforeLongBreak: clamp(p.sessionsBeforeLongBreak, 1, 8, 4),
      autoStartBreaks: bool(p.autoStartBreaks, false),
      autoStartFocus: bool(p.autoStartFocus, false),
    };
  }

  private phaseSeconds(
    phase: TimerPhase,
    s: TimerSettings = this.settings(),
  ): number {
    if (phase === 'focus') return s.focusMinutes * 60;
    if (phase === 'short-break') return s.shortBreakMinutes * 60;
    if (phase === 'long-break') return s.longBreakMinutes * 60;
    return 0;
  }

  private nextPhase(
    completed: TimerPhase,
    sessionsCompleted: number,
  ): TimerPhase {
    if (completed === 'focus') {
      const s = this.settings();
      return sessionsCompleted % s.sessionsBeforeLongBreak === 0
        ? 'long-break'
        : 'short-break';
    }
    return 'focus';
  }

  private computeElapsedSeconds(): number {
    if (this.state.phaseEndsAt !== null) {
      const remaining = Math.max(
        0,
        Math.ceil((this.state.phaseEndsAt - this.deps.now()) / 1000),
      );
      return Math.max(0, this.state.totalSeconds - remaining);
    }
    if (this.state.pausedRemainingSeconds !== null) {
      return Math.max(
        0,
        this.state.totalSeconds - this.state.pausedRemainingSeconds,
      );
    }
    return 0;
  }

  private genId(): string {
    if (this.deps.generateId) return this.deps.generateId();
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private pushHistory(entry: Omit<HistoryEntry, 'id' | 'completedAt'>): void {
    this.history.unshift({
      id: this.genId(),
      completedAt: this.deps.now(),
      ...entry,
    });
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(0, MAX_HISTORY);
    }
  }

  private scheduleEnd(): void {
    this.clearScheduledEnd();
    if (!this.state.isRunning || this.state.phaseEndsAt === null) return;
    const delay = Math.max(0, this.state.phaseEndsAt - this.deps.now());
    const sched = this.deps.scheduler ?? defaultScheduler;
    this.phaseEndHandle = sched.after(delay, async () => {
      this.phaseEndHandle = null;
      await this.onScheduledPhaseEnd();
    });
  }

  private clearScheduledEnd(): void {
    if (this.phaseEndHandle) {
      this.phaseEndHandle.clear();
      this.phaseEndHandle = null;
    }
  }

  private async onScheduledPhaseEnd(): Promise<void> {
    const completed = this.state.phase;
    if (completed === 'idle') return;

    await this.advanceAfterCompletion(completed, {
      recordHistory: {
        phase: completed as HistoryEntry['phase'],
        durationMinutes: this.state.totalSeconds / 60,
        wasInterrupted: false,
      },
      fireNotification: true,
      forceManualAdvance: false,
    });
  }

  private async advanceAfterCompletion(
    completed: TimerPhase,
    opts: {
      recordHistory: Omit<HistoryEntry, 'id' | 'completedAt'> | null;
      fireNotification: boolean;
      forceManualAdvance: boolean;
    },
  ): Promise<void> {
    if (opts.recordHistory) {
      this.pushHistory(opts.recordHistory);
      await this.persistHistory();
    }

    if (completed === 'focus') {
      this.state.sessionsCompleted += 1;
      this.state.totalSessionsEver += 1;
    }

    const settings = this.settings();
    const next = this.nextPhase(completed, this.state.sessionsCompleted);
    const nextSecs = this.phaseSeconds(next, settings);

    this.state.phase = next;
    this.state.totalSeconds = nextSecs;
    this.state.pausedRemainingSeconds = null;
    this.state.phaseEndsAt = null;
    this.state.isRunning = false;
    this.clearScheduledEnd();

    const autoStart =
      !opts.forceManualAdvance &&
      (completed === 'focus'
        ? settings.autoStartBreaks
        : settings.autoStartFocus);

    if (autoStart) {
      this.state.phaseEndsAt = this.deps.now() + nextSecs * 1000;
      this.state.isRunning = true;
      this.scheduleEnd();
    }

    if (opts.fireNotification) {
      this.deps.onPhaseComplete?.(completed, next, this.getState());
    }

    await this.persistState();
    this.broadcast();
  }

  private broadcast(): void {
    this.transitionListener?.(this.getState());
  }

  private async persistState(): Promise<void> {
    await this.deps.state.set(KEY_TIMER, this.state);
  }

  private async persistHistory(): Promise<void> {
    await this.deps.state.set(KEY_HISTORY, this.history);
  }
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
