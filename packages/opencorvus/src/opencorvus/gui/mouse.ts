import { Log } from "../../util/log"

/** Ensure thrown value is always a proper Error object */
function asError(e: unknown): Error {
  if (e instanceof Error) return e
  return new Error(typeof e === "string" ? e : JSON.stringify(e))
}

export namespace Mouse {
  const log = Log.create({ service: "opencorvus-mouse" })
  const LEFT_DOWN = 0x0002
  const LEFT_UP = 0x0004
  const RIGHT_DOWN = 0x0008
  const RIGHT_UP = 0x0010
  const MIDDLE_DOWN = 0x0020
  const MIDDLE_UP = 0x0040
  const WHEEL = 0x0800
  const WHEEL_DELTA = 120

  let user32: ReturnType<(typeof import("bun:ffi"))["dlopen"]> | undefined

  async function win32() {
    if (process.platform !== "win32") return undefined
    if (user32) return user32
    const ffi = await import("bun:ffi")
    user32 = ffi.dlopen("user32.dll", {
      SetCursorPos: { args: ["i32", "i32"], returns: "i32" },
      mouse_event: { args: ["u32", "u32", "u32", "u32", "u32"], returns: "void" },
    })
    return user32
  }

  async function winMove(x: number, y: number) {
    const api = await win32()
    if (!api) return false
    const set = api.symbols.SetCursorPos as unknown as (x: number, y: number) => number
    const ok = set(x, y)
    if (ok === 0) {
      log.warn("win32 SetCursorPos failed; falling back to nut-js", { x, y })
      return false
    }
    return true
  }

  async function winMouse(flags: number, data = 0) {
    const api = await win32()
    if (!api) return false
    const send = api.symbols.mouse_event as unknown as (
      flags: number,
      dx: number,
      dy: number,
      data: number,
      extra: number,
    ) => void
    send(flags, 0, 0, data, 0)
    return true
  }

  function sleep(ms: number) {
    return new Promise((done) => setTimeout(done, ms))
  }

  async function moveToPosition(x: number, y: number): Promise<void> {
    if (await winMove(x, y)) return
    const { mouse, Point } = await import("@nut-tree-fork/nut-js")
    // Use setPosition for instant move — more reliable than straightTo+move path animation
    await mouse.setPosition(new Point(x, y))
  }

  export async function click(x: number, y: number): Promise<void> {
    try {
      if (await winMove(x, y)) {
        await winMouse(LEFT_DOWN | LEFT_UP)
        log.info("clicked", { x, y, backend: "win32" })
        return
      }
      const { mouse } = await import("@nut-tree-fork/nut-js")
      await moveToPosition(x, y)
      await mouse.leftClick()
      log.info("clicked", { x, y })
    } catch (e) {
      const err = asError(e)
      log.error("click failed", { x, y, errorName: err.name, error: err.message, stack: err.stack, rawType: typeof e })
      throw err
    }
  }

  export async function doubleClick(x: number, y: number): Promise<void> {
    try {
      if (await winMove(x, y)) {
        await winMouse(LEFT_DOWN | LEFT_UP)
        await sleep(40)
        await winMouse(LEFT_DOWN | LEFT_UP)
        log.info("double clicked", { x, y, backend: "win32" })
        return
      }
      const { mouse, Button } = await import("@nut-tree-fork/nut-js")
      await moveToPosition(x, y)
      await mouse.doubleClick(Button.LEFT)
      log.info("double clicked", { x, y })
    } catch (e) {
      const err = asError(e)
      log.error("doubleClick failed", {
        x,
        y,
        errorName: err.name,
        error: err.message,
        stack: err.stack,
        rawType: typeof e,
      })
      throw err
    }
  }

  export async function rightClick(x: number, y: number): Promise<void> {
    try {
      if (await winMove(x, y)) {
        await winMouse(RIGHT_DOWN | RIGHT_UP)
        log.info("right clicked", { x, y, backend: "win32" })
        return
      }
      const { mouse } = await import("@nut-tree-fork/nut-js")
      await moveToPosition(x, y)
      await mouse.rightClick()
      log.info("right clicked", { x, y })
    } catch (e) {
      const err = asError(e)
      log.error("rightClick failed", {
        x,
        y,
        errorName: err.name,
        error: err.message,
        stack: err.stack,
        rawType: typeof e,
      })
      throw err
    }
  }

  export async function middleClick(x: number, y: number): Promise<void> {
    try {
      if (await winMove(x, y)) {
        await winMouse(MIDDLE_DOWN | MIDDLE_UP)
        log.info("middle clicked", { x, y, backend: "win32" })
        return
      }
      const { mouse, Button } = await import("@nut-tree-fork/nut-js")
      await moveToPosition(x, y)
      await mouse.click(Button.MIDDLE)
      log.info("middle clicked", { x, y })
    } catch (e) {
      const err = asError(e)
      log.error("middleClick failed", {
        x,
        y,
        errorName: err.name,
        error: err.message,
        stack: err.stack,
        rawType: typeof e,
      })
      throw err
    }
  }

  export async function scroll(direction: "up" | "down", amount: number = 3): Promise<void> {
    try {
      const delta = direction === "up" ? WHEEL_DELTA * amount : -WHEEL_DELTA * amount
      if (await winMouse(WHEEL, delta)) {
        log.info("scrolled", { direction, amount, backend: "win32" })
        return
      }
      const { mouse } = await import("@nut-tree-fork/nut-js")
      if (direction === "up") {
        await mouse.scrollUp(amount)
      } else {
        await mouse.scrollDown(amount)
      }
      log.info("scrolled", { direction, amount })
    } catch (e) {
      const err = asError(e)
      log.error("scroll failed", {
        direction,
        amount,
        errorName: err.name,
        error: err.message,
        stack: err.stack,
        rawType: typeof e,
      })
      throw err
    }
  }

  export async function moveTo(x: number, y: number): Promise<void> {
    try {
      await moveToPosition(x, y)
      log.info("moved to", { x, y })
    } catch (e) {
      const err = asError(e)
      log.error("moveTo failed", { x, y, errorName: err.name, error: err.message, stack: err.stack, rawType: typeof e })
      throw err
    }
  }

  export async function drag(startX: number, startY: number, endX: number, endY: number): Promise<void> {
    try {
      if (await winMove(startX, startY)) {
        await winMouse(LEFT_DOWN)
        const steps = 18
        for (let i = 1; i <= steps; i++) {
          const x = Math.round(startX + ((endX - startX) * i) / steps)
          const y = Math.round(startY + ((endY - startY) * i) / steps)
          await winMove(x, y)
          await sleep(6)
        }
        await winMouse(LEFT_UP)
        log.info("dragged", { startX, startY, endX, endY, backend: "win32" })
        return
      }
      const { mouse, straightTo, Point } = await import("@nut-tree-fork/nut-js")
      await moveToPosition(startX, startY)
      await mouse.drag(straightTo(new Point(endX, endY)))
      log.info("dragged", { startX, startY, endX, endY })
    } catch (e) {
      const err = asError(e)
      log.error("drag failed", {
        startX,
        startY,
        endX,
        endY,
        errorName: err.name,
        error: err.message,
        stack: err.stack,
        rawType: typeof e,
      })
      throw err
    }
  }
}
