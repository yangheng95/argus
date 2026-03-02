import { Instance } from "../project/instance"

export interface ActionRecord {
  step: number
  time: number
  tool: string
  action: string
  coords?: { x: number; y: number }
  detail: string
  screenshotHashAfter: string | null
  screenChanged: boolean | null
}

export interface ScreenshotRecord {
  hash: string
  step: number
  description: string | null
  width: number
  height: number
  seenCount: number
}

interface GuiSessionState {
  actions: ActionRecord[]
  screenshots: Map<string, ScreenshotRecord>
  currentStep: number
  taskEpoch: number
  lastScreenshotHash: string | null
  isGuiSession: boolean
  repetition: {
    consecutiveNoChange: number
    recentClickCoords: Array<{ x: number; y: number; step: number }>
  }
}

const MAX_ACTIONS = 60
const MAX_SCREENSHOTS = 30
const MAX_CLICK_COORDS = 20

const guiState = Instance.state(
  (): GuiSessionState => ({
    actions: [],
    screenshots: new Map(),
    currentStep: 0,
    taskEpoch: 0,
    lastScreenshotHash: null,
    isGuiSession: false,
    repetition: {
      consecutiveNoChange: 0,
      recentClickCoords: [],
    },
  }),
)

export namespace GuiState {
  export function get(): GuiSessionState {
    return guiState()
  }

  export function setStep(step: number): void {
    const s = guiState()
    if (!s.isGuiSession) return
    s.currentStep = step
  }

  export function markNewTask(): void {
    const s = guiState()
    if (!s.isGuiSession) return
    s.taskEpoch++
    s.currentStep = 0
  }

  export function activate(): void {
    guiState().isGuiSession = true
  }

  export function recordAction(record: Omit<ActionRecord, "step">): void {
    const s = guiState()
    if (!s.isGuiSession) return
    const entry: ActionRecord = { ...record, step: s.currentStep }
    s.actions.push(entry)
    if (s.actions.length > MAX_ACTIONS) {
      s.actions = s.actions.slice(-MAX_ACTIONS)
    }
  }

  export function recordScreenshot(hash: string, width: number, height: number, unchanged: boolean): void {
    const s = guiState()
    if (!s.isGuiSession) return

    const existing = s.screenshots.get(hash)
    if (existing) {
      existing.seenCount++
      existing.step = s.currentStep
    } else {
      s.screenshots.set(hash, {
        hash,
        step: s.currentStep,
        description: null,
        width,
        height,
        seenCount: 1,
      })
      // Evict oldest entries if over limit
      if (s.screenshots.size > MAX_SCREENSHOTS) {
        const entries = Array.from(s.screenshots.entries())
        entries.sort((a, b) => a[1].step - b[1].step)
        while (s.screenshots.size > MAX_SCREENSHOTS) {
          s.screenshots.delete(entries.shift()![0])
        }
      }
    }

    s.lastScreenshotHash = hash
  }

  export function captureDescription(hash: string, text: string): void {
    const s = guiState()
    if (!s.isGuiSession) return
    const record = s.screenshots.get(hash)
    if (record) {
      // Keep the longest description (model may produce multiple text blocks)
      if (!record.description || text.length > record.description.length) {
        record.description = text
      }
    }
  }

  export function getDescription(hash: string): string | null {
    return guiState().screenshots.get(hash)?.description ?? null
  }

  export function updateRepetition(screenChanged: boolean | null, coords?: { x: number; y: number }): void {
    const s = guiState()
    if (!s.isGuiSession) return

    if (screenChanged === false) {
      s.repetition.consecutiveNoChange++
    } else if (screenChanged === true) {
      s.repetition.consecutiveNoChange = 0
    }
    // null = non-screenshot action, don't change counter

    if (coords) {
      s.repetition.recentClickCoords.push({ ...coords, step: s.currentStep })
      if (s.repetition.recentClickCoords.length > MAX_CLICK_COORDS) {
        s.repetition.recentClickCoords = s.repetition.recentClickCoords.slice(-MAX_CLICK_COORDS)
      }
    }
  }

