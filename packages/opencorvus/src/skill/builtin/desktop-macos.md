---
name: desktop-macos
description: macOS GUI automation playbook with Spotlight launch, window binding, dialogs, and Cmd-based shortcuts.
platforms:
  - darwin
---

# Desktop Automation Skill (macOS)

Use this skill for macOS desktop tasks. Interact only through `screen` and `input` tools.

## Standard Flow

1. `screen.screenshot`
2. `screen.list_windows` then `screen.bind_window({window_id})` when app-level precision is needed
3. `input.*` action
4. `input.wait(10)` only when UI is not ready yet
5. `screen.screenshot` verify
6. `screen.list_windows` only if window title is ambiguous or bind failed

## App Launch (macOS)

- Open Spotlight: `input.key("cmd+space")`
- Search app: `input.type("AppName")`
- Launch: `input.key("enter")`
- Verify quickly: `input.wait(10)` + `screen.screenshot`
- Bind target window if needed: `screen.list_windows` -> `screen.bind_window({window_id})` (title fallback: `screen.bind_window("AppName")`)

## Window Positioning

- Always bind before pointer actions.
- Re-bind by `window_id` from `screen.list_windows` if multiple similar windows exist.
- If window not responsive, try `cmd+tab` to switch back, then screenshot.

## Browser Workflow (Safari/Chrome)

1. `screen.list_windows` -> `screen.bind_window({window_id})` (or title fallback: `"Safari"` / `"Chrome"`)
2. `input.key("cmd+l")` (address bar)
3. `input.key("cmd+a")`
4. `input.type("https://...")`
5. `input.key("enter")`
6. `input.wait(10)`
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
