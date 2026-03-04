#!/usr/bin/env python3
"""Tank Battle Game using Python curses library."""

import curses
import random
import time
from dataclasses import dataclass
from typing import List, Tuple


@dataclass
class GameObject:
    x: int
    y: int
    width: int = 1
    height: int = 1


@dataclass
class Tank(GameObject):
    direction: str = "up"  # up, down, left, right
    health: int = 3
    symbol: str = "T"
    is_player: bool = True


@dataclass
class Bullet(GameObject):
    direction: str = "up"
    owner: str = "player"  # player or enemy


@dataclass
class Wall(GameObject):
    symbol: str = "#"


class TankGame:
    def __init__(self, stdscr):
        self.stdscr = stdscr
        self.height, self.width = stdscr.getmaxyx()
        self.game_height = self.height - 2
        self.game_width = self.width - 2
        
        # Initialize colors
        curses.start_color()
        curses.init_pair(1, curses.COLOR_GREEN, curses.COLOR_BLACK)  # Player
        curses.init_pair(2, curses.COLOR_RED, curses.COLOR_BLACK)    # Enemy
        curses.init_pair(3, curses.COLOR_YELLOW, curses.COLOR_BLACK) # Bullet
        curses.init_pair(4, curses.COLOR_CYAN, curses.COLOR_BLACK)   # Wall
        curses.init_pair(5, curses.COLOR_WHITE, curses.COLOR_BLACK)  # Text
        
        # Game state
        self.score = 0
        self.game_over = False
        self.message = ""
        
        # Create player tank
        self.player = Tank(
            x=self.game_width // 2,
            y=self.game_height - 2,
            is_player=True,
            symbol="P"
        )
        
        # Create enemy tanks
        self.enemies: List[Tank] = []
        self.spawn_enemy()
        self.spawn_enemy()
        
        # Bullets
        self.bullets: List[Bullet] = []
        
        # Walls
        self.walls: List[Wall] = []
        self.generate_walls()
        
        # Last shot time
        self.last_shot_time = 0
        self.shot_cooldown = 0.3
        
        # Setup screen
        self.stdscr.nodelay(True)
        curses.curs_set(0)
        
    def generate_walls(self):
        """Generate random wall obstacles."""
        num_walls = 15
        for _ in range(num_walls):
            wall_x = random.randint(2, self.game_width - 3)
            wall_y = random.randint(2, self.game_height - 4)
            # Avoid spawning walls near player
            if abs(wall_x - self.player.x) > 3 or abs(wall_y - self.player.y) > 3:
                self.walls.append(Wall(x=wall_x, y=wall_y, width=2, height=1))
    
    def spawn_enemy(self):
        """Spawn a new enemy tank."""
        enemy_x = random.randint(1, self.game_width - 2)
        enemy = Tank(
            x=enemy_x,
            y=1,
            is_player=False,
            symbol="E",
            health=2,
            direction="down"
        )
        self.enemies.append(enemy)
    
    def draw_border(self):
        """Draw game border."""
        # Top and bottom borders
        for x in range(self.game_width):
            try:
                self.stdscr.addch(0, x, "-", curses.color_pair(5))
                self.stdscr.addch(self.game_height, x, "-", curses.color_pair(5))
            except curses.error:
                pass
        
        # Side borders
        for y in range(1, self.game_height):
            try:
                self.stdscr.addch(y, 0, "|", curses.color_pair(5))
                self.stdscr.addch(y, self.game_width - 1, "|", curses.color_pair(5))
            except curses.error:
                pass
        
        # Corners
        try:
            self.stdscr.addch(0, 0, "+", curses.color_pair(5))
            self.stdscr.addch(0, self.game_width - 1, "+", curses.color_pair(5))
            self.stdscr.addch(self.game_height, 0, "+", curses.color_pair(5))
            self.stdscr.addch(self.game_height, self.game_width - 1, "+", curses.color_pair(5))
        except curses.error:
            pass
    
    def draw_tank(self, tank: Tank):
        """Draw a tank on the screen."""
        color = curses.color_pair(1) if tank.is_player else curses.color_pair(2)
        symbol = tank.symbol
        
        # Draw tank body
        try:
            self.stdscr.addch(tank.y, tank.x, symbol, color | curses.A_BOLD)
        except curses.error:
            pass
        
        # Draw direction indicator
        dir_offsets = {
            "up": (0, -1),
            "down": (0, 1),
            "left": (-1, 0),
            "right": (1, 0)
        }
        dx, dy = dir_offsets.get(tank.direction, (0, -1))
        try:
            self.stdscr.addch(tank.y + dy, tank.x + dx, "^" if tank.direction == "up" else 
                             "v" if tank.direction == "down" else 
                             "<" if tank.direction == "left" else ">", color)
        except curses.error:
            pass
    
    def draw_bullet(self, bullet: Bullet):
        """Draw a bullet on the screen."""
        try:
            self.stdscr.addch(bullet.y, bullet.x, "*", curses.color_pair(3) | curses.A_BOLD)
        except curses.error:
            pass
    
    def draw_wall(self, wall: Wall):
        """Draw a wall on the screen."""
        for dx in range(wall.width):
            for dy in range(wall.height):
                try:
                    self.stdscr.addch(wall.y + dy, wall.x + dx, wall.symbol, curses.color_pair(4) | curses.A_BOLD)
                except curses.error:
                    pass
    
    def draw_ui(self):
        """Draw UI elements."""
        # Score
        score_text = f"Score: {self.score}"
        try:
            self.stdscr.addstr(self.game_height + 1, 2, score_text, curses.color_pair(5))
        except curses.error:
            pass
        
        # Health
        health_text = f"Health: {'♥' * self.player.health}"
        try:
            self.stdscr.addstr(self.game_height + 1, self.game_width // 2 - 5, health_text, curses.color_pair(1))
        except curses.error:
            pass
        
        # Enemies count
        enemy_text = f"Enemies: {len(self.enemies)}"
        try:
            self.stdscr.addstr(self.game_height + 1, self.game_width - 15, enemy_text, curses.color_pair(2))
        except curses.error:
            pass
        
        # Message
        if self.message:
            try:
                self.stdscr.addstr(self.game_height // 2, self.game_width // 2 - len(self.message) // 2, 
                                 self.message, curses.color_pair(5) | curses.A_BOLD)
            except curses.error:
                pass
        
        # Game over
        if self.game_over:
            go_text = "GAME OVER - Press Q to quit"
            try:
                self.stdscr.addstr(self.game_height // 2 - 1, self.game_width // 2 - len(go_text) // 2,
                                 go_text, curses.color_pair(2) | curses.A_BOLD)
            except curses.error:
                pass
    
    def check_collision(self, obj: GameObject, walls: bool = True, tanks: bool = True) -> bool:
        """Check if object collides with boundaries, walls, or tanks."""
        # Boundary collision
        if obj.x < 1 or obj.x >= self.game_width - 1 or obj.y < 1 or obj.y >= self.game_height:
            return True
        
        # Wall collision
        if walls:
            for wall in self.walls:
                if (obj.x >= wall.x and obj.x < wall.x + wall.width and
                    obj.y >= wall.y and obj.y < wall.y + wall.height):
                    return True
        
        return False
    
    def check_bullet_collision(self, bullet: Bullet) -> bool:
        """Check bullet collisions and return True if bullet should be removed."""
        # Boundary/wall collision
        if self.check_collision(bullet):
            return True
        
        # Player hit
        if bullet.owner == "enemy":
            if (bullet.x == self.player.x and bullet.y == self.player.y):
                self.player.health -= 1
                if self.player.health <= 0:
                    self.game_over = True
                    self.message = "You were destroyed!"
                return True
        
        # Enemy hit
        if bullet.owner == "player":
            for i, enemy in enumerate(self.enemies):
                if bullet.x == enemy.x and bullet.y == enemy.y:
                    enemy.health -= 1
                    if enemy.health <= 0:
                        self.enemies.pop(i)
                        self.score += 100
                        self.message = "Enemy destroyed! +100"
                        # Spawn new enemy
                        if len(self.enemies) < 2:
                            self.spawn_enemy()
                    return True
        
        return False
    
    def move_tank(self, tank: Tank, direction: str) -> bool:
        """Move tank in given direction. Returns True if move was successful."""
        tank.direction = direction
        
        dir_offsets = {
            "up": (0, -1),
            "down": (0, 1),
            "left": (-1, 0),
            "right": (1, 0)
        }
        dx, dy = dir_offsets.get(direction, (0, 0))
        
        new_x = tank.x + dx
        new_y = tank.y + dy
        
        # Create temp object for collision check
        temp_obj = GameObject(x=new_x, y=new_y)
        
        # Check collision with walls and boundaries
        if tank.is_player:
            # Player collides with walls
            for wall in self.walls:
                if (new_x >= wall.x and new_x < wall.x + wall.width and
                    new_y >= wall.y and new_y < wall.y + wall.height):
                    return False
            # Player collides with enemies
            for enemy in self.enemies:
                if new_x == enemy.x and new_y == enemy.y:
                    return False
        else:
            # Enemy collides with walls
            for wall in self.walls:
                if (new_x >= wall.x and new_x < wall.x + wall.width and
                    new_y >= wall.y and new_y < wall.y + wall.height):
                    return False
            # Enemy collides with player
            if new_x == self.player.x and new_y == self.player.y:
                return False
        
        # Check boundaries
        if new_x < 1 or new_x >= self.game_width - 1 or new_y < 1 or new_y >= self.game_height:
            return False
        
        tank.x = new_x
        tank.y = new_y
        return True
    
    def move_bullet(self, bullet: Bullet):
        """Move bullet in its direction."""
        dir_offsets = {
            "up": (0, -1),
            "down": (0, 1),
            "left": (-1, 0),
            "right": (1, 0)
        }
        dx, dy = dir_offsets.get(bullet.direction, (0, -1))
        bullet.x += dx
        bullet.y += dy
    
    def enemy_ai(self, enemy: Tank):
        """Simple AI for enemy tank."""
        # Random movement
        if random.random() < 0.3:
            directions = ["up", "down", "left", "right"]
            new_dir = random.choice(directions)
            self.move_tank(enemy, new_dir)
        
        # Move towards player occasionally
        if random.random() < 0.4:
            if self.player.x > enemy.x:
                self.move_tank(enemy, "right")
            elif self.player.x < enemy.x:
                self.move_tank(enemy, "left")
            elif self.player.y > enemy.y:
                self.move_tank(enemy, "down")
            elif self.player.y < enemy.y:
                self.move_tank(enemy, "up")
        
        # Shoot at player if aligned
        if random.random() < 0.02:
            aligned = False
            if enemy.x == self.player.x:
                enemy.direction = "down" if self.player.y > enemy.y else "up"
                aligned = True
            elif enemy.y == self.player.y:
                enemy.direction = "right" if self.player.x > enemy.x else "left"
                aligned = True
            
            if aligned:
                self.bullets.append(Bullet(
                    x=enemy.x,
                    y=enemy.y,
                    direction=enemy.direction,
                    owner="enemy"
                ))
    
    def shoot(self, tank: Tank, is_player: bool):
        """Fire a bullet from tank."""
        current_time = time.time()
        if current_time - self.last_shot_time < self.shot_cooldown:
            return
        
        self.last_shot_time = current_time
        self.bullets.append(Bullet(
            x=tank.x,
            y=tank.y,
            direction=tank.direction,
            owner="player" if is_player else "enemy"
        ))
    
    def handle_input(self, key: int):
        """Handle player input."""
        if self.game_over:
            if key in [ord('q'), ord('Q')]:
                return False
            return True
        
        # Movement
        if key == curses.KEY_UP or key == ord('w'):
            self.move_tank(self.player, "up")
        elif key == curses.KEY_DOWN or key == ord('s'):
            self.move_tank(self.player, "down")
        elif key == curses.KEY_LEFT or key == ord('a'):
            self.move_tank(self.player, "left")
        elif key == curses.KEY_RIGHT or key == ord('d'):
            self.move_tank(self.player, "right")
        
        # Shoot
        elif key == ord(' '):
            self.shoot(self.player, True)
        
        # Quit
        elif key in [ord('q'), ord('Q')]:
            return False
        
        return True
    
    def update(self):
        """Update game state."""
        if self.game_over:
            return
        
        # Update bullets
        bullets_to_remove = []
        for bullet in self.bullets:
            self.move_bullet(bullet)
            if self.check_bullet_collision(bullet):
                bullets_to_remove.append(bullet)
        
        for bullet in bullets_to_remove:
            if bullet in self.bullets:
                self.bullets.remove(bullet)
        
        # Update enemies
        for enemy in self.enemies:
            self.enemy_ai(enemy)
        
        # Spawn enemies periodically
        if len(self.enemies) < 2 and random.random() < 0.01:
            self.spawn_enemy()
    
    def draw(self):
        """Draw all game elements."""
        self.stdscr.clear()
        
        self.draw_border()
        
        for wall in self.walls:
            self.draw_wall(wall)
        
        for enemy in self.enemies:
            self.draw_tank(enemy)
        
        self.draw_tank(self.player)
        
        for bullet in self.bullets:
            self.draw_bullet(bullet)
        
        self.draw_ui()
        
        self.stdscr.refresh()
    
    def run(self):
        """Main game loop."""
        while True:
            self.draw()
            
            try:
                key = self.stdscr.getch()
                if not self.handle_input(key):
                    break
            except curses.error:
                pass
            
            self.update()
            time.sleep(0.05)  # Game speed


def main(stdscr):
    game = TankGame(stdscr)
    game.run()


if __name__ == "__main__":
    curses.wrapper(main)
