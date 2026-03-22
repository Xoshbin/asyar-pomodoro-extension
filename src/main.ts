// ---------------------------------------------------------------------------
// main.ts — Pomodoro Timer extension bootstrap
//
// Bootstrap order:
//   1. Parse extensionId from asyar-extension://org.asyar.pomodoro/...
//   2. Initialize SDK context (sets extensionId on all service proxies)
//   3. Initialize timer engine (loads localStorage, reconstructs clock state)
//   4. Post asyar:extension:loaded to host
//   5. Forward ⌘K keydown to host
//   6. Handle asyar:invoke:command (future-proofing; host may send for no-view)
//   7. Set up global ⌘K actions (dynamic, reactive to timer state)
//   8. Mount view component based on ?view= query param
//      - ?view=TimerView → mount TimerView panel
//      - ?view=NoView    → start timer + notify silently, mount nothing
//      - otherwise       → mount nothing (background state only)
// ---------------------------------------------------------------------------

import { mount } from 'svelte';
import {
  ExtensionContext,
  type INotificationService,
  type IActionService,
  type IClipboardHistoryService,
  type IStatusBarService,
} from 'asyar-sdk';
import {
  init as initTimer,
  start,
  getState,
} from './lib/timerEngine';

import { setupGlobalActions } from './lib/actions';

import {
  notifyStarted,
  notifyAlreadyRunning,
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

const notifService    = context.getService<INotificationService>('NotificationService');
const actionService   = context.getService<IActionService>('ActionService');
const clipboardService = context.getService<IClipboardHistoryService>('ClipboardHistoryService');
const statusBarService = context.getService<IStatusBarService>('StatusBarService');

// ---------------------------------------------------------------------------
// 3. Timer engine init — pass notification callbacks
// ---------------------------------------------------------------------------
initTimer((completedPhase, nextPhase) => {
  // NOTE: These fire only if the iframe is alive when the timer reaches zero.
  // When the launcher is closed, the iframe is torn down and can't fire notifications.
  // The clock-based design ensures state is correct on next open.
  if (completedPhase === 'focus') {
    const s = getState();
    notifyFocusComplete(notifService, nextPhase, s.totalSessionsEver).catch(console.error);
  } else {
    notifyBreakComplete(notifService).catch(console.error);
  }
});

// ---------------------------------------------------------------------------
// 4. Signal readiness to host
// ---------------------------------------------------------------------------
window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId }, '*');

// ---------------------------------------------------------------------------
// 5. Forward ⌘K to host so the action drawer opens while focus is in iframe
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 6. Handle asyar:invoke:command (host may send this in future no-view flows)
// ---------------------------------------------------------------------------
window.addEventListener('message', async (event) => {
  if (event.data?.type !== 'asyar:invoke:command') return;
  const { commandId } = event.data.payload ?? {};

  if (commandId === 'start-timer') {
    const state = getState();
    if (state.isRunning) {
      await notifyAlreadyRunning(notifService, state.secondsRemaining);
    } else {
      start();
      await notifyStarted(notifService, getState().totalSeconds / 60);
    }
  }
});

// ---------------------------------------------------------------------------
// 7. Register global ⌘K actions (dynamic, tracks timer state)
// ---------------------------------------------------------------------------
const cleanupActions = setupGlobalActions(actionService, clipboardService, statusBarService, extensionId);

// Clean up on page unload (best-effort for Tier 2 iframe teardown)
window.addEventListener('beforeunload', () => {
  cleanupActions();
});

// ---------------------------------------------------------------------------
// 8. Mount view based on ?view= query param
// ---------------------------------------------------------------------------
const viewName = new URLSearchParams(window.location.search).get('view');
const target   = document.getElementById('app')!;

if (viewName === 'TimerView') {
  mount(TimerView, {
    target,
    props: { notifService, actionService, clipboardService, extensionId },
  });
} else if (viewName === 'NoView') {
  const state = getState();
  if (state.isRunning) {
    notifyAlreadyRunning(notifService, state.secondsRemaining).catch(console.error);
  } else {
    start();
    notifyStarted(notifService, getState().totalSeconds / 60).catch(console.error);
  }
  // Close the launcher — no view should stay open
  window.parent.postMessage({ type: 'asyar:window:hide', extensionId }, '*');
}
// All other view values (e.g., timer-status fallback to TimerView handled by defaultView)
// → falls through to TimerView mounting via the host's defaultView routing
