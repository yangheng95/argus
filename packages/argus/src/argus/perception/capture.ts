import { Log } from "../../util/log"
import { Global } from "../../global"
import { Filesystem } from "../../util/filesystem"
import path from "path"

export namespace Capture {
  const log = Log.create({ service: "argus-capture" })

  export interface CaptureResult {
    path: string
    width: number
    height: number
    buffer: Buffer
    timestamp: number
  }

  export interface CaptureOptions {
    mode: "window" | "fullscreen"
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
      if (options.mode === "window" && options.windowTitle) {
        return await captureWindow(options.windowTitle, filePath, timestamp)
      }
      return await captureFullscreen(filePath, timestamp)
    } catch (e) {
      log.warn("capture failed, falling back to fullscreen", {
        error: e instanceof Error ? e.message : String(e),
      })
      return await captureFullscreen(filePath, timestamp)
    }
  }

  async function captureWindow(title: string, filePath: string, timestamp: number): Promise<CaptureResult> {
    const { Monitor } = await import("node-screenshots")
    const monitors = Monitor.all()

    for (const monitor of monitors) {
      const image = monitor.captureImageSync()
      const buffer = Buffer.from(image.toPngSync())
      await Filesystem.write(filePath, buffer, undefined)

      log.info("captured window (fullscreen fallback)", {
        path: filePath,
        width: image.width,
        height: image.height,
      })

      return {
        path: filePath,
        width: image.width,
        height: image.height,
        buffer,
        timestamp,
      }
    }

    throw new Error(`No monitors found for window: ${title}`)
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
      timestamp,
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
