<script lang="ts">
  import type { TimerPhase } from '../lib/timerEngine';

  interface Props {
    secondsRemaining: number;
    totalSeconds: number;
    phase: TimerPhase;
    isRunning: boolean;
  }
  let { secondsRemaining, totalSeconds, phase, isRunning }: Props = $props();

  const SIZE          = 200;
  const STROKE        = 10;
  const RADIUS        = (SIZE - STROKE) / 2;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  let ratio       = $derived(totalSeconds > 0 ? secondsRemaining / totalSeconds : 1);
  let dashOffset  = $derived(CIRCUMFERENCE * (1 - ratio));

  let phaseColor = $derived(
    phase === 'focus'       ? 'var(--pomodoro-focus)'
    : phase === 'short-break' ? 'var(--pomodoro-break)'
    : phase === 'long-break'  ? 'var(--pomodoro-long-break)'
    : 'var(--pomodoro-idle)'
  );

  let phaseLabel = $derived(
    phase === 'focus'       ? 'FOCUS'
    : phase === 'short-break' ? 'SHORT BREAK'
    : phase === 'long-break'  ? 'LONG BREAK'
    : 'IDLE'
  );

  let minutes     = $derived(Math.floor(secondsRemaining / 60));
  let seconds     = $derived(secondsRemaining % 60);
  let timeDisplay = $derived(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
</script>

<div class="circular-progress" aria-label="{phaseLabel}: {timeDisplay}">
  <svg
    width={SIZE}
    height={SIZE}
    viewBox="0 0 {SIZE} {SIZE}"
    role="img"
  >
    <!-- Track ring -->
    <circle
      cx={SIZE / 2}
      cy={SIZE / 2}
      r={RADIUS}
      fill="none"
      stroke="var(--track-color)"
      stroke-width={STROKE}
    />

    <!-- Progress ring — rotated -90° so it starts at the top -->
    <circle
      cx={SIZE / 2}
      cy={SIZE / 2}
      r={RADIUS}
      fill="none"
      stroke={phaseColor}
      stroke-width={STROKE}
      stroke-linecap="round"
      stroke-dasharray={CIRCUMFERENCE}
      stroke-dashoffset={dashOffset}
      class="progress-ring"
      class:pulsing={isRunning}
      style="transform: rotate(-90deg); transform-origin: center; transition: stroke-dashoffset 0.9s linear, stroke 0.3s ease;"
    />

    <!-- Time text -->
    <text
      x="50%"
      y="44%"
      text-anchor="middle"
      dominant-baseline="middle"
      class="time-text"
      fill="var(--text-primary)"
    >
      {timeDisplay}
    </text>

    <!-- Phase label -->
    <text
      x="50%"
      y="62%"
      text-anchor="middle"
      dominant-baseline="middle"
      class="phase-label"
      fill={phaseColor}
    >
      {phaseLabel}
    </text>
  </svg>
</div>

<style>
  .circular-progress {
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
  }

  .progress-ring {
    transition: stroke-dashoffset 0.9s linear, stroke 0.3s ease;
  }

  .time-text {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 36px;
    font-weight: 700;
    letter-spacing: -1px;
  }

  .phase-label {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  @keyframes subtlePulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.75; }
  }

  .pulsing {
    animation: subtlePulse 2s ease-in-out infinite;
  }
</style>
