// 游戏常量
const CANVAS_WIDTH = 800
const CANVAS_HEIGHT = 600
const TILE_SIZE = 40
const PLAYER_SPEED = 3
const BULLET_SPEED = 8
const ENEMY_SPEED = 1.5

// 方向枚举
const Direction = {
  UP: 0,
  RIGHT: 1,
  DOWN: 2,
  LEFT: 3,
}

// 游戏状态
const GameState = {
  START: 0,
  PLAYING: 1,
  PAUSED: 2,
  GAME_OVER: 3,
}

// 输入处理
class InputHandler {
  constructor() {
    this.keys = {}
    window.addEventListener("keydown", (e) => {
      this.keys[e.code] = true
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        e.preventDefault()
      }
    })
    window.addEventListener("keyup", (e) => {
      this.keys[e.code] = false
    })
  }

  isDown(code) {
    return this.keys[code] === true
  }
}

// 子弹类
class Bullet {
  constructor(x, y, direction, isPlayerBullet = true) {
    this.x = x
    this.y = y
    this.direction = direction
    this.isPlayerBullet = isPlayerBullet
    this.width = 6
    this.height = 6
    this.active = true
  }

  update() {
    switch (this.direction) {
      case Direction.UP:
        this.y -= BULLET_SPEED
        break
      case Direction.DOWN:
        this.y += BULLET_SPEED
        break
      case Direction.LEFT:
        this.x -= BULLET_SPEED
        break
      case Direction.RIGHT:
        this.x += BULLET_SPEED
        break
    }

    // 检查边界
    if (this.x < 0 || this.x > CANVAS_WIDTH || this.y < 0 || this.y > CANVAS_HEIGHT) {
      this.active = false
    }
  }

  draw(ctx) {
    ctx.fillStyle = this.isPlayerBullet ? "#f4d03f" : "#e74c3c"
    ctx.beginPath()
    ctx.arc(this.x + this.width / 2, this.y + this.height / 2, this.width / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  getBounds() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    }
  }
}

// 坦克基类
class Tank {
  constructor(x, y, color) {
    this.x = x
    this.y = y
    this.color = color
    this.width = 36
    this.height = 36
    this.direction = Direction.UP
    this.speed = 0
    this.shootCooldown = 0
    this.active = true
  }

  draw(ctx) {
    ctx.save()
    ctx.translate(this.x + this.width / 2, this.y + this.height / 2)
    ctx.rotate((this.direction * 90 * Math.PI) / 180)
    ctx.translate(-(this.x + this.width / 2), -(this.y + this.height / 2))

    // 坦克主体
    ctx.fillStyle = this.color
    ctx.fillRect(this.x + 4, this.y + 4, this.width - 8, this.height - 8)

    // 履带
    ctx.fillStyle = "#2c3e50"
    ctx.fillRect(this.x, this.y + 2, 8, this.height - 4)
    ctx.fillRect(this.x + this.width - 8, this.y + 2, 8, this.height - 4)

    // 炮管
    ctx.fillStyle = "#34495e"
    ctx.fillRect(this.x + this.width / 2 - 3, this.y - 5, 6, 18)

    // 炮塔
    ctx.fillStyle = this.color
    ctx.beginPath()
    ctx.arc(this.x + this.width / 2, this.y + this.height / 2, 10, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  }

  getBounds() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    }
  }

  shoot() {
    if (this.shootCooldown <= 0) {
      let bulletX, bulletY
      switch (this.direction) {
        case Direction.UP:
          bulletX = this.x + this.width / 2 - 3
          bulletY = this.y - 10
          break
        case Direction.DOWN:
          bulletX = this.x + this.width / 2 - 3
          bulletY = this.y + this.height + 4
          break
        case Direction.LEFT:
          bulletX = this.x - 10
          bulletY = this.y + this.height / 2 - 3
          break
        case Direction.RIGHT:
          bulletX = this.x + this.width + 4
          bulletY = this.y + this.height / 2 - 3
          break
      }
      this.shootCooldown = 30
      return new Bullet(bulletX, bulletY, this.direction, this instanceof Player)
    }
    return null
  }

  update() {
    if (this.shootCooldown > 0) {
      this.shootCooldown--
    }
  }

  checkCollisionWith(other) {
    const a = this.getBounds()
    const b = other.getBounds()
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  }
}

