import type { Extension, ExtensionContext } from "asyar-sdk";
import TimerView from "./views/TimerView.svelte";
import { backgroundTick, getState } from "./lib/timerEngine";

class PomodoroExtension implements Extension {
  private extensionManager?: any;

  async initialize(context: ExtensionContext) {
    this.extensionManager = context.getService("extensions");
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async viewActivated(_viewId: string): Promise<void> {}
  async viewDeactivated(_viewId: string): Promise<void> {}

  async executeCommand(commandId: string, _args?: Record<string, any>): Promise<any> {
    if (commandId === "open-timer") {
      this.extensionManager?.navigateToView("org.asyar.pomodoro/TimerView");
      return {
        type: "view",
        viewPath: "org.asyar.pomodoro/TimerView",
      };
    }

    if (commandId === "tick") {
      // Background scheduler tick (fires every 60 s via manifest `schedule`).
      // Safety net for phase-end detection when the iframe is alive but
      // suspended, or when the view is not mounted. Reconstructs clock
      // state, advances the phase if expired, and persists. Notifications
      // for the phase transition are fired from the engine's `onComplete`
      // callback wired up in main.ts.
      const before = getState();
      if (!before.isRunning) return { type: "no-view" };
      backgroundTick();
      return { type: "no-view" };
    }

    // start-timer (no-view) is handled via asyar:invoke:command in main.ts
  }

  onUnload = () => {};
}

export default new PomodoroExtension();
export { TimerView };
