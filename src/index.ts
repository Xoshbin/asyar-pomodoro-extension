import type { Extension, ExtensionContext } from "asyar-api";
import DefaultView from "./DefaultView.svelte";

class MyExtension implements Extension {
  private extensionManager?: any;

  async initialize(context: ExtensionContext) {
    this.extensionManager = context.getService("ExtensionManager");
    console.log("Pomodoro initialized!");
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async viewActivated(viewId: string): Promise<void> {}
  async viewDeactivated(viewId: string): Promise<void> {}
  
  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === "open") {
      this.extensionManager?.navigateToView("org.asyar.pomodoro/DefaultView");
      return {
        type: "view",
        viewPath: "org.asyar.pomodoro/DefaultView",
      };
    }
  }
  
  onUnload = () => {};
}

export default new MyExtension();
export { DefaultView };