// 玩家坦克
class Player extends Tank {
  constructor(x, y) {
    super(x, y, "#27ae60")
    this.speed = PLAYER_SPEED
    this.lives = 3
    this.score = 0
    this.invincible = false
    this.invincibleTime = 0
  }

  update(input, walls) {
    super.update()

    let dx = 0,
      dy = 0
    let moved = false

    if (input.isDown("KeyW") || input.isDown("ArrowUp")) {
      dy = -this.speed
      this.direction = Direction.UP
      moved = true
    } else if (input.isDown("KeyS") || input.isDown("ArrowDown")) {
      dy = this.speed
      this.direction = Direction.DOWN
      moved = true
    } else if (input.isDown("KeyA") || input.isDown("ArrowLeft")) {
      dx = -this.speed
      this.direction = Direction.LEFT
      moved = true
    } else if (input.isDown("KeyD") || input.isDown("ArrowRight")) {
      dx = this.speed
      this.direction = Direction.RIGHT
      moved = true
    }

    if (moved) {
      const newX = this.x + dx
      const newY = this.y + dy

      if (!this.checkWallCollision(newX, this.y, walls)) {
        this.x = newX
      }
      if (!this.checkWallCollision(this.x, newY, walls)) {
        this.y = newY
      }

      // 边界检查
      this.x = Math.max(0, Math.min(CANVAS_WIDTH - this.width, this.x))
      this.y = Math.max(0, Math.min(CANVAS_HEIGHT - this.height, this.y))
    }

    if (this.invincible && this.invincibleTime > 0) {
      this.invincibleTime--
      if (this.invincibleTime <= 0) {
        this.invincible = false
      }
    }
  }

  checkWallCollision(newX, newY, walls) {
    const tempBounds = {
      x: newX,
      y: newY,
      width: this.width,
      height: this.height,
    }

    for (const wall of walls) {
      if (wall.active && this.rectCollision(tempBounds, wall.getBounds())) {
        return true
      }
    }
    return false
  }

  rectCollision(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  }

  draw(ctx) {
    if (this.invincible && Math.floor(this.invincibleTime / 5) % 2 === 0) {
      return // 闪烁效果
    }
    super.draw(ctx)
  }

  hit() {
    if (!this.invincible) {
      this.lives--
      this.invincible = true
      this.invincibleTime = 120
    }
  }
}

// 敌人坦克
class Enemy extends Tank {
  constructor(x, y) {
    super(x, y, "#e74c3c")
    this.speed = ENEMY_SPEED
    this.moveTimer = 0
    this.direction = Direction.DOWN
  }

  update(player, walls) {
    super.update()

    this.moveTimer--
    if (this.moveTimer <= 0) {
      this.changeDirection(player)
      this.moveTimer = 60 + Math.random() * 60
    }

    const newX = this.x
    const newY = this.y

    switch (this.direction) {
      case Direction.UP:
        this.y -= this.speed
        break
      case Direction.DOWN:
        this.y += this.speed
        break
      case Direction.LEFT:
        this.x -= this.speed
        break
      case Direction.RIGHT:
        this.x += this.speed
        break
    }

    if (this.checkWallCollision(walls) || this.isOutOfBounds()) {
      this.x = newX
      this.y = newY
      this.changeDirection(player)
    }
  }

  changeDirection(player) {
    const directions = [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT]

    if (Math.random() < 0.5 && player.active) {
      if (Math.abs(player.x - this.x) > Math.abs(player.y - this.y)) {
        this.direction = player.x > this.x ? Direction.RIGHT : Direction.LEFT
      } else {
        this.direction = player.y > this.y ? Direction.DOWN : Direction.UP
      }
    } else {
      this.direction = directions[Math.floor(Math.random() * directions.length)]
    }
  }

