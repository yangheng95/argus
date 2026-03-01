---
name: desktop
description: Desktop automation skill covering screen observation (screenshot, window listing, window binding) and input actions (click, type, key, scroll, drag, move, wait). Use for any GUI automation task.
---

# Desktop Automation Skill

You are a GUI automation agent. You interact with the computer ONLY through `screen` and `input` tools.

## Tools Quick Reference

| Tool | Action | Parameters | What it does |
|------|--------|-----------|-------------|
| `screen` | `list_windows` | — | List all open windows (title, app, position, size) |
| `screen` | `bind_window` | `title` | Bind to a window by title — makes coordinates relative to it |
| `screen` | `screenshot` | — | Capture screen/bound window (skips if unchanged) |
| `input` | `click` | `x, y, button?` | Click at (x,y). button: left/right/double/middle |
| `input` | `type` | `text` | Type text via clipboard paste |
| `input` | `key` | `key` | Press key or combo: `enter`, `ctrl+c`, `alt+f4` |
| `input` | `scroll` | `direction, amount?` | Scroll up/down (default 3 steps) |
| `input` | `drag` | `startX, startY, endX, endY` | Drag between two points |
| `input` | `move` | `x, y` | Move mouse without clicking (for hover) |
| `input` | `wait` | `ms` | Wait 100-10000ms for UI to settle |

## Golden Rules

1. **list_windows FIRST** — Before interacting with any app, check what's open. Don't guess.
2. **bind_window for precision** — Binding makes coordinates window-relative and screenshots cleaner.
3. **Screenshot BEFORE acting** — Never click/type blindly. Know what's on screen.
4. **Screenshot AFTER acting** — Verify every action had the expected effect.
5. **Click BEFORE typing** — Always click the target field to give it focus.
6. **Wait BEFORE screenshot** — If expecting UI changes, `wait` first, then screenshot.
7. **Coordinates are integers** — `{"x": 500, "y": 300}`. NEVER use arrays.
8. **Describe every screenshot** — Screenshots are removed from context after the current turn. Your text description is the only surviving record.

## Platform Detection

The screenshot output includes platform info (e.g. "Platform: Windows"). Use it to determine shortcuts:

| Platform | Modifier | App launcher | Examples |
|----------|----------|-------------|---------|
| Windows | `ctrl` | `win` key → type name | `ctrl+c`, `win+e`, `alt+f4` |
| macOS | `cmd` | `cmd+space` (Spotlight) | `cmd+c`, `cmd+space`, `cmd+w` |
| Linux | `ctrl` | `super` key → type name | `ctrl+c`, `super`, `alt+f4` |

---

# Scenario Playbooks

## 1. Opening Programs

### Windows
```
input.key("win") → wait(500) → input.type("AppName") → wait(500) → input.key("enter") → wait(2000) → screen.list_windows → screen.bind_window("AppName")
```

### macOS
```
input.key("cmd+space") → wait(500) → input.type("AppName") → wait(500) → input.key("enter") → wait(2000) → screen.list_windows → screen.bind_window("AppName")
```

### Linux
```
input.key("super") → wait(500) → input.type("AppName") → wait(500) → input.key("enter") → wait(2000) → screen.list_windows → screen.bind_window("AppName")
```

**Verification:** Always `list_windows` after launching — if the app doesn't appear, wait longer or try again.

## 2. Opening a URL in Browser

```
1. Open browser (if not already open, launch it via platform launcher)
2. screen.bind_window("Chrome")      ← or "Firefox", "Edge", "Safari"
3. input.key("ctrl+l")               ← macOS: "cmd+l" — focus address bar
4. input.key("ctrl+a")               ← select all existing URL text
5. input.type("https://example.com")
6. input.key("enter")
7. input.wait(3000)                   ← let page load
8. screen.screenshot                  ← verify page loaded
```

## 3. Text Selection & Clipboard

### Select all text in a field
```
input.click(x, y)        ← click the field
input.key("ctrl+a")      ← macOS: "cmd+a"
```

