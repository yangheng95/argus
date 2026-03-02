---
name: desktop-linux
description: Linux GUI automation playbook with Super launcher, window binding, dialogs, and Ctrl-based shortcuts.
platforms:
  - linux
---

# Desktop Automation Skill (Linux)

Use this skill for Linux desktop tasks. Interact only through `screen` and `input` tools.

## Standard Flow

1. `screen.list_windows`
2. `screen.bind_window("target")`
3. `screen.screenshot`
4. `input.*` action
5. `input.wait(300-3000)`
6. `screen.screenshot` verify

## App Launch (Linux)

- Open launcher: `input.key("super")`
- Search app: `input.type("AppName")`
- Launch: `input.key("enter")`
- Wait and verify: `input.wait(2000)` + `screen.list_windows`
- Bind target window: `screen.bind_window("AppName")`

## Window Positioning

- Always bind before pointer actions.
- Re-bind with more specific title if multiple windows match.
- If compositor delays rendering, use longer waits before screenshot.

## Browser Workflow (Chrome/Firefox)

1. `screen.bind_window("Chrome")` or `screen.bind_window("Firefox")`
2. `input.key("ctrl+l")` (address bar)
3. `input.key("ctrl+a")`
4. `input.type("https://...")`
5. `input.key("enter")`
6. `input.wait(3000)`
7. `screen.screenshot`

## Common Linux Shortcuts

- Copy/Paste/Cut: `ctrl+c`, `ctrl+v`, `ctrl+x`
- Select all: `ctrl+a`
- Find/Replace: `ctrl+f`, `ctrl+h`
- New tab / close tab: `ctrl+t`, `ctrl+w`
- Switch window: `alt+tab`
- Close app/window: `alt+f4`
- Terminal common: `ctrl+shift+t`, `ctrl+shift+w` (depends on terminal)

## File Dialog (GTK/Qt common)

- Location entry in many dialogs: `input.key("ctrl+l")`
- Type absolute path: `/home/user/...`
- Confirm with `enter`
- Select file via click or filename + `enter`

## Reliability Rules

- Click before typing.
- Never click without a recent screenshot anchor.
- If screenshot unchanged: wait longer and retry (`500 -> 1000 -> 2000 -> 5000`).
- Describe every screenshot in text for memory continuity.
