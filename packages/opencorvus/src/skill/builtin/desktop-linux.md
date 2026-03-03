---
name: desktop-linux
description: Linux GUI automation playbook with Super launcher, window binding, dialogs, and Ctrl-based shortcuts.
platforms:
  - linux
---

# Desktop Automation Skill (Linux)

Use this skill for Linux desktop tasks. Interact only through `screen` and `input` tools.

## Standard Flow

1. `screen.screenshot`
2. `screen.list_windows` then `screen.bind_window({window_id})` when app-level precision is needed
3. `input.*` action
4. `input.wait(300-3000)`
5. `screen.screenshot` verify
6. `screen.list_windows` only if window title is ambiguous or bind failed

## App Launch (Linux)

- Open launcher: `input.key("super")`
- Search app: `input.type("AppName")`
- Launch: `input.key("enter")`
- Wait and verify: `input.wait(2000)` + `screen.screenshot`
- Bind target window if needed: `screen.list_windows` -> `screen.bind_window({window_id})` (title fallback: `screen.bind_window("AppName")`)

## Window Positioning

- Always bind before pointer actions.
- Re-bind by `window_id` from `screen.list_windows` if multiple windows match.
- If compositor delays rendering, use longer waits before screenshot.

## Browser Workflow (Chrome/Firefox)

1. `screen.list_windows` -> `screen.bind_window({window_id})` (or title fallback: `"Chrome"` / `"Firefox"`)
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
