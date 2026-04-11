<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    subscribe,
    start, pause, stop, skip,
    clearHistory, getHistory, getTimerSettings,
    type TimerState, type SessionRecord,
  } from '../lib/timerEngine';
  import {
    type INotificationService, type IActionService,
    type IClipboardHistoryService,
    ActionContext, ClipboardItemType
  } from 'asyar-sdk';
  import { notifyPaused } from '../lib/notifications';

  import CircularProgress from '../components/CircularProgress.svelte';
  import SessionDots      from '../components/SessionDots.svelte';
  import HistoryList      from '../components/HistoryList.svelte';

  interface Props {
    notifService:     INotificationService;
    actionService:    IActionService;
    clipboardService: IClipboardHistoryService;
    extensionId:      string;
  }
  let { notifService, actionService, clipboardService, extensionId }: Props = $props();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let timerState = $state<TimerState | null>(null);
  let history    = $state<SessionRecord[]>([]);
  let searchQuery                   = $state('');
  let showHistory                   = $state(true);

  // ---------------------------------------------------------------------------
  // Derived helpers
  // ---------------------------------------------------------------------------
  let isRunning      = $derived(timerState?.isRunning ?? false);
  let phase          = $derived(timerState?.phase ?? 'idle');
  let secondsLeft    = $derived(timerState?.secondsRemaining ?? 0);
  let totalSecs      = $derived(timerState?.totalSeconds ?? 1);
  let sessions       = $derived(timerState?.sessionsCompleted ?? 0);
  // Re-read whenever the engine broadcasts — the engine fires a broadcast
  // on every preference change, so `timerState` updates drive this
  // derivation and it always reflects the current preferences.
  let sessionsBefore = $derived(timerState ? getTimerSettings().sessionsBeforeLongBreak : 4);

  // ---------------------------------------------------------------------------
  // Subscribe to timer engine
  // ---------------------------------------------------------------------------
  let unsubTimer: (() => void) | null = null;

  onMount(() => {
    unsubTimer = subscribe((s: TimerState) => {
      timerState = s;
      history    = getHistory();
    });

    window.addEventListener('message', handleHostMessage);
    registerViewActions();
  });

  onDestroy(() => {
    unsubTimer?.();
    window.removeEventListener('message', handleHostMessage);
    unregisterViewActions();
  });

  // ---------------------------------------------------------------------------
  // Host message handler (keydown forwarding + view search)
  // ---------------------------------------------------------------------------
  function handleHostMessage(event: MessageEvent) {
    if (event.source !== window.parent) return;
    const { type, payload } = event.data ?? {};

    if (type === 'asyar:view:keydown') {
      handleKeydown(payload);
    } else if (type === 'asyar:view:search') {
      searchQuery = payload?.query ?? '';
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------
  function handleKeydown(kev: { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }) {
    if (!kev) return;

    switch (kev.key) {
      case ' ':
        if (isRunning) {
          pause();
          notifyPaused(notifService, timerState?.secondsRemaining ?? 0).catch(console.error);
        } else {
          start();
        }
        break;
      case 's':
      case 'S':
        stop();
        break;
      case 'n':
      case 'N':
        skip();
        break;
      case 'h':
      case 'H':
        showHistory = !showHistory;
        break;
      case 'Escape':
        window.parent.postMessage({
          type: 'asyar:extension:keydown',
          payload: { key: 'Escape', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
        }, '*');
        break;
    }
  }

  function handleNativeKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    handleKeydown(event);
  }

  // ---------------------------------------------------------------------------
  // View-scoped ⌘K actions (EXTENSION_VIEW context)
  // ---------------------------------------------------------------------------
  const ACTION_CLEAR_HISTORY = 'org.asyar.pomodoro:view:clear-history';

  function registerViewActions() {
    actionService.registerAction({
      id: ACTION_CLEAR_HISTORY,
      title: 'Clear Session History',
      description: 'Permanently removes all recorded sessions',
      icon: '🗑️',
      category: 'Settings',
      extensionId,
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        await notifService.notify({
          title: '🗑️ History cleared',
          body: 'All session records have been deleted.',
        }).catch(console.error);
        clearHistory();
        history = [];
      },
    });
  }

  function unregisterViewActions() {
    actionService.unregisterAction(ACTION_CLEAR_HISTORY);
  }

  // ---------------------------------------------------------------------------
  // Copy session summary
  // ---------------------------------------------------------------------------
  async function copySessionSummary() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayFocus = history.filter(r => r.phase === 'focus' && r.completedAt >= today.getTime() && !r.wasInterrupted);
    const totalMins  = Math.round(todayFocus.reduce((a, r) => a + r.durationMinutes, 0));
    const text = [
      `🍅 Pomodoro Summary — ${new Date().toLocaleDateString()}`,
      `• Focus sessions: ${todayFocus.length}`,
      `• Total focus time: ${totalMins} minutes`,
    ].join('\n');

    await clipboardService.writeToClipboard({
      id: crypto.randomUUID(),
      type: ClipboardItemType.Text,
      content: text,
      createdAt: Date.now(),
      favorite: false,
    });

    await notifService.notify({ title: '📋 Copied!', body: 'Session summary copied to clipboard.' }).catch(console.error);
  }

  // ---------------------------------------------------------------------------
  // Phase toggle (primary button)
  // ---------------------------------------------------------------------------
  function handlePrimaryButton() {
    if (isRunning) {
      pause();
      notifyPaused(notifService, timerState?.secondsRemaining ?? 0).catch(console.error);
    } else {
      start();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="timer-view"
  onkeydown={handleNativeKeydown}
  role="application"
  aria-label="Pomodoro Timer"
  tabindex="-1"
>
  <!-- ─────────────────── Header ─────────────────────────────────────────── -->
  <div class="header">
    <div class="title">
      <span class="title-icon" aria-hidden="true">🍅</span>
      <span>Pomodoro Timer</span>
    </div>
    <div class="header-actions">
      <button
        class="icon-btn"
        onclick={() => showHistory = !showHistory}
        aria-label="{showHistory ? 'Hide' : 'Show'} history"
        title="Toggle history (H)"
      >
        📋
      </button>
    </div>
  </div>

  <!-- ─────────────────── Main content ──────────────────────────────────── -->
  <div class="main-content">
    <!-- Left: Timer + controls -->
    <div class="timer-column">
      {#if timerState}
        <CircularProgress
          secondsRemaining={secondsLeft}
          totalSeconds={totalSecs}
          phase={phase}
          isRunning={isRunning}
        />
      {/if}

      <SessionDots
        sessionsCompleted={sessions}
        sessionsBeforeLongBreak={sessionsBefore}
        isCurrentlyFocus={isRunning && phase === 'focus'}
      />

      <!-- Controls -->
      <div class="controls">
        <button
          class="btn-primary"
          class:running={isRunning}
          onclick={handlePrimaryButton}
          aria-label={isRunning ? 'Pause' : (phase === 'idle' ? 'Start' : 'Resume')}
          title="Space"
        >
          {isRunning ? '⏸ Pause' : phase === 'idle' ? '▶ Start' : '▶ Resume'}
        </button>

        {#if phase !== 'idle'}
          <button
            class="btn-secondary"
            onclick={() => stop()}
            aria-label="Stop timer"
            title="S"
          >
            ■ Stop
          </button>
          <button
            class="btn-secondary"
            onclick={() => skip()}
            aria-label="Skip to next phase"
            title="N"
          >
            ⏭ Skip
          </button>
        {/if}
      </div>

      <div class="keyboard-hints">
        <span>Space = start/pause</span>
        <span>N = skip</span>
        <span>S = stop</span>
      </div>
    </div>

    <!-- Right: History -->
    {#if showHistory}
      <div class="history-column">
        <div class="history-header">
          <h4>Session History</h4>
          {#if history.length > 0}
            <button
              class="copy-btn"
              onclick={copySessionSummary}
              title="Copy today's summary to clipboard"
              aria-label="Copy session summary"
            >
              📋 Copy
            </button>
          {/if}
        </div>

        <HistoryList
          history={history}
          searchQuery={searchQuery}
        />
      </div>
    {/if}
  </div>
</div>

<style>
  /* Semantic Pomodoro phase colours — same in both modes */
  :global(:root) {
    --pomodoro-focus:      #ef4444;
    --pomodoro-break:      #22c55e;
    --pomodoro-long-break: #3b82f6;
    --pomodoro-idle:       #6b7280;
  }

  /* Dark mode — pomodoro-specific tokens not in tokens.css */
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --text-muted:  rgba(235, 235, 245, 0.35);
      --hover-bg:    rgba(64, 64, 66, 0.55);
      --track-color: rgba(255, 255, 255, 0.1);
    }
  }

  /* Light mode — matches Asyar host palette */
  @media (prefers-color-scheme: light) {
    :global(:root) {
      --bg-primary:    rgb(242, 242, 247);
      --bg-secondary:  rgb(230, 230, 235);
      --text-primary:  rgba(0, 0, 0, 0.9);
      --text-secondary: rgba(60, 60, 67, 0.7);
      --text-muted:    rgba(60, 60, 67, 0.4);
      --border-color:  rgba(60, 60, 67, 0.15);
      --hover-bg:      rgba(0, 0, 0, 0.05);
      --track-color:   rgba(0, 0, 0, 0.08);
    }
  }

  .timer-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    overflow: hidden;
    position: relative;
    outline: none;
  }

  /* ── Header ──────────────────────────────────────────────────────────── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px 8px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .title-icon {
    font-size: 16px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    padding: 4px 6px;
    border-radius: 6px;
    opacity: 0.6;
    transition: opacity 0.15s, background 0.15s;
    line-height: 1;
  }

  .icon-btn:hover {
    opacity: 1;
    background: var(--hover-bg);
  }

  /* ── Main layout ─────────────────────────────────────────────────────── */
  .main-content {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  /* ── Timer column ────────────────────────────────────────────────────── */
  .timer-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 16px 16px 12px;
    flex-shrink: 0;
    width: 240px;
  }

  /* ── Controls ────────────────────────────────────────────────────────── */
  .controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    align-items: center;
  }

  .btn-primary {
    width: 140px;
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    background-color: var(--pomodoro-focus);
    color: white;
    transition: opacity 0.15s, transform 0.1s;
    letter-spacing: 0.3px;
  }

  .btn-primary.running {
    background-color: var(--pomodoro-idle);
  }

  .btn-primary:hover {
    opacity: 0.85;
  }

  .btn-primary:active {
    transform: scale(0.97);
  }

  .btn-secondary {
    width: 140px;
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    background-color: transparent;
    color: var(--text-secondary);
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .btn-secondary:hover {
    background-color: var(--hover-bg);
    color: var(--text-primary);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .keyboard-hints {
    display: flex;
    gap: 10px;
    font-size: 10px;
    color: var(--text-muted);
    margin-top: 2px;
    flex-wrap: wrap;
    justify-content: center;
  }

  /* ── History column ──────────────────────────────────────────────────── */
  .history-column {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-left: 1px solid var(--border-color);
    min-width: 0;
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px 6px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  h4 {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-muted);
  }

  .copy-btn {
    background: none;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 5px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .copy-btn:hover {
    background: var(--hover-bg);
    color: var(--text-primary);
    border-color: rgba(255, 255, 255, 0.2);
  }
</style>
