import { describe, it, expect, beforeEach } from 'vitest';
import {
  TimerEngine,
  DEFAULT_STATE,
  type HistoryEntry,
  type TimerState,
  type Scheduler,
  type SchedulingHandle,
} from './timerEngine';

// ---------------------------------------------------------------------------
// Test fakes
// ---------------------------------------------------------------------------

class FakeStore {
  private data = new Map<string, unknown>();
  seed(key: string, value: unknown): void {
    this.data.set(key, value);
  }
  async get(key: string): Promise<unknown> {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  async set(key: string, value: unknown): Promise<void> {
    // Round-trip through JSON so tests catch accidental non-serialisable
    // values slipping into persisted state.
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }
  read<T = unknown>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }
}

class FakePrefs {
  public values: Record<string, unknown> = {};
  update(patch: Record<string, unknown>): void {
    this.values = { ...this.values, ...patch };
  }
}

class ManualScheduler implements Scheduler {
  private pending: Array<{
    delay: number;
    cb: () => void | Promise<void>;
    cleared: boolean;
  }> = [];
  after(delayMs: number, cb: () => void | Promise<void>): SchedulingHandle {
    const entry = { delay: delayMs, cb, cleared: false };
    this.pending.push(entry);
    return {
      clear: () => {
        entry.cleared = true;
      },
    };
  }
  /** Fire the most-recently-scheduled live callback (awaits async handlers). */
  async fire(): Promise<void> {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const entry = this.pending[i];
      if (entry.cleared) continue;
      entry.cleared = true;
      await entry.cb();
      return;
    }
    throw new Error('No live scheduled callback to fire');
  }
  liveCount(): number {
    return this.pending.filter((e) => !e.cleared).length;
  }
}

interface Clock { now: number }

const BASE_PREFS = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
};

function makeEngine(overrides: Partial<typeof BASE_PREFS> = {}): {
  engine: TimerEngine;
  store: FakeStore;
  prefs: FakePrefs;
  scheduler: ManualScheduler;
  clock: Clock;
  states: TimerState[];
} {
  const store = new FakeStore();
  const prefs = new FakePrefs();
  prefs.update({ ...BASE_PREFS, ...overrides });
  const scheduler = new ManualScheduler();
  const clock: Clock = { now: 1_700_000_000_000 };
  const states: TimerState[] = [];
  let counter = 0;
  const engine = new TimerEngine({
    state: store,
    preferences: prefs,
    now: () => clock.now,
    scheduler,
    generateId: () => `id-${++counter}`,
  });
  engine.onTransition((s) => states.push(s));
  return { engine, store, prefs, scheduler, clock, states };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimerEngine — init + defaults', () => {
  it('boots to idle with focusMinutes*60 as the display total', async () => {
    const { engine } = makeEngine({ focusMinutes: 30 });
    await engine.init();
    const s = engine.getState();
    expect(s.phase).toBe('idle');
    expect(s.isRunning).toBe(false);
    expect(s.totalSeconds).toBe(30 * 60);
    expect(s.phaseEndsAt).toBeNull();
    expect(s.pausedRemainingSeconds).toBeNull();
  });

  it('leaves DEFAULT_STATE untouched (defensive)', () => {
    expect(DEFAULT_STATE.phase).toBe('idle');
    expect(DEFAULT_STATE.isRunning).toBe(false);
  });
});

describe('TimerEngine — start / pause / resume', () => {
  it('start() anchors phaseEndsAt at now + focusMinutes*60*1000 and schedules end', async () => {
    const { engine, clock, scheduler, states } = makeEngine({ focusMinutes: 25 });
    await engine.init();
    states.length = 0;
    await engine.start();
    const s = engine.getState();
    expect(s.phase).toBe('focus');
    expect(s.isRunning).toBe(true);
    expect(s.phaseEndsAt).toBe(clock.now + 25 * 60 * 1000);
    expect(s.totalSeconds).toBe(25 * 60);
    expect(s.pausedRemainingSeconds).toBeNull();
    expect(scheduler.liveCount()).toBe(1);
    expect(states.length).toBeGreaterThanOrEqual(1);
  });

  it('start() while running is a no-op', async () => {
    const { engine, scheduler } = makeEngine();
    await engine.init();
    await engine.start();
    const first = engine.getState();
    await engine.start();
    expect(engine.getState()).toEqual(first);
    expect(scheduler.liveCount()).toBe(1);
  });

  it('pause() snapshots remaining seconds and clears phaseEndsAt + schedule', async () => {
    const { engine, clock, scheduler } = makeEngine({ focusMinutes: 25 });
    await engine.init();
    await engine.start();
    clock.now += 5 * 60 * 1000 + 500; // 5 min 0.5 s in
    await engine.pause();
    const s = engine.getState();
    expect(s.isRunning).toBe(false);
    expect(s.phaseEndsAt).toBeNull();
    expect(s.pausedRemainingSeconds).toBe(25 * 60 - 5 * 60);
    expect(scheduler.liveCount()).toBe(0);
  });

  it('resume() re-anchors phaseEndsAt from pausedRemainingSeconds', async () => {
    const { engine, clock } = makeEngine({ focusMinutes: 25 });
    await engine.init();
    await engine.start();
    clock.now += 10 * 60 * 1000;
    await engine.pause();
    clock.now += 9999;
    await engine.resume();
    const s = engine.getState();
    expect(s.isRunning).toBe(true);
    expect(s.phaseEndsAt).toBe(clock.now + 15 * 60 * 1000);
    expect(s.pausedRemainingSeconds).toBeNull();
  });
});

