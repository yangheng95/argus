---
name: desktop
description: Desktop automation skill covering screen observation (screenshot, window listing, window binding) and input actions (click, type, key, scroll, drag, move, wait). Use for any GUI automation task.
---

# Desktop Automation Skill

You are a GUI automation agent. You interact with the computer ONLY through `screen` and `input` tools.

## Tools Overview

| Tool | Action | What it does |
|------|--------|-------------|
| `screen` | `list_windows` | List all open windows (title, app, position, size) |
| `screen` | `bind_window` | Bind to a window by title — makes coordinates relative to it |
| `screen` | `screenshot` | Capture screen/bound window (skips image if unchanged) |
| `input` | `click` | Click at (x,y) — buttons: left, right, double, middle |
| `input` | `type` | Type text via clipboard paste |
| `input` | `key` | Press key or combo: `enter`, `ctrl+c`, `alt+f4`, `win` |
| `input` | `scroll` | Scroll up/down |
| `input` | `drag` | Drag from (startX,startY) to (endX,endY) |
| `input` | `move` | Move mouse to (x,y) without clicking |
| `input` | `wait` | Wait N milliseconds (100-10000) for UI to load |

## CRITICAL RULES

1. **list_windows FIRST** — Before interacting with any app, call `list_windows` to see what's open. Don't guess.
2. **bind_window for precision** — After finding the target window, bind to it. This makes coordinates relative to the window and screenshots show only that window.
3. **Screenshot BEFORE acting** — Never click/type blindly. Always screenshot first.
4. **Screenshot AFTER acting** — Verify the action had the expected effect.
5. **Click BEFORE typing** — Always click on the target input field first to give it focus.
6. **Wait BEFORE screenshot** — If waiting for UI to load (app opening, page loading), use `wait` first, then screenshot. Don't take multiple identical screenshots.
7. **Coordinates are integers** — Always pass x and y as separate integer values: `{"x": 500, "y": 300}`. NEVER pass arrays.

## Standard Workflow

```
Step 1: list_windows              → see what apps are open
Step 2: bind_window("AppName")    → focus on target app
Step 3: screenshot                → see app content
Step 4: click/type/key            → interact
Step 5: wait (if needed)          → let UI respond
Step 6: screenshot                → verify result
Step 7: repeat 4-6 as needed
```

## Opening a Program (Windows)

```
1. input.key("win")         → open Start menu
2. input.wait(500)          → let Start menu animate
3. input.type("AppName")    → type the app name
4. input.wait(500)          → let search results appear
5. input.key("enter")       → launch top result
6. input.wait(2000)         → let the app open
7. screen.list_windows      → verify app appeared in window list
8. screen.bind_window("AppName") → bind to it
9. screen.screenshot        → see the app
```

## Opening a URL in Browser

```
1. (Open browser via Start menu if not already open)
2. screen.list_windows             → find browser window
3. screen.bind_window("Chrome")    → bind to it
4. input.key("ctrl+l")            → focus address bar
5. input.type("https://example.com")
6. input.key("enter")
7. input.wait(3000)               → let page load
8. screen.screenshot              → verify page loaded
```

## Typing in an Application

```
1. screen.bind_window("AppName")  → bind to target
2. screen.screenshot              → see current state
3. input.click(x, y)             → click on input field
4. input.type("your text here")   → type the text
5. input.key("enter")            → submit (if needed)
6. screen.screenshot              → verify
```

## Switching Between Windows

```
Option A: input.key("alt+tab")           → cycle to next window
Option B: screen.list_windows             → find all windows
          screen.bind_window("Target")    → switch to specific window
```

## Keyboard Reference

Modifiers: `ctrl`, `alt`, `shift`, `win`/`super`/`meta`/`cmd`
Combos: `ctrl+c`, `alt+f4`, `ctrl+shift+s`, `win+e`

| Key | Name |
|-----|------|
| Enter | `enter` |
| Escape | `esc` |
| Tab | `tab` |
| Space | `space` |
| Backspace | `backspace` |
| Delete | `delete` |
| Arrows | `up`, `down`, `left`, `right` |
| Function | `f1` through `f24` |
| Home/End | `home`, `end` |
| Page Up/Down | `pageup`, `pagedown` |
| Print Screen | `printscreen` |
| Caps Lock | `capslock` |
| Letters | `a` through `z` |
| Numbers | `0` through `9` |

## Common Shortcuts (Windows)

| Action | Shortcut |
|--------|----------|
| Copy | `ctrl+c` |
| Paste | `ctrl+v` |
| Cut | `ctrl+x` |
| Undo | `ctrl+z` |
| Redo | `ctrl+y` |
| Save | `ctrl+s` |
| Select All | `ctrl+a` |
| Find | `ctrl+f` |
| Close window | `alt+f4` |
| Switch window | `alt+tab` |
| Address bar | `ctrl+l` |
| New tab | `ctrl+t` |
| Close tab | `ctrl+w` |
| Open Explorer | `win+e` |
| Task Manager | `ctrl+shift+esc` |
| Open Start | `win` |
| Open Run | `win+r` |

## Screenshot Dedup

The screen tool automatically detects identical screenshots. If you see "Screen has NOT changed", it means:
- The UI hasn't updated yet → use `input.wait(2000)` then try again
- Nothing happened → your previous action may have failed, try a different approach

## Tips

- **Don't guess coordinates** — always screenshot first and read the positions from the image.
- **Use bind_window** — it reduces coordinate errors and makes screenshots cleaner (only the target window).
- **Use wait() between heavy actions** — opening apps, loading pages, waiting for AI responses all need time.
- **Check list_windows after opening an app** — verify it actually appeared before trying to interact.
- **Use keyboard shortcuts** — they are more reliable than navigating menus with clicks.
- **If stuck** — try `alt+f4` to close unwanted popups, or `esc` to cancel dialogs.
