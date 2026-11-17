<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type {
    ExtensionContext,
    IActionService,
    IClipboardHistoryService,
    ExtensionStateProxy,
  } from 'asyar-sdk/view';
  import { ActionContext, ClipboardItemType, extensionBridge } from 'asyar-sdk/view';
  import type { IFeedbackService } from 'asyar-sdk/contracts';

  import type { HistoryEntry, TimerPhase, TimerState } from '../lib/timerEngine';
  import { buildSummaryText } from '../lib/summary';
  import { phaseTheme } from '../lib/phaseTheme';
  import { startOfToday } from '../lib/time';
  import { computeTodayStats, formatTimeRange, formatDuration } from '../lib/stats';
  import { VIEW_ACTION_NAMES, viewActionId } from '../lib/actions';

  interface SearchBarAccessoryLike {
    onChange: (handler: (value: string) => void) => () => void;
    setButtonTitle?: (title: string) => void;
  }

  interface Props {
    context: ExtensionContext;
    searchBarAccessory?: SearchBarAccessoryLike;
  }
  let { context, searchBarAccessory }: Props = $props();

  const extensionId = 'org.asyar.pomodoro';

  const stateProxy = $derived(context.getService<ExtensionStateProxy>('state'));
  const actions = $derived(context.getService<IActionService>('actions'));
  const clipboard = $derived(context.getService<IClipboardHistoryService>('clipboard'));
  const feedback = $derived(context.getService<IFeedbackService>('feedback'));
  const extensionManager = $derived(context.getService<any>('extensions'));

  // ── State ────────────────────────────────────────────────────────────────
  let timer: TimerState | null = $state(null);
  let history: HistoryEntry[] = $state([]);
  let now: number = $state(Date.now());
  let currentFilter = $state<'all' | 'focus' | 'breaks' | 'stats'>('all');
  let searchQuery = $state('');

  let clockInterval: ReturnType<typeof setInterval> | undefined;
  let accessoryDispose: (() => void) | undefined;

  // ── Derived Values ───────────────────────────────────────────────────────
  const defaultFocusSeconds = $derived.by(() => {
    const v = context.preferences.values.focusMinutes;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v * 60 : 25 * 60;
  });

  const ready = $derived(timer !== null);
  const isRunning = $derived(timer?.isRunning ?? false);
  const phase: TimerPhase = $derived(timer?.phase ?? 'idle');
  const totalSecs = $derived(
    timer && timer.totalSeconds > 0 ? timer.totalSeconds : defaultFocusSeconds,
  );
  const sessions = $derived(timer?.sessionsCompleted ?? 0);
  const theme = $derived(phaseTheme(phase));

  const isPaused = $derived(
    !!timer && !timer.isRunning && timer.phase !== 'idle' && timer.pausedRemainingSeconds !== null,
  );

  const remainingSeconds = $derived.by(() => {
    if (!timer || timer.phase === 'idle') {
      return timer && timer.totalSeconds > 0 ? timer.totalSeconds : defaultFocusSeconds;
    }
    if (timer.isRunning && timer.phaseEndsAt !== null) {
      return Math.max(0, Math.ceil((timer.phaseEndsAt - now) / 1000));
    }
    if (timer.pausedRemainingSeconds !== null) return timer.pausedRemainingSeconds;
    if (timer.totalSeconds > 0) return timer.totalSeconds;
    return defaultFocusSeconds;
  });

  const displayMinutes = $derived(Math.floor(remainingSeconds / 60));
  const displaySeconds = $derived(remainingSeconds % 60);
  const timeFormatted = $derived(
    `${String(displayMinutes).padStart(2, '0')}:${String(displaySeconds).padStart(2, '0')}`,
  );

  const progressPercent = $derived.by(() => {
    if (totalSecs <= 0 || phase === 'idle') return 0;
    const elapsed = Math.max(0, totalSecs - remainingSeconds);
    return Math.min(100, Math.round((elapsed / totalSecs) * 100));
  });

  const sessionsBefore = $derived.by(() => {
    const v = context.preferences.values.sessionsBeforeLongBreak;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 4;
  });

  const currentCycleSession = $derived(sessions % sessionsBefore);

  const todayStart = $derived(startOfToday(now));
  const todayHistory = $derived(history.filter((h) => h.completedAt >= todayStart));
  const stats = $derived(computeTodayStats(history, now, sessionsBefore * 2));

  const filteredHistory = $derived.by(() => {
    let list = todayHistory;
    if (currentFilter === 'focus') {
      list = list.filter((h) => h.phase === 'focus');
    } else if (currentFilter === 'breaks') {
      list = list.filter((h) => h.phase === 'short-break' || h.phase === 'long-break');
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((h) => h.phase.toLowerCase().includes(q));
    }
    return list;
  });

  const primaryLabel = $derived.by(() => {
    if (isRunning) return 'Pause';
    if (isPaused) return 'Resume';
    return 'Start Focus';
  });

  const phaseGlowColor = $derived.by(() => {
    if (phase === 'focus') return 'rgba(244, 63, 94, 0.16)';
    if (phase === 'short-break') return 'rgba(16, 185, 129, 0.16)';
    if (phase === 'long-break') return 'rgba(99, 102, 241, 0.16)';
    return 'rgba(148, 163, 184, 0.08)';
  });

  const phaseAccentColor = $derived.by(() => {
    if (phase === 'focus') return '#f43f5e';
    if (phase === 'short-break') return '#10b981';
    if (phase === 'long-break') return '#6366f1';
    return 'var(--text-secondary)';
  });

  // ── Actions ──────────────────────────────────────────────────────────────
  async function toggleTimer(): Promise<void> {
    try {
      if (isRunning) {
        await context.request('pause', {});
      } else if (isPaused) {
        await context.request('resume', {});
      } else {
        await context.request('start', {});
      }
    } catch (err) {
      console.error('[Pomodoro] toggleTimer failed:', err);
      void feedback?.showHUD(`Failed to toggle: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function startPreset(targetPhase: 'focus' | 'short-break' | 'long-break', minutes?: number): Promise<void> {
    try {
      await context.request('startPhase', { phase: targetPhase, minutes });
    } catch (err) {
      console.error('[Pomodoro] startPreset failed:', err);
      void feedback?.showHUD(`Failed to start ${targetPhase}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function skipPhase(): Promise<void> {
    try {
      await context.request('skip', {});
    } catch (err) {
      console.error('[Pomodoro] skipPhase failed:', err);
    }
  }

  async function stopTimer(): Promise<void> {
    try {
      await context.request('stop', {});
    } catch (err) {
      console.error('[Pomodoro] stopTimer failed:', err);
    }
  }

  async function copySummary(): Promise<void> {
    try {
      const text = buildSummaryText({ now, history });
      await clipboard.writeToClipboard({
        id: crypto.randomUUID(),
        type: ClipboardItemType.Text,
        content: text,
        createdAt: Date.now(),
        favorite: false,
      });
      void feedback.showHUD('Today’s summary copied');
    } catch (err) {
      console.error('[Pomodoro] copySummary failed:', err);
    }
  }

  async function clearHistory(): Promise<void> {
    try {
      await context.request('clearHistory', {});
      void feedback.showHUD('Session history cleared');
    } catch (err) {
      console.error('[Pomodoro] clearHistory failed:', err);
    }
  }

  // ── Keyboard Navigation ──────────────────────────────────────────────────
  function handleKeydown(e: KeyboardEvent): void {
    // Space or Enter or Cmd+Enter / Ctrl+Enter: Toggle timer
    if (e.key === ' ' || (e.key === 'Enter' && !e.altKey)) {
      e.preventDefault();
      void toggleTimer();
      return;
    }

    // ⌘S: Skip phase
    if ((e.key === 's' || e.key === 'S') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void skipPhase();
      return;
    }

    // ⌘.: Reset / Stop
    if (e.key === '.' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void stopTimer();
      return;
    }

    // ⌘1: Start 25m Focus
    if (e.key === '1' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void startPreset('focus', 25);
      return;
    }

    // ⌘2: Start 50m Deep Work
    if (e.key === '2' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void startPreset('focus', 50);
      return;
    }

    // ⌘3: Start 5m Short Break
    if (e.key === '3' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void startPreset('short-break', 5);
      return;
    }

    // ⌘4: Start 15m Long Break
    if (e.key === '4' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void startPreset('long-break', 15);
      return;
    }

    // ⇧⌘C: Copy summary
    if ((e.key === 'c' || e.key === 'C') && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      void copySummary();
      return;
    }
  }

  // ── Host Messages ────────────────────────────────────────────────────────
  function handleHostMessage(event: MessageEvent): void {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'asyar:event:search:query') {
      searchQuery = typeof data.payload?.query === 'string' ? data.payload.query : '';
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  onMount(async () => {
    window.addEventListener('message', handleHostMessage);
    window.addEventListener('keydown', handleKeydown);

    clockInterval = setInterval(() => {
      now = Date.now();
    }, 1000);

    // Initial state reads
    try {
      const initialTimer = (await stateProxy.get('timer')) as TimerState | null;
      if (initialTimer) {
        timer = initialTimer;
      } else {
        const initial = (await stateProxy.get('state')) as TimerState | null;
        if (initial) timer = initial;
      }
    } catch {}

    try {
      const initialHistory = (await stateProxy.get('history')) as HistoryEntry[] | null;
      if (initialHistory) history = initialHistory;
    } catch {}

    // Subscriptions
    try {
      await stateProxy.subscribe('timer', (next) => {
        if (next) timer = next as TimerState;
      });
      await stateProxy.subscribe('state', (next) => {
        if (next) timer = next as TimerState;
      });
      await stateProxy.subscribe('history', (next) => {
        history = (next as HistoryEntry[] | null) ?? [];
      });
    } catch {}

    // Search bar accessory dropdown
    if (searchBarAccessory?.onChange) {
      accessoryDispose = searchBarAccessory.onChange((value: string) => {
        if (value === 'all' || value === 'focus' || value === 'breaks' || value === 'stats') {
          currentFilter = value;
        }
      });
    }

    // Register ⌘K actions with host actionService
    actions.registerAction({
      id: viewActionId(extensionId, 'toggle-timer'),
      title: 'Toggle Focus / Pause',
      icon: '⏯',
      shortcut: 'Mod+Enter',
      category: 'Timer',
      primary: true,
      extensionId,
      context: ActionContext.EXTENSION_VIEW,
      execute: toggleTimer,
    });

    actions.registerAction({
      id: viewActionId(extensionId, 'start-focus-25'),
      title: 'Start 25m Focus Sprint',
      icon: '🍅',
      shortcut: 'Mod+1',
      category: 'Presets',
      extensionId,
      context: ActionContext.EXTENSION_VIEW,
      execute: () => startPreset('focus', 25),
    });

    actions.registerAction({
      id: viewActionId(extensionId, 'start-focus-50'),
      title: 'Start 50m Deep Work',
      icon: '⚡',
      shortcut: 'Mod+2',
      category: 'Presets',
      extensionId,
      context: ActionContext.EXTENSION_VIEW,
      execute: () => startPreset('focus', 50),
    });

    actions.registerAction({
      id: viewActionId(extensionId, 'start-short-break'),
      title: 'Start 5m Short Break',
      icon: '☕',
      shortcut: 'Mod+3',
      category: 'Presets',
      extensionId,
      context: ActionContext.EXTENSION_VIEW,
      execute: () => startPreset('short-break', 5),
    });

    actions.registerAction({
      id: viewActionId(extensionId, 'start-long-break'),
      title: 'Start 15m Long Break',
      icon: '🌴',
      shortcut: 'Mod+4',
      category: 'Presets',
      extensionId,
      context: ActionContext.EXTENSION_VIEW,
      execute: () => startPreset('long-break', 15),
    });

    actions.registerAction({
      id: viewActionId(extensionId, 'skip-phase'),
      title: 'Skip to Next Interval',
      icon: '⏭',
      shortcut: 'Mod+S',
      category: 'Timer',
      extensionId,
      context: ActionContext.EXTENSION_VIEW,
      execute: skipPhase,
    });

    actions.registerAction({
      id: viewActionId(extensionId, 'stop-timer'),
      title: 'Reset Timer to Idle',
      icon: '⏹',
      shortcut: 'Mod+.',
      category: 'Timer',
      extensionId,
      context: ActionContext.EXTENSION_VIEW,
      execute: stopTimer,
    });

    actions.registerAction({
      id: viewActionId(extensionId, 'copy-summary'),
      title: 'Copy Today’s Summary',
      icon: '📋',
      shortcut: 'Mod+Shift+C',
      category: 'History',
      extensionId,
      context: ActionContext.EXTENSION_VIEW,
      execute: copySummary,
    });

    actions.registerAction({
      id: viewActionId(extensionId, 'clear-history'),
      title: 'Clear Session History',
      icon: '🗑',
      shortcut: 'Control+Shift+X',
      category: 'History',
      destructive: true,
      extensionId,
      context: ActionContext.EXTENSION_VIEW,
      execute: clearHistory,
    });

    // Register handlers for actions
    const execMap: Record<string, () => Promise<void>> = {
      'toggle-timer': toggleTimer,
      'start-focus-25': () => startPreset('focus', 25),
      'start-focus-50': () => startPreset('focus', 50),
      'start-short-break': () => startPreset('short-break', 5),
      'start-long-break': () => startPreset('long-break', 15),
      'skip-phase': skipPhase,
      'stop-timer': stopTimer,
      'copy-summary': copySummary,
      'clear-history': clearHistory,
    };

    const bridge = extensionBridge as any;
    for (const name of VIEW_ACTION_NAMES) {
      const vid = viewActionId(extensionId, name);
      const fn = execMap[name];
      if (!fn) continue;

      actions.registerActionHandler(vid, fn);
      actions.registerActionHandler(name, fn);

      if (bridge?.actionRegistry) {
        const dummyAction = { id: vid, title: name, extensionId, execute: fn };
        bridge.actionRegistry.set(vid, dummyAction);
        bridge.actionRegistry.set(name, dummyAction);
        bridge.actionRegistry.set(`act_${extensionId}_${name}`, dummyAction);
        bridge.actionRegistry.set(`act_${extensionId}_${vid}`, dummyAction);
      }
    }
  });

  onDestroy(() => {
    window.removeEventListener('message', handleHostMessage);
    window.removeEventListener('keydown', handleKeydown);
    if (clockInterval) clearInterval(clockInterval);
    accessoryDispose?.();

    for (const name of VIEW_ACTION_NAMES) {
      actions.unregisterAction(viewActionId(extensionId, name));
    }
  });

  // Update bottom action bar label
  $effect(() => {
    extensionManager?.setActiveViewActionLabel?.(primaryLabel);
  });
</script>

<div class="pomo-shell custom-scrollbar" style="--pomo-glow: {phaseGlowColor}; --pomo-accent: {phaseAccentColor};">
  <!-- ── 1. The Focus Stage (Hero Card) ── -->
  <section class="pomo-hero" aria-label="Current timer">
    <div class="pomo-hero-header">
      <div class="pomo-badge" class:is-active={isRunning}>
        <span class="pomo-dot" aria-hidden="true"></span>
        <span class="pomo-badge-text">
          {#if phase === 'focus'}
            🍅 Focus Session
          {:else if phase === 'short-break'}
            ☕ Short Break
          {:else if phase === 'long-break'}
            🌴 Long Break
          {:else}
            ⏳ Focus Studio
          {/if}
        </span>
      </div>

      <div class="pomo-state-tag" class:running={isRunning} class:paused={isPaused}>
        {#if isRunning}
          ● Running
        {:else if isPaused}
          ❚❚ Paused
        {:else}
          ○ Idle
        {/if}
      </div>
    </div>

    <!-- Live Digital Countdown -->
    <div class="pomo-timer-display" aria-label="{timeFormatted} remaining">
      {timeFormatted}
    </div>

    <!-- Live Progress Bar -->
    <div class="pomo-progress-wrap">
      <div class="pomo-progress-track">
        <div class="pomo-progress-bar" style="width: {progressPercent}%;"></div>
      </div>
      <div class="pomo-progress-meta">
        <span>{phase === 'idle' ? `${timeFormatted} session` : `${timeFormatted} remaining`}</span>
        <span>{phase === 'idle' ? 'Ready' : `${progressPercent}% completed`}</span>
      </div>
    </div>

    <!-- Cycle Indicator (Connected Capsule Pills) -->
    <div class="pomo-cycle-row">
      <div class="pomo-capsules">
        {#each Array(Math.max(1, sessionsBefore)) as _, index}
          <div
            class="pomo-capsule"
            class:filled={index < currentCycleSession}
            class:active={isRunning && index === currentCycleSession && phase === 'focus'}
            title="Session {index + 1} of {sessionsBefore}"
          ></div>
        {/each}
      </div>
      <span class="pomo-cycle-label">
        Session {Math.min(sessionsBefore, currentCycleSession + 1)} of {sessionsBefore} • Long break in {Math.max(1, sessionsBefore - currentCycleSession)}
      </span>
    </div>

    <!-- Quick Sprint Preset Chips -->
    <div class="pomo-presets-row" role="group" aria-label="Quick presets">
      <button class="pomo-chip" type="button" onclick={() => startPreset('focus', 25)}>
        <span>⚡</span> 25m Focus
      </button>
      <button class="pomo-chip" type="button" onclick={() => startPreset('focus', 50)}>
        <span>🔥</span> 50m Deep Work
      </button>
      <button class="pomo-chip" type="button" onclick={() => startPreset('short-break', 5)}>
        <span>☕</span> 5m Break
      </button>
      <button class="pomo-chip" type="button" onclick={() => startPreset('long-break', 15)}>
        <span>🌴</span> 15m Long
      </button>
    </div>

    <!-- Primary Control Buttons -->
    <div class="pomo-controls-row">
      <button
        class="pomo-btn-main"
        class:is-running={isRunning}
        type="button"
        onclick={toggleTimer}
      >
        {#if isRunning}
          <span class="pomo-btn-icon">❚❚</span> Pause
        {:else if isPaused}
          <span class="pomo-btn-icon">▶</span> Resume Focus
        {:else}
          <span class="pomo-btn-icon">▶</span> Start Focus
        {/if}
      </button>

      {#if phase !== 'idle'}
        <button class="pomo-btn-sub" type="button" onclick={skipPhase} title="Skip to next interval (⌘S)">
          ⏭ Skip
        </button>
        <button class="pomo-btn-sub" type="button" onclick={stopTimer} title="Reset timer (⌘.)">
          ⏹ Reset
        </button>
      {/if}
    </div>
  </section>

  <!-- ── 2. Today's Focus Pulse (3 Glass Metric Cards) ── -->
  <section class="pomo-stats-grid" aria-label="Today's stats">
    <div class="pomo-stat-card">
      <div class="pomo-stat-top">
        <span class="pomo-stat-icon">⏱️</span>
        <span class="pomo-stat-tag">Focus Time</span>
      </div>
      <div class="pomo-stat-num">{stats.focusFormatted}</div>
      <div class="pomo-stat-sub">Across today's sessions</div>
    </div>

    <div class="pomo-stat-card">
      <div class="pomo-stat-top">
        <span class="pomo-stat-icon">🍅</span>
        <span class="pomo-stat-tag">Sessions</span>
      </div>
      <div class="pomo-stat-num">{stats.completedSessions} <span class="pomo-stat-goal">/ {stats.dailyGoalSessions}</span></div>
      <div class="pomo-stat-sub">
        <div class="pomo-mini-bar">
          <div class="pomo-mini-fill" style="width: {stats.dailyGoalPercent}%;"></div>
        </div>
        <span>{stats.dailyGoalPercent}% daily goal</span>
      </div>
    </div>

    <div class="pomo-stat-card">
      <div class="pomo-stat-top">
        <span class="pomo-stat-icon">🔥</span>
        <span class="pomo-stat-tag">Daily Streak</span>
      </div>
      <div class="pomo-stat-num">{stats.streakDays} <span class="pomo-stat-goal">{stats.streakDays === 1 ? 'day' : 'days'}</span></div>
      <div class="pomo-stat-sub">All-time: {timer?.totalSessionsEver ?? 0} sessions</div>
    </div>
  </section>

  <!-- ── 3. Session Timeline & History ── -->
  <section class="pomo-activity-section" aria-label="Today's activity">
    <div class="pomo-activity-header">
      <div class="pomo-activity-title">
        Today’s Activity
        <span class="pomo-activity-count">{filteredHistory.length}</span>
      </div>
      <button class="pomo-copy-link" type="button" onclick={copySummary} title="Copy summary (⇧⌘C)">
        📋 Copy Summary
      </button>
    </div>

    {#if filteredHistory.length > 0}
      <div class="pomo-history-list">
        {#each filteredHistory as entry (entry.id)}
          <div class="pomo-history-row">
            <div class="pomo-row-left">
              <span class="pomo-row-icon" class:focus={entry.phase === 'focus'} class:break={entry.phase !== 'focus'}>
                {#if entry.phase === 'focus'}
                  🍅
                {:else if entry.phase === 'short-break'}
                  ☕
                {:else}
                  🌴
                {/if}
              </span>
              <div class="pomo-row-info">
                <span class="pomo-row-title">
                  {#if entry.phase === 'focus'}
                    Focus Sprint
                  {:else if entry.phase === 'short-break'}
                    Short Break
                  {:else}
                    Long Break
                  {/if}
                </span>
                <span class="pomo-row-time">
                  {formatTimeRange(entry.completedAt, entry.durationMinutes)}
                </span>
              </div>
            </div>

            <div class="pomo-row-right">
              <span class="pomo-row-dur">{formatDuration(entry.durationMinutes)}</span>
              {#if entry.wasInterrupted}
                <span class="pomo-row-tag interrupted">Interrupted</span>
              {:else}
                <span class="pomo-row-tag completed">Completed</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="pomo-empty-card">
        <div class="pomo-empty-icon">🍅</div>
        <div class="pomo-empty-title">Ready to focus?</div>
        <div class="pomo-empty-desc">
          Choose a preset above or press <kbd>Enter</kbd> to begin your first 25-minute sprint.
        </div>
      </div>
    {/if}
  </section>
</div>

<style>
  .pomo-shell {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: var(--space-4, 16px);
    gap: var(--space-4, 16px);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: var(--font-ui, system-ui, -apple-system, sans-serif);
    overflow-y: auto;
    box-sizing: border-box;
  }

  /* ── 1. Hero Card ──────────────────────────────────────────────────────── */
  .pomo-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-5, 20px) var(--space-6, 24px);
    border-radius: var(--radius-lg, 16px);
    background: radial-gradient(ellipse at top, var(--pomo-glow) 0%, var(--bg-secondary) 65%);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
    box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.12);
    position: relative;
    overflow: hidden;
  }

  .pomo-hero-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .pomo-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2, 8px);
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--bg-tertiary);
    font-size: var(--font-size-sm, 12px);
    font-weight: 600;
    color: var(--text-primary);
  }

  .pomo-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--pomo-accent);
  }

  .pomo-badge.is-active .pomo-dot {
    animation: pomo-pulse 1.8s infinite ease-in-out;
  }

  .pomo-state-tag {
    font-size: var(--font-size-xs, 11px);
    font-weight: 600;
    padding: 3px 8px;
    border-radius: var(--radius-sm, 6px);
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
  }

  .pomo-state-tag.running {
    color: #10b981;
    background: rgba(16, 185, 129, 0.12);
  }

  .pomo-state-tag.paused {
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.12);
  }

  /* Giant Digits Display */
  .pomo-timer-display {
    font-size: 58px;
    font-weight: 700;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.04em;
    color: var(--text-primary);
    margin: var(--space-2, 8px) 0 var(--space-1, 4px);
    line-height: 1;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
  }

  /* Progress Bar */
  .pomo-progress-wrap {
    width: 100%;
    max-width: 380px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: var(--space-3, 12px);
  }

  .pomo-progress-track {
    width: 100%;
    height: 6px;
    border-radius: 999px;
    background: var(--bg-tertiary);
    overflow: hidden;
  }

  .pomo-progress-bar {
    height: 100%;
    border-radius: 999px;
    background: var(--pomo-accent);
    transition: width 0.4s ease-out;
  }

  .pomo-progress-meta {
    display: flex;
    justify-content: space-between;
    font-size: var(--font-size-xs, 11px);
    color: var(--text-tertiary);
    font-weight: 500;
  }

  /* Connected Capsules */
  .pomo-cycle-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    margin-bottom: var(--space-4, 16px);
  }

  .pomo-capsules {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .pomo-capsule {
    width: 28px;
    height: 6px;
    border-radius: 999px;
    background: var(--bg-tertiary);
    transition: background 0.2s, box-shadow 0.2s;
  }

  .pomo-capsule.filled {
    background: var(--pomo-accent);
  }

  .pomo-capsule.active {
    background: var(--pomo-accent);
    box-shadow: 0 0 8px var(--pomo-accent);
    animation: pomo-capsule-glow 1.5s infinite alternate;
  }

  .pomo-cycle-label {
    font-size: var(--font-size-xs, 11px);
    color: var(--text-tertiary);
    font-weight: 500;
  }

  /* Preset Sprint Chips */
  .pomo-presets-row {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    flex-wrap: wrap;
    justify-content: center;
    margin-bottom: var(--space-4, 16px);
  }

  .pomo-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 12px;
    border-radius: 999px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
    color: var(--text-secondary);
    font-size: var(--font-size-xs, 12px);
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.1s;
  }

  .pomo-chip:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    transform: translateY(-1px);
  }

  /* Main Controls */
  .pomo-controls-row {
    display: flex;
    align-items: center;
    gap: var(--space-3, 10px);
  }

  .pomo-btn-main {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2, 8px);
    padding: 9px 26px;
    border-radius: var(--radius-md, 10px);
    background: var(--pomo-accent);
    color: #ffffff;
    border: none;
    font-size: var(--font-size-md, 14px);
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
    transition: opacity 0.15s, transform 0.1s;
  }

  .pomo-btn-main:hover {
    opacity: 0.92;
    transform: scale(1.02);
  }

  .pomo-btn-main:active {
    transform: scale(0.98);
  }

  .pomo-btn-main.is-running {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
  }

  .pomo-btn-sub {
    padding: 9px 16px;
    border-radius: var(--radius-md, 10px);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
    color: var(--text-secondary);
    font-size: var(--font-size-sm, 13px);
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .pomo-btn-sub:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* ── 2. Today's Pulse Metrics ─────────────────────────────────────────── */
  .pomo-stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3, 12px);
    width: 100%;
  }

  .pomo-stat-card {
    display: flex;
    flex-direction: column;
    padding: var(--space-3, 14px) var(--space-4, 16px);
    border-radius: var(--radius-md, 12px);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.06));
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  .pomo-stat-top {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .pomo-stat-icon {
    font-size: 14px;
  }

  .pomo-stat-tag {
    font-size: var(--font-size-xs, 11px);
    color: var(--text-tertiary);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .pomo-stat-num {
    font-size: var(--font-size-lg, 20px);
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
    margin-bottom: 4px;
  }

  .pomo-stat-goal {
    font-size: var(--font-size-sm, 13px);
    font-weight: 500;
    color: var(--text-tertiary);
  }

  .pomo-stat-sub {
    font-size: var(--font-size-xs, 11px);
    color: var(--text-tertiary);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .pomo-mini-bar {
    width: 100%;
    height: 4px;
    border-radius: 999px;
    background: var(--bg-tertiary);
    overflow: hidden;
  }

  .pomo-mini-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--pomo-accent);
    transition: width 0.3s;
  }

  /* ── 3. Activity Timeline ──────────────────────────────────────────────── */
  .pomo-activity-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    width: 100%;
  }

  .pomo-activity-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-1, 4px);
  }

  .pomo-activity-title {
    font-size: var(--font-size-sm, 13px);
    font-weight: 600;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .pomo-activity-count {
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    font-size: 11px;
    font-weight: 600;
  }

  .pomo-copy-link {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: var(--font-size-xs, 12px);
    font-weight: 500;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm, 4px);
    transition: color 0.15s, background 0.15s;
  }

  .pomo-copy-link:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .pomo-history-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .pomo-history-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2, 8px) var(--space-3, 12px);
    border-radius: var(--radius-md, 8px);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.05));
    transition: background 0.15s;
  }

  .pomo-history-row:hover {
    background: var(--bg-hover);
  }

  .pomo-row-left {
    display: flex;
    align-items: center;
    gap: var(--space-3, 10px);
  }

  .pomo-row-icon {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    background: var(--bg-tertiary);
  }

  .pomo-row-icon.focus {
    background: rgba(244, 63, 94, 0.12);
  }

  .pomo-row-icon.break {
    background: rgba(16, 185, 129, 0.12);
  }

  .pomo-row-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .pomo-row-title {
    font-size: var(--font-size-sm, 13px);
    font-weight: 600;
    color: var(--text-primary);
  }

  .pomo-row-time {
    font-size: var(--font-size-xs, 11px);
    color: var(--text-tertiary);
  }

  .pomo-row-right {
    display: flex;
    align-items: center;
    gap: var(--space-3, 10px);
  }

  .pomo-row-dur {
    font-size: var(--font-size-xs, 12px);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .pomo-row-tag {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 999px;
  }

  .pomo-row-tag.completed {
    background: rgba(16, 185, 129, 0.12);
    color: #10b981;
  }

  .pomo-row-tag.interrupted {
    background: rgba(245, 158, 11, 0.12);
    color: #f59e0b;
  }

  /* Empty Activity Card */
  .pomo-empty-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-6, 32px) var(--space-4, 16px);
    border-radius: var(--radius-md, 12px);
    background: var(--bg-secondary);
    border: 1px dashed var(--border-color, rgba(255, 255, 255, 0.1));
    text-align: center;
  }

  .pomo-empty-icon {
    font-size: 28px;
    margin-bottom: var(--space-2, 8px);
  }

  .pomo-empty-title {
    font-size: var(--font-size-md, 14px);
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .pomo-empty-desc {
    font-size: var(--font-size-xs, 12px);
    color: var(--text-tertiary);
    max-width: 280px;
    line-height: 1.4;
  }

  .pomo-empty-desc kbd {
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    font-family: inherit;
    font-size: 11px;
  }

  /* Animations */
  @keyframes pomo-pulse {
    0%, 100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(1.4);
      opacity: 0.6;
    }
  }

  @keyframes pomo-capsule-glow {
    from {
      box-shadow: 0 0 4px var(--pomo-accent);
    }
    to {
      box-shadow: 0 0 10px var(--pomo-accent);
    }
  }
</style>
