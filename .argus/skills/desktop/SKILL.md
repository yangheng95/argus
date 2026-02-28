---
name: desktop
description: Desktop automation skill covering screen observation (screenshot, window listing, window binding) and input actions (click, type, key, scroll, drag). Use for any GUI automation task.
---

# Desktop Automation Skill

Orchestrate the `screen` and `input` tools to automate desktop GUI tasks.

## Tools

| Tool | Actions | Permission | Risk |
|------|---------|------------|------|
| `screen` | `screenshot`, `list_windows`, `bind_window` | `screen` (safe) | Auto-execute at Level 2 |
| `input` | `click`, `type`, `key`, `scroll`, `drag` | `input` (risky) | Needs confirmation at Level 2 |

## Workflow Pattern

Always follow the **Observe → Act → Verify** loop:

```
1. screen.screenshot       — see current state
2. (analyze the screenshot)
3. input.click / type / key — perform the action
4. screen.screenshot       — verify the result
5. repeat as needed
```

## Window Binding

Use `screen.bind_window` to focus on a specific application window:

```
1. screen.list_windows          — find available windows
2. screen.bind_window("Chrome") — bind to Chrome
3. screen.screenshot            — capture only that window
4. input.click(x, y)           — coordinates are now window-relative
```

When bound:
- Screenshots capture only the bound window
- All coordinates (click, drag) are relative to the window's top-left corner
- The coordinate mapping is automatic — just use the coordinates you see in the screenshot

When not bound:
- Screenshots capture the full screen
- All coordinates are screen-absolute

## Coordinate System

- Origin `(0, 0)` is always the **top-left** corner (of screen or bound window)
- X increases rightward, Y increases downward
- After `screen.screenshot`, the output tells you the coordinate mode:
  - `"Coordinates are screen-absolute."` — full screen mode
  - `"Coordinates are relative to the bound window (WxH at X,Y)."` — window mode

## Tips

- **Screenshot before acting**: Never click blindly. Always screenshot first to see what's on screen.
- **Screenshot after acting**: Verify your action had the expected effect.
- **Click before typing**: Position the cursor in the target field with `input.click` before using `input.type`.
- **Use bind_window for precision**: When working with a specific app, binding reduces coordinate errors.
- **Keyboard shortcuts**: Use `input.key("ctrl+s")` for common operations instead of navigating menus.
- **Scroll then screenshot**: After scrolling, take a screenshot to see the new content.
