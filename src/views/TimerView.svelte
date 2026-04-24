<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    ExtensionContext,
    IActionService,
    IClipboardHistoryService,
    ExtensionStateProxy,
  } from 'asyar-sdk/view';
  import { ActionContext, ClipboardItemType } from 'asyar-sdk/view';

  import type {
    TimerState,
    TimerPhase,
    HistoryEntry,
  } from '../lib/timerEngine';
  import { buildSummaryText } from '../lib/summary';

  import CircularProgress from '../components/CircularProgress.svelte';
  import SessionDots      from '../components/SessionDots.svelte';
  import HistoryList      from '../components/HistoryList.svelte';

  interface Props {
    context: ExtensionContext;
  }
  let { context }: Props = $props();

  const extensionId = 'org.asyar.pomodoro';
  const ACTION_CLEAR_HISTORY = 'org.asyar.pomodoro:view:clear-history';

  const stateProxy    = $derived(context.getService<ExtensionStateProxy>('state'));
  const actionService = $derived(context.getService<IActionService>('actions'));
  const clipboardSvc  = $derived(context.getService<IClipboardHistoryService>('clipboard'));

  // ---------------------------------------------------------------------------
  // Reactive state — all worker-owned; view reads + subscribes.
  // ---------------------------------------------------------------------------
  let timer: TimerState | null = $state(null);
  let history: HistoryEntry[]  = $state([]);
  let now: number              = $state(Date.now());
  let searchQuery              = $state('');
  let showHistory              = $state(true);

  // ---------------------------------------------------------------------------
  // Derived display values — computed locally, no cross-boundary traffic.
  // ---------------------------------------------------------------------------
  const isRunning   = $derived(timer?.isRunning ?? false);
  const phase: TimerPhase = $derived(timer?.phase ?? 'idle');
  const totalSecs   = $derived(timer?.totalSeconds ?? 1);
  const sessions    = $derived(timer?.sessionsCompleted ?? 0);

  const remainingSeconds = $derived.by(() => {
    if (!timer) return 0;
    if (timer.isRunning && timer.phaseEndsAt !== null) {
      return Math.max(0, Math.ceil((timer.phaseEndsAt - now) / 1000));
    }
    if (timer.pausedRemainingSeconds !== null) {
      return timer.pausedRemainingSeconds;
    }
    return timer.totalSeconds;
  });

  const sessionsBefore = $derived.by(() => {
    const v = context.preferences.values.sessionsBeforeLongBreak;
    return typeof v === 'number' && Number.isFinite(v) ? v : 4;
  });

  const isPaused = $derived(
    !!timer &&
      !timer.isRunning &&
      timer.phase !== 'idle' &&
      timer.pausedRemainingSeconds !== null,
  );

  // ---------------------------------------------------------------------------
  // Bootstrap: get initial state + subscribe + local tick + actions.
  // ---------------------------------------------------------------------------
  onMount(() => {
    let cleanup: Array<() => void | Promise<void>> = [];
    let active = true;

    (async () => {
      const [initialTimer, initialHistory, unsubTimer, unsubHistory] =
        await Promise.all([
          stateProxy.get('timer'),
          stateProxy.get('history'),
          stateProxy.subscribe('timer', (v) => {
            if (!active) return;
            timer = (v as TimerState | null) ?? null;
          }),
          stateProxy.subscribe('history', (v) => {
            if (!active) return;
            history = Array.isArray(v) ? (v as HistoryEntry[]) : [];
          }),
        ]);

      if (!active) {
        void unsubTimer();
        void unsubHistory();
        return;
      }

      timer   = (initialTimer as TimerState | null) ?? null;
      history = Array.isArray(initialHistory) ? (initialHistory as HistoryEntry[]) : [];

      cleanup.push(unsubTimer, unsubHistory);
    })().catch((err) => {
      context.getService<import('asyar-sdk/view').ILogService>('log').error(
        `TimerView bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    const tickHandle = window.setInterval(() => {
      now = Date.now();
    }, 500);
    cleanup.push(() => window.clearInterval(tickHandle));

    window.addEventListener('message', handleHostMessage);
    cleanup.push(() => window.removeEventListener('message', handleHostMessage));

    registerViewActions();
    cleanup.push(() => unregisterViewActions());

    return () => {
      active = false;
      for (const fn of cleanup) {
        try {
          void fn();
        } catch {
          // Best-effort teardown.
        }
      }
    };
  });

  // ---------------------------------------------------------------------------
  // Manifest-action handlers (see design §4-A deviation: registered from view
  // because worker has no actions service). Also registers the view-scoped
  // clear-history action.
  // ---------------------------------------------------------------------------
  function registerViewActions(): void {
    actionService.registerActionHandler('copy-summary', async () => {
      await writeSummaryToClipboard();
    });
    actionService.registerActionHandler('learn-more', async () => {
      openExternal('https://en.wikipedia.org/wiki/Pomodoro_Technique');
    });

    actionService.registerAction({
      id: ACTION_CLEAR_HISTORY,
      title: 'Clear Session History',
      description: 'Permanently removes all recorded sessions',
      icon: '🗑️',
      category: 'Settings',
      extensionId,
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        await context.request('clearHistory', {});
      },
    });
  }

  function unregisterViewActions(): void {
    try { actionService.unregisterAction(ACTION_CLEAR_HISTORY); } catch { /* noop */ }
  }

  async function writeSummaryToClipboard(): Promise<void> {
    const text = buildSummaryText({ now: Date.now(), history });
    await clipboardSvc.writeToClipboard({
      id: crypto.randomUUID(),
      type: ClipboardItemType.Text,
      content: text,
      createdAt: Date.now(),
      favorite: false,
    });
  }

  function openExternal(url: string): void {
    const messageId =
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2);
    window.parent.postMessage(
      { type: 'asyar:api:opener:open', payload: { url }, messageId, extensionId },
      '*',
    );
  }

  // ---------------------------------------------------------------------------
  // Host message forwarding (keydown, view search).
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

  function handleKeydown(kev: { key: string } | undefined) {
    if (!kev) return;
    switch (kev.key) {
      case ' ':
        void (isRunning ? context.request('pause', {}) : context.request('start', {}));
        break;
      case 's':
      case 'S':
        void context.request('stop', {});
        break;
      case 'n':
      case 'N':
        void context.request('skip', {});
        break;
      case 'h':
      case 'H':
        showHistory = !showHistory;
        break;
      case 'Escape':
        window.parent.postMessage(
          {
            type: 'asyar:extension:keydown',
            payload: { key: 'Escape', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
          },
          '*',
        );
        break;
    }
  }

  function handleNativeKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    handleKeydown(event);
  }

  // ---------------------------------------------------------------------------
  // Primary / secondary button handlers — all fan out to worker via RPC.
  // ---------------------------------------------------------------------------
  function handlePrimaryButton() {
    void (isRunning ? context.request('pause', {}) : context.request('start', {}));
  }
  function handleStop()  { void context.request('stop', {}); }
  function handleSkip()  { void context.request('skip', {}); }

  // ---------------------------------------------------------------------------
  // Copy button in-view (parity with the ⌘K copy-summary action).
  // ---------------------------------------------------------------------------
  async function copyFromHeader(): Promise<void> {
    await writeSummaryToClipboard();
  }

  // ---------------------------------------------------------------------------
  // Skeleton state — until the initial svc.state.get resolves.
  // ---------------------------------------------------------------------------
  const timerReady = $derived(timer !== null);
  const timeDisplay = $derived.by(() => {
    if (!timerReady) return '--:--';
    const m = Math.floor(remainingSeconds / 60);
    const s = remainingSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  });

  const primaryLabel = $derived.by(() => {
    if (!timerReady) return '— Loading';
    if (isRunning) return '⏸ Pause';
    if (phase === 'idle') return '▶ Start';
    return '▶ Resume';
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="timer-view"
  onkeydown={handleNativeKeydown}
  role="application"
  aria-label="Pomodoro Timer"
  tabindex="-1"
>
  <div class="header">
    <div class="title">
      <span class="title-icon" aria-hidden="true">🍅</span>
      <span>Pomodoro Timer</span>
      {#if isPaused}
        <span class="paused-badge">Paused</span>
      {/if}
    </div>
    <div class="header-actions">
      <button
        class="icon-btn"
        onclick={() => (showHistory = !showHistory)}
        aria-label="{showHistory ? 'Hide' : 'Show'} history"
        title="Toggle history (H)"
      >
        📋
      </button>
    </div>
  </div>

  <div class="main-content">
    <div class="timer-column">
      <CircularProgress
        secondsRemaining={remainingSeconds}
        totalSeconds={totalSecs}
        phase={phase}
        isRunning={isRunning}
      />

      <SessionDots
        sessionsCompleted={sessions}
        sessionsBeforeLongBreak={sessionsBefore}
        isCurrentlyFocus={isRunning && phase === 'focus'}
      />

      <div class="controls">
        <button
          class="btn-primary"
          class:running={isRunning}
          onclick={handlePrimaryButton}
          disabled={!timerReady}
          aria-label={primaryLabel}
          title="Space"
        >
          {primaryLabel}
        </button>

        {#if timerReady && phase !== 'idle'}
          <button class="btn-secondary" onclick={handleStop} aria-label="Stop timer" title="S">
            ■ Stop
          </button>
          <button class="btn-secondary" onclick={handleSkip} aria-label="Skip to next phase" title="N">
            ⏭ Skip
          </button>
        {/if}
      </div>

      <div class="keyboard-hints">
        <span>Space = start/pause</span>
        <span>N = skip</span>
        <span>S = stop</span>
      </div>

      {#if !timerReady}
        <div class="skeleton-note" aria-live="polite">Loading timer state…</div>
      {:else}
        <div class="visually-hidden" aria-live="polite">{timeDisplay}</div>
      {/if}
    </div>

    {#if showHistory}
      <div class="history-column">
        <div class="history-header">
          <h4>Session History</h4>
          {#if history.length > 0}
            <button
              class="copy-btn"
              onclick={copyFromHeader}
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
  :global(:root) {
    --pomodoro-focus:      #ef4444;
    --pomodoro-break:      #22c55e;
    --pomodoro-long-break: #3b82f6;
    --pomodoro-idle:       #6b7280;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --text-muted:  rgba(235, 235, 245, 0.35);
      --hover-bg:    rgba(64, 64, 66, 0.55);
      --track-color: rgba(255, 255, 255, 0.1);
    }
  }

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

  .title-icon { font-size: 16px; }

  .paused-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(107, 114, 128, 0.2);
    color: var(--pomodoro-idle);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .header-actions { display: flex; align-items: center; gap: 4px; }

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
  .icon-btn:hover { opacity: 1; background: var(--hover-bg); }

  .main-content {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

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
  .btn-primary.running { background-color: var(--pomodoro-idle); }
  .btn-primary:hover:not(:disabled) { opacity: 0.85; }
  .btn-primary:active:not(:disabled) { transform: scale(0.97); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

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

  .skeleton-note {
    font-size: 11px;
    color: var(--text-muted);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

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
