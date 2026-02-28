import { Instance } from "../../project/instance"
import { Bus } from "../../bus"
import { Log } from "../../util/log"
import { Capture } from "../perception/capture"
import { ScreenDiff, type ScreenDiff as ScreenDiffNS } from "../perception/diff"
import { MonitorEvent } from "./events"
import { resolveConfig, type MonitorConfig, type MonitorState } from "./types"

export namespace Monitor {
  const log = Log.create({ service: "monitor" })

  interface CaptureData {
    rawBuffer: Buffer
    width: number
    height: number
    timestamp: number
    pngBuffer: Buffer
    path: string
  }

  interface MonitorStateData {
    status: MonitorState
    abort: AbortController | null
    config: MonitorConfig | null
    previousCapture: CaptureData | null
    captureTimer: ReturnType<typeof setInterval> | null
    processing: boolean
  }

  function teardownState(s: MonitorStateData) {
    if (s.captureTimer) {
      clearInterval(s.captureTimer)
      s.captureTimer = null
    }
    if (s.abort) {
      s.abort.abort()
      s.abort = null
    }
    s.status = "stopped"
    s.previousCapture = null
    s.processing = false
  }

  async function dispose(s: MonitorStateData) {
    teardownState(s)
  }

  const state = Instance.state(
    (): MonitorStateData => ({
      status: "stopped",
      abort: null,
      config: null,
      previousCapture: null,
      captureTimer: null,
      processing: false,
    }),
    dispose,
  )

  export async function start(overrides?: Partial<MonitorConfig>): Promise<void> {
    const s = state()

    if (s.status === "running") {
      log.warn("monitor already running")
      return
    }

    const config = resolveConfig(overrides)
    s.config = config
    s.abort = new AbortController()
    s.status = "running"
    s.previousCapture = null
    s.processing = false

    log.info("monitor starting", {
      captureInterval: config.captureInterval,
      diffThreshold: config.diffThreshold,
      autonomyLevel: config.autonomyLevel,
      captureMode: config.captureMode,
      brainEnabled: config.brainEnabled,
    })

    await Bus.publish(MonitorEvent.Started, {
      captureInterval: config.captureInterval,
      diffThreshold: config.diffThreshold,
      autonomyLevel: config.autonomyLevel,
    })

    // Start capture loop
    s.captureTimer = setInterval(() => {
      void tick()
    }, config.captureInterval)

    // Perform first capture immediately
    void tick()
  }

  export async function stop(): Promise<void> {
    const s = state()

    if (s.status === "stopped") {
      log.warn("monitor already stopped")
      return
    }

    log.info("monitor stopping")

    teardownState(s)

    // Clear Brain's module-level action history so stale entries do not bleed
    // into the next session (workaround until Brain adopts per-session state).
    const { Brain } = await import("../brain")
    Brain.reset()

    await Bus.publish(MonitorEvent.Stopped, { reason: "manual" })
  }

  export async function pause(): Promise<void> {
    const s = state()

    if (s.status !== "running") {
      log.warn("monitor not running, cannot pause")
      return
    }

    s.status = "paused"
    log.info("monitor paused")
    await Bus.publish(MonitorEvent.Paused, {})
  }

  export async function resume(): Promise<void> {
    const s = state()

    if (s.status !== "paused") {
      log.warn("monitor not paused, cannot resume")
      return
    }

    s.status = "running"
    log.info("monitor resumed")
    await Bus.publish(MonitorEvent.Resumed, {})
  }

  export function status(): {
    state: MonitorState
    config: MonitorConfig | null
  } {
    const s = state()
    return {
      state: s.status,
      config: s.config,
    }
  }

  async function tick(): Promise<void> {
    const s = state()

    // Skip if paused, stopped, or already processing
    if (s.status !== "running" || s.processing) return

    s.processing = true

    try {
      const config = s.config
      if (!config) return

      // Check abort signal
      if (s.abort?.signal.aborted) return

      // Capture screenshot
      const capture = await Capture.take({
        mode: config.captureMode === "window" ? "window" : "fullscreen",
        windowTitle: config.windowTitle,
        outputDir: config.screenshotDir,
      })

      if (!capture.rawBuffer) {
        log.warn("capture did not produce rawBuffer, skipping diff")
        return
      }

      const currentData: CaptureData = {
        rawBuffer: capture.rawBuffer,
        width: capture.width,
        height: capture.height,
        timestamp: capture.timestamp,
        pngBuffer: capture.buffer,
        path: capture.path,
      }

      await Bus.publish(MonitorEvent.CaptureCompleted, {
        timestamp: capture.timestamp,
        width: capture.width,
        height: capture.height,
        path: capture.path,
      })

      // First capture — just store it
      if (!s.previousCapture) {
        s.previousCapture = currentData
        log.info("first capture stored", {
          width: capture.width,
          height: capture.height,
        })
        return
      }

      // Compare with previous capture
      const diffResult = await ScreenDiff.compare(
        {
          rawBuffer: s.previousCapture.rawBuffer,
          width: s.previousCapture.width,
          height: s.previousCapture.height,
          timestamp: s.previousCapture.timestamp,
        },
        {
          rawBuffer: currentData.rawBuffer,
          width: currentData.width,
          height: currentData.height,
          timestamp: currentData.timestamp,
        },
        { diffThreshold: config.diffThreshold },
      )

      if (!diffResult.changed) {
        await Bus.publish(MonitorEvent.ChangeNone, {
          timestamp: currentData.timestamp,
        })
        // Still update previous capture to keep reference fresh
        s.previousCapture = currentData
        return
      }

      // Change detected
      log.info("change detected", {
        diffPercent: diffResult.diffPercent.toFixed(2),
        diffPixels: diffResult.diffPixels,
      })

      await Bus.publish(MonitorEvent.ChangeDetected, {
        diffPercent: diffResult.diffPercent,
        diffPixels: diffResult.diffPixels,
        totalPixels: diffResult.totalPixels,
        timestamp: currentData.timestamp,
      })

      // If brain is enabled, delegate analysis
      if (config.brainEnabled && s.abort && !s.abort.signal.aborted) {
        try {
          const { Brain } = await import("../brain")
          await Brain.processChange({
            screenshot: currentData.pngBuffer,
            diffResult,
            config,
            abort: s.abort.signal,
          })
        } catch (err) {
          log.error("brain processing failed", {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      // Cleanup old screenshots
      await Capture.cleanup(config.screenshotDir, config.maxScreenshots).catch(() => {})

      // Update previous capture
      s.previousCapture = currentData
    } catch (err) {
      log.error("tick failed", {
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      s.processing = false
    }
  }
}
