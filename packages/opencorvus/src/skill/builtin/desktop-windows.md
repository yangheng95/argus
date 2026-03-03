---
name: desktop-windows
description: Windows GUI automation playbook with Win-specific launch, window binding, dialogs, and shortcuts.
platforms:
  - win32
---

# Desktop Automation Skill (Windows)

Use this skill for Windows desktop tasks. Interact only through `screen` and `input` tools.

## Standard Flow

1. `screen.screenshot`
2. `screen.list_windows` then `screen.bind_window({window_id})` when app-level precision is needed
3. `input.*` action
4. `input.wait(10)` only when UI is not ready yet
5. `screen.screenshot` verify
6. `screen.list_windows` only if window title is ambiguous or bind failed

## App Launch (Windows)

- Open Start: `input.key("win")`
- Search app: `input.type("AppName")`
- Launch: `input.key("enter")`
- Verify quickly: `input.wait(10)` + `screen.screenshot`
- Bind target window if needed: `screen.list_windows` -> `screen.bind_window({window_id})` (title fallback: `screen.bind_window("AppName")`)

## Window Positioning

- Always bind before pointer actions.
- If wrong window is focused, run `screen.list_windows` and re-bind by `window_id`.
- If minimized, bind + take fresh screenshot before click/type.

## Browser Workflow (Chrome/Edge)

1. `screen.list_windows` -> `screen.bind_window({window_id})` (or title fallback: `"Chrome"` / `"Edge"`)
2. `input.key("ctrl+l")` (address bar)
3. `input.key("ctrl+a")`
4. `input.type("https://...")`
5. `input.key("enter")`
6. `input.wait(10)`
7. `screen.screenshot`

## Common Windows Shortcuts

- Copy/Paste/Cut: `ctrl+c`, `ctrl+v`, `ctrl+x`
- Select all: `ctrl+a`
- Find/Replace: `ctrl+f`, `ctrl+h`
- New tab / close tab: `ctrl+t`, `ctrl+w`
- Switch window: `alt+tab`
- Close app: `alt+f4`
- File explorer: `win+e`
- Run dialog: `win+r`

## File Dialog (Open/Save)

- Focus path bar, type absolute path, press `enter`.
- If unsure current folder: screenshot and read breadcrumb/path field.
- For filename input:
  - `input.type("name.ext")`
  - `input.key("enter")`

## Reliability Rules

- Click before typing.
- Never click without a recent screenshot anchor.
- If screenshot unchanged: wait longer and retry (`500 -> 1000 -> 2000 -> 5000`).
- Describe every screenshot in text for memory continuity.
