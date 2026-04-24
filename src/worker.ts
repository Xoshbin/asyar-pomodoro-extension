// ---------------------------------------------------------------------------
// worker.ts — Pomodoro Tier 2 worker entry, loaded by dist/worker.html.
//
// Owns every long-lived concern: the TimerEngine (phase machine + persisted
// state via svc.state), the scheduled 60-s `tick` safety-net, phase-end
// notifications, the tray item, and the RPC handlers the view dispatches
// into (start/pause/resume/stop/skip/clearHistory).
//
// Imports come from `asyar-sdk/worker` (role assertion + worker-only
// ExtensionContext class with `onRequest`) and `asyar-sdk/contracts`
// (pure types — service interfaces + the Extension interface).
// ---------------------------------------------------------------------------

import {
  ExtensionContext as WorkerExtensionContext,
  extensionBridge,
} from 'asyar-sdk/worker';
import type {
  Extension,
  ExtensionContext,
  ILogService,
  INotificationService,
  IStatusBarService,
  ExtensionStateProxy,
} from 'asyar-sdk/contracts';

import manifest from '../manifest.json';
import {
  TimerEngine,
  formatTime,
  type TimerPhase,
  type TimerState,
} from './lib/timerEngine';
import {
  notifyFocusComplete,
  notifyBreakComplete,
} from './lib/notifications';

// ---------------------------------------------------------------------------
// Extension identity (same URL-parsing the other extensions use).
// ---------------------------------------------------------------------------
const extensionId =
  window.location.hostname === 'localhost' ||
  window.location.hostname === 'asyar-extension.localhost'
    ? window.location.pathname.split('/').filter(Boolean)[0] ||
      'org.asyar.pomodoro'
    : window.location.hostname || 'org.asyar.pomodoro';

const workerContext = new WorkerExtensionContext();
workerContext.setExtensionId(extensionId);

const log = workerContext.getService<ILogService>('log');
const notifier = workerContext.getService<INotificationService>('notifications');
const statusBar = workerContext.getService<IStatusBarService>('statusBar');
const stateProxy = workerContext.getService<ExtensionStateProxy>('state');

// ---------------------------------------------------------------------------
// Engine.
// ---------------------------------------------------------------------------
const engine = new TimerEngine({
  state: {
    get: (key) => stateProxy.get(key),
    set: (key, value) => stateProxy.set(key, value),
  },
  preferences: workerContext.preferences,
  now: () => Date.now(),
  onPhaseComplete: (completed: TimerPhase, next: TimerPhase, snapshot: TimerState) => {
    if (completed === 'focus') {
      void notifyFocusComplete(notifier, next, snapshot.totalSessionsEver).catch(
        (err: unknown) => log.error(`notifyFocusComplete: ${describe(err)}`),
      );
    } else if (completed === 'short-break' || completed === 'long-break') {
      void notifyBreakComplete(notifier).catch((err: unknown) =>
        log.error(`notifyBreakComplete: ${describe(err)}`),
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Tray item.
// ---------------------------------------------------------------------------
const TRAY_ITEM_ID = 'timer-status';
let trayRegistered = false;

function trayIconFor(phase: TimerPhase): string {
  if (phase === 'focus') return '🍅';
  if (phase === 'short-break') return '☕';
  if (phase === 'long-break') return '🛋️';
  return '🍅';
}

function trayTextFor(state: TimerState): string {
  if (state.isRunning && state.phaseEndsAt !== null) {
    const remaining = Math.max(
      0,
      Math.ceil((state.phaseEndsAt - Date.now()) / 1000),
    );
    return formatTime(remaining);
  }
  if (state.pausedRemainingSeconds !== null) {
    return `⏸ ${formatTime(state.pausedRemainingSeconds)}`;
  }
  return formatTime(state.totalSeconds);
}

function updateTray(state: TimerState): void {
  if (state.phase === 'idle') {
    if (trayRegistered) {
      statusBar.unregisterItem(TRAY_ITEM_ID);
      trayRegistered = false;
    }
    return;
  }

  const item = {
    id: TRAY_ITEM_ID,
    icon: trayIconFor(state.phase),
    text: trayTextFor(state),
  };
  if (trayRegistered) {
    statusBar.updateItem(TRAY_ITEM_ID, { icon: item.icon, text: item.text });
  } else {
    statusBar.registerItem(item);
    trayRegistered = true;
  }
}

engine.onTransition(updateTray);

// ---------------------------------------------------------------------------
// Extension impl — wires commands.
// ---------------------------------------------------------------------------
class PomodoroWorkerExtension implements Extension {
  async initialize(_ctx: ExtensionContext): Promise<void> {}

  async activate(): Promise<void> {
    await engine.init();
  }

  async deactivate(): Promise<void> {
    engine.destroy();
    if (trayRegistered) {
      try {
        statusBar.unregisterItem(TRAY_ITEM_ID);
      } catch {
        // Launcher may have already torn the item down.
      }
      trayRegistered = false;
    }
  }

  async executeCommand(commandId: string): Promise<unknown> {
    switch (commandId) {
      case 'start-timer':
        await engine.start();
        return;
      case 'pause-timer':
        await engine.pause();
        return;
      case 'resume-timer':
        await engine.resume();
        return;
      case 'stop-timer':
        await engine.stop();
        return;
      case 'skip-timer':
        await engine.skip();
        return;
      case 'tick':
        await engine.backgroundTick();
        return;
      case 'open-timer':
        // View-scoped command — the launcher dispatches this to the view
        // iframe. If the worker receives it (dual dispatch), it's a no-op.
        return;
      default:
        return undefined;
    }
  }

  onUnload = (): void => {};
}

const pomodoro = new PomodoroWorkerExtension();

extensionBridge.registerManifest(
  manifest as Parameters<typeof extensionBridge.registerManifest>[0],
);
extensionBridge.registerExtensionImplementation(extensionId, pomodoro);

// ---------------------------------------------------------------------------
// RPC handlers. Same code paths as the corresponding commands — the worker
// is the single writer for transitions regardless of whether the trigger is
// a command or a view-originated RPC.
// ---------------------------------------------------------------------------
workerContext.onRequest<Record<string, never>, void>('start', async () => {
  await engine.start();
});
workerContext.onRequest<Record<string, never>, void>('pause', async () => {
  await engine.pause();
});
workerContext.onRequest<Record<string, never>, void>('resume', async () => {
  await engine.resume();
});
workerContext.onRequest<Record<string, never>, void>('stop', async () => {
  await engine.stop();
});
workerContext.onRequest<Record<string, never>, void>('skip', async () => {
  await engine.skip();
});
workerContext.onRequest<Record<string, never>, void>('clearHistory', async () => {
  await engine.clearHistory();
});

// ---------------------------------------------------------------------------
// Preferences reactivity.
// ---------------------------------------------------------------------------
workerContext.onPreferencesChanged(() => {
  void engine.preferencesChanged();
});

// ---------------------------------------------------------------------------
// Activate.
// ---------------------------------------------------------------------------
void (async () => {
  try {
    await pomodoro.activate();
  } catch (err: unknown) {
    log.error(`[${extensionId}] worker activate failed: ${describe(err)}`);
  }
})();

window.addEventListener('beforeunload', () => {
  void pomodoro.deactivate();
});

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
