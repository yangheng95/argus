import { Log } from "../../util/log"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import { WindowManager } from "./window"
import path from "path"

export namespace Capture {
  const log = Log.create({ service: "argus-capture" })

  export interface WindowBounds {
    x: number
    y: number
    width: number
    height: number
  }

  export interface CaptureResult {
    path: string
    width: number
    height: number
    buffer: Buffer
    rawBuffer?: Buffer
    timestamp: number
    windowBounds: WindowBounds | null
  }

  export interface CaptureOptions {
    mode: "window" | "fullscreen" | "auto"
    windowTitle?: string
    outputDir?: string
  }

  function getOutputDir(outputDir?: string): string {
    return outputDir ?? path.join(Global.Path.data, "argus", "screenshots")
  }

  export async function take(options: CaptureOptions): Promise<CaptureResult> {
    const outputDir = getOutputDir(options.outputDir)
    await Filesystem.write(path.join(outputDir, ".keep"), "", undefined)

    const timestamp = Date.now()
    const filename = `capture_${timestamp}.png`
    const filePath = path.join(outputDir, filename)

    try {
      if (options.mode === "auto") {
        const binding = await WindowManager.getBinding()
        if (binding && !binding.info.isMinimized) {
          return await captureWindowById(binding.windowId, binding.info, filePath, timestamp)
        }
        return await captureFullscreen(filePath, timestamp)
      }

      if (options.mode === "window" && options.windowTitle) {
        const info = await WindowManager.findWindow(options.windowTitle)
        if (info) {
          return await captureWindowById(info.id, info, filePath, timestamp)
        }
        log.warn("window not found, falling back to fullscreen", { windowTitle: options.windowTitle })
        return await captureFullscreen(filePath, timestamp)
      }

      return await captureFullscreen(filePath, timestamp)
    } catch (e) {
      log.warn("capture failed, falling back to fullscreen", {
        error: e instanceof Error ? e.message : String(e),
      })
      return await captureFullscreen(filePath, timestamp)
    }
  }

  async function captureWindowById(
    windowId: number,
    info: WindowManager.WindowInfo,
    filePath: string,
    timestamp: number,
  ): Promise<CaptureResult> {
    const native = await WindowManager.getNativeWindow(windowId)
    if (!native) {
      throw new Error(`Window with id ${windowId} no longer exists`)
    }

    const image = native.captureImageSync()
    const buffer = Buffer.from(image.toPngSync())
    const rawBuffer = Buffer.from(image.toRawSync())
    await Filesystem.write(filePath, buffer, undefined)

    const bounds: WindowBounds = {
      x: native.x(),
      y: native.y(),
      width: image.width,
      height: image.height,
    }

    log.info("captured window", {
      path: filePath,
      windowId,
      title: info.title,
      width: image.width,
      height: image.height,
      bounds,
    })

    return {
      path: filePath,
      width: image.width,
      height: image.height,
      buffer,
      rawBuffer,
      timestamp,
      windowBounds: bounds,
    }
  }

  async function captureFullscreen(filePath: string, timestamp: number): Promise<CaptureResult> {
    const { Monitor } = await import("node-screenshots")
    const monitors = Monitor.all()

    if (monitors.length === 0) {
      throw new Error("No monitors found")
    }

    const primary = monitors[0]
    const image = primary.captureImageSync()
    const buffer = Buffer.from(image.toPngSync())
    const rawBuffer = Buffer.from(image.toRawSync())
    await Filesystem.write(filePath, buffer, undefined)

    log.info("captured fullscreen", {
      path: filePath,
      width: image.width,
      height: image.height,
    })

    return {
      path: filePath,
      width: image.width,
      height: image.height,
      buffer,
      rawBuffer,
      timestamp,
      windowBounds: null,
    }
  }

  export async function cleanup(outputDir?: string, maxScreenshots?: number) {
    const dir = getOutputDir(outputDir)
    const max = maxScreenshots ?? 100

    try {
      const { glob } = await import("glob")
      const files = await glob(path.join(dir, "capture_*.png").replace(/\\/g, "/"))
      if (files.length <= max) return

      const sorted = files.sort()
      const toDelete = sorted.slice(0, files.length - max)

      for (const file of toDelete) {
        const fs = await import("fs/promises")
        await fs.unlink(file).catch(() => {})
      }

      log.info("cleaned up screenshots", { deleted: toDelete.length })
    } catch {
      // Directory might not exist yet
    }
  }
}