### Select specific text
```
# Method A: Double-click to select a word
input.click(x, y) with button="double"

# Method B: Click + Shift+Click for range selection
input.click(startX, startY)           ← click at start
input.key("shift") (hold) — NOT available directly
→ Instead: input.click(startX, startY), then input.key("shift+end") to select to end of line
→ Or: input.key("shift+ctrl+right") to select word by word

# Method C: Keyboard-driven selection
input.key("home")                     ← go to line start
input.key("shift+end")               ← select entire line
input.key("ctrl+shift+right")        ← select next word (macOS: "alt+shift+right")
```

### Copy text from screen
```
1. Select the text (see above)
2. input.key("ctrl+c")               ← macOS: "cmd+c"
3. The text is now on clipboard — mention what you selected in your response
```

### Cut and paste
```
input.key("ctrl+x")  → move to target → input.click(x,y) → input.key("ctrl+v")
```

## 4. Find & Replace within Apps

### Open Find dialog
```
input.key("ctrl+f")                  ← macOS: "cmd+f" — opens Find bar
input.type("search term")
input.key("enter")                   ← go to next match
input.key("shift+enter")             ← go to previous match (some apps)
input.key("esc")                     ← close Find bar
```

### Find and Replace
```
input.key("ctrl+h")                  ← macOS: "cmd+alt+f" or "cmd+shift+h" (varies by app)
input.type("find text")
input.key("tab")                     ← move to replace field
input.type("replace text")
input.key("enter")                   ← replace next
```

**Tip:** In VS Code: `ctrl+h` opens replace. `ctrl+shift+h` opens replace across files.

## 5. Form Interaction

### Tab between form fields
```
input.key("tab")          ← next field
input.key("shift+tab")    ← previous field
```

### Checkboxes and radio buttons
```
input.click(x, y)         ← click the checkbox/radio
# OR if focused:
input.key("space")        ← toggle checkbox
```

### Dropdown / Select box
```
# Method A: Click to open, click to select
input.click(x, y)         ← click dropdown to open it
input.wait(300)            ← let menu appear
screen.screenshot          ← see options
input.click(optX, optY)   ← click desired option

# Method B: Keyboard navigation
input.click(x, y)         ← focus the dropdown
input.key("down")         ← move through options
input.key("down")         ← keep navigating
input.key("enter")        ← confirm selection

# Method C: Type to search (in searchable dropdowns)
input.click(x, y)         ← open dropdown
input.type("option text") ← type to filter
input.key("enter")        ← select filtered result
```

### Buttons
```
input.click(x, y)         ← click button
# OR if focused:
input.key("enter")        ← activate focused button
input.key("space")        ← also activates buttons
```

## 6. File Dialogs (Open / Save)

File dialogs are extremely common and vary significantly across platforms.

### Windows File Dialog
```
# Navigate to a path:
1. In the file dialog, click the path bar (usually at top)
2. input.type("C:\\Users\\user\\Documents")  ← type full path
3. input.key("enter")                        ← navigate to folder
4. input.wait(500)
5. screen.screenshot                         ← see files in folder

# Select a file:
6. Double-click the file, OR:
   input.type("filename.txt")               ← type in filename field
   input.key("enter")                        ← open/save
```

### macOS File Dialog
```
# Show path bar:
1. input.key("cmd+shift+g")                 ← "Go to folder" dialog
2. input.type("/Users/user/Documents")
3. input.key("enter")

# Or use Finder column view:
1. Navigate by clicking folders in columns
2. Double-click file or click "Open"
```

### Linux (GTK/Qt)
```
# Navigate via path:
1. input.key("ctrl+l")                      ← show path entry (GTK)
2. input.type("/home/user/Documents")
3. input.key("enter")
```

### Common tips for file dialogs
- **Type the filename** in the "File name" field at the bottom — faster than navigating
- **Use path bar** to jump to any directory by typing the full path
- **Ctrl+L** usually reveals a path entry bar
- **Desktop shortcut:** Most dialogs have a "Desktop" link in the sidebar

## 7. Right-Click Context Menus

