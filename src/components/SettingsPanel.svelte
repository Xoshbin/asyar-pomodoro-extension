<script lang="ts">
  import { getSettings, updateSettings, type TimerSettings } from '../lib/timerEngine';

  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  let settings: TimerSettings = $state(getSettings());

  function handleChange() {
    updateSettings({ ...settings });
  }

  function step(field: keyof TimerSettings, delta: number, min: number, max: number) {
    const current = settings[field] as number;
    (settings as any)[field] = Math.min(max, Math.max(min, current + delta));
    handleChange();
  }
</script>

<div class="settings-panel" role="complementary" aria-label="Timer settings">
  <div class="settings-header">
    <h3>Timer Settings</h3>
    <button class="close-btn" onclick={onClose} aria-label="Close settings">✕</button>
  </div>

  <div class="settings-body">

    <div class="setting-row">
      <span class="setting-label">Focus Duration</span>
      <div class="stepper">
        <button onclick={() => step('focusMinutes', -5, 5, 60)}>−</button>
        <span class="step-value">{settings.focusMinutes} min</span>
        <button onclick={() => step('focusMinutes', +5, 5, 60)}>+</button>
      </div>
    </div>

    <div class="setting-row">
      <span class="setting-label">Short Break</span>
      <div class="stepper">
        <button onclick={() => step('shortBreakMinutes', -1, 1, 15)}>−</button>
        <span class="step-value">{settings.shortBreakMinutes} min</span>
        <button onclick={() => step('shortBreakMinutes', +1, 1, 15)}>+</button>
      </div>
    </div>

    <div class="setting-row">
      <span class="setting-label">Long Break</span>
      <div class="stepper">
        <button onclick={() => step('longBreakMinutes', -5, 10, 30)}>−</button>
        <span class="step-value">{settings.longBreakMinutes} min</span>
        <button onclick={() => step('longBreakMinutes', +5, 10, 30)}>+</button>
      </div>
    </div>

    <div class="setting-row">
      <span class="setting-label">Sessions Before Long Break</span>
      <div class="stepper">
        <button onclick={() => step('sessionsBeforeLongBreak', -1, 1, 8)}>−</button>
        <span class="step-value">{settings.sessionsBeforeLongBreak}</span>
        <button onclick={() => step('sessionsBeforeLongBreak', +1, 1, 8)}>+</button>
      </div>
    </div>

    <div class="setting-row toggle-row">
      <span class="setting-label">Auto-start Breaks</span>
      <label class="toggle">
        <input type="checkbox" bind:checked={settings.autoStartBreaks} onchange={handleChange} />
        <span class="toggle-track"></span>
      </label>
    </div>

    <div class="setting-row toggle-row">
      <span class="setting-label">Auto-start Focus</span>
      <label class="toggle">
        <input type="checkbox" bind:checked={settings.autoStartFocus} onchange={handleChange} />
        <span class="toggle-track"></span>
      </label>
    </div>

  </div>
</div>

<style>
  .settings-panel {
    position: absolute;
    top: 0; right: 0;
    width: 240px; height: 100%;
    background-color: var(--bg-secondary);
    border-left: 1px solid var(--border-color);
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
    border-bottom: 1px solid var(--border-color);
  }

  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }

  .close-btn:hover {
    color: var(--text-primary);
    background: var(--hover-bg);
  }

  .settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid var(--border-color);
  }

  .setting-row:last-child {
    border-bottom: none;
  }

  .setting-label {
    font-size: 12px;
    color: var(--text-secondary);
    flex: 1;
    padding-right: 8px;
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .stepper button {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.1s;
  }

  .stepper button:hover {
    background: var(--hover-bg);
  }

  .stepper button:active {
    background: var(--border-color);
  }

  .step-value {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    min-width: 44px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .toggle-row {
    align-items: center;
  }

  .toggle {
    position: relative;
    flex-shrink: 0;
  }

  .toggle input[type="checkbox"] {
    display: none;
  }

  .toggle-track {
    display: block;
    width: 34px;
    height: 18px;
    border-radius: 9px;
    background: var(--border-color);
    position: relative;
    cursor: pointer;
    transition: background 0.2s;
  }

  .toggle-track::after {
    content: '';
    position: absolute;
    top: 3px; left: 3px;
    width: 12px; height: 12px;
    border-radius: 50%;
    background: white;
    transition: transform 0.2s;
  }

  .toggle input[type="checkbox"]:checked + .toggle-track {
    background: var(--pomodoro-focus);
  }

  .toggle input[type="checkbox"]:checked + .toggle-track::after {
    transform: translateX(16px);
  }
</style>
