#!/usr/bin/env python3
"""
AI Assistant TUI - A terminal-based AI chat interface using curses
"""

import curses
import asyncio
from datetime import datetime
from dataclasses import dataclass, field
from typing import List, Optional
from enum import Enum


class MessageType(Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


@dataclass
class Message:
    role: MessageType
    content: str
    timestamp: datetime = field(default_factory=datetime.now)


class AIAssistantTUI:
    def __init__(self, stdscr):
        self.stdscr = stdscr
        self.messages: List[Message] = []
        self.input_buffer = ""
        self.scroll_offset = 0
        self.running = True
        self.status = "Ready"
        
        # Initialize colors
        curses.start_color()
        curses.use_default_colors()
        curses.init_pair(1, curses.COLOR_GREEN, -1)   # User messages
        curses.init_pair(2, curses.COLOR_CYAN, -1)    # Assistant messages
        curses.init_pair(3, curses.COLOR_YELLOW, -1)  # System messages
        curses.init_pair(4, curses.COLOR_BLACK, curses.COLOR_WHITE)  # Input bar
        curses.init_pair(5, curses.COLOR_WHITE, curses.COLOR_BLUE)  # Status bar
        curses.init_pair(6, curses.COLOR_RED, -1)     # Error messages
        
        # Configure curses
        curses.curs_set(1)  # Show cursor
        self.stdscr.timeout(100)  # Non-blocking input
        
        # Add welcome message
        self.add_message(MessageType.SYSTEM, "Welcome to AI Assistant TUI! Type your message and press Enter. Ctrl+Q to quit.")
    
    def add_message(self, role: MessageType, content: str):
        self.messages.append(Message(role, content))
        self.scroll_to_bottom()
    
    def scroll_to_bottom(self):
        self.scroll_offset = max(0, len(self.messages) - self.get_message_area_height())
    
    def get_message_area_height(self) -> int:
        height, _ = self.stdscr.getmaxyx()
        return height - 3  # Reserve 3 lines for input and status
    
    def get_message_area_width(self) -> int:
        _, width = self.stdscr.getmaxyx()
        return width - 4  # Reserve space for margins
    
    def draw(self):
        self.stdscr.clear()
        height, width = self.stdscr.getmaxyx()
        
        # Draw title
        title = " AI Assistant TUI "
        self.stdscr.attron(curses.A_BOLD | curses.A_REVERSE)
        self.stdscr.addstr(0, (width - len(title)) // 2, title)
        self.stdscr.attroff(curses.A_BOLD | curses.A_REVERSE)
        
        # Draw messages
        self.draw_messages()
        
        # Draw input bar
        self.draw_input_bar(height - 2, width)
        
        # Draw status bar
        self.draw_status_bar(height - 1, width)
        
        self.stdscr.refresh()
    
    def draw_messages(self):
        height, _ = self.stdscr.getmaxyx()
        start_y = 2
        max_width = self.get_message_area_width()
        visible_messages = self.get_message_area_height()
        
        for i, msg in enumerate(self.messages[self.scroll_offset:self.scroll_offset + visible_messages]):
            y = start_y + i
            if y >= height - 2:
                break
            
            # Format prefix based on role
            if msg.role == MessageType.USER:
                prefix = "You"
                color = curses.color_pair(1)
            elif msg.role == MessageType.ASSISTANT:
                prefix = "AI"
                color = curses.color_pair(2)
            else:
                prefix = "System"
                color = curses.color_pair(3)
            
            # Wrap text
            wrapped_lines = self.wrap_text(f"[{prefix}]: {msg.content}", max_width)
            
            self.stdscr.attron(color)
            for j, line in enumerate(wrapped_lines):
                if y + j < height - 2:
                    self.stdscr.addstr(y + j, 2, line[:max_width])
            self.stdscr.attroff(color)
    
    def wrap_text(self, text: str, max_width: int) -> List[str]:
        words = text.split()
        lines = []
        current_line = ""
        
        for word in words:
            if len(current_line) + len(word) + 1 <= max_width:
                if current_line:
                    current_line += " " + word
                else:
                    current_line = word
            else:
                if current_line:
                    lines.append(current_line)
                current_line = word
        
        if current_line:
            lines.append(current_line)
        
        return lines if lines else [""]
    
    def draw_input_bar(self, y: int, width: int):
        self.stdscr.attron(curses.color_pair(4))
        prompt = " > "
        self.stdscr.addstr(y, 0, prompt + " " * (width - len(prompt)))
        self.stdscr.addstr(y, len(prompt), self.input_buffer[:width - len(prompt) - 1])
        self.stdscr.attroff(curses.color_pair(4))
    
    def draw_status_bar(self, y: int, width: int):
        self.stdscr.attron(curses.color_pair(5))
        status_text = f" {self.status} | Messages: {len(self.messages)} | Scroll: {self.scroll_offset} | Ctrl+Q: Quit "
        status_text = status_text[:width - 1].ljust(width - 1)
        self.stdscr.addstr(y, 0, status_text)
        self.stdscr.attroff(curses.color_pair(5))
    
    def handle_input(self, key: int) -> bool:
        if key == 17:  # Ctrl+Q
            self.running = False
            return False
        
        elif key == curses.KEY_UP:
            self.scroll_offset = max(0, self.scroll_offset - 1)
        
        elif key == curses.KEY_DOWN:
            max_scroll = max(0, len(self.messages) - self.get_message_area_height())
            self.scroll_offset = min(max_scroll, self.scroll_offset + 1)
        
        elif key == curses.KEY_PPAGE:  # Page Up
            self.scroll_offset = max(0, self.scroll_offset - self.get_message_area_height())
        
        elif key == curses.KEY_NPAGE:  # Page Down
            max_scroll = max(0, len(self.messages) - self.get_message_area_height())
            self.scroll_offset = min(max_scroll, self.scroll_offset + self.get_message_area_height())
        
        elif key == 127 or key == curses.KEY_BACKSPACE or key == 8:  # Backspace
            if self.input_buffer:
                self.input_buffer = self.input_buffer[:-1]
        
        elif key == 10 or key == 13:  # Enter
            if self.input_buffer.strip():
                self.send_message()
        
        elif key == curses.KEY_RESIZE:
            self.scroll_to_bottom()
        
        elif 32 <= key <= 126:  # Printable characters
            self.input_buffer += chr(key)
        
        return True
    
    def send_message(self):
        content = self.input_buffer.strip()
        if not content:
            return
        
        # Add user message
        self.add_message(MessageType.USER, content)
        self.input_buffer = ""
        
        # Simulate AI response (replace with actual AI integration)
        self.status = "Thinking..."
        self.draw()
        
        # Simple echo response for demo
        response = self.generate_response(content)
        self.add_message(MessageType.ASSISTANT, response)
        self.status = "Ready"
    
    def generate_response(self, user_input: str) -> str:
        """Generate a simple response. Replace with actual AI integration."""
        responses = {
            "hello": "Hello! How can I assist you today?",
            "help": "I'm a terminal-based AI assistant. Type your questions and I'll do my best to help!",
            "time": f"Current time is {datetime.now().strftime('%H:%M:%S')}",
            "date": f"Today is {datetime.now().strftime('%Y-%m-%d')}",
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


def main(stdscr):
    app = AIAssistantTUI(stdscr)
    app.run()


if __name__ == "__main__":
    print("Starting AI Assistant TUI...")
    print("Press Ctrl+Q to quit")
    print()
    curses.wrapper(main)
