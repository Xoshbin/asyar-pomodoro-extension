import { describe, it, expect } from 'vitest';
import { VIEW_ACTION_NAMES, viewActionId } from './actions';

describe('actions', () => {
  it('formats viewActionId with extensionId and action name', () => {
    expect(viewActionId('org.asyar.pomodoro', 'toggle-timer')).toBe(
      'org.asyar.pomodoro.view.toggle-timer',
    );
    expect(viewActionId('org.asyar.pomodoro', 'skip-phase')).toBe(
      'org.asyar.pomodoro.view.skip-phase',
    );
  });

  it('contains all documented view actions', () => {
    expect(VIEW_ACTION_NAMES).toContain('toggle-timer');
    expect(VIEW_ACTION_NAMES).toContain('start-focus-25');
    expect(VIEW_ACTION_NAMES).toContain('start-focus-50');
    expect(VIEW_ACTION_NAMES).toContain('start-short-break');
    expect(VIEW_ACTION_NAMES).toContain('start-long-break');
    expect(VIEW_ACTION_NAMES).toContain('skip-phase');
    expect(VIEW_ACTION_NAMES).toContain('stop-timer');
    expect(VIEW_ACTION_NAMES).toContain('copy-summary');
    expect(VIEW_ACTION_NAMES).toContain('clear-history');
  });
});