  export function buildActionSummary(maxSteps?: number): string {
    const s = guiState()
    if (!s.isGuiSession || s.actions.length === 0) return ""

    const limit = maxSteps ?? 30
    const recentActions = s.actions.slice(-limit)

    // Group actions by step
    const stepGroups = new Map<number, ActionRecord[]>()
    for (const action of recentActions) {
      const group = stepGroups.get(action.step) ?? []
      group.push(action)
      stepGroups.set(action.step, group)
    }

    const lines: string[] = []
    for (const [step, actions] of stepGroups) {
      const parts = actions.map((a) => {
        let desc = `${a.tool}.${a.action}`
        if (a.action === "screenshot") {
          desc += a.screenChanged === false ? " [NO CHANGE]" : a.screenChanged === true ? " [changed]" : ""
        } else if (a.coords) {
          desc += ` (${a.coords.x},${a.coords.y})`
        }
        if (a.detail && a.action !== "screenshot") {
          desc += ` ${a.detail}`
        }
        return desc
      })
      lines.push(`Step ${step}: ${parts.join(" → ")}`)
    }

    const result = ["<gui-action-history>", ...lines]

    if (s.repetition.consecutiveNoChange >= 3) {
      result.push(`⚠ WARNING: ${s.repetition.consecutiveNoChange} consecutive actions with NO screen change`)
    }

    result.push("</gui-action-history>")
    return result.join("\n")
  }

  export function lastActionCoords(): { x: number; y: number } | null {
    const s = guiState()
    for (let i = s.actions.length - 1; i >= 0; i--) {
      if (s.actions[i].coords) return s.actions[i].coords!
    }
    return null
  }

  export function checkRepetition(): string | null {
    const s = guiState()
    if (!s.isGuiSession) return null

    const alerts: string[] = []

    // Signal 1: consecutive no-change
    if (s.repetition.consecutiveNoChange >= 4) {
      alerts.push(
        `STOP: You have performed ${s.repetition.consecutiveNoChange} actions with NO screen change.`,
        `The UI is NOT responding to your actions. Do NOT repeat the same action.`,
      )
    }

    // Signal 2: same-area repeated clicks (within 30px radius, last 8 steps)
    const recentClicks = s.repetition.recentClickCoords.filter(
      (c) => c.step >= s.currentStep - 8,
    )
    if (recentClicks.length >= 4) {
      // Check if 4+ clicks cluster within 30px of each other
      for (let i = 0; i < recentClicks.length; i++) {
        const center = recentClicks[i]
        const nearby = recentClicks.filter(
          (c) => Math.abs(c.x - center.x) <= 30 && Math.abs(c.y - center.y) <= 30,
        )
        if (nearby.length >= 4) {
          alerts.push(
            `STOP: You have clicked the same area (${center.x},${center.y}) ${nearby.length} times in recent steps.`,
            `The element is NOT responding to clicks.`,
          )
          break
        }
      }
    }

    // Signal 3: same screenshot hash appearing too many times
    for (const [, record] of s.screenshots) {
      if (record.seenCount >= 4 && record.step >= s.currentStep - 10) {
        alerts.push(
          `STOP: The same screenshot has appeared ${record.seenCount} times. The screen is not changing.`,
        )
        break
      }
    }

    if (alerts.length === 0) return null

    return [
      "<gui-repetition-alert>",
      ...alerts,
      "Try: (1) Click a different element (2) Use keyboard shortcut (Tab+Enter)",
      "(3) Press Esc to dismiss hidden overlay (4) Use list_windows to check for new dialogs",
      "(5) Try a completely different approach to accomplish your goal",
      "</gui-repetition-alert>",
    ].join("\n")
  }
}