```
1. input.click(x, y) with button="right"    ← right-click
2. input.wait(300)                           ← let menu appear
3. screen.screenshot                         ← see menu items
4. input.click(menuX, menuY)                 ← click desired item

# To dismiss without selecting:
input.key("esc")

# Keyboard navigation in context menu:
input.key("down") / input.key("up")          ← navigate items
input.key("enter")                           ← select item
input.key("right")                           ← open submenu
input.key("left")                            ← close submenu
```

## 8. Scrolling Strategies

### Basic scroll
```
input.scroll(direction="down", amount=3)     ← scroll down 3 steps
input.scroll(direction="up", amount=5)       ← scroll up 5 steps
```

### Scroll to find content
```
# Pattern: scroll + screenshot loop
1. screen.screenshot                         ← check current view
2. (content not found)
3. input.scroll("down", 5)                   ← scroll more
4. input.wait(300)
5. screen.screenshot                         ← check again
6. Repeat until content found or page end reached
```

### Jump to top / bottom
```
input.key("ctrl+home")                       ← jump to top (macOS: "cmd+up")
input.key("ctrl+end")                        ← jump to bottom (macOS: "cmd+down")
input.key("home")                            ← start of line
input.key("end")                             ← end of line
```

### Page navigation
```
input.key("pageup")                          ← scroll up one page
input.key("pagedown")                        ← scroll down one page
input.key("space")                           ← page down (in browsers and readers)
input.key("shift+space")                     ← page up (in browsers)
```

### Scroll to specific element
If you need to reach an element you know exists but can't see:
1. Try `ctrl+f` to search for nearby text
2. Or use `ctrl+end` / `ctrl+home` to get to known positions
3. Then scroll incrementally from there

## 9. Multi-Window Workflows

### Copy between apps
```
1. screen.bind_window("SourceApp")
2. screen.screenshot                         ← see source content
3. Select and copy text: input.key("ctrl+a"), input.key("ctrl+c")
4. screen.bind_window("TargetApp")
5. screen.screenshot                         ← see target
6. input.click(x, y)                         ← click target field
7. input.key("ctrl+v")                       ← paste
```

### Side-by-side comparison
```
# Windows: Win+Left / Win+Right for split
input.key("win+left")                        ← snap window to left half
# Switch to other window
input.key("alt+tab")
input.key("win+right")                       ← snap to right half
```

### Alt-Tab cycling
```
input.key("alt+tab")                         ← macOS: "cmd+tab"
# To go to a specific window:
screen.list_windows → screen.bind_window("target")
```

## 10. Window Management (Keyboard)

| Action | Windows | macOS | Linux (GNOME) |
|--------|---------|-------|---------------|
| Minimize | `win+down` | `cmd+m` | `super+h` |
| Maximize | `win+up` | `ctrl+cmd+f` (fullscreen) | `super+up` |
| Close | `alt+f4` | `cmd+w` (tab) / `cmd+q` (app) | `alt+f4` |
| Snap left | `win+left` | — (use Rectangle app) | `super+left` |
| Snap right | `win+right` | — | `super+right` |
| Switch desktop | `ctrl+win+left/right` | `ctrl+left/right` | `super+pageup/pagedown` |
| Show desktop | `win+d` | `f11` or `cmd+f3` | `super+d` |
| Task view | `win+tab` | `ctrl+up` (Mission Control) | `super` |
| Lock screen | `win+l` | `ctrl+cmd+q` | `super+l` |

## 11. Browser Tab Management

