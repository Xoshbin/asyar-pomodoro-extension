/**
 * In-view action names and IDs for the Pomodoro view.
 *
 * Registered via `actions.registerAction({ id, ..., context: ActionContext.EXTENSION_VIEW, execute })`
 * so they appear in the launcher's ⌘K drawer while TimerView is mounted.
 */
export const VIEW_ACTION_NAMES = [
  'toggle-timer',
  'start-focus-25',
  'start-focus-50',
  'start-short-break',
  'start-long-break',
  'skip-phase',
  'stop-timer',
  'copy-summary',
  'clear-history',
] as const;

export type ViewActionName = (typeof VIEW_ACTION_NAMES)[number];

/** The ID used both to register and unregister an in-view action. */
export function viewActionId(extensionId: string, name: ViewActionName): string {
  return `${extensionId}.view.${name}`;
}
