import { describe, expect, it } from 'vitest';
import { historyPhaseLabel, phaseTheme } from './phaseTheme';
import type { TimerPhase } from './timerEngine';

const PHASES: TimerPhase[] = ['idle', 'focus', 'short-break', 'long-break'];

describe('phaseTheme', () => {
  it('gives focus the danger voice and the danger ground', () => {
    expect(phaseTheme('focus')).toEqual({
      voice: 'var(--accent-danger)',
      fill: 'var(--accent-danger-fill)',
      label: 'Focus',
    });
  });

  it('gives the short break the success voice and ground', () => {
    expect(phaseTheme('short-break')).toEqual({
      voice: 'var(--accent-success)',
      fill: 'var(--accent-success-fill)',
      label: 'Short break',
    });
  });

  it('gives the long break the primary voice and ground', () => {
    expect(phaseTheme('long-break')).toEqual({
      voice: 'var(--accent-primary)',
      fill: 'var(--accent-primary-fill)',
      label: 'Long break',
    });
  });

  // The one rule the design system is strictest about: a colour that fills
  // cannot also be the colour that speaks.
  it('never uses a -fill token as a voice', () => {
    for (const phase of PHASES) {
      expect(phaseTheme(phase).voice).not.toContain('-fill');
    }
  });

  it('always pairs the voice with a ground', () => {
    for (const phase of PHASES) {
      expect(phaseTheme(phase).fill).toContain('-fill');
    }
  });

  it('labels history phases in sentence case', () => {
    expect(historyPhaseLabel('focus')).toBe('Focus');
    expect(historyPhaseLabel('short-break')).toBe('Short break');
    expect(historyPhaseLabel('long-break')).toBe('Long break');
  });
});