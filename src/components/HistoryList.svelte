<script lang="ts">
  import type { SessionRecord } from '../lib/timerEngine';

  export let history: SessionRecord[];
  export let searchQuery: string = '';

  function relativeTime(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60)   return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function phaseIcon(phase: SessionRecord['phase']): string {
    if (phase === 'focus')       return '🍅';
    if (phase === 'short-break') return '☕';
    if (phase === 'long-break')  return '🛋️';
    return '⏱️';
  }

  function phaseLabel(phase: SessionRecord['phase']): string {
    if (phase === 'focus')       return 'Focus';
    if (phase === 'short-break') return 'Short break';
    if (phase === 'long-break')  return 'Long break';
    return 'Unknown';
  }

  $: filtered = searchQuery.trim()
    ? history.filter(r => {
        const q = searchQuery.toLowerCase();
        return phaseLabel(r.phase).toLowerCase().includes(q)
          || String(Math.round(r.durationMinutes)).includes(q)
          || (q === 'focus' && r.phase === 'focus')
          || (q === 'break' && r.phase !== 'focus');
      })
    : history;
</script>

<div class="history-list">
  {#if filtered.length === 0}
    <div class="empty-state">
      {#if searchQuery.trim()}
        <span>No sessions match "{searchQuery}"</span>
      {:else}
        <span>No sessions yet. Start your first Pomodoro!</span>
      {/if}
    </div>
  {:else}
    <ul>
      {#each filtered as record (record.id)}
        <li class="history-item" class:interrupted={record.wasInterrupted}>
          <span class="icon" aria-hidden="true">{phaseIcon(record.phase)}</span>
          <span class="label">{phaseLabel(record.phase)}</span>
          <span class="duration">{Math.round(record.durationMinutes)}min</span>
          {#if record.wasInterrupted}
            <span class="interrupted-badge">interrupted</span>
          {/if}
          <span class="time">{relativeTime(record.completedAt)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .history-list {
    width: 100%;
    height: 100%;
    overflow-y: auto;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .history-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-secondary, rgba(255,255,255,0.6));
    transition: background-color 0.1s ease;
  }

  .history-item:hover {
    background-color: var(--hover-bg, rgba(255,255,255,0.05));
  }

  .history-item.interrupted {
    opacity: 0.6;
  }

  .icon {
    font-size: 13px;
    flex-shrink: 0;
  }

  .label {
    flex: 1;
    color: var(--text-primary, rgba(255,255,255,0.85));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .duration {
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary, rgba(255,255,255,0.5));
    flex-shrink: 0;
  }

  .interrupted-badge {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
    flex-shrink: 0;
  }

  .time {
    flex-shrink: 0;
    text-align: right;
    min-width: 60px;
    color: var(--text-muted, rgba(255,255,255,0.35));
    font-size: 11px;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100px;
    color: var(--text-muted, rgba(255,255,255,0.35));
    font-size: 12px;
    text-align: center;
    padding: 16px;
  }
</style>