| Action | Windows/Linux | macOS |
|--------|--------------|-------|
| New tab | `ctrl+t` | `cmd+t` |
| Close tab | `ctrl+w` | `cmd+w` |
| Reopen closed tab | `ctrl+shift+t` | `cmd+shift+t` |
| Next tab | `ctrl+tab` | `ctrl+tab` or `cmd+alt+right` |
| Previous tab | `ctrl+shift+tab` | `ctrl+shift+tab` or `cmd+alt+left` |
| Go to tab N | `ctrl+1` to `ctrl+8` | `cmd+1` to `cmd+8` |
| Last tab | `ctrl+9` | `cmd+9` |
| Address bar | `ctrl+l` or `f6` | `cmd+l` |
| Refresh | `ctrl+r` or `f5` | `cmd+r` |
| Hard refresh | `ctrl+shift+r` | `cmd+shift+r` |
| Back | `alt+left` | `cmd+[` |
| Forward | `alt+right` | `cmd+]` |
| Zoom in | `ctrl+=` | `cmd+=` |
| Zoom out | `ctrl+-` | `cmd+-` |
| Reset zoom | `ctrl+0` | `cmd+0` |
| Downloads | `ctrl+j` | `cmd+alt+l` (Chrome) |
| Dev Tools | `f12` or `ctrl+shift+i` | `cmd+alt+i` |
| Bookmark | `ctrl+d` | `cmd+d` |

## 12. File Manager Operations

### Windows (Explorer)
```
input.key("win+e")                           ← open File Explorer
input.wait(1500)
screen.bind_window("Explorer")

# Navigate to path:
input.key("ctrl+l")                          ← focus address bar
input.type("C:\\path\\to\\folder")
input.key("enter")

# Create new folder:
input.key("ctrl+shift+n")

# Rename:
input.key("f2")                              ← rename selected item
input.type("new name")
input.key("enter")

# Delete:
input.key("delete")                          ← move to recycle bin
# Or: input.key("shift+delete")             ← permanent delete (careful!)

# Select multiple files:
input.click(x1, y1)                          ← click first file
input.key("ctrl") (hold) — use shift+click for range:
input.click(firstX, firstY) → input.key("shift") — NOT directly available
→ Use: input.click(firstX, firstY), then input.key("ctrl+a") for select all
→ Or: input.key("ctrl+shift+end") to select from current to last
```

### macOS (Finder)
```
# Open Finder: click Finder in Dock, or cmd+space → type "Finder"
# Go to path: input.key("cmd+shift+g") → type path → enter
# New folder: input.key("cmd+shift+n")
# Rename: input.key("enter") on selected file → type new name → input.key("enter")
# Delete: input.key("cmd+delete")
# Get Info: input.key("cmd+i")
```

### Linux (Nautilus/Files)
```
# Open: input.key("super") → type "Files" → enter
# Go to path: input.key("ctrl+l") → type path → enter
# New folder: input.key("ctrl+shift+n")
# Rename: input.key("f2")
# Delete: input.key("delete")
```

## 13. Hover & Tooltips

```
1. input.move(x, y)                          ← move mouse to element (don't click!)
2. input.wait(800)                           ← wait for tooltip to appear
3. screen.screenshot                         ← capture the tooltip
4. Describe the tooltip content in your response
```

**Common hover targets:** toolbar icons, status bar items, abbreviations, chart data points.

## 14. Drag & Drop Patterns

### Drag a file
```
1. screen.screenshot                         ← locate source file
2. input.drag(fileX, fileY, targetX, targetY) ← drag file to destination
3. input.wait(500)
4. screen.screenshot                         ← verify
```

### Rearrange UI elements (tabs, panels)
```
input.drag(tabX, tabY, newPosX, newPosY)     ← drag tab to new position
```

### Resize a panel/divider
```
input.drag(dividerX, dividerY, newX, newY)   ← drag splitter/divider
```

### Selecting text by drag
```
input.drag(startX, startY, endX, endY)       ← drag to select text range
input.key("ctrl+c")                          ← copy selected text
```

## 15. Dialog & Popup Handling

### Confirmation dialogs
```
# Screenshot to read the dialog
screen.screenshot
# Click the appropriate button (OK, Cancel, Yes, No)
input.click(buttonX, buttonY)

# Common keyboard shortcuts:
input.key("enter")                           ← confirms default button
input.key("esc")                             ← cancels / closes dialog
input.key("tab")                             ← switch between buttons
input.key("alt+y")                           ← Yes (some Windows dialogs)
input.key("alt+n")                           ← No (some Windows dialogs)
```

