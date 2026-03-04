#!/usr/bin/env python3
"""
Enhanced AI Assistant TUI - Advanced terminal-based AI chat interface with curses
Features: Chat history persistence, typing animation, themes, command system
"""

import curses
import json
import os
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import List, Optional
from enum import Enum
import threading
import time


class MessageType(Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    ERROR = "error"


@dataclass
class Message:
    role: str
    content: str
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    
    @classmethod
    def from_dict(cls, data: dict):
        return cls(**data)


class Theme(Enum):
    DEFAULT = "default"
    DARK = "dark"
    LIGHT = "light"
    MONOKAI = "monokai"


THEMES = {
    Theme.DEFAULT: {
        "user": (curses.COLOR_GREEN, -1),
        "assistant": (curses.COLOR_CYAN, -1),
        "system": (curses.COLOR_YELLOW, -1),
        "error": (curses.COLOR_RED, -1),
        "input": (curses.COLOR_BLACK, curses.COLOR_WHITE),
        "status": (curses.COLOR_WHITE, curses.COLOR_BLUE),
        "title": (curses.COLOR_WHITE, curses.COLOR_BLUE),
    },
    Theme.DARK: {
        "user": (curses.COLOR_GREEN, -1),
        "assistant": (curses.COLOR_CYAN, -1),
        "system": (curses.COLOR_YELLOW, -1),
        "error": (curses.COLOR_RED, -1),
        "input": (curses.COLOR_WHITE, curses.COLOR_BLACK),
        "status": (curses.COLOR_BLACK, curses.COLOR_GREEN),
        "title": (curses.COLOR_BLACK, curses.COLOR_GREEN),
    },
    Theme.LIGHT: {
        "user": (curses.COLOR_BLUE, -1),
        "assistant": (curses.COLOR_MAGENTA, -1),
        "system": (curses.COLOR_BLACK, -1),
        "error": (curses.COLOR_RED, -1),
        "input": (curses.COLOR_BLACK, curses.COLOR_WHITE),
        "status": (curses.COLOR_WHITE, curses.COLOR_BLUE),
        "title": (curses.COLOR_WHITE, curses.COLOR_BLUE),
    },
    Theme.MONOKAI: {
        "user": (curses.COLOR_GREEN, -1),
        "assistant": (curses.COLOR_YELLOW, -1),
        "system": (curses.COLOR_CYAN, -1),
        "error": (curses.COLOR_RED, -1),
        "input": (curses.COLOR_WHITE, curses.COLOR_BLACK),
        "status": (curses.COLOR_BLACK, curses.COLOR_WHITE),
        "title": (curses.COLOR_BLACK, curses.COLOR_WHITE),
    },
}


class AIAssistantTUI:
    def __init__(self, stdscr, history_file: str = "chat_history.json"):
        self.stdscr = stdscr
        self.messages: List[Message] = []
        self.input_buffer = ""
        self.scroll_offset = 0
        self.running = True
        self.status = "Ready"
        self.theme = Theme.DEFAULT
        self.history_file = history_file
        self.is_typing = False
        self.typing_text = ""
        self.typing_start_time = 0
        
        # Initialize colors
        curses.start_color()
        curses.use_default_colors()
        self.init_colors()
        
        # Configure curses
        curses.curs_set(1)
        self.stdscr.timeout(50)
        curses.noecho()
        self.stdscr.keypad(True)
        
        # Load chat history
        self.load_history()
        
        # Add welcome message if no history
        if not self.messages:
            self.add_message(MessageType.SYSTEM, "Welcome to AI Assistant TUI! Type /help for commands. Ctrl+Q to quit.")
    
    def init_colors(self):
        theme_colors = THEMES[self.theme]
        for i, (name, (fg, bg)) in enumerate(theme_colors.items(), 1):
            curses.init_pair(i, fg, bg)
        self.color_map = {
            "user": curses.color_pair(1),
            "assistant": curses.color_pair(2),
            "system": curses.color_pair(3),
            "error": curses.color_pair(4),
            "input": curses.color_pair(5),
            "status": curses.color_pair(6),
            "title": curses.color_pair(7),
        }
    
    def switch_theme(self):
        themes = list(Theme)
        current_idx = themes.index(self.theme)
        self.theme = themes[(current_idx + 1) % len(themes)]
        self.init_colors()
        self.add_message(MessageType.SYSTEM, f"Theme switched to: {self.theme.value}")
    
    def load_history(self):
        if os.path.exists(self.history_file):
            try:
                with open(self.history_file, "r") as f:
                    data = json.load(f)
                    self.messages = [Message.from_dict(m) for m in data.get("messages", [])]
            except Exception:
                pass
    
    def save_history(self):
        try:
            with open(self.history_file, "w") as f:
                json.dump({"messages": [asdict(m) for m in self.messages]}, f, indent=2)
        except Exception:
            pass
    
    def add_message(self, role: MessageType, content: str):
        self.messages.append(Message(role.value, content))
        self.scroll_to_bottom()
        self.save_history()
    
    def scroll_to_bottom(self):
        self.scroll_offset = max(0, len(self.messages) - self.get_message_area_height())
    
    def get_message_area_height(self) -> int:
        height, _ = self.stdscr.getmaxyx()
        return height - 3
    
    def get_message_area_width(self) -> int:
        _, width = self.stdscr.getmaxyx()
        return width - 4
    
    def draw(self):
        self.stdscr.clear()
        height, width = self.stdscr.getmaxyx()
        
        self.draw_title()
        self.draw_messages()
        self.draw_input_bar(height - 2, width)
        self.draw_status_bar(height - 1, width)
        
        self.stdscr.refresh()
    
    def draw_title(self):
        title = " 🤖 AI Assistant TUI "
        height, width = self.stdscr.getmaxyx()
        self.stdscr.attron(self.color_map["title"] | curses.A_BOLD)
        self.stdscr.addstr(0, (width - len(title)) // 2, title)
        self.stdscr.attroff(self.color_map["title"] | curses.A_BOLD)
    
    def draw_messages(self):
        height, _ = self.stdscr.getmaxyx()
        start_y = 2
        max_width = self.get_message_area_width()
        visible_messages = self.get_message_area_height()
        
        for i, msg in enumerate(self.messages[self.scroll_offset:self.scroll_offset + visible_messages]):
            y = start_y + i
            if y >= height - 2:
                break
            
            prefix = {"user": "You", "assistant": "AI", "system": "System", "error": "Error"}.get(msg.role, msg.role)
            color = self.color_map.get(msg.role, curses.A_NORMAL)
            
            wrapped_lines = self.wrap_text(f"[{prefix}]: {msg.content}", max_width)
            
            self.stdscr.attron(color)
            for j, line in enumerate(wrapped_lines):
                if y + j < height - 2:
                    try:
                        self.stdscr.addstr(y + j, 2, line[:max_width])
                    except curses.error:
                        pass
            self.stdscr.attroff(color)
        
        # Draw typing animation
        if self.is_typing:
            elapsed = time.time() - self.typing_start_time
            dots = "." * (int(elapsed * 2) % 4)
            self.stdscr.attron(curses.A_BOLD)
            try:
                self.stdscr.addstr(height - 3, 2, f"[AI is typing{dots}]")
            except curses.error:
                pass
            self.stdscr.attroff(curses.A_BOLD)
    
    def wrap_text(self, text: str, max_width: int) -> List[str]:
        words = text.split()
        lines = []
        current_line = ""
        
        for word in words:
            if len(current_line) + len(word) + 1 <= max_width:
                current_line = current_line + " " + word if current_line else word
            else:
                if current_line:
                    lines.append(current_line)
                current_line = word
        
        if current_line:
            lines.append(current_line)
        
        return lines if lines else [""]
    
    def draw_input_bar(self, y: int, width: int):
        self.stdscr.attron(self.color_map["input"])
        prompt = " ❯ "
        try:
            self.stdscr.addstr(y, 0, prompt + " " * (width - len(prompt)))
            self.stdscr.addstr(y, len(prompt), self.input_buffer[:width - len(prompt) - 1])
        except curses.error:
            pass
        self.stdscr.attroff(self.color_map["input"])
    
    def draw_status_bar(self, y: int, width: int):
        self.stdscr.attron(self.color_map["status"])
        status_text = f" {self.status} | Msgs: {len(self.messages)} | Theme: {self.theme.value} | /help | Ctrl+Q "
        status_text = status_text[:width - 1].ljust(width - 1)
        try:
            self.stdscr.addstr(y, 0, status_text)
        except curses.error:
            pass
        self.stdscr.attroff(self.color_map["status"])
    
    def handle_input(self, key: int) -> bool:
        if key == 17:  # Ctrl+Q
            self.running = False
            return False
        
        elif key == curses.KEY_UP:
            self.scroll_offset = max(0, self.scroll_offset - 1)
        
        elif key == curses.KEY_DOWN:
            max_scroll = max(0, len(self.messages) - self.get_message_area_height())
            self.scroll_offset = min(max_scroll, self.scroll_offset + 1)
        
        elif key == curses.KEY_PPAGE:
            self.scroll_offset = max(0, self.scroll_offset - self.get_message_area_height())
        
        elif key == curses.KEY_NPAGE:
            max_scroll = max(0, len(self.messages) - self.get_message_area_height())
            self.scroll_offset = min(max_scroll, self.scroll_offset + self.get_message_area_height())
        
        elif key == 127 or key == curses.KEY_BACKSPACE or key == 8:
            self.input_buffer = self.input_buffer[:-1]
        
        elif key == 10 or key == 13:
            if self.input_buffer.strip():
                self.process_command()
        
        elif key == curses.KEY_RESIZE:
            self.scroll_to_bottom()
        
        elif 32 <= key <= 126:
            self.input_buffer += chr(key)
        
        return True
    
    def process_command(self):
        content = self.input_buffer.strip()
        self.input_buffer = ""
        
        if content.startswith("/"):
            self.handle_command(content)
        else:
            self.send_message(content)
    
    def handle_command(self, cmd: str):
        parts = cmd.split(" ", 1)
        command = parts[0].lower()
        args = parts[1] if len(parts) > 1 else ""
        
        commands = {
            "/help": self.cmd_help,
            "/clear": self.cmd_clear,
            "/theme": self.cmd_theme,
            "/export": self.cmd_export,
            "/quit": lambda: setattr(self, "running", False),
        }
        
        if command in commands:
            commands[command]()
        else:
            self.add_message(MessageType.ERROR, f"Unknown command: {command}. Type /help for available commands.")
    
    def cmd_help(self):
        help_text = """Commands: /help (this), /clear (clear chat), /theme (switch theme), /export <file> (save chat), /quit (exit)"""
        self.add_message(MessageType.SYSTEM, help_text)
    
    def cmd_clear(self):
        self.messages.clear()
        self.add_message(MessageType.SYSTEM, "Chat history cleared.")
    
    def cmd_theme(self):
        self.switch_theme()
    
    def cmd_export(self, filename: str = "chat_export.json"):
        try:
            with open(filename, "w") as f:
                json.dump({"messages": [asdict(m) for m in self.messages]}, f, indent=2)
            self.add_message(MessageType.SYSTEM, f"Chat exported to {filename}")
        except Exception as e:
            self.add_message(MessageType.ERROR, f"Export failed: {e}")
    
    def send_message(self, content: str):
        self.add_message(MessageType.USER, content)
        
        # Simulate typing
        self.is_typing = True
        self.typing_start_time = time.time()
        self.status = "AI is thinking..."
        
        # Generate response
        response = self.generate_response(content)
        
        self.is_typing = False
        self.add_message(MessageType.ASSISTANT, response)
        self.status = "Ready"
    
    def generate_response(self, user_input: str) -> str:
        responses = {
            "hello": "Hello! How can I assist you today?",
            "help": "I'm a terminal-based AI assistant. Type your questions or use /help for commands!",
            "time": f"Current time is {datetime.now().strftime('%H:%M:%S')}",
            "date": f"Today is {datetime.now().strftime('%Y-%m-%d %A')}",
            "who are you": "I'm an AI Assistant TUI built with Python curses. I can chat with you in the terminal!",
            "clear": "You can use /clear command to clear the chat history.",
            "theme": "Use /theme command to cycle through available themes: default, dark, light, monokai.",
        }
        
        user_input_lower = user_input.lower()
        for key, response in responses.items():
            if key in user_input_lower:
                return response
        
        return f"You said: '{user_input}'. This is a demo TUI. Integrate your AI API for real responses!"
    
    def run(self):
        while self.running:
            self.draw()
            try:
                key = self.stdscr.getch()
                if key != -1:
                    self.handle_input(key)
            except KeyboardInterrupt:
                break
        
        self.save_history()


def main(stdscr):
    app = AIAssistantTUI(stdscr)
    app.run()


if __name__ == "__main__":
    print("Starting Enhanced AI Assistant TUI...")
    print("Press Ctrl+Q to quit")
    print()
    curses.wrapper(main)