  checkWallCollision(walls) {
    for (const wall of walls) {
      if (wall.active && this.checkCollisionWith(wall)) {
        return true
      }
    }
    return false
  }

  isOutOfBounds() {
    return this.x < 0 || this.x > CANVAS_WIDTH - this.width || this.y < 0 || this.y > CANVAS_HEIGHT - this.height
  }

  shoot() {
    if (this.shootCooldown <= 0 && Math.random() < 0.03) {
      this.shootCooldown = 60 + Math.random() * 60
      return super.shoot()
    }
    return null
  }
}

// 墙壁类
class Wall {
  constructor(x, y, type = "brick") {
    this.x = x
    this.y = y
    this.width = TILE_SIZE
    this.height = TILE_SIZE
    this.type = type
    this.active = true
    this.health = type === "steel" ? 999 : 2
  }

  draw(ctx) {
    if (!this.active) return

    if (this.type === "brick") {
      ctx.fillStyle = "#d35400"
      ctx.fillRect(this.x + 2, this.y + 2, this.width - 4, this.height - 4)

      ctx.fillStyle = "#e67e22"
      ctx.fillRect(this.x + 4, this.y + 4, this.width - 8, this.height / 2 - 6)
      ctx.fillRect(this.x + 4, this.y + this.height / 2 + 2, this.width - 8, this.height / 2 - 6)
    } else if (this.type === "steel") {
      ctx.fillStyle = "#95a5a6"
      ctx.fillRect(this.x + 4, this.y + 4, this.width - 8, this.height - 8)

      ctx.fillStyle = "#bdc3c7"
      ctx.fillRect(this.x + 8, this.y + 8, this.width - 16, this.height - 16)
    } else if (this.type === "base") {
      ctx.fillStyle = "#3498db"
      ctx.beginPath()
      ctx.moveTo(this.x + this.width / 2, this.y + 4)
      ctx.lineTo(this.x + this.width - 4, this.y + this.height - 4)
      ctx.lineTo(this.x + 4, this.y + this.height - 4)
      ctx.closePath()
      ctx.fill()
    }
  }

  getBounds() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    }
  }

  hit() {
    if (this.type === "brick") {
      this.health--
      if (this.health <= 0) {
        this.active = false
      }
    }
  }
}

// 爆炸效果
class Explosion {
  constructor(x, y) {
    this.x = x
    this.y = y
    this.frame = 0
    this.maxFrames = 20
    this.active = true
  }

  update() {
    this.frame++
    if (this.frame >= this.maxFrames) {
      this.active = false
    }
  }

