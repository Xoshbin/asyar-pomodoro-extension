<script lang="ts">
  interface Props {
    /** Focus sessions completed in the current cycle. */
    sessionsCompleted: number;
    /** Sessions in one cycle before a long break (from settings). */
    sessionsBeforeLongBreak: number;
    /** Whether a focus session is running right now. */
    isCurrentlyFocus: boolean;
  }
  let { sessionsCompleted, sessionsBeforeLongBreak, isCurrentlyFocus }: Props = $props();

  let total = $derived(Math.max(1, Math.round(sessionsBeforeLongBreak)));
  let dots = $derived(Array.from({ length: total }, (_, i) => i));
</script>

<div
  class="session-dots"
  role="img"
  aria-label="{sessionsCompleted} of {total} focus sessions completed toward a long break"
>
  {#each dots as i (i)}
    <span
      class="dot"
      class:filled={i < sessionsCompleted}
      class:active={isCurrentlyFocus && i === sessionsCompleted}
      aria-hidden="true"
    ></span>
  {/each}
</div>

<style>
  .session-dots {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: var(--radius-full);
    /* Future sessions are recessed wells, not empty outlines — the eye reads a
       set of four positions to fill, not four checkboxes. */
    background: var(--bg-tertiary);
    box-shadow: inset 0 0 0 1px var(--border-color);
    transition:
      background var(--dur-quick) var(--ease-travel),
      box-shadow var(--dur-quick) var(--ease-travel),
      transform var(--dur-quick) var(--ease-travel);
  }

  .dot.filled {
    background: var(--phase-voice);
    box-shadow: none;
  }

  .dot.active {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--phase-voice);
    animation: dot-breathe 2.4s var(--ease-travel) infinite;
  }

  @keyframes dot-breathe {
    0%,
    100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(1.28);
      opacity: 0.55;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot.active {
      animation: none;
    }
  }
</style>