# AI Assistant TUI

A terminal-based AI chat interface built with Python's curses library.

## Features

- 🎨 Color-coded messages (User/AI/System)
- 📜 Scrollable message history (Arrow keys, Page Up/Down)
- ⌨️ Simple input interface
- 📊 Status bar with message count and scroll position
- 🔄 Auto-scroll to latest messages

## Requirements

- Python 3.7+
- Windows/Linux/macOS with curses support

## Usage

```bash
python ai_tui.py
```

## Controls

| Key                     | Action           |
| ----------------------- | ---------------- |
| `Enter`                 | Send message     |
| `↑` / `↓`               | Scroll messages  |
| `Page Up` / `Page Down` | Fast scroll      |
| `Ctrl+Q`                | Quit application |
| `Backspace`             | Delete character |

## Customization

To integrate with a real AI API, modify the `generate_response()` method in `ai_tui.py`:

```python
def generate_response(self, user_input: str) -> str:
    # Replace with your AI API call
    import requests
    response = requests.post("https://api.example.com/chat", json={"message": user_input})
    return response.json()["reply"]
```

## Screenshots

The app features:

- Title bar with app name
- Message area with color-coded conversations
- Input bar at bottom
- Status bar with stats

## Troubleshooting

### Windows curses issues

On Windows, you may need to install `windows-curses`:

```bash
pip install windows-curses
```

### Terminal size

Resize your terminal if the UI appears cramped. The app adapts to terminal size changes.