describe('TimerEngine — phase completion + history + notifications', () => {
  it('records a history entry and advances to short-break after a focus completion', async () => {
    const { engine, scheduler, store } = makeEngine();
    await engine.init();
    await engine.start();
    await scheduler.fire();
    const s = engine.getState();
    expect(s.phase).toBe('short-break');
    expect(s.isRunning).toBe(false); // auto-start-breaks is off
    expect(s.totalSeconds).toBe(5 * 60);
    expect(s.sessionsCompleted).toBe(1);
    expect(s.totalSessionsEver).toBe(1);
    const history = store.read<HistoryEntry[]>('history') ?? [];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      phase: 'focus',
      durationMinutes: 25,
      wasInterrupted: false,
    });
  });

  it('auto-starts the break when autoStartBreaks is true', async () => {
    const { engine, scheduler, clock } = makeEngine({ autoStartBreaks: true });
    await engine.init();
    await engine.start();
    await scheduler.fire();
    const s = engine.getState();
    expect(s.phase).toBe('short-break');
    expect(s.isRunning).toBe(true);
    expect(s.phaseEndsAt).toBe(clock.now + 5 * 60 * 1000);
    expect(scheduler.liveCount()).toBe(1);
  });

  it('returns to focus after a break, with sessionsCompleted preserved', async () => {
    const { engine, scheduler } = makeEngine({ autoStartBreaks: true });
    await engine.init();
    await engine.start();                 // focus begins
    await scheduler.fire();                // focus completes → break begins
    expect(engine.getState().phase).toBe('short-break');
    await scheduler.fire();                // break completes → focus at idle
    const s = engine.getState();
    expect(s.phase).toBe('focus');
    expect(s.sessionsCompleted).toBe(1);
    expect(s.isRunning).toBe(false); // autoStartFocus is off
  });

  it('picks long-break every sessionsBeforeLongBreak focuses', async () => {
    const { engine, scheduler } = makeEngine({
      autoStartBreaks: true,
      autoStartFocus: true,
      sessionsBeforeLongBreak: 2,
    });
    await engine.init();
    await engine.start();              // F1
    await scheduler.fire();             // → short-break
    await scheduler.fire();             // → F2
    await scheduler.fire();             // F2 done → long-break (sessionsCompleted=2, 2 % 2 === 0)
    const s = engine.getState();
    expect(s.phase).toBe('long-break');
    expect(s.sessionsCompleted).toBe(2);
  });
});

describe('TimerEngine — stop / skip', () => {
  it('stop() records an interrupted entry when elapsed > 10s', async () => {
    const { engine, clock, store } = makeEngine();
    await engine.init();
    await engine.start();
    clock.now += 30_000; // 30 s in
    await engine.stop();
    const s = engine.getState();
    expect(s.phase).toBe('idle');
    expect(s.isRunning).toBe(false);
    const history = store.read<HistoryEntry[]>('history') ?? [];
    expect(history).toHaveLength(1);
    expect(history[0].wasInterrupted).toBe(true);
  });

  it('stop() records nothing when elapsed <= 10s', async () => {
    const { engine, clock, store } = makeEngine();
    await engine.init();
    await engine.start();
    clock.now += 5_000;
    await engine.stop();
    const history = store.read<HistoryEntry[]>('history') ?? [];
    expect(history).toHaveLength(0);
  });

  it('skip() from focus advances + records interrupted if > 10s', async () => {
    const { engine, clock, store } = makeEngine();
    await engine.init();
    await engine.start();
    clock.now += 11_000;
    await engine.skip();
    expect(engine.getState().phase).toBe('short-break');
    expect(engine.getState().sessionsCompleted).toBe(1);
    const history = store.read<HistoryEntry[]>('history') ?? [];
    expect(history).toHaveLength(1);
    expect(history[0].wasInterrupted).toBe(true);
  });

  it('skip() while idle starts a focus session', async () => {
    const { engine, clock } = makeEngine();
    await engine.init();
    await engine.skip();
    const s = engine.getState();
    expect(s.phase).toBe('focus');
    expect(s.isRunning).toBe(true);
    expect(s.phaseEndsAt).toBe(clock.now + 25 * 60 * 1000);
  });
});

