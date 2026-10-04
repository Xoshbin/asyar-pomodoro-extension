<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    ExtensionContext,
    IActionService,
    IClipboardHistoryService,
    ExtensionStateProxy,
  } from 'asyar-sdk/view';
  import { ActionContext, ClipboardItemType } from 'asyar-sdk/view';
  import type { IOpenerService } from 'asyar-sdk/contracts';

  import type { TimerState, TimerPhase, HistoryEntry } from '../lib/timerEngine';
  import { buildSummaryText } from '../lib/summary';

  import CircularProgress from '../components/CircularProgress.svelte';
  import SessionDots from '../components/SessionDots.svelte';
  import HistoryList from '../components/HistoryList.svelte';

  interface Props {
    context: ExtensionContext;
  }
  let { context }: Props = $props();

  const extensionId = 'org.asyar.pomodoro';
  const ACTION_CLEAR_HISTORY = 'org.asyar.pomodoro:view:clear-history';

  const stateProxy = $derived(context.getService<ExtensionStateProxy>('state'));
  const actionService = $derived(context.getService<IActionService>('actions'));
  const clipboardSvc = $derived(context.getService<IClipboardHistoryService>('clipboard'));

  // ---------------------------------------------------------------------------
  // Reactive state — all worker-owned; view reads + subscribes.
  // ---------------------------------------------------------------------------
  let timer: TimerState | null = $state(null);
  let history: HistoryEntry[] = $state([]);
  let now: number = $state(Date.now());
  let searchQuery = $state('');
  let showHistory = $state(true);

  // ---------------------------------------------------------------------------
  // Derived display values — computed locally, no cross-boundary traffic.
  // ---------------------------------------------------------------------------
  const isRunning = $derived(timer?.isRunning ?? false);
  const phase: TimerPhase = $derived(timer?.phase ?? 'idle');
  const totalSecs = $derived(timer?.totalSeconds ?? 1);
  const sessions = $derived(timer?.sessionsCompleted ?? 0);

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
    !!timer && !timer.isRunning && timer.phase !== 'idle' && timer.pausedRemainingSeconds !== null,
  );

  // ---------------------------------------------------------------------------
  // Subscriptions + mount lifecycle.
  // ---------------------------------------------------------------------------
  onMount(() => {
    let active = true;
    const cleanup: Array<() => void> = [];

    (async () => {
      try {
        const initial = (await stateProxy.get('state')) as TimerState | null;
        if (active && initial) timer = initial;
      } catch {
        // Worker may not have written state yet — subscription will pick it up.
      }

      try {
        const initialHistory = (await stateProxy.get('history')) as HistoryEntry[] | null;
        if (active && initialHistory) history = initialHistory;
      } catch {
        // Same as above.
      }

      try {
        const unsub = await stateProxy.subscribe('state', (next) => {
          if (active) timer = (next as TimerState | null) ?? null;
        });
        cleanup.push(() => void unsub());
      } catch {
        // Fall back to periodic pull if subscription fails.
      }

      try {
        const unsub = await stateProxy.subscribe('history', (next) => {
          if (active) history = (next as HistoryEntry[] | null) ?? [];
        });
        cleanup.push(() => void unsub());
      } catch {
        // Same fallback.
      }
    })();

    const tickHandle = window.setInterval(() => {
      now = Date.now();
    }, 500);
    cleanup.push(() => window.clearInterval(tickHandle));

    window.addEventListener('message', handleHostMessage);
    cleanup.push(() => window.removeEventListener('message', handleHostMessage));

    registerViewActions();

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
    const opener = context.getService<IOpenerService>('opener');
    void opener.openUrl(url);
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
            payload: {
              key: 'Escape',
              metaKey: false,
              ctrlKey: false,
              shiftKey: false,
              altKey: false,
            },
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
  function handleStop() {
    void context.request('stop', {});
  }
  function handleSkip() {
    void context.request('skip', {});
  }

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
        {phase}
        {isRunning}
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
          <button
            class="btn-secondary"
            onclick={handleSkip}
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

        <HistoryList {history} {searchQuery} />
      </div>
    {/if}
  </div>
</div>

<style>
  :global(:root) {
    --pomodoro-focus: var(--accent-danger);
    --pomodoro-break: var(--accent-success);
    --pomodoro-long-break: var(--accent-primary);
    --pomodoro-idle: var(--text-tertiary);
  }

  .timer-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    font-family: var(--font-ui);
    overflow: hidden;
    position: relative;
    outline: none;
  }
  .timer-view:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-6) var(--space-3);
    border-bottom: 1px solid var(--separator);
    flex-shrink: 0;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .title-icon {
    font-size: var(--font-size-base);
  }

  .paused-badge {
    font-size: var(--font-size-2xs);
    padding: 1px var(--space-2);
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, var(--text-tertiary) 20%, transparent);
    color: var(--pomodoro-idle);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: var(--font-size-base);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    opacity: 0.6;
    transition:
      opacity 0.15s,
      background 0.15s;
    line-height: 1;
  }
  .icon-btn:hover {
    opacity: 1;
    background: var(--bg-hover);
  }

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
    gap: var(--space-5);
    padding: var(--space-6) var(--space-6) var(--space-5);
    flex-shrink: 0;
    width: 240px;
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
    align-items: center;
  }

  .btn-primary {
    width: 140px;
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-md);
    border: none;
    cursor: pointer;
    font-size: var(--font-size-md);
    font-weight: 600;
    background-color: var(--pomodoro-focus);
    color: white;
    transition:
      opacity 0.15s,
      transform 0.1s;
    letter-spacing: 0.3px;
  }
  .btn-primary.running {
    background-color: var(--pomodoro-idle);
  }
  .btn-primary:hover:not(:disabled) {
    opacity: 0.85;
  }
  .btn-primary:active:not(:disabled) {
    transform: scale(0.97);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    width: 140px;
    padding: 5px var(--space-5);
    border-radius: var(--radius-sm);
    border: 1px solid var(--separator);
    cursor: pointer;
    font-size: var(--font-size-sm);
    font-weight: 500;
    background-color: transparent;
    color: var(--text-secondary);
    transition:
      background 0.15s,
      color 0.15s,
      border-color 0.15s;
  }
  .btn-secondary:hover {
    background-color: var(--bg-hover);
    color: var(--text-primary);
    border-color: color-mix(in srgb, var(--text-primary) 20%, transparent);
  }

  .keyboard-hints {
    display: flex;
    gap: var(--space-4);
    font-size: var(--font-size-2xs);
    color: var(--text-tertiary);
    margin-top: 2px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .skeleton-note {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
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
    border-left: 1px solid var(--separator);
    min-width: 0;
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-5) var(--space-2);
    border-bottom: 1px solid var(--separator);
    flex-shrink: 0;
  }

  h4 {
    margin: 0;
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-tertiary);
  }

  .copy-btn {
    background: none;
    border: 1px solid var(--separator);
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    padding: 3px var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.15s;
  }
  .copy-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: color-mix(in srgb, var(--text-primary) 20%, transparent);
  }
</style>
