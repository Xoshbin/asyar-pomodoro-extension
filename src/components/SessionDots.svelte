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
    gap: 8px;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    max-width: 180px;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: var(--dot-empty, rgba(255, 255, 255, 0.15));
    border: 1.5px solid var(--dot-border, rgba(255, 255, 255, 0.25));
    transition: background-color 0.3s ease, transform 0.2s ease;
  }

  .dot.filled {
    background-color: var(--pomodoro-focus, #ef4444);
    border-color: var(--pomodoro-focus, #ef4444);
  }

  .dot.active {
    background-color: transparent;
    border-color: var(--pomodoro-focus, #ef4444);
    box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.3);
    animation: dotPulse 1.5s ease-in-out infinite;
  }

  @keyframes dotPulse {
    0%, 100% { transform: scale(1); }
    50%       { transform: scale(1.2); }
  }
</style>
