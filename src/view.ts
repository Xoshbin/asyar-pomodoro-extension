// ---------------------------------------------------------------------------
// view.ts — Pomodoro Tier 2 view entry, loaded by dist/view.html.
//
// Responsibilities (display-side only):
//   1) Register the view-side Extension impl so `open-timer` navigates to
//      the TimerView route.
//   2) Bootstrap ExtensionContext, post asyar:extension:loaded, forward ⌘K.
//   3) Mount TimerView.svelte when `?view=TimerView`.
//
// Every state-owning concern (timer, history, phase transitions, tray,
// notifications, scheduled tick) lives in the worker. The view reads state
// via svc.state.subscribe and dispatches user actions via context.request.
//
// Imports come from `asyar-sdk/view`, which asserts
// `window.__ASYAR_ROLE__ === "view"` at module-load time.
// ---------------------------------------------------------------------------

import 'asyar-sdk/tokens.css';
import { mount } from 'svelte';
import {
  ExtensionContext,
  extensionBridge,
  registerIconElement,
  type Extension,
  type IExtensionManager,
} from 'asyar-sdk/view';
import manifest from '../manifest.json';
import TimerView from './views/TimerView.svelte';

class PomodoroViewExtension implements Extension {
  private extensionManager?: IExtensionManager;

  async initialize(ctx: ExtensionContext): Promise<void> {
    this.extensionManager = ctx.getService<IExtensionManager>('extensions');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}

  async executeCommand(commandId: string): Promise<unknown> {
    if (commandId === 'open-timer') {
      this.extensionManager?.navigateToView('org.asyar.pomodoro/TimerView');
      return { type: 'view', viewPath: 'org.asyar.pomodoro/TimerView' };
    }
    return undefined;
  }

  onUnload = (): void => {};
}

const extensionId =
  window.location.hostname === 'localhost' ||
  window.location.hostname === 'asyar-extension.localhost'
    ? window.location.pathname.split('/').filter(Boolean)[0] ||
      'org.asyar.pomodoro'
    : window.location.hostname || 'org.asyar.pomodoro';

const context = new ExtensionContext();
context.setExtensionId(extensionId);
registerIconElement();

const viewExtension = new PomodoroViewExtension();
extensionBridge.registerManifest(
  manifest as Parameters<typeof extensionBridge.registerManifest>[0],
);
extensionBridge.registerExtensionImplementation(extensionId, viewExtension);

// Forward ⌘K to host so the action palette opens while focus is inside the
// iframe. The in-view Space/S/N/H/Escape shortcuts are handled inside
// TimerView.svelte's onkeydown.
window.addEventListener('keydown', (event) => {
  const isCommandK = (event.metaKey || event.ctrlKey) && event.key === 'k';
  if (isCommandK) {
    event.preventDefault();
    window.parent.postMessage(
      {
        type: 'asyar:extension:keydown',
        payload: {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        },
      },
      '*',
    );
  }
});

void (async () => {
  await viewExtension.initialize(context);
  await viewExtension.activate();
})();

const viewName = new URLSearchParams(window.location.search).get('view');
const target = document.getElementById('app');
if (viewName === 'TimerView' && target) {
  mount(TimerView, {
    target,
    props: { context },
  });
}
