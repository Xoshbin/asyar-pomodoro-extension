// ---------------------------------------------------------------------------
// actions.ts — Dynamic ⌘K action management
//
// Timer-control actions are re-registered on every state change because their
// titles embed live time ("Pause (18:32 remaining)") and the IActionService
// has no updateAction — only registerAction / unregisterAction.
//
// Persistent utility actions (Copy Summary, Learn More) are registered once
// at startup and never change.
// ---------------------------------------------------------------------------

import { ActionContext, ClipboardItemType, type IActionService, type IClipboardHistoryService } from 'asyar-sdk';

/** Send asyar:api:opener:open directly — MessageBroker is not in the public asyar-sdk export. */
function openUrl(url: string, extensionId: string): void {
  const messageId = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  window.parent.postMessage(
    { type: 'asyar:api:opener:open', payload: { url }, messageId, extensionId },
    '*'
  );
}
import { subscribe, start, pause, stop, skip, getHistory, formatTime, type TimerState } from './timerEngine';

// ---------------------------------------------------------------------------
// Action IDs — stable across re-registrations so the ⌘K panel doesn't flicker
// ---------------------------------------------------------------------------
export const ACTION_START         = 'org.asyar.pomodoro:start';
export const ACTION_PAUSE         = 'org.asyar.pomodoro:pause';
export const ACTION_RESUME        = 'org.asyar.pomodoro:resume';
export const ACTION_STOP          = 'org.asyar.pomodoro:stop';
export const ACTION_SKIP          = 'org.asyar.pomodoro:skip';
export const ACTION_COPY_SUMMARY  = 'org.asyar.pomodoro:copy-summary';
export const ACTION_OPEN_BROWSER  = 'org.asyar.pomodoro:learn-more';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TIMER_CONTROL_IDS = new Set([
  ACTION_START, ACTION_PAUSE, ACTION_RESUME, ACTION_STOP, ACTION_SKIP,
]);

