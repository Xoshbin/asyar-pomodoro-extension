<script lang="ts">
  import { getSettings, updateSettings, type TimerSettings } from '../lib/timerEngine';

  export let onClose: () => void;

  let settings: TimerSettings = getSettings();

  function handleChange() {
    updateSettings({ ...settings });
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div class="settings-panel" role="complementary" aria-label="Timer settings">
  <div class="settings-header">
    <h3>Timer Settings</h3>
    <button class="close-btn" on:click={onClose} aria-label="Close settings">✕</button>
  </div>

  <div class="settings-body">
    <div class="setting-group">
      <label>
        <span class="setting-label">Focus Duration</span>
        <span class="setting-value">{settings.focusMinutes} min</span>
        <input
          type="range" min="5" max="60" step="5"
          bind:value={settings.focusMinutes}
          on:change={handleChange}
          aria-label="Focus duration: {settings.focusMinutes} minutes"
        />
      </label>
    </div>

    <div class="setting-group">
      <label>
        <span class="setting-label">Short Break</span>
        <span class="setting-value">{settings.shortBreakMinutes} min</span>
        <input
          type="range" min="1" max="15" step="1"
          bind:value={settings.shortBreakMinutes}
          on:change={handleChange}
          aria-label="Short break: {settings.shortBreakMinutes} minutes"
        />
      </label>
    </div>

    <div class="setting-group">
      <label>
        <span class="setting-label">Long Break</span>
        <span class="setting-value">{settings.longBreakMinutes} min</span>
        <input
          type="range" min="10" max="30" step="5"
          bind:value={settings.longBreakMinutes}
          on:change={handleChange}
          aria-label="Long break: {settings.longBreakMinutes} minutes"
        />
      </label>
    </div>

    <div class="setting-group">
      <label>
        <span class="setting-label">Sessions Before Long Break</span>
        <span class="setting-value">{settings.sessionsBeforeLongBreak}</span>
        <input
          type="range" min="1" max="8" step="1"
          bind:value={settings.sessionsBeforeLongBreak}
          on:change={handleChange}
          aria-label="Sessions before long break: {settings.sessionsBeforeLongBreak}"
        />
      </label>
    </div>

    <div class="setting-group toggle-group">
      <label class="toggle-label">
        <span class="setting-label">Auto-start Breaks</span>
        <input type="checkbox" bind:checked={settings.autoStartBreaks} on:change={handleChange} />
        <span class="toggle-track" />
      </label>
    </div>

    <div class="setting-group toggle-group">
      <label class="toggle-label">
        <span class="setting-label">Auto-start Focus</span>
        <input type="checkbox" bind:checked={settings.autoStartFocus} on:change={handleChange} />
        <span class="toggle-track" />
      </label>
    </div>
  </div>
</div>

<style>
  .settings-panel {
    position: absolute;
    top: 0;
    right: 0;
    width: 240px;
    height: 100%;
    background-color: var(--bg-secondary, #1e1e2e);
    border-left: 1px solid var(--border-color, rgba(255,255,255,0.08));
    display: flex;
    flex-direction: column;
    z-index: 10;
    animation: slideIn 0.2s ease;
  }

  @keyframes slideIn {
    from { transform: translateX(100%); }
    to   { transform: translateX(0); }
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
  }

  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, rgba(255,255,255,0.9));
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary, rgba(255,255,255,0.5));
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }

  .close-btn:hover {
    color: var(--text-primary, rgba(255,255,255,0.9));
    background: var(--hover-bg, rgba(255,255,255,0.08));
  }

  .settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .setting-group label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    cursor: pointer;
  }

  .setting-label {
    font-size: 12px;
    color: var(--text-secondary, rgba(255,255,255,0.6));
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .setting-value {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, rgba(255,255,255,0.9));
    font-variant-numeric: tabular-nums;
  }

  input[type="range"] {
    width: 100%;
    height: 4px;
    appearance: none;
    background: var(--border-color, rgba(255,255,255,0.15));
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }

  input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--pomodoro-focus, #ef4444);
    cursor: pointer;
    border: none;
  }

  /* Toggle */
  .toggle-group .toggle-label {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .toggle-label input[type="checkbox"] {
    display: none;
  }

  .toggle-track {
    width: 34px;
    height: 18px;
    border-radius: 9px;
    background: var(--border-color, rgba(255,255,255,0.15));
    position: relative;
    flex-shrink: 0;
    transition: background 0.2s;
    cursor: pointer;
  }

  .toggle-track::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: white;
    transition: transform 0.2s;
  }

  input[type="checkbox"]:checked + .toggle-track {
    background: var(--pomodoro-focus, #ef4444);
  }

  input[type="checkbox"]:checked + .toggle-track::after {
    transform: translateX(16px);
  }
</style>