### Cookie / consent banners (web)
```
1. screen.screenshot                         ← see the banner
2. Look for "Accept", "Reject", "Close", "X" button
3. input.click(x, y)                         ← click it
4. input.wait(500)
5. screen.screenshot                         ← verify it's gone
```

### Unexpected popups blocking interaction
```
# Strategy: dismiss first, then continue
1. screen.screenshot                         ← identify the popup
2. Try: input.key("esc")                     ← most popups close with Esc
3. screen.screenshot                         ← verify dismissed
4. If still there: look for X/Close button and click it
5. If modal dialog: must interact with it (click OK/Cancel) before continuing
```

### UAC / elevation prompts (Windows)
```
# UAC dialogs require clicking Yes/No — keyboard alt+y may work
input.key("alt+y")                           ← click "Yes" on UAC prompt
```

## 16. Web Login Flow

```
1. Navigate to login page (see "Opening a URL" above)
2. screen.screenshot                         ← see login form
3. input.click(usernameX, usernameY)         ← click username field
4. input.type("username")
5. input.key("tab")                          ← move to password field
6. input.type("password")
7. input.key("enter")                        ← submit
   # OR: input.click(loginBtnX, loginBtnY)   ← click login button
8. input.wait(3000)                          ← wait for redirect
9. screen.screenshot                         ← verify logged in
```

**Tips:**
- If "Show password" toggle exists, use it to verify before submitting
- Handle 2FA: screenshot to see the 2FA prompt, inform user if manual input needed
- Cookie banners may appear before login — dismiss them first

## 17. Text Editor / IDE Patterns

### VS Code / Editor shortcuts
| Action | Windows/Linux | macOS |
|--------|--------------|-------|
| Open file | `ctrl+o` | `cmd+o` |
| Quick open | `ctrl+p` | `cmd+p` |
| Command palette | `ctrl+shift+p` | `cmd+shift+p` |
| Save | `ctrl+s` | `cmd+s` |
| Save all | `ctrl+k s` (chord) | `cmd+alt+s` |
| Close file | `ctrl+w` | `cmd+w` |
| Undo | `ctrl+z` | `cmd+z` |
| Redo | `ctrl+y` or `ctrl+shift+z` | `cmd+shift+z` |
| Go to line | `ctrl+g` | `ctrl+g` |
| Toggle terminal | `` ctrl+` `` | `` ctrl+` `` |
| Split editor | `ctrl+\` | `cmd+\` |
| Toggle sidebar | `ctrl+b` | `cmd+b` |

### Multi-cursor editing (VS Code)
```
input.key("ctrl+d")                          ← select next occurrence
input.key("ctrl+shift+l")                    ← select all occurrences
# Then type to replace all at once
```

## 18. Terminal Operations (via GUI)

### Open terminal
```
# Windows:
input.key("win") → type "Terminal" or "cmd" or "PowerShell" → enter

# macOS:
input.key("cmd+space") → type "Terminal" → enter

# Linux:
input.key("ctrl+alt+t")                     ← direct shortcut on most distros

# In VS Code:
input.key("ctrl+`")                          ← toggle integrated terminal
```

### Terminal text interaction
```
# Type command:
input.type("ls -la")
input.key("enter")

# Clear terminal:
input.key("ctrl+l")                          ← or type "clear"

# Cancel running command:
input.key("ctrl+c")

# Scroll terminal output:
input.key("shift+pageup")                   ← scroll up
input.key("shift+pagedown")                 ← scroll down

# Copy from terminal:
# Select text first (drag or Shift+arrows), then:
input.key("ctrl+shift+c")                   ← terminal copy (Linux)
input.key("ctrl+c")                          ← Windows Terminal / macOS
```

## 19. Installation Wizard Pattern

```
# General pattern for "Next → Next → Install" wizards:
1. screen.screenshot                         ← read current step
2. Look for "Next", "Continue", "Install", "Agree" button
3. If checkbox needed (e.g. "I agree"): input.click(checkboxX, checkboxY)
4. input.click(nextBtnX, nextBtnY)           ← click Next/Install
5. input.wait(1000)                          ← wait for next step
6. screen.screenshot                         ← verify and repeat

