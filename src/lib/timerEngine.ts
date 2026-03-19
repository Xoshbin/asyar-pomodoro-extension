// ---------------------------------------------------------------------------
// timerEngine.ts — Clock-based Pomodoro timer singleton
//
// ARCHITECTURE NOTE: The setInterval is only a UI repaint trigger.
// The source of truth for elapsed time is always:
//   Math.floor((Date.now() - startedAt) / 1000)
// This means the timer is accurate even if the iframe is suspended, the
// laptop sleeps, or the launcher is closed and reopened.
// ---------------------------------------------------------------------------

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

export interface TimerSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
const KEY_STATE    = 'pomodoro:state';
const KEY_HISTORY  = 'pomodoro:history';
const KEY_SETTINGS = 'pomodoro:settings';

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
let _settings: TimerSettings = { ...DEFAULT_SETTINGS };
let _state: TimerState = { ...DEFAULT_STATE };
let _history: SessionRecord[] = [];

let _intervalId: number | null = null;
let _subscribers: Set<(s: TimerState) => void> = new Set();
let _onComplete: ((completed: TimerPhase, next: TimerPhase) => void) | null = null;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function persist(): void {
  try { localStorage.setItem(KEY_STATE, JSON.stringify(_state)); } catch { /* ignore */ }
}
function persistHistory(): void {
  try { localStorage.setItem(KEY_HISTORY, JSON.stringify(_history.slice(0, 50))); } catch { /* ignore */ }
}
function persistSettings(): void {
  try { localStorage.setItem(KEY_SETTINGS, JSON.stringify(_settings)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function broadcast(): void {
  const snap = { ..._state };
  _subscribers.forEach(cb => { try { cb(snap); } catch { /* ignore */ } });
}

function phaseSeconds(phase: TimerPhase): number {
  if (phase === 'focus')       return _settings.focusMinutes * 60;
  if (phase === 'short-break') return _settings.shortBreakMinutes * 60;
  if (phase === 'long-break')  return _settings.longBreakMinutes * 60;
  return 0;
}

function nextPhaseAfter(completed: TimerPhase, sessionsCompleted: number): TimerPhase {
  if (completed === 'focus') {
    return (sessionsCompleted % _settings.sessionsBeforeLongBreak === 0)
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

function tick(): void {
  if (!_state.isRunning || _state.startedAt === null) return;

  // Clock-based: recalculate from anchor
  const elapsed    = Math.floor((Date.now() - _state.startedAt) / 1000);
  const remaining  = Math.max(0, _state.totalSeconds - elapsed);
  _state.secondsRemaining = remaining;

  if (remaining <= 0) {
    completePhase();
  }

  persist();
  broadcast();
}

function completePhase(): void {
  const completed = _state.phase;

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
    try { _onComplete(completed, next); } catch { /* ignore */ }
  }

  const nextSecs = phaseSeconds(next);
  const autoStart = completed === 'focus' ? _settings.autoStartBreaks : _settings.autoStartFocus;

  _state.phase            = next;
  _state.totalSeconds     = nextSecs;
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
 * Initialize from localStorage. Reconstructs clock-based timer if running.
 * Call once at the top of main.ts.
 */
export function init(
  onComplete?: (completed: TimerPhase, next: TimerPhase) => void
): void {
  _onComplete = onComplete ?? null;

  try {
    const s = localStorage.getItem(KEY_SETTINGS);
    if (s) _settings = { ...DEFAULT_SETTINGS, ...JSON.parse(s) };
  } catch { _settings = { ...DEFAULT_SETTINGS }; }

  try {
    const h = localStorage.getItem(KEY_HISTORY);
    if (h) _history = JSON.parse(h);
  } catch { _history = []; }

  try {
    const st = localStorage.getItem(KEY_STATE);
    if (st) {
      const parsed: TimerState = JSON.parse(st);
      _state = { ...DEFAULT_STATE, ...parsed };

      // Reconstruct clock-based remaining time
      if (_state.isRunning && _state.startedAt !== null) {
        const elapsed   = Math.floor((Date.now() - _state.startedAt) / 1000);
        const remaining = Math.max(0, _state.totalSeconds - elapsed);
        _state.secondsRemaining = remaining;

        if (remaining <= 0) {
          // Expired while away — advance to next phase without notification
          if (_state.phase === 'focus') {
            _state.sessionsCompleted += 1;
            _state.totalSessionsEver += 1;
          }
          const next  = nextPhaseAfter(_state.phase, _state.sessionsCompleted);
          _state.phase            = next;
          _state.totalSeconds     = phaseSeconds(next);
          _state.secondsRemaining = phaseSeconds(next);
          _state.isRunning        = false;
          _state.startedAt        = null;
          persist();
        }
      }
    }
  } catch { _state = { ...DEFAULT_STATE }; }

  // For idle display: pre-fill totalSeconds so CircularProgress shows "25:00"
  if (_state.phase === 'idle' && _state.totalSeconds === 0) {
    _state.totalSeconds     = _settings.focusMinutes * 60;
    _state.secondsRemaining = _settings.focusMinutes * 60;
  }

  if (_state.isRunning) {
    startInterval();
  }
}

export function getState(): TimerState {
  return { ..._state };
}

export function getSettings(): TimerSettings {
  return { ..._settings };
}

export function getHistory(): SessionRecord[] {
  return [..._history];
}

/** Start (or resume) the timer. */
export function start(): void {
  if (_state.isRunning) return;

  if (_state.phase === 'idle') {
    _state.phase            = 'focus';
    _state.totalSeconds     = phaseSeconds('focus');
    _state.secondsRemaining = _state.totalSeconds;
  }

  // Anchor startedAt so that elapsed = totalSeconds - secondsRemaining
  _state.startedAt = Date.now() - (_state.totalSeconds - _state.secondsRemaining) * 1000;
  _state.isRunning = true;

  startInterval();
  persist();
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
  persist();
  broadcast();
}

/** Stop and reset to idle. Records an interrupted session if > 10 s elapsed. */
export function stop(): void {
  if (_state.phase !== 'idle') {
    const elapsed = _state.startedAt
      ? Math.floor((Date.now() - _state.startedAt) / 1000)
      : (_state.totalSeconds - _state.secondsRemaining);

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

  _state = {
    ...DEFAULT_STATE,
    sessionsCompleted: _state.sessionsCompleted,
    totalSessionsEver: _state.totalSessionsEver,
    // Restore idle display time
    totalSeconds:     _settings.focusMinutes * 60,
    secondsRemaining: _settings.focusMinutes * 60,
  };

  persist();
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
    : (_state.totalSeconds - _state.secondsRemaining);

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
  _state.phase            = next;
  _state.totalSeconds     = phaseSeconds(next);
  _state.secondsRemaining = phaseSeconds(next);
  _state.isRunning        = false;
  _state.startedAt        = null;

  stopInterval();
  persist();
  broadcast();
}

/** Update settings; does not interrupt a running timer. */
export function updateSettings(partial: Partial<TimerSettings>): void {
  _settings = { ..._settings, ...partial };

  // Reflect new durations on idle or fully-untouched paused phase
  if (!_state.isRunning) {
    if (_state.phase === 'idle') {
      _state.totalSeconds     = _settings.focusMinutes * 60;
      _state.secondsRemaining = _settings.focusMinutes * 60;
    } else if (_state.secondsRemaining === _state.totalSeconds) {
      // Paused at the very beginning — safe to update
      _state.totalSeconds     = phaseSeconds(_state.phase);
      _state.secondsRemaining = _state.totalSeconds;
    }
  }

  persistSettings();
  persist();
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
  return () => { _subscribers.delete(callback); };
}

/** Format seconds as MM:SS */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
