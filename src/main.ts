// ---------------------------------------------------------------------------
// main.ts — Pomodoro Timer extension bootstrap
//
// Bootstrap order:
//   1. Parse extensionId from asyar-extension://org.asyar.pomodoro/...
//   2. Initialize SDK context (sets extensionId on all service proxies)
//   3. Initialize timer engine (loads state from StorageService, subscribes
//      to context.onPreferencesChanged so setting edits take effect live)
//   4. Post asyar:extension:loaded to host (also triggers the host to send
//      the initial preferences snapshot via asyar:preferences:set-all)
//   5. Forward ⌘K keydown to host
//   6. Handle asyar:command:execute for no-view commands
//   7. Set up global ⌘K actions (dynamic, reactive to timer state)
//   8. Mount view component based on ?view= query param
// ---------------------------------------------------------------------------

import 'asyar-sdk/tokens.css';
import { mount } from 'svelte';
import {
  ExtensionContext,
  ExtensionBridge,
  registerIconElement,
  type INotificationService,
  type IActionService,
  type IClipboardHistoryService,
  type IStatusBarService,
  type IFeedbackService,
  type ICommandService,
} from 'asyar-sdk';
import extensionModule from './index';
import manifest from '../manifest.json';
import {
  init as initTimer,
  start,
  getState,
  destroy as destroyTimer,
} from './lib/timerEngine';

import { setupGlobalActions, registerManifestHandlers } from './lib/actions';

import {
  notifyFocusComplete,
  notifyBreakComplete,
} from './lib/notifications';

import TimerView from './views/TimerView.svelte';

// ---------------------------------------------------------------------------
// 1. Extension identity
// ---------------------------------------------------------------------------
// On macOS (WKWebView): asyar-extension://org.asyar.pomodoro/index.html
//   → hostname = 'org.asyar.pomodoro'
// On Windows (WebView2): asyar-extension://localhost/org.asyar.pomodoro/index.html
//   → hostname = 'localhost', pathname = '/org.asyar.pomodoro/index.html'
const extensionId = (
  window.location.hostname === 'localhost' ||
  window.location.hostname === 'asyar-extension.localhost'
)
  ? window.location.pathname.split('/').filter(Boolean)[0] || 'org.asyar.pomodoro'
  : window.location.hostname || 'org.asyar.pomodoro';
console.log(`[${extensionId}] Bootstrapping...`);

// ---------------------------------------------------------------------------
// 2. SDK context — single instance, sets extensionId on all service proxies
// ---------------------------------------------------------------------------
const context = new ExtensionContext();
context.setExtensionId(extensionId);
registerIconElement();

// Register with ExtensionBridge so it can dispatch:
//   - asyar:command:execute → extensionModule.executeCommand(commandId, args)
// Without this, no-view commands (e.g. the scheduled `tick`) are silently dropped.
const bridge = ExtensionBridge.getInstance();
bridge.registerManifest(manifest as any);
bridge.registerExtensionImplementation(extensionId, extensionModule);

const notifService    = context.getService<INotificationService>('notifications');
const actionService   = context.getService<IActionService>('actions');
const clipboardService = context.getService<IClipboardHistoryService>('clipboard');
const statusBarService  = context.getService<IStatusBarService>('statusBar');
const feedbackService   = context.getService<IFeedbackService>('feedback');
const commandService    = context.getService<ICommandService>('commands');

