---
name: desktop-macos
description: macOS GUI automation playbook with Spotlight launch, window binding, dialogs, and Cmd-based shortcuts.
platforms:
  - darwin
---

# Desktop Automation Skill (macOS)

Use this skill for macOS desktop tasks. Interact only through `screen` and `input` tools.

## Standard Flow

1. `screen.list_windows`
2. `screen.bind_window("target")`
3. `screen.screenshot`
4. `input.*` action
5. `input.wait(300-3000)`
6. `screen.screenshot` verify

## App Launch (macOS)

- Open Spotlight: `input.key("cmd+space")`
- Search app: `input.type("AppName")`
- Launch: `input.key("enter")`
- Wait and verify: `input.wait(2000)` + `screen.list_windows`
- Bind target window: `screen.bind_window("AppName")`

## Window Positioning

- Always bind before pointer actions.
- Re-bind with exact app/window substring if multiple similar windows exist.
- If window not responsive, try `cmd+tab` to switch back, then screenshot.

## Browser Workflow (Safari/Chrome)

1. `screen.bind_window("Safari")` or `screen.bind_window("Chrome")`
2. `input.key("cmd+l")` (address bar)
3. `input.key("cmd+a")`
4. `input.type("https://...")`
5. `input.key("enter")`
6. `input.wait(3000)`
7. `screen.screenshot`

## Common macOS Shortcuts

- Copy/Paste/Cut: `cmd+c`, `cmd+v`, `cmd+x`
- Select all: `cmd+a`
- Find/Replace: `cmd+f`, app-dependent replace shortcut
- New tab / close tab: `cmd+t`, `cmd+w`
- Switch app: `cmd+tab`
- Close window: `cmd+w`
- Quit app: `cmd+q`
- Screenshot tool: `cmd+shift+4`

## File Dialog (Open/Save)

- Quick go-to-path: `input.key("cmd+shift+g")`
- Type path: `/Users/...`
- Confirm: `input.key("enter")`
- Select file by click/double-click or type filename + `enter`.

## Reliability Rules

- Click before typing.
- Never click without a recent screenshot anchor.
- If screenshot unchanged: wait longer and retry (`500 -> 1000 -> 2000 -> 5000`).
- Describe every screenshot in text for memory continuity.
