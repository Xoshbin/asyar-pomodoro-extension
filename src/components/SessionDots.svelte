<script lang="ts">
  interface Props {
    /** Number of focus sessions completed in the current cycle. */
    sessionsCompleted: number;
    /** Total sessions before a long break (from settings). */
    sessionsBeforeLongBreak: number;
    /** Whether a focus session is currently running. */
    isCurrentlyFocus: boolean;
  }
  let { sessionsCompleted, sessionsBeforeLongBreak, isCurrentlyFocus }: Props = $props();
</script>

<div class="session-dots" aria-label="{sessionsCompleted} of {sessionsBeforeLongBreak} sessions completed">
  {#each Array(sessionsBeforeLongBreak) as _, i}
    <div
      class="dot"
      class:filled={i < sessionsCompleted}
      class:active={isCurrentlyFocus && i === sessionsCompleted}
      title={i < sessionsCompleted
        ? `Session ${i + 1} complete`
        : isCurrentlyFocus && i === sessionsCompleted
          ? 'In progress'
          : `Session ${i + 1}`}
    ></div>
  {/each}
</div>

<style>
  .session-dots {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    max-width: 180px;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: var(--radius-full);
    background-color: var(--dot-empty);
    border: 1.5px solid var(--dot-border);
    transition: background-color 0.3s ease, transform 0.2s ease;
  }

  .dot.filled {
    background-color: var(--pomodoro-focus);
    border-color: var(--pomodoro-focus);
  }

  .dot.active {
    background-color: transparent;
    border-color: var(--pomodoro-focus);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-danger) 30%, transparent);
    animation: dotPulse 1.5s ease-in-out infinite;
  }

  @keyframes dotPulse {
    0%, 100% { transform: scale(1); }
    50%       { transform: scale(1.2); }
  }
</style>