describe('TimerEngine — history bounds + clearHistory', () => {
  it('bounds history at 50 entries (most-recent first)', async () => {
    const { engine, scheduler, store } = makeEngine({
      focusMinutes: 1,
      autoStartBreaks: true,
      autoStartFocus: true,
    });
    await engine.init();
    await engine.start();
    // 55 phase transitions: each fire() completes one phase and auto-starts next.
    for (let i = 0; i < 55; i++) await scheduler.fire();
    const history = store.read<HistoryEntry[]>('history') ?? [];
    expect(history.length).toBe(50);
  });

  it('clearHistory() empties history and persists', async () => {
    const { engine, scheduler, store } = makeEngine();
    await engine.init();
    await engine.start();
    await scheduler.fire();
    expect((store.read<HistoryEntry[]>('history') ?? []).length).toBe(1);
    await engine.clearHistory();
    expect(store.read<HistoryEntry[]>('history')).toEqual([]);
    expect(engine.getHistory()).toEqual([]);
  });
});

describe('TimerEngine — init reconstruction', () => {
  it('silently advances when persisted phase already expired', async () => {
    const store = new FakeStore();
    const base = 1_700_000_000_000;
    const expired: TimerState = {
      phase: 'focus',
      isRunning: true,
      phaseEndsAt: base - 5_000,
      pausedRemainingSeconds: null,
      totalSeconds: 25 * 60,
      sessionsCompleted: 0,
      totalSessionsEver: 0,
    };
    store.seed('timer', expired);
    const prefs = new FakePrefs();
    prefs.update(BASE_PREFS);
    const engine = new TimerEngine({
      state: store,
      preferences: prefs,
      now: () => base,
      scheduler: new ManualScheduler(),
    });
    await engine.init();
    const s = engine.getState();
    expect(s.phase).toBe('short-break');
    expect(s.isRunning).toBe(false);
    expect(s.sessionsCompleted).toBe(1);
  });

  it('reschedules phaseEnd for a still-running persisted session', async () => {
    const store = new FakeStore();
    const base = 1_700_000_000_000;
    const future = base + 60_000;
    store.seed('timer', {
      phase: 'focus',
      isRunning: true,
      phaseEndsAt: future,
      pausedRemainingSeconds: null,
      totalSeconds: 25 * 60,
      sessionsCompleted: 2,
      totalSessionsEver: 2,
    });
    const prefs = new FakePrefs();
    prefs.update(BASE_PREFS);
    const scheduler = new ManualScheduler();
    const engine = new TimerEngine({
      state: store,
      preferences: prefs,
      now: () => base,
      scheduler,
    });
    await engine.init();
    const s = engine.getState();
    expect(s.isRunning).toBe(true);
    expect(s.phaseEndsAt).toBe(future);
    expect(scheduler.liveCount()).toBe(1);
  });
});

describe('TimerEngine — backgroundTick safety net', () => {
  it('advances the phase when now has passed phaseEndsAt but scheduler never fired', async () => {
    const { engine, clock, scheduler, store } = makeEngine();
    await engine.init();
    await engine.start();
    clock.now += 25 * 60 * 1000 + 1_000;
    // Scheduler callback never fired (simulating worker suspension).
    await engine.backgroundTick();
    expect(engine.getState().phase).toBe('short-break');
    const history = store.read<HistoryEntry[]>('history') ?? [];
    expect(history).toHaveLength(1);
    // The pending scheduler handle from start() was cleared during advance.
    expect(scheduler.liveCount()).toBeLessThanOrEqual(0);
  });

  it('is a no-op when not running', async () => {
    const { engine, store } = makeEngine();
    await engine.init();
    await engine.backgroundTick();
    expect(store.read('history')).toBeUndefined();
    expect(engine.getState().phase).toBe('idle');
  });
});

describe('TimerEngine — preferences reactivity', () => {
  it('idle display tracks focusMinutes on preferencesChanged', async () => {
    const { engine, prefs } = makeEngine({ focusMinutes: 25 });
    await engine.init();
    expect(engine.getState().totalSeconds).toBe(25 * 60);
    prefs.update({ focusMinutes: 50 });
    await engine.preferencesChanged();
    expect(engine.getState().totalSeconds).toBe(50 * 60);
  });

  it('leaves a running session alone when focusMinutes changes', async () => {
    const { engine, clock, prefs } = makeEngine({ focusMinutes: 25 });
    await engine.init();
    await engine.start();
    const before = engine.getState();
    prefs.update({ focusMinutes: 40 });
    clock.now += 1;
    await engine.preferencesChanged();
    const after = engine.getState();
    expect(after.totalSeconds).toBe(before.totalSeconds);
    expect(after.phaseEndsAt).toBe(before.phaseEndsAt);
  });
});
