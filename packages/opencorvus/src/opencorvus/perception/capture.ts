import { Log } from "../../util/log"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import { WindowManager } from "./window"
import path from "path"

export namespace Capture {
  const log = Log.create({ service: "opencorvus-capture" })

  export interface WindowBounds {
    x: number
    y: number
    width: number
    height: number
    scaleX?: number
    scaleY?: number
    logicalX?: number
    logicalY?: number
    logicalWidth?: number
    logicalHeight?: number
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
    return outputDir ?? path.join(Global.Path.data, "opencorvus", "screenshots")
  }

  export function scaleWindowBounds(input: {
    logicalX: number
    logicalY: number
    logicalWidth: number
    logicalHeight: number
    imageWidth: number
    imageHeight: number
  }): WindowBounds {
    const logicalX = Number.isFinite(input.logicalX) ? input.logicalX : 0
    const logicalY = Number.isFinite(input.logicalY) ? input.logicalY : 0
    const logicalWidth = Number.isFinite(input.logicalWidth) ? input.logicalWidth : 0
    const logicalHeight = Number.isFinite(input.logicalHeight) ? input.logicalHeight : 0
    const imageWidth = Number.isFinite(input.imageWidth) && input.imageWidth > 0 ? input.imageWidth : 1
    const imageHeight = Number.isFinite(input.imageHeight) && input.imageHeight > 0 ? input.imageHeight : 1
    const rawScaleX = logicalWidth > 0 ? imageWidth / logicalWidth : 1
    const rawScaleY = logicalHeight > 0 ? imageHeight / logicalHeight : 1
    const scaleX = Number.isFinite(rawScaleX) && rawScaleX > 0 ? rawScaleX : 1
    const scaleY = Number.isFinite(rawScaleY) && rawScaleY > 0 ? rawScaleY : 1

    return {
      x: Math.round(logicalX * scaleX),
      y: Math.round(logicalY * scaleY),
      width: imageWidth,
      height: imageHeight,
      scaleX,
      scaleY,
      logicalX,
      logicalY,
      logicalWidth,
      logicalHeight,
    }
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

    const image = await native.captureImage()
    const buffer = Buffer.from(await image.toPng())
    const rawBuffer = Buffer.from(await image.toRaw())
    await Filesystem.write(filePath, buffer, undefined)

    const logicalX = native.x()
    const logicalY = native.y()
    const logicalWidth = native.width()
    const logicalHeight = native.height()
    const bounds = scaleWindowBounds({
      logicalX,
      logicalY,
      logicalWidth,
      logicalHeight,
      imageWidth: image.width,
      imageHeight: image.height,
    })

    log.info("captured window", {
      path: filePath,
      windowId,
      title: info.title,
      width: image.width,
      height: image.height,
      bounds,
      logicalBounds: `${bounds.logicalWidth}x${bounds.logicalHeight}@${logicalX},${logicalY}`,
      pixelScale: `${(bounds.scaleX ?? 1).toFixed(3)}x${(bounds.scaleY ?? 1).toFixed(3)}`,
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
    const { Monitor, Window } = await import("node-screenshots")
    const monitors = Monitor.all()

    if (monitors.length === 0) {
      throw new Error("No monitors found")
    }

    const focused = Window.all().find((w) => w.isFocused() && !w.isMinimized())
    const target = focused?.currentMonitor()
      ?? monitors.find((m) => m.isPrimary())
      ?? monitors[0]
    const source = focused ? "focused-window-monitor" : target.isPrimary() ? "primary-monitor" : "first-monitor"

    const image = await target.captureImage()
    const buffer = Buffer.from(await image.toPng())
    const rawBuffer = Buffer.from(await image.toRaw())
    await Filesystem.write(filePath, buffer, undefined)

    const logicalX = target.x()
    const logicalY = target.y()
    const logicalWidth = target.width()
    const logicalHeight = target.height()
    const bounds = scaleWindowBounds({
      logicalX,
      logicalY,
      logicalWidth,
      logicalHeight,
      imageWidth: image.width,
      imageHeight: image.height,
    })

    log.info("captured fullscreen", {
      path: filePath,
      width: image.width,
      height: image.height,
      monitor: {
        id: target.id(),
        name: target.name(),
        x: logicalX,
        y: logicalY,
        width: logicalWidth,
        height: logicalHeight,
        isPrimary: target.isPrimary(),
        scaleFactor: target.scaleFactor(),
      },
      source,
      focusedWindow: focused
        ? {
            id: focused.id(),
            title: focused.title(),
            appName: focused.appName(),
          }
        : null,
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
        await fs.unlink(file).catch((err) => {
          log.warn("failed to delete screenshot", { file, error: err instanceof Error ? err.message : String(err) })
        })
      }

      log.info("cleaned up screenshots", { deleted: toDelete.length })
    } catch (err) {
      // Directory might not exist yet — only log unexpected errors
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("cleanup failed", { error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
}
