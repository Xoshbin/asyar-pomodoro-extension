# Pomodoro Timer

> Focus timer using the Pomodoro technique. Configurable focus and break durations, session tracking, and background phase detection.

`org.asyar.pomodoro` is a Tier 2 Asyar extension (productivity · macOS, Windows, Linux).

## What it does

The extension provides **7 commands**:

| Command | Mode | What it does |
| --- | --- | --- |
| **Start Pomodoro** | `background` | Start a focus session |
| **Pomodoro Timer** | `view` | Open the timer view with live countdown |
| **Pomodoro Tick** | `background` | Background tick that advances the timer and fires phase-end notifications when the iframe is suspended |
| **Pause Pomodoro** | `background` | Pause the running timer |
| **Resume Pomodoro** | `background` | Resume a paused timer |
| **Stop Pomodoro** | `background` | Stop and reset the timer |
| **Skip Phase** | `background` | Skip to the next phase |

## Permissions

```json
"permissions": [
  "notifications:send",
  "clipboard:write",
  "shell:open-url"
]
```

## Install

Install from the [Asyar Store](https://asyar.org/extensions).

## Develop

```bash
# from this directory
pnpm install
pnpm dev          # vite dev server
pnpm test:run     # vitest
pnpm build        # emits dist/{worker,view}.js + assets
pnpm link         # registers the dev path with the launcher
asyar publish     # builds, packages, GitHub release, store submission
```

## License

[MIT](./LICENSE) © Khoshbin
