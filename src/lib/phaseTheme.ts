// ---------------------------------------------------------------------------
// phaseTheme.ts — one phase, one voice, one ground.
//
// Asyar has two accent ramps and they are not interchangeable: the *voice*
// ramp (--accent-*) colours strokes, pips and text; the *ground* ramp
// (--accent-*-fill) is only ever the background of a filled surface that
// carries --text-on-accent. Keeping the mapping in one place is what stops the
// dial, the session dots, the primary button and the ledger from drifting into
// four slightly different reds.
// ---------------------------------------------------------------------------

import type { TimerPhase } from './timerEngine';

export interface PhaseTheme {
  /** Voice token — rings, pips, icons, text. Never a fill under text. */
  voice: string;
  /** Ground token — the filled primary button, carrying --text-on-accent. */
  fill: string;
  /** Sentence-case name used in labels and buttons. */
  label: string;
}

const PHASE_THEME: Record<TimerPhase, PhaseTheme> = {
  idle: {
    voice: 'var(--text-secondary)',
    fill: 'var(--accent-danger-fill)',
    label: 'Idle',
  },
  focus: {
    voice: 'var(--accent-danger)',
    fill: 'var(--accent-danger-fill)',
    label: 'Focus',
  },
  'short-break': {
    voice: 'var(--accent-success)',
    fill: 'var(--accent-success-fill)',
    label: 'Short break',
  },
  'long-break': {
    voice: 'var(--accent-primary)',
    fill: 'var(--accent-primary-fill)',
    label: 'Long break',
  },
};

export function phaseTheme(phase: TimerPhase): PhaseTheme {
  return PHASE_THEME[phase] ?? PHASE_THEME.idle;
}

/** The phases the ledger can hold — `idle` never produces a history row. */
export type HistoryPhase = Exclude<TimerPhase, 'idle'>;

export function historyPhaseLabel(phase: HistoryPhase): string {
  return phaseTheme(phase).label;
}

export function historyPhaseVoice(phase: HistoryPhase): string {
  return phaseTheme(phase).voice;
}