  draw(ctx) {
    const progress = this.frame / this.maxFrames
    const radius = 20 + progress * 30
    const alpha = 1 - progress

    ctx.save()
    ctx.globalAlpha = alpha

    ctx.fillStyle = "#e74c3c"
    ctx.beginPath()
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = "#f4d03f"
    ctx.beginPath()
    ctx.arc(this.x, this.y, radius * 0.6, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  }
}

// 游戏主类
class Game {
  constructor() {
    this.canvas = document.getElementById("gameCanvas")
    this.ctx = this.canvas.getContext("2d")
    this.input = new InputHandler()
    this.state = GameState.START
    this.level = 1

    this.scoreElement = document.getElementById("score")
    this.livesElement = document.getElementById("lives")
    this.levelElement = document.getElementById("level")
    this.startScreen = document.getElementById("startScreen")
    this.gameOverScreen = document.getElementById("gameOverScreen")
    this.pauseScreen = document.getElementById("pauseScreen")
    this.finalScoreElement = document.getElementById("finalScore")

    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") {
        this.handleSpaceKey()
      } else if (e.code === "KeyP") {
        this.togglePause()
      }
    })

    this.init()
  }

  init() {
    this.player = new Player(CANVAS_WIDTH / 2 - 18, CANVAS_HEIGHT - 80)
    this.enemies = []
    this.bullets = []
    this.walls = []
    this.explosions = []
    this.enemySpawnTimer = 0
    this.enemiesToSpawn = 5 + this.level * 2
    this.enemiesSpawned = 0

    this.generateLevel()
    this.updateUI()
  }

  generateLevel() {
    this.walls = []

    const mapLayout = [
      "....................",
      ".###.###....###.###.",
      ".###.###....###.###.",
      ".###.###....###.###.",
      "....................",
      ".###.###.##.###.###.",
      ".###.###.##.###.###.",
      "....................",
      ".###.###....###.###.",
      ".###.###....###.###.",
      "....................",
      "...###..##..###.....",
      "...###..##..###.....",
      "....................",
      ".###.###....###.###.",
    ]

    for (let row = 0; row < mapLayout.length; row++) {
      for (let col = 0; col < mapLayout[row].length; col++) {
        const char = mapLayout[row][col]
        const x = col * TILE_SIZE + 20
        const y = row * TILE_SIZE + 40

        if (char === "#") {
          this.walls.push(new Wall(x, y, "brick"))
        } else if (char === "$") {
          this.walls.push(new Wall(x, y, "steel"))
        }
      }
    }

    // 添加基地
    const baseX = CANVAS_WIDTH / 2 - TILE_SIZE
    const baseY = CANVAS_HEIGHT - TILE_SIZE - 20
    this.baseWall = new Wall(baseX, baseY, "base")
    this.walls.push(this.baseWall)
  }

  handleSpaceKey() {
    if (this.state === GameState.START || this.state === GameState.GAME_OVER) {
      this.startGame()
    } else if (this.state === GameState.PLAYING) {
      const bullet = this.player.shoot()
      if (bullet) {
        this.bullets.push(bullet)
      }
    }
  }

  togglePause() {
    if (this.state === GameState.PLAYING) {
      this.state = GameState.PAUSED
      this.pauseScreen.classList.remove("hidden")
    } else if (this.state === GameState.PAUSED) {
      this.state = GameState.PLAYING
      this.pauseScreen.classList.add("hidden")
    }
  }

  startGame() {
    this.state = GameState.PLAYING
    this.player = new Player(CANVAS_WIDTH / 2 - 18, CANVAS_HEIGHT - 80)
    this.enemies = []
    this.bullets = []
    this.explosions = []
    this.enemySpawnTimer = 0
    this.enemiesToSpawn = 5 + this.level * 2
    this.enemiesSpawned = 0
    this.startScreen.classList.add("hidden")
    this.gameOverScreen.classList.add("hidden")
    this.updateUI()
  }

  spawnEnemy() {
    if (this.enemiesSpawned >= this.enemiesToSpawn) return
    if (this.enemies.length >= 4) return

    this.enemySpawnTimer++
    if (this.enemySpawnTimer < 120) return

    this.enemySpawnTimer = 0

    const spawnPoints = [
      { x: 40, y: 40 },
      { x: CANVAS_WIDTH / 2 - 18, y: 40 },
      { x: CANVAS_WIDTH - 76, y: 40 },
    ]

    const spawnPoint = spawnPoints[Math.floor(Math.random() * spawnPoints.length)]

    let canSpawn = true
    for (const enemy of this.enemies) {
      if (Math.abs(enemy.x - spawnPoint.x) < 50 && Math.abs(enemy.y - spawnPoint.y) < 50) {
        canSpawn = false
        break
      }
    }

    if (canSpawn) {
      this.enemies.push(new Enemy(spawnPoint.x, spawnPoint.y))
      this.enemiesSpawned++
    }
  }

  checkCollisions() {
    // 子弹碰撞检测
    for (const bullet of this.bullets) {
      if (!bullet.active) continue

      // 子弹与墙壁
      for (const wall of this.walls) {
        if (wall.active && this.rectCollision(bullet.getBounds(), wall.getBounds())) {
          bullet.active = false
          if (wall.type !== "base") {
            wall.hit()
          } else {
            this.gameOver()
          }
          break
        }
      }

      // 玩家子弹与敌人
      if (bullet.isPlayerBullet) {
        for (const enemy of this.enemies) {
          if (enemy.active && this.rectCollision(bullet.getBounds(), enemy.getBounds())) {
            bullet.active = false
            enemy.active = false
            this.explosions.push(new Explosion(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2))
            this.player.score += 100
            this.updateUI()
            break
          }
        }
      } else {
        // 敌人子弹与玩家
        if (
          this.player.active &&
          !this.player.invincible &&
          this.rectCollision(bullet.getBounds(), this.player.getBounds())
        ) {
          bullet.active = false
          this.player.hit()
          this.explosions.push(
            new Explosion(this.player.x + this.player.width / 2, this.player.y + this.player.height / 2),
          )
          this.updateUI()

          if (this.player.lives <= 0) {
            this.player.active = false
            this.gameOver()
          }
        }
      }
    }

    // 清理不活跃的物体
    this.bullets = this.bullets.filter((b) => b.active)
    this.enemies = this.enemies.filter((e) => e.active)
    this.walls = this.walls.filter((w) => w.active)
  }

  rectCollision(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  }

  update() {
    if (this.state !== GameState.PLAYING) return

    this.player.update(this.input, this.walls)

    // 玩家射击
    if (this.input.isDown("KeyJ")) {
      const bullet = this.player.shoot()
      if (bullet) {
        this.bullets.push(bullet)
      }
    }

    this.spawnEnemy()

    for (const enemy of this.enemies) {
      enemy.update(this.player, this.walls)
      const bullet = enemy.shoot()
      if (bullet) {
        this.bullets.push(bullet)
      }
    }

    for (const bullet of this.bullets) {
      bullet.update()
    }

    for (const explosion of this.explosions) {
      explosion.update()
    }

    this.checkCollisions()

    // 检查关卡完成
    if (this.enemiesSpawned >= this.enemiesToSpawn && this.enemies.length === 0) {
      this.level++
      this.init()
    }

    this.explosions = this.explosions.filter((e) => e.active)
  }

  draw() {
    this.ctx.fillStyle = "#000"
    this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    // 绘制网格背景
    this.ctx.strokeStyle = "#1a1a1a"
    this.ctx.lineWidth = 1
    for (let x = 0; x < CANVAS_WIDTH; x += TILE_SIZE) {
      this.ctx.beginPath()
      this.ctx.moveTo(x, 0)
      this.ctx.lineTo(x, CANVAS_HEIGHT)
      this.ctx.stroke()
    }
    for (let y = 0; y < CANVAS_HEIGHT; y += TILE_SIZE) {
      this.ctx.beginPath()
      this.ctx.moveTo(0, y)
      this.ctx.lineTo(CANVAS_WIDTH, y)
      this.ctx.stroke()
    }

    for (const wall of this.walls) {
      wall.draw(this.ctx)
    }

    if (this.player.active) {
      this.player.draw(this.ctx)
    }

    for (const enemy of this.enemies) {
      enemy.draw(this.ctx)
    }

    for (const bullet of this.bullets) {
      bullet.draw(this.ctx)
    }

    for (const explosion of this.explosions) {
      explosion.draw(this.ctx)
    }
  }

  updateUI() {
    this.scoreElement.textContent = this.player.score
    this.livesElement.textContent = this.player.lives
    this.levelElement.textContent = this.level
  }

  gameOver() {
    this.state = GameState.GAME_OVER
    this.finalScoreElement.textContent = this.player.score
    this.gameOverScreen.classList.remove("hidden")
  }

  run() {
    const gameLoop = () => {
      this.update()
      this.draw()
      requestAnimationFrame(gameLoop)
    }
    gameLoop()
  }
}

// 启动游戏
const game = new Game()
game.run()