# If a license agreement page:
input.scroll("down", 10)                     ← scroll to bottom (some require this)
input.click(agreeCheckboxX, agreeCheckboxY)  ← check "I agree"
input.click(nextBtnX, nextBtnY)

# Progress bar: wait until finished
input.wait(5000)
screen.screenshot                            ← check if still installing
# Repeat wait+screenshot until "Finish" button appears
```

---

# Strategy & Methodology

## Exploring Unknown Applications

When you encounter an unfamiliar application:

```
1. screen.screenshot                         ← get full view
2. Describe the UI: menu bar, toolbar, sidebar, main area, status bar
3. Read all visible text: menus, labels, buttons, tabs
4. Identify interactive elements: buttons, fields, links, tabs
5. Try the menu bar first — it reveals all available actions
6. Right-click key areas — context menus show available operations
7. Look for keyboard shortcuts listed next to menu items
```

**Menu exploration pattern:**
```
input.click(menuX, menuY)                    ← click "File" or first menu
input.wait(300)
screen.screenshot                            ← read all menu items and their shortcuts
input.key("esc")                             ← close menu
# Repeat for each menu: Edit, View, Tools, Help, etc.
```

## Adaptive Waiting

Don't use fixed wait times blindly. Adjust based on the action:

| Action | Suggested wait |
|--------|---------------|
| Key press / click | 200-500ms |
| Menu open | 300-500ms |
| Tab switch | 300-500ms |
| App launch | 2000-5000ms |
| Page load (web) | 2000-5000ms |
| File dialog open | 500-1000ms |
| Heavy operation (install, build) | 5000-10000ms |
| Tooltip appear | 500-1000ms |

**If screenshot shows "unchanged":** Wait longer and retry. Double the wait time on each retry (500 → 1000 → 2000).

## Retry & Recovery Strategy

When an action doesn't produce the expected result:

```
Attempt 1: Try the action as planned
    ↓ (screenshot shows unexpected state)
Attempt 2: Wait longer, retry same action
    ↓ (still wrong)
Attempt 3: Try alternative approach
    - Different click target
    - Keyboard shortcut instead of click
    - Different path to reach the same goal
    ↓ (still wrong)
Attempt 4: Reset state
    - Press Esc to dismiss popups
    - Press Alt+F4 to close stuck windows
    - Go back to list_windows and start over
```

**Common failure modes:**
- **Click missed the target** → Screenshot, re-read coordinates, try again
- **Popup blocking interaction** → Dismiss with Esc or click X
- **App not responding** → Wait longer (5000ms), or try alt+tab away and back
- **Wrong window focused** → Re-bind to target window
- **Keyboard shortcut didn't work** → App might need focus first — click on it, then retry

## Reading Screen Content

You CANNOT do OCR, but you can read text visible in screenshots:

1. **Always describe what you see** after each screenshot — this becomes your memory
2. **Use large text areas** — zoom in if text is too small (ctrl+= to zoom)
3. **For precise text extraction**, select + copy is more reliable than trying to read pixels:
   ```
   input.key("ctrl+a")    ← select all
   input.key("ctrl+c")    ← copy to clipboard
   ```
4. **If text is too small**, zoom the application:
   ```
   input.key("ctrl+=")    ← zoom in (macOS: "cmd+=")
   screen.screenshot      ← read enlarged text
   input.key("ctrl+0")    ← reset zoom when done
   ```

---

# Complete Keyboard Reference

## Modifiers

| Key | Aliases |
|-----|---------|
| Control | `ctrl`, `control`, `LeftControl`, `rctrl` (right) |
| Alt | `alt`, `option`, `LeftAlt`, `ralt` (right) |
| Shift | `shift`, `LeftShift`, `rshift` (right) |
| Windows/Super | `win`, `super`, `meta`, `cmd`, `command` |

**Combinations:** use `+` separator — `ctrl+c`, `alt+f4`, `ctrl+shift+s`, `win+e`

## Common Keys

| Category | Keys |
|----------|------|
| Standard | `enter`, `esc`, `tab`, `space`, `backspace`, `delete`, `insert` |
| Arrows | `up`, `down`, `left`, `right` |
| Navigation | `home`, `end`, `pageup`, `pagedown` |
| Function | `f1` through `f24` |
| Letters | `a` through `z` (case-insensitive) |
| Numbers | `0` through `9` |
| Numpad | `numpad0`–`numpad9`, `decimal`, `add`, `subtract`, `multiply`, `divide` |
| System | `printscreen`, `pause`, `capslock`, `numlock`, `scrolllock` |
| Media | `mute`, `volumeup`, `volumedown`, `mediaplay`, `mediastop`, `mediaprev`, `medianext` |
| Symbols | `` ` ``, `-`, `=`, `[`, `]`, `\`, `;`, `'`, `,`, `.`, `/` |

