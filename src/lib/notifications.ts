import type { INotificationService } from 'asyar-sdk/contracts';
import type { TimerPhase } from './timerEngine';

// Helpers propagate errors to the caller — the worker's invocation sites
// wrap them in `.catch(log.error)` so failures land in the extension log
// rather than the DevTools console.

export async function notifyFocusComplete(
  notifService: INotificationService,
  nextPhase: TimerPhase,
  totalSessionsEver: number,
): Promise<void> {
  const suffix = nextPhase === 'long-break' ? 'long' : '5-minute';
  const plural = totalSessionsEver === 1 ? '' : 's';
  const body = `Time for a ${suffix} break. You've completed ${totalSessionsEver} session${plural} today.`;
  await notifService.send({ title: '🍅 Focus session complete!', body });
}

export async function notifyBreakComplete(
  notifService: INotificationService,
): Promise<void> {
  await notifService.send({
    title: '⏰ Break over!',
    body: 'Ready to focus? Start your next Pomodoro.',
  });
}
