import z from "zod"
import { BusEvent } from "../../bus/bus-event"

export const MonitorEvent = {
  Started: BusEvent.define(
    "monitor.started",
    z.object({
      captureInterval: z.number(),
      diffThreshold: z.number(),
      autonomyLevel: z.number(),
    }),
  ),

  Stopped: BusEvent.define(
    "monitor.stopped",
    z.object({
      reason: z.string().optional(),
    }),
  ),

  Paused: BusEvent.define("monitor.paused", z.object({})),

  Resumed: BusEvent.define("monitor.resumed", z.object({})),

  CaptureCompleted: BusEvent.define(
    "monitor.capture.completed",
    z.object({
      timestamp: z.number(),
      width: z.number(),
      height: z.number(),
      path: z.string(),
    }),
  ),

  ChangeDetected: BusEvent.define(
    "monitor.change.detected",
    z.object({
      diffPercent: z.number(),
      diffPixels: z.number(),
      totalPixels: z.number(),
      timestamp: z.number(),
    }),
  ),

  ChangeNone: BusEvent.define(
    "monitor.change.none",
    z.object({
      timestamp: z.number(),
    }),
  ),

  VisionAnalysis: BusEvent.define(
    "monitor.vision.analysis",
    z.object({
      timestamp: z.number(),
      description: z.string(),
      changeType: z.string(),
      severity: z.string(),
      regions: z.array(
        z.object({
          x: z.number(),
          y: z.number(),
          w: z.number(),
          h: z.number(),
          label: z.string(),
        }),
      ),
    }),
  ),

  BrainDecision: BusEvent.define(
    "monitor.brain.decision",
    z.object({
      action: z.string(),
      reasoning: z.string(),
      timestamp: z.number(),
    }),
  ),

  BrainAction: BusEvent.define(
    "monitor.brain.action",
    z.object({
      action: z.string(),
      result: z.string().optional(),
      timestamp: z.number(),
    }),
  ),

  CommandStaged: BusEvent.define(
    "monitor.command.staged",
    z.object({
      id: z.string(),
      priority: z.string(),
      source: z.string(),
      content: z.string(),
      timestamp: z.number(),
    }),
  ),

  CommandProcessed: BusEvent.define(
    "monitor.command.processed",
    z.object({
      id: z.string(),
      result: z.string().optional(),
      timestamp: z.number(),
    }),
  ),

  Anomaly: BusEvent.define(
    "monitor.anomaly",
    z.object({
      message: z.string(),
      severity: z.string(),
      timestamp: z.number(),
    }),
  ),
}