---

# Cross-Platform Shortcut Quick Reference

## Universal Actions

| Action | Windows/Linux | macOS |
|--------|--------------|-------|
| Copy | `ctrl+c` | `cmd+c` |
| Paste | `ctrl+v` | `cmd+v` |
| Cut | `ctrl+x` | `cmd+x` |
| Undo | `ctrl+z` | `cmd+z` |
| Redo | `ctrl+y` | `cmd+shift+z` |
| Save | `ctrl+s` | `cmd+s` |
| Select All | `ctrl+a` | `cmd+a` |
| Find | `ctrl+f` | `cmd+f` |
| Find & Replace | `ctrl+h` | `cmd+alt+f` |
| Print | `ctrl+p` | `cmd+p` |
| New | `ctrl+n` | `cmd+n` |
| Open | `ctrl+o` | `cmd+o` |
| Close tab/window | `ctrl+w` | `cmd+w` |
| Quit app | `alt+f4` | `cmd+q` |
| Switch app | `alt+tab` | `cmd+tab` |
| Switch tab | `ctrl+tab` | `ctrl+tab` |
| Address bar | `ctrl+l` | `cmd+l` |
| New tab | `ctrl+t` | `cmd+t` |
| Reopen tab | `ctrl+shift+t` | `cmd+shift+t` |
| Zoom in | `ctrl+=` | `cmd+=` |
| Zoom out | `ctrl+-` | `cmd+-` |
| Reset zoom | `ctrl+0` | `cmd+0` |
| Refresh | `ctrl+r` / `f5` | `cmd+r` |
| App launcher | `win` | `cmd+space` |
| File manager | `win+e` | (Spotlight → Finder) |
| Task manager | `ctrl+shift+esc` | (Spotlight → Activity Monitor) |
| Lock screen | `win+l` | `ctrl+cmd+q` |
| Screenshot (system) | `win+shift+s` | `cmd+shift+4` |
| Emoji picker | `win+.` | `ctrl+cmd+space` |

---

# Tips & Best Practices

- **Keyboard shortcuts > mouse clicks** — Shortcuts are faster and more reliable than navigating menus.
- **Don't guess coordinates** — Always screenshot first and read positions from the image.
- **Use bind_window** — It reduces coordinate errors and makes screenshots cleaner.
- **Check list_windows after opening an app** — Verify the app actually appeared.
- **If stuck, reset** — `esc` to close dialogs, `alt+f4` to close windows, `list_windows` to reassess.
- **Platform matters** — Always check platform info in screenshot output and use the correct modifier.
- **Describe everything you see** — Your text description is the ONLY thing that persists between turns.
- **One action at a time** — Verify each step before proceeding to the next.
- **If "Screen has NOT changed"** — Wait longer, then retry. The UI hasn't updated yet.
- **Use wait() generously** — It's better to wait too long than to screenshot too early and waste a turn.

## Screenshot Dedup

The screen tool detects identical screenshots. When you see "Screen has NOT changed":
- The UI hasn't updated yet → use `input.wait(2000)` then screenshot again
- Your previous action may have failed → try a different approach
- Double the wait time on each retry: 500 → 1000 → 2000 → 5000