function buildSummaryText(): string {
  const history = getHistory();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTs = todayStart.getTime();
  const todayFocus = history.filter(r => r.phase === 'focus' && r.completedAt >= todayTs && !r.wasInterrupted);
  const totalMins = Math.round(todayFocus.reduce((acc, r) => acc + r.durationMinutes, 0));
  const lines = [
    `🍅 Pomodoro Summary — ${new Date().toLocaleDateString()}`,
    `• Focus sessions: ${todayFocus.length}`,
    `• Total focus time: ${totalMins} minutes`,
  ];
  if (history.length > 0) {
    const recent = history.slice(0, 5).map(r => {
      const when = new Date(r.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const label = r.phase === 'focus' ? '🍅 Focus' : r.phase === 'short-break' ? '☕ Short break' : '🛋️ Long break';
      const mins = Math.round(r.durationMinutes);
      const interrupted = r.wasInterrupted ? ' (interrupted)' : '';
      return `  ${when} — ${label} ${mins}min${interrupted}`;
    });
    lines.push('', 'Recent sessions:', ...recent);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// setupGlobalActions — call once from main.ts
// ---------------------------------------------------------------------------
let _registeredTimerControls: string[] = [];

/**
 * Registers persistent actions and subscribes to timer state for dynamic ones.
 * Returns the unsubscribe function — call it on extension unload.
 */
export function setupGlobalActions(
  actionService: IActionService,
  clipboardService: IClipboardHistoryService,
  extensionId: string
): () => void {
  // --- Persistent utility actions (registered once, never change) -----------
  actionService.registerAction({
    id: ACTION_COPY_SUMMARY,
    title: 'Copy Session Summary',
    description: "Copy today's Pomodoro summary to clipboard",
    category: 'Pomodoro Timer',
    extensionId,
    context: ActionContext.GLOBAL,
    execute: async () => {
      const text = buildSummaryText();
      await clipboardService.writeToClipboard({
        id: crypto.randomUUID(),
        type: ClipboardItemType.Text,
        content: text,
        createdAt: Date.now(),
        favorite: false,
      });
    },
  });

  actionService.registerAction({
    id: ACTION_OPEN_BROWSER,
    title: 'Learn About Pomodoro',
    description: 'Open the Pomodoro Technique on Wikipedia',
    category: 'Pomodoro Timer',
    extensionId,
    context: ActionContext.GLOBAL,
    execute: async () => {
      openUrl('https://en.wikipedia.org/wiki/Pomodoro_Technique', extensionId);
    },
  });

  // --- Dynamic timer-control actions (re-registered on each state change) --
  const unsubscribe = subscribe((state: TimerState) => {
    // Unregister previous timer-control actions
    _registeredTimerControls.forEach(id => actionService.unregisterAction(id));
    _registeredTimerControls = [];

    const time = formatTime(state.secondsRemaining);

    if (state.phase === 'idle') {
      actionService.registerAction({
        id: ACTION_START,
        title: 'Start Focus Session',
        category: 'Pomodoro Timer',
        extensionId,
        context: ActionContext.GLOBAL,
        execute: async () => start(),
      });
      _registeredTimerControls.push(ACTION_START);
    } else if (state.isRunning && state.phase === 'focus') {
      actionService.registerAction({
        id: ACTION_PAUSE,
        title: `Pause (${time} remaining)`,
        category: 'Pomodoro Timer',
        extensionId,
        context: ActionContext.GLOBAL,
        execute: async () => pause(),
      });
      actionService.registerAction({
        id: ACTION_STOP,
        title: 'Stop Focus Session',
        category: 'Pomodoro Timer',
        extensionId,
        context: ActionContext.GLOBAL,
        execute: async () => stop(),
      });
      actionService.registerAction({
        id: ACTION_SKIP,
        title: `Skip to Break (${time} remaining)`,
        category: 'Pomodoro Timer',
        extensionId,
        context: ActionContext.GLOBAL,
        execute: async () => skip(),
      });
      _registeredTimerControls.push(ACTION_PAUSE, ACTION_STOP, ACTION_SKIP);
    } else if (state.isRunning && (state.phase === 'short-break' || state.phase === 'long-break')) {
      actionService.registerAction({
        id: ACTION_SKIP,
        title: `Skip Break (${time} remaining)`,
        category: 'Pomodoro Timer',
        extensionId,
        context: ActionContext.GLOBAL,
        execute: async () => skip(),
      });
      actionService.registerAction({
        id: ACTION_STOP,
        title: 'Stop Break',
        category: 'Pomodoro Timer',
        extensionId,
        context: ActionContext.GLOBAL,
        execute: async () => stop(),
      });
      _registeredTimerControls.push(ACTION_SKIP, ACTION_STOP);
    } else {
      // Paused (any phase, not running)
      actionService.registerAction({
        id: ACTION_RESUME,
        title: `Resume (${time} remaining)`,
        category: 'Pomodoro Timer',
        extensionId,
        context: ActionContext.GLOBAL,
        execute: async () => start(),
      });
      actionService.registerAction({
        id: ACTION_STOP,
        title: 'Stop Timer',
        category: 'Pomodoro Timer',
        extensionId,
        context: ActionContext.GLOBAL,
        execute: async () => stop(),
      });
      actionService.registerAction({
        id: ACTION_SKIP,
        title: 'Skip to Next Phase',
        category: 'Pomodoro Timer',
        extensionId,
        context: ActionContext.GLOBAL,
        execute: async () => skip(),
      });
      _registeredTimerControls.push(ACTION_RESUME, ACTION_STOP, ACTION_SKIP);
    }
  });

  // Return full cleanup function
  return () => {
    unsubscribe();
    _registeredTimerControls.forEach(id => actionService.unregisterAction(id));
    _registeredTimerControls = [];
    actionService.unregisterAction(ACTION_COPY_SUMMARY);
    actionService.unregisterAction(ACTION_OPEN_BROWSER);
    // Clear any remaining known IDs defensively
    TIMER_CONTROL_IDS.forEach(id => actionService.unregisterAction(id));
  };
}
