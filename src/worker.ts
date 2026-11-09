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

import { ExtensionContext as WorkerExtensionContext, extensionBridge } from 'asyar-sdk/worker';
import type {
  Extension,
  ExtensionContext,
  ILogService,
  IFeedbackService,
  IStatusBarService,
  ExtensionStateProxy,
} from 'asyar-sdk/contracts';

import manifest from '../manifest.json';
import { TimerEngine, type TimerPhase, type TimerState } from './lib/timerEngine';
import { notifyFocusComplete, notifyBreakComplete } from './lib/notifications';
import { PomodoroTray } from './lib/tray';

// ---------------------------------------------------------------------------
// Extension identity (same URL-parsing the other extensions use).
// ---------------------------------------------------------------------------
const extensionId = manifest.id;

const workerContext = new WorkerExtensionContext();
workerContext.setExtensionId(extensionId);

const log = workerContext.getService<ILogService>('log');
const notifier = workerContext.getService<IFeedbackService>('feedback');
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
      void notifyFocusComplete(notifier, next, snapshot.totalSessionsEver).catch((err: unknown) =>
        log.error(`notifyFocusComplete: ${describe(err)}`),
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
const tray = new PomodoroTray(statusBar, () => engine.getState(), () => Date.now());
engine.onTransition((state) => tray.sync(state));

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
    try {
      tray.dispose();
    } catch {
      // Launcher may have already torn the item down.
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

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
