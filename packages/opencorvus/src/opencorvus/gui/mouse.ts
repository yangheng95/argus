import { Log } from "../../util/log"

/** Ensure thrown value is always a proper Error object */
function asError(e: unknown): Error {
  if (e instanceof Error) return e
  return new Error(typeof e === "string" ? e : JSON.stringify(e))
}

export namespace Mouse {
  const log = Log.create({ service: "opencorvus-mouse" })

  async function moveToPosition(x: number, y: number): Promise<void> {
    const { mouse, Point } = await import("@nut-tree-fork/nut-js")
    // Use setPosition for instant move — more reliable than straightTo+move path animation
    await mouse.setPosition(new Point(x, y))
  }

  export async function click(x: number, y: number): Promise<void> {
    try {
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
      const { mouse, Button } = await import("@nut-tree-fork/nut-js")
      await moveToPosition(x, y)
      await mouse.doubleClick(Button.LEFT)
      log.info("double clicked", { x, y })
    } catch (e) {
      const err = asError(e)
      log.error("doubleClick failed", { x, y, errorName: err.name, error: err.message, stack: err.stack, rawType: typeof e })
      throw err
    }
  }

  export async function rightClick(x: number, y: number): Promise<void> {
    try {
      const { mouse } = await import("@nut-tree-fork/nut-js")
      await moveToPosition(x, y)
      await mouse.rightClick()
      log.info("right clicked", { x, y })
    } catch (e) {
      const err = asError(e)
      log.error("rightClick failed", { x, y, errorName: err.name, error: err.message, stack: err.stack, rawType: typeof e })
      throw err
    }
  }

  export async function middleClick(x: number, y: number): Promise<void> {
    try {
      const { mouse, Button } = await import("@nut-tree-fork/nut-js")
      await moveToPosition(x, y)
      await mouse.click(Button.MIDDLE)
      log.info("middle clicked", { x, y })
    } catch (e) {
      const err = asError(e)
      log.error("middleClick failed", { x, y, errorName: err.name, error: err.message, stack: err.stack, rawType: typeof e })
      throw err
    }
  }

  export async function scroll(direction: "up" | "down", amount: number = 3): Promise<void> {
    try {
      const { mouse } = await import("@nut-tree-fork/nut-js")
      if (direction === "up") {
        await mouse.scrollUp(amount)
      } else {
        await mouse.scrollDown(amount)
      }
      log.info("scrolled", { direction, amount })
    } catch (e) {
      const err = asError(e)
      log.error("scroll failed", { direction, amount, errorName: err.name, error: err.message, stack: err.stack, rawType: typeof e })
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
      const { mouse, straightTo, Point } = await import("@nut-tree-fork/nut-js")
      await moveToPosition(startX, startY)
      await mouse.drag(straightTo(new Point(endX, endY)))
      log.info("dragged", { startX, startY, endX, endY })
    } catch (e) {
      const err = asError(e)
      log.error("drag failed", { startX, startY, endX, endY, errorName: err.name, error: err.message, stack: err.stack, rawType: typeof e })
      throw err
    }
  }
}
