// ---------------------------------------------------------------------------
// timerEngine.ts — Clock-based Pomodoro timer, wired to SDK services
//
// ARCHITECTURE NOTES
// ------------------
// 1. **Clock-based**: the setInterval is a UI repaint trigger only. Elapsed
//    time is always computed as `Math.floor((Date.now() - startedAt) / 1000)`.
//    This means the timer is correct even if the iframe is suspended, the
//    laptop sleeps, or the launcher is closed and reopened — the next read
//    reconstructs state from the clock anchor.
//
// 2. **Settings from preferences**: durations, session count, and auto-start
//    flags live in the extension manifest as declared preferences. The engine
//    reads them live from `context.preferences` — never cached into a module
//    singleton. When the user edits a preference in the launcher's Extensions
//    tab, `context.setPreferences` installs a new frozen snapshot and fires
//    `onPreferencesChanged` listeners; the engine uses that to recompute the
//    idle display and broadcast.
//
// 3. **State persisted via StorageService**: running/paused state, session
//    counter, and session history all go through the SDK's StorageService,
//    which stores them in the host's SQLite database. Uninstalling the
//    extension clears its data atomically via the platform lifecycle path;
//    localStorage (the old storage) is not wiped on uninstall.
//
// 4. **Async I/O, sync reads**: writes are fire-and-forget — the worst case
//    on crash is losing a second or two of progress, which the clock-based
//    reconstruction handles cleanly on next boot. Reads happen once at
//    `init()` time and block bootstrap.
// ---------------------------------------------------------------------------

import type { ExtensionContext, IStorageService } from 'asyar-sdk';

export type TimerPhase = 'focus' | 'short-break' | 'long-break' | 'idle';

export interface TimerState {
  phase: TimerPhase;
  secondsRemaining: number;
  totalSeconds: number;
  isRunning: boolean;
  sessionsCompleted: number;    // # of focus sessions in current cycle
  totalSessionsEver: number;
  startedAt: number | null;     // Unix timestamp ms — clock anchor
}

export interface SessionRecord {
  id: string;
  phase: TimerPhase;
  durationMinutes: number;
  completedAt: number;          // Unix timestamp ms
  wasInterrupted: boolean;
}

/** Shape of values read from `context.preferences`. All numbers are hours/minutes. */
interface TimerSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
}

// ---------------------------------------------------------------------------
// Storage keys (values persisted via StorageService)
// ---------------------------------------------------------------------------
const KEY_STATE = 'pomodoro:state';
const KEY_HISTORY = 'pomodoro:history';

const DEFAULT_SETTINGS: TimerSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
};

const DEFAULT_STATE: TimerState = {
  phase: 'idle',
  secondsRemaining: 0,
  totalSeconds: 0,
  isRunning: false,
  sessionsCompleted: 0,
  totalSessionsEver: 0,
  startedAt: null,
};

// ---------------------------------------------------------------------------
// Module-level singletons
// ---------------------------------------------------------------------------
let _context: ExtensionContext | null = null;
let _storage: IStorageService | null = null;
let _state: TimerState = { ...DEFAULT_STATE };
let _history: SessionRecord[] = [];

let _intervalId: number | null = null;
let _subscribers: Set<(s: TimerState) => void> = new Set();
let _onComplete: ((completed: TimerPhase, next: TimerPhase) => void) | null = null;
let _unsubPrefs: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Settings: live read from context.preferences, clamped to sensible ranges.
// Called on every phase transition and on every preference change.
// ---------------------------------------------------------------------------
function getSettings(): TimerSettings {
  const prefs = _context?.preferences;
  if (!prefs) return { ...DEFAULT_SETTINGS };

  const clampNumber = (v: unknown, min: number, max: number, fallback: number): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, v));
  };

  return {
    focusMinutes: clampNumber(prefs.focusMinutes, 5, 60, DEFAULT_SETTINGS.focusMinutes),
    shortBreakMinutes: clampNumber(prefs.shortBreakMinutes, 1, 15, DEFAULT_SETTINGS.shortBreakMinutes),
    longBreakMinutes: clampNumber(prefs.longBreakMinutes, 10, 30, DEFAULT_SETTINGS.longBreakMinutes),
    sessionsBeforeLongBreak: clampNumber(
      prefs.sessionsBeforeLongBreak,
      1,
      8,
      DEFAULT_SETTINGS.sessionsBeforeLongBreak
    ),
    autoStartBreaks: typeof prefs.autoStartBreaks === 'boolean'
      ? prefs.autoStartBreaks
      : DEFAULT_SETTINGS.autoStartBreaks,
    autoStartFocus: typeof prefs.autoStartFocus === 'boolean'
      ? prefs.autoStartFocus
      : DEFAULT_SETTINGS.autoStartFocus,
  };
}

