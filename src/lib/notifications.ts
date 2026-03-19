import type { INotificationService } from 'asyar-api';
import type { TimerPhase } from './timerEngine';
import { formatTime } from './timerEngine';

export async function notifyFocusComplete(
  notifService: INotificationService,
  nextPhase: TimerPhase,
  totalSessionsEver: number
): Promise<void> {
  const body = `Time for a ${nextPhase === 'long-break' ? 'long' : '5-minute'} break. You've completed ${totalSessionsEver} session${totalSessionsEver !== 1 ? 's' : ''} today.`;
  await notifService.notify({ title: '🍅 Focus session complete!', body }).catch(console.error);
}

export async function notifyBreakComplete(notifService: INotificationService): Promise<void> {
  await notifService.notify({
    title: '⏰ Break over!',
    body: 'Ready to focus? Start your next Pomodoro.',
  }).catch(console.error);
}

export async function notifyStarted(
  notifService: INotificationService,
  minutes: number
): Promise<void> {
  await notifService.notify({
    title: '▶️ Pomodoro started',
    body: `${minutes} minutes of focus. You've got this.`,
  }).catch(console.error);
}

export async function notifyAlreadyRunning(
  notifService: INotificationService,
  secondsRemaining: number
): Promise<void> {
  await notifService.notify({
    title: '⏱️ Timer already running',
    body: `${formatTime(secondsRemaining)} remaining in your focus session.`,
  }).catch(console.error);
}

export async function notifyPaused(
  notifService: INotificationService,
  secondsRemaining: number
): Promise<void> {
  await notifService.notify({
    title: '⏸️ Timer paused',
    body: `${formatTime(secondsRemaining)} remaining. Resume when you're ready.`,
  }).catch(console.error);
}
