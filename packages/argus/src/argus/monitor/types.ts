import { Flag } from "../../flag/flag"

export type MonitorState = "stopped" | "running" | "paused"
export type AutonomyLevel = 0 | 1 | 2 | 3

export interface MonitorConfig {
  enabled: boolean
  captureInterval: number
  diffThreshold: number
  autonomyLevel: AutonomyLevel
  captureMode: "window" | "fullscreen"
  windowTitle?: string
  maxScreenshots: number
  screenshotDir?: string
  visionModel?: { providerID: string; modelID: string }
  brainModel?: { providerID: string; modelID: string }
  brainEnabled: boolean
}

export interface DiffResult {
  changed: boolean
  diffPixels: number
  diffPercent: number
  totalPixels: number
  previousTimestamp: number
  currentTimestamp: number
}

export interface VisionAnalysis {
  timestamp: number
  description: string
  changeType:
    | "ui_update"
    | "content_change"
    | "error_appeared"
    | "dialog"
    | "notification"
    | "navigation"
    | "unknown"
  severity: "low" | "medium" | "high" | "critical"
  regions: Array<{ x: number; y: number; w: number; h: number; label: string }>
  rawScreenshot: Buffer
}

export interface StagedCommand {
  id: string
  timestamp: number
  priority: "urgent" | "high" | "normal" | "low"
  source: "user" | "system"
  content: string
}

export interface BrainDecision {
  action:
    | "analyze_change"
    | "execute_command"
    | "suggest_action"
    | "auto_execute"
    | "ask_user"
    | "wait"
  reasoning: string
  toolCalls?: string[]
  suggestion?: string
  commandID?: string
}

function parseModel(value: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!value) return undefined
  const parts = value.split("/")
  if (parts.length < 2) return undefined
  return { providerID: parts[0], modelID: parts.slice(1).join("/") }
}

function clampAutonomy(value: number | undefined): AutonomyLevel {
  if (value === undefined) return 0
  if (value <= 0) return 0
  if (value >= 3) return 3
  return value as AutonomyLevel
}

export function resolveConfig(overrides?: Partial<MonitorConfig>): MonitorConfig {
  return {
    enabled: overrides?.enabled ?? Flag.ARGUS_MONITOR_ENABLED,
    captureInterval: overrides?.captureInterval ?? Flag.ARGUS_MONITOR_CAPTURE_INTERVAL ?? 5000,
    diffThreshold: overrides?.diffThreshold ?? Flag.ARGUS_MONITOR_DIFF_THRESHOLD ?? 1,
    autonomyLevel: overrides?.autonomyLevel ?? clampAutonomy(Flag.ARGUS_MONITOR_AUTONOMY_LEVEL),
    captureMode:
      overrides?.captureMode ??
      ((Flag.ARGUS_MONITOR_CAPTURE_MODE === "window" ? "window" : "fullscreen") as "window" | "fullscreen"),
    windowTitle: overrides?.windowTitle ?? Flag.ARGUS_MONITOR_WINDOW_TITLE,
    maxScreenshots: overrides?.maxScreenshots ?? Flag.ARGUS_MONITOR_MAX_SCREENSHOTS ?? 100,
    screenshotDir: overrides?.screenshotDir ?? Flag.ARGUS_MONITOR_SCREENSHOT_DIR,
    visionModel: overrides?.visionModel ?? parseModel(Flag.ARGUS_MONITOR_VISION_MODEL),
    brainModel: overrides?.brainModel ?? parseModel(Flag.ARGUS_MONITOR_BRAIN_MODEL),
    brainEnabled: overrides?.brainEnabled ?? Flag.ARGUS_MONITOR_BRAIN_ENABLED,
  }
}