// ---------------------------------------------------------------------------
// Persistence (fire-and-forget writes via StorageService).
//
// We intentionally do NOT await these writes from tick() / start() / pause().
// The clock-based architecture means a lost write on crash loses at most a
// second or two — the reconstruction in init() recovers cleanly.
// ---------------------------------------------------------------------------
function persistState(): void {
  if (!_storage) return;
  void _storage.set(KEY_STATE, JSON.stringify(_state)).catch(() => { /* ignore */ });
}

function persistHistory(): void {
  if (!_storage) return;
  // Bound history growth — keep only the most recent 50 entries.
  void _storage.set(KEY_HISTORY, JSON.stringify(_history.slice(0, 50))).catch(() => { /* ignore */ });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function broadcast(): void {
  const snap = { ..._state };
  _subscribers.forEach((cb) => {
    try {
      cb(snap);
    } catch {
      /* ignore */
    }
  });
}

function phaseSeconds(phase: TimerPhase, settings: TimerSettings = getSettings()): number {
  if (phase === 'focus') return settings.focusMinutes * 60;
  if (phase === 'short-break') return settings.shortBreakMinutes * 60;
  if (phase === 'long-break') return settings.longBreakMinutes * 60;
  return 0;
}

function nextPhaseAfter(completed: TimerPhase, sessionsCompleted: number): TimerPhase {
  if (completed === 'focus') {
    const settings = getSettings();
    return sessionsCompleted % settings.sessionsBeforeLongBreak === 0
      ? 'long-break'
      : 'short-break';
  }
  return 'focus';
}

function startInterval(): void {
  if (_intervalId !== null) return;
  _intervalId = window.setInterval(tick, 1000);
}

function stopInterval(): void {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

/**
 * UI repaint + phase-expiry check. Called every second while the iframe is
 * alive. Also called from the scheduled background tick command as a safety
 * net when the iframe has been suspended.
 */
function tick(): void {
  if (!_state.isRunning || _state.startedAt === null) return;

  // Clock-based: recalculate from anchor.
  const elapsed = Math.floor((Date.now() - _state.startedAt) / 1000);
  const remaining = Math.max(0, _state.totalSeconds - elapsed);
  _state.secondsRemaining = remaining;

  if (remaining <= 0) {
    completePhase();
  }

  persistState();
  broadcast();
}

function completePhase(): void {
  const completed = _state.phase;
  const settings = getSettings();

  // Record completed session
  _history.unshift({
    id: crypto.randomUUID(),
    phase: completed,
    durationMinutes: _state.totalSeconds / 60,
    completedAt: Date.now(),
    wasInterrupted: false,
  });
  persistHistory();

  if (completed === 'focus') {
    _state.sessionsCompleted += 1;
    _state.totalSessionsEver += 1;
  }

  const next = nextPhaseAfter(completed, _state.sessionsCompleted);

  // Fire notification callback (injected from main.ts)
  if (_onComplete) {
    try {
      _onComplete(completed, next);
    } catch {
      /* ignore */
    }
  }

  const nextSecs = phaseSeconds(next, settings);
  const autoStart = completed === 'focus' ? settings.autoStartBreaks : settings.autoStartFocus;

  _state.phase = next;
  _state.totalSeconds = nextSecs;
  _state.secondsRemaining = nextSecs;

  if (autoStart) {
    _state.startedAt = Date.now();
    _state.isRunning = true;
  } else {
    _state.startedAt = null;
    _state.isRunning = false;
    stopInterval();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the engine from StorageService. Reconstructs clock-based timer
 * state if a run was in progress when the iframe last died. Call once at
 * the top of main.ts.
 *
 * Async because StorageService reads go over IPC. All subsequent engine
 * operations are synchronous.
 */
export async function init(
  context: ExtensionContext,
  onComplete?: (completed: TimerPhase, next: TimerPhase) => void
): Promise<void> {
  _context = context;
  _storage = context.getService<IStorageService>('storage');
  _onComplete = onComplete ?? null;

  // Load persisted history. StorageService.get returns Promise<string | null>.
  try {
    const raw = await _storage.get(KEY_HISTORY);
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) _history = parsed;
    }
  } catch {
    _history = [];
  }

  // Load persisted state + reconstruct clock-based remaining time
  try {
    const raw = await _storage.get(KEY_STATE);
    if (typeof raw === 'string') {
      const parsed: TimerState = JSON.parse(raw);
      _state = { ...DEFAULT_STATE, ...parsed };

      if (_state.isRunning && _state.startedAt !== null) {
        const elapsed = Math.floor((Date.now() - _state.startedAt) / 1000);
        const remaining = Math.max(0, _state.totalSeconds - elapsed);
        _state.secondsRemaining = remaining;

        if (remaining <= 0) {
          // Expired while the iframe was dead — advance to next phase.
          // We intentionally do NOT fire the notification callback here:
          // the scheduled tick command (if it fired first) is responsible
          // for user-visible notifications. Silent advancement here keeps
          // the UI consistent on next open without spamming the user.
          if (_state.phase === 'focus') {
            _state.sessionsCompleted += 1;
            _state.totalSessionsEver += 1;
          }
          const next = nextPhaseAfter(_state.phase, _state.sessionsCompleted);
          _state.phase = next;
          _state.totalSeconds = phaseSeconds(next);
          _state.secondsRemaining = phaseSeconds(next);
          _state.isRunning = false;
          _state.startedAt = null;
          persistState();
        }
      }
    }
  } catch {
    _state = { ...DEFAULT_STATE };
  }

  // When the timer is idle, the display always reflects CURRENT preferences,
  // not whatever `totalSeconds` happened to be persisted from a previous
  // session or a previous pre-fill. Persisted state is only authoritative
  // for *running* timers, where it anchors the clock reconstruction.
  //
  // This prevents a sticky-state bug where the engine would read
  // persisted `{totalSeconds: 1500}` from an earlier session, take the
  // "state already filled" branch, and never re-evaluate against fresh
  // preferences — leaving the idle display stuck at the old value.
  if (!_state.isRunning && _state.phase === 'idle') {
    const s = getSettings();
    _state.totalSeconds = s.focusMinutes * 60;
    _state.secondsRemaining = s.focusMinutes * 60;
  }

  if (_state.isRunning) {
    startInterval();
  }

  // Subscribe to preference changes. When the user edits durations in the
  // launcher's Extensions tab, recompute the idle display and broadcast so
  // the view repaints with the new values.
  _unsubPrefs = context.onPreferencesChanged(() => {
    if (!_state.isRunning && _state.phase === 'idle') {
      const s = getSettings();
      _state.totalSeconds = s.focusMinutes * 60;
      _state.secondsRemaining = s.focusMinutes * 60;
      persistState();
      broadcast();
    } else {
      // Running or mid-phase: just broadcast so the view picks up any
      // settings consumed for rendering (e.g. sessionsBeforeLongBreak).
      broadcast();
    }
  });
}

/** Public getter for the current timer state. */
export function getState(): TimerState {
  return { ..._state };
}

/**
 * Live read of the current timer settings. Derived from `context.preferences`
 * on every call — safe to call from components that render settings-dependent
 * UI.
 */
export function getTimerSettings(): TimerSettings {
  return getSettings();
}

export function getHistory(): SessionRecord[] {
  return [..._history];
}

/** Start (or resume) the timer. */
export function start(): void {
  if (_state.isRunning) return;

  if (_state.phase === 'idle') {
    _state.phase = 'focus';
    _state.totalSeconds = phaseSeconds('focus');
    _state.secondsRemaining = _state.totalSeconds;
  }

  // Anchor startedAt so that elapsed = totalSeconds - secondsRemaining
  _state.startedAt = Date.now() - (_state.totalSeconds - _state.secondsRemaining) * 1000;
  _state.isRunning = true;

  startInterval();
  persistState();
  broadcast();
}

/** Pause, snapshotting the remaining time. */
export function pause(): void {
  if (!_state.isRunning) return;

  if (_state.startedAt !== null) {
    const elapsed = Math.floor((Date.now() - _state.startedAt) / 1000);
    _state.secondsRemaining = Math.max(0, _state.totalSeconds - elapsed);
  }
  _state.isRunning = false;
  _state.startedAt = null;

  stopInterval();
  persistState();
  broadcast();
}

/** Stop and reset to idle. Records an interrupted session if > 10 s elapsed. */
export function stop(): void {
  if (_state.phase !== 'idle') {
    const elapsed = _state.startedAt
      ? Math.floor((Date.now() - _state.startedAt) / 1000)
      : _state.totalSeconds - _state.secondsRemaining;

    if (elapsed > 10) {
      _history.unshift({
        id: crypto.randomUUID(),
        phase: _state.phase,
        durationMinutes: elapsed / 60,
        completedAt: Date.now(),
        wasInterrupted: true,
      });
      persistHistory();
    }
  }

  stopInterval();

  const s = getSettings();
  _state = {
    ...DEFAULT_STATE,
    sessionsCompleted: _state.sessionsCompleted,
    totalSessionsEver: _state.totalSessionsEver,
    // Restore idle display time from current preferences
    totalSeconds: s.focusMinutes * 60,
    secondsRemaining: s.focusMinutes * 60,
  };

  persistState();
  broadcast();
}

/** Skip to next phase (records interrupted session). */
export function skip(): void {
  if (_state.phase === 'idle') {
    start();
    return;
  }

  const elapsed = _state.startedAt
    ? Math.floor((Date.now() - _state.startedAt) / 1000)
    : _state.totalSeconds - _state.secondsRemaining;

  if (elapsed > 10) {
    _history.unshift({
      id: crypto.randomUUID(),
      phase: _state.phase,
      durationMinutes: elapsed / 60,
      completedAt: Date.now(),
      wasInterrupted: true,
    });
    persistHistory();
  }

  if (_state.phase === 'focus') {
    _state.sessionsCompleted += 1;
    _state.totalSessionsEver += 1;
  }

  const next = nextPhaseAfter(_state.phase, _state.sessionsCompleted);
  _state.phase = next;
  _state.totalSeconds = phaseSeconds(next);
  _state.secondsRemaining = phaseSeconds(next);
  _state.isRunning = false;
  _state.startedAt = null;

  stopInterval();
  persistState();
  broadcast();
}

/** Clear all history. */
export function clearHistory(): void {
  _history = [];
  persistHistory();
  broadcast();
}

/**
 * Subscribe to state changes. Callback fires immediately with current state,
 * then on every change. Returns an unsubscribe function.
 */
export function subscribe(callback: (s: TimerState) => void): () => void {
  _subscribers.add(callback);
  callback({ ..._state });
  return () => {
    _subscribers.delete(callback);
  };
}

/**
 * Run one background tick. Called by the scheduled `tick` command in
 * index.ts. Equivalent to a UI repaint tick but runs even when the iframe
 * has no subscribers (no open view). Safe to call at any time.
 */
export function backgroundTick(): void {
  tick();
}

/** Clean up engine resources (called on iframe teardown). */
export function destroy(): void {
  stopInterval();
  _unsubPrefs?.();
  _unsubPrefs = null;
  _subscribers.clear();
}

/** Format seconds as MM:SS */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
