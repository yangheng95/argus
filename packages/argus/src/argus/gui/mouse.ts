import { Log } from "../../util/log"

export namespace Mouse {
  const log = Log.create({ service: "argus-mouse" })

  export async function click(x: number, y: number): Promise<void> {
    try {
      const { mouse, straightTo, Point } = await import("@nut-tree-fork/nut-js")
      await mouse.move(straightTo(new Point(x, y)))
      await mouse.leftClick()
      log.info("clicked", { x, y })
    } catch (e) {
      log.error("click failed", {
        x,
        y,
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  export async function doubleClick(x: number, y: number): Promise<void> {
    try {
      const { mouse, straightTo, Point } = await import("@nut-tree-fork/nut-js")
      await mouse.move(straightTo(new Point(x, y)))
      await mouse.leftClick()
      await mouse.leftClick()
      log.info("double clicked", { x, y })
    } catch (e) {
      log.error("doubleClick failed", {
        x,
        y,
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  export async function rightClick(x: number, y: number): Promise<void> {
    try {
      const { mouse, straightTo, Point } = await import("@nut-tree-fork/nut-js")
      await mouse.move(straightTo(new Point(x, y)))
      await mouse.rightClick()
      log.info("right clicked", { x, y })
    } catch (e) {
      log.error("rightClick failed", {
        x,
        y,
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  export async function scroll(direction: "up" | "down", amount: number = 3): Promise<void> {
    try {
      const { mouse } = await import("@nut-tree-fork/nut-js")
      const scrollAmount = direction === "up" ? -amount : amount
      await mouse.scrollDown(scrollAmount)
      log.info("scrolled", { direction, amount })
    } catch (e) {
      log.error("scroll failed", {
        direction,
        amount,
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  export async function moveTo(x: number, y: number): Promise<void> {
    try {
      const { mouse, straightTo, Point } = await import("@nut-tree-fork/nut-js")
      await mouse.move(straightTo(new Point(x, y)))
      log.info("moved to", { x, y })
    } catch (e) {
      log.error("moveTo failed", {
        x,
        y,
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }
}
