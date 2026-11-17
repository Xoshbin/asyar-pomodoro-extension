<script lang="ts">
  import type { TimerPhase } from '../lib/timerEngine';
  import { phaseTheme } from '../lib/phaseTheme';

  interface Props {
    secondsRemaining: number;
    totalSeconds: number;
    phase: TimerPhase;
    isRunning: boolean;
    /** False until the worker's first state snapshot arrives. */
    ready: boolean;
  }
  let { secondsRemaining, totalSeconds, phase, isRunning, ready }: Props = $props();

  const SIZE = 196;
  const STROKE = 9;
  const RADIUS = (SIZE - STROKE) / 2;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  let ratio = $derived(
    totalSeconds > 0 ? Math.min(1, Math.max(0, secondsRemaining / totalSeconds)) : 1,
  );
  let dashOffset = $derived(CIRCUMFERENCE * (1 - ratio));

  let theme = $derived(phaseTheme(phase));

  let minutes = $derived(Math.floor(secondsRemaining / 60));
  let seconds = $derived(secondsRemaining % 60);
  let timeDisplay = $derived(
    `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
  );
</script>

<div class="dial" style="--dial-size: {SIZE}px">
  <svg width={SIZE} height={SIZE} viewBox="0 0 {SIZE} {SIZE}" aria-hidden="true">
    <circle
      class="track"
      cx={SIZE / 2}
      cy={SIZE / 2}
      r={RADIUS}
      fill="none"
      stroke-width={STROKE}
    />
    <circle
      class="progress"
      class:running={isRunning}
      cx={SIZE / 2}
      cy={SIZE / 2}
      r={RADIUS}
      fill="none"
      stroke-width={STROKE}
      stroke-linecap="round"
      stroke-dasharray={CIRCUMFERENCE}
      stroke-dashoffset={dashOffset}
    />
  </svg>

  <div class="readout">
    <span class="time" role="timer" aria-live="off">{ready ? timeDisplay : '--:--'}</span>
    <span class="phase">{theme.label}</span>
  </div>
</div>

<style>
  .dial {
    position: relative;
    width: var(--dial-size);
    height: var(--dial-size);
    flex-shrink: 0;
    display: grid;
    place-items: center;
    user-select: none;
  }

  svg {
    position: absolute;
    inset: 0;
    display: block;
  }

  /* The empty well the progress stroke travels around. */
  .track {
    stroke: var(--bg-tertiary);
  }

  .progress {
    stroke: var(--phase-voice);
    transform: rotate(-90deg);
    transform-origin: center;
    /* A tick lands once a second; the short linear glide keeps the stroke from
       stepping. Phase jumps (skip, resume) ease across in the same motion. */
    transition:
      stroke-dashoffset var(--dur-emerge) linear,
      stroke var(--dur-quick) var(--ease-travel);
  }

  .readout {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    /* Optical centring: the readout sits a hair below the geometric centre so
       the countdown reads as the dial's axis, not its top half. */
    transform: translateY(-2px);
    pointer-events: none;
  }

  .time {
    font-family: var(--font-mono);
    font-size: var(--font-size-display);
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
  }

  .phase {
    font-family: var(--font-ui);
    font-size: var(--font-size-xs);
    font-weight: 600;
    line-height: 1;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }
</style>