// ---------------------------------------------------------------------------
// 3. Async bootstrap — the timer engine reads state from StorageService over
//    IPC, so it must finish before we start mounting views. We tell the host
//    we're ready after the engine is initialised, so the first preferences
//    snapshot arrives after `onPreferencesChanged` listeners are wired up.
// ---------------------------------------------------------------------------
(async () => {
  await initTimer(context, (completedPhase, nextPhase) => {
    // These fire only if the iframe is alive when the timer reaches zero.
    // When the launcher is closed, the iframe is torn down — the scheduled
    // `tick` command (see index.ts) handles notifications in that case.
    if (completedPhase === 'focus') {
      const s = getState();
      notifyFocusComplete(notifService, nextPhase, s.totalSessionsEver).catch(console.error);
    } else {
      notifyBreakComplete(notifService).catch(console.error);
    }
  });

  // ------------------------------------------------------------------------
  // 4. Signal readiness to host. The host's ExtensionIpcRouter answers this
  //    with an asyar:preferences:set-all message containing the initial
  //    preferences bundle, which ExtensionBridge delivers to context via
  //    context.setPreferences — firing any onPreferencesChanged listeners.
  // ------------------------------------------------------------------------
  window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId }, '*');

  // ------------------------------------------------------------------------
  // 5. Forward ⌘K to host so the action drawer opens while focus is in iframe
  // ------------------------------------------------------------------------
  window.addEventListener('keydown', (event) => {
    const isCommandK = (event.metaKey || event.ctrlKey) && event.key === 'k';
    if (isCommandK) {
      event.preventDefault();
      window.parent.postMessage({
        type: 'asyar:extension:keydown',
        payload: {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        },
      }, '*');
    }
  });

  // ------------------------------------------------------------------------
  // 6. Fallback handler for legacy `asyar:invoke:command` messages. New-style
  //    command execution flows through index.ts `executeCommand`, which the
  //    SDK bridge dispatches via `asyar:command:execute`.
  // ------------------------------------------------------------------------
  window.addEventListener('message', async (event) => {
    if (event.data?.type !== 'asyar:invoke:command') return;
    const { commandId } = event.data.payload ?? {};

    if (commandId === 'start-timer') {
      const state = getState();
      if (state.isRunning) {
        const mins = Math.ceil(state.secondsRemaining / 60);
        await feedbackService.showHUD(`🍅 Already running — ${mins} min remaining`);
      } else {
        start();
        const mins = Math.round(getState().totalSeconds / 60);
        await feedbackService.showHUD(`🍅 Pomodoro started — ${mins} min`);
      }
    }
  });

  // ------------------------------------------------------------------------
  // 7. Register ⌘K actions
  //    a) Manifest-declared handlers (copy-summary, learn-more) — the host
  //       registered these from manifest.json; we just wire the execute logic.
  //    b) Global dynamic actions (timer controls) — re-registered on each
  //       state change to embed live countdown in titles.
  // ------------------------------------------------------------------------
  registerManifestHandlers(actionService, clipboardService, extensionId);

  const cleanupActions = setupGlobalActions(
    actionService,
    statusBarService,
    commandService,
    extensionId,
  );

  // Clean up on page unload (best-effort for Tier 2 iframe teardown)
  window.addEventListener('beforeunload', () => {
    cleanupActions();
    destroyTimer();
  });

  // ------------------------------------------------------------------------
  // 8. Mount view based on ?view= query param
  // ------------------------------------------------------------------------
  const viewName = new URLSearchParams(window.location.search).get('view');
  const target   = document.getElementById('app')!;

  if (viewName === 'TimerView') {
    mount(TimerView, {
      target,
      props: { notifService, actionService, clipboardService, extensionId },
    });
  } else if (viewName === 'NoView') {
    // The "Start Pomodoro" command is `resultType: 'no-view'`, so the launcher
    // hides immediately after we run. This is the canonical HUD use case:
    // we need to confirm the action visually without leaving the launcher open.
    const state = getState();
    if (state.isRunning) {
      const mins = Math.ceil(state.secondsRemaining / 60);
      feedbackService
        .showHUD(`🍅 Already running — ${mins} min remaining`)
        .catch(console.error);
    } else {
      start();
      const mins = Math.round(getState().totalSeconds / 60);
      feedbackService
        .showHUD(`🍅 Pomodoro started — ${mins} min`)
        .catch(console.error);
    }
    // showHUD already calls hideWindow internally, so no need to post
    // asyar:window:hide here.
  }
  // All other view values (e.g., timer-status fallback to TimerView handled by defaultView)
  // → falls through to TimerView mounting via the host's defaultView routing
})().catch((err) => {
  console.error(`[${extensionId}] Bootstrap failed:`, err);
});
