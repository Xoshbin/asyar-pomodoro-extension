import type { Extension, ExtensionContext } from "asyar-sdk";
import TimerView from "./views/TimerView.svelte";

class PomodoroExtension implements Extension {
  private extensionManager?: any;

  async initialize(context: ExtensionContext) {
    this.extensionManager = context.getService("ExtensionManager");
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async viewActivated(viewId: string): Promise<void> {}
  async viewDeactivated(viewId: string): Promise<void> {}

  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === "open-timer") {
      this.extensionManager?.navigateToView("org.asyar.pomodoro/TimerView");
      return {
        type: "view",
        viewPath: "org.asyar.pomodoro/TimerView",
      };
    }
    // start-timer (no-view) is handled via asyar:invoke:command in main.ts
  }

  onUnload = () => {};
}

export default new PomodoroExtension();
export { TimerView };
