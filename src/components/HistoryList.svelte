<script lang="ts">
  import type { HistoryEntry } from '../lib/timerEngine';
  import { historyPhaseLabel, historyPhaseVoice } from '../lib/phaseTheme';
  import { formatClockTime, startOfToday } from '../lib/time';

  interface Props {
    /** Newest first — the worker unshifts on insert. */
    history: HistoryEntry[];
    /** Query forwarded from the launcher search field, if any. */
    searchQuery?: string;
    /** Current clock, injected so "today" and the live rows stay testable. */
    now: number;
  }
  let { history, searchQuery = '', now }: Props = $props();

  function formatDuration(minutes: number): string {
    if (minutes < 1) return '<1m';
    return `${Math.round(minutes)}m`;
  }

  let todayStart = $derived(startOfToday(now));

  let today = $derived(history.filter((record) => record.completedAt >= todayStart));

  let visible = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return today;
    return today.filter((record) => {
      const label = historyPhaseLabel(record.phase).toLowerCase();
      return (
        label.includes(q) ||
        (q === 'break' && record.phase !== 'focus') ||
        formatDuration(record.durationMinutes).includes(q)
      );
    });
  });
</script>

<div class="history-list">
  {#if visible.length === 0}
    <div class="empty">
      {#if searchQuery.trim()}
        <span class="empty-title">No sessions match “{searchQuery.trim()}”</span>
        <span class="empty-hint">Try a phase name or a duration</span>
      {:else}
        <span class="empty-title">No sessions recorded today</span>
        <span class="empty-hint">Start a timer to build focus</span>
      {/if}
    </div>
  {:else}
    <ul>
      {#each visible as record (record.id)}
        <li
          class="row"
          class:interrupted={record.wasInterrupted}
          title={record.wasInterrupted ? 'Ended early' : undefined}
        >
          <span
            class="pip"
            class:hollow={record.wasInterrupted}
            style="--pip: {historyPhaseVoice(record.phase)}"
            aria-hidden="true"
          ></span>
          <span class="phase">{historyPhaseLabel(record.phase)}</span>
          <span class="meta">
            <span class="duration">{formatDuration(record.durationMinutes)}</span>
            <span class="dot-separator" aria-hidden="true">·</span>
            <span class="time">{formatClockTime(record.completedAt)}</span>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .history-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 var(--space-3) var(--space-3);
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
    overscroll-behavior: contain;
  }

  .history-list::-webkit-scrollbar {
    width: 10px;
  }
  .history-list::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: var(--radius-full);
    border: 3px solid transparent;
    background-clip: content-box;
  }
  .history-list::-webkit-scrollbar-track {
    background: transparent;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* One rhythmic 38px row, matching the launcher's list so the ledger and the
     results list share a baseline when the view sits between them. */
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: var(--shell-row-h);
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    transition: background var(--dur-instant) var(--ease-travel);
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .pip {
    width: 7px;
    height: 7px;
    flex-shrink: 0;
    border-radius: var(--radius-full);
    background: var(--pip);
  }

  /* An interrupted session keeps its phase colour but loses its fill, so the
     state survives with all hue removed. */
  .pip.hollow {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--pip);
  }

  .phase {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-family: var(--font-ui);
    font-weight: 500;
    color: var(--text-primary);
  }

  .row.interrupted .phase {
    color: var(--text-secondary);
  }

  .meta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--font-size-2xs);
    color: var(--text-secondary);
  }

  .dot-separator {
    color: var(--text-tertiary);
    opacity: 0.6;
  }

  .time {
    min-width: 58px;
    text-align: right;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    height: 100%;
    min-height: 120px;
    padding: var(--space-6);
    text-align: center;
  }

  .empty-title {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-secondary);
  }

  .empty-hint {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }
</style>