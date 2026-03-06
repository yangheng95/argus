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

export interface ClickMarker {
  x: number
  y: number
  screenX: number
  screenY: number
  label: string | null
  time: number
  step: number
}

export type VerificationStatus = "pending" | "pass" | "fail" | "uncertain"
export type VerificationExpectation = "must_change" | "may_change"

export interface VerificationTarget {
  id: string | null
  center: { x: number; y: number } | null
  bbox: { x: number; y: number; width: number; height: number } | null
}

export interface VerificationRecord {
  action: string
  status: VerificationStatus
  expectation: VerificationExpectation
  detail: string | null
  coords: { x: number; y: number } | null
  target: VerificationTarget | null
  hit: boolean | null
  distanceToCenter: number | null
  distanceToBBox: number | null
  screenshotHash: string | null
  time: number
  step: number
}

export interface VerificationGate {
  reason: "verification_pending" | "verification_recovery_required"
  action: string
  status: VerificationStatus
  detail: string | null
  coords: { x: number; y: number } | null
  step: number
}

export interface VisionTarget {
  id: string
  description: string
  type: string
  x: number
  y: number
  confidence: number | null
  bbox: { x: number; y: number; width: number; height: number } | null
  screenshotHash: string
  step: number
}

interface GuiSessionState {
  actions: ActionRecord[]
  screenshots: Map<string, ScreenshotRecord>
  visionTargets: Map<string, { hash: string; step: number; items: VisionTarget[] }>
  clickMarker: ClickMarker | null
  verificationPending: VerificationRecord | null
  verificationLast: VerificationRecord | null
  currentStep: number
  taskEpoch: number
  lastScreenshotHash: string | null
  isGuiSession: boolean
  lastFocusChangeStep: number
  repetition: {
    consecutiveNoChange: number
    recentClickCoords: Array<{ x: number; y: number; step: number }>
  }
}

const MAX_ACTIONS = 60
const MAX_SCREENSHOTS = 30
const MAX_CLICK_COORDS = 20
const MAX_VISION_TARGET_GROUPS = 30

function round(value: number) {
  return Number(value.toFixed(2))
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return round(Math.hypot(a.x - b.x, a.y - b.y))
}

function toBoxDistance(point: { x: number; y: number }, box: { x: number; y: number; width: number; height: number }) {
  const minX = box.x
  const minY = box.y
  const maxX = box.x + box.width - 1
  const maxY = box.y + box.height - 1
  const dx = point.x < minX ? minX - point.x : point.x > maxX ? point.x - maxX : 0
  const dy = point.y < minY ? minY - point.y : point.y > maxY ? point.y - maxY : 0
  return round(Math.hypot(dx, dy))
}

function hit(
  target: VerificationTarget | null,
  point: { x: number; y: number } | null | undefined,
): { hit: boolean | null; distanceToCenter: number | null; distanceToBBox: number | null } {
  if (!target || !point) {
    return {
      hit: null,
      distanceToCenter: null,
      distanceToBBox: null,
    }
  }
  const distanceToCenter = target.center ? dist(point, target.center) : null
  if (target.bbox) {
    const distanceToBBox = toBoxDistance(point, target.bbox)
    return {
      hit: distanceToBBox <= 0,
      distanceToCenter,
      distanceToBBox,
    }
  }
  if (distanceToCenter !== null) {
    return {
      hit: distanceToCenter <= 8,
      distanceToCenter,
      distanceToBBox: null,
    }
  }
  return {
    hit: null,
    distanceToCenter: null,
    distanceToBBox: null,
  }
}

const guiState = Instance.state(
  (): GuiSessionState => ({
    actions: [],
    screenshots: new Map(),
    visionTargets: new Map(),
    clickMarker: null,
    verificationPending: null,
    verificationLast: null,
    currentStep: 0,
    taskEpoch: 0,
    lastScreenshotHash: null,
    isGuiSession: false,
    lastFocusChangeStep: -1,
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
    s.clickMarker = null
    s.verificationPending = null
    s.verificationLast = null
    s.visionTargets.clear()
  }

  export function activate(): void {
    guiState().isGuiSession = true
  }

  export function recordFocusChange(): void {
    const s = guiState()
    if (!s.isGuiSession) return
    s.lastFocusChangeStep = s.currentStep
    // Reset no-change counter — new window screenshot will differ
    s.repetition.consecutiveNoChange = 0
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

  export function recordScreenshot(hash: string, width: number, height: number, _unchanged: boolean): void {
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
          const removed = entries.shift()
          if (!removed) break
          s.screenshots.delete(removed[0])
          s.visionTargets.delete(removed[0])
        }
      }
    }

    s.lastScreenshotHash = hash
  }

  export function recordVisionTargets(
    hash: string,
    targets: Array<Omit<VisionTarget, "screenshotHash" | "step">>,
  ): VisionTarget[] {
    const s = guiState()
    if (!s.isGuiSession) return []
    const items = targets.map((target) => ({
      ...target,
      screenshotHash: hash,
      step: s.currentStep,
    }))
    s.visionTargets.set(hash, {
      hash,
      step: s.currentStep,
      items,
    })
    if (s.visionTargets.size > MAX_VISION_TARGET_GROUPS) {
      const list = Array.from(s.visionTargets.entries()).sort((a, b) => a[1].step - b[1].step)
      while (s.visionTargets.size > MAX_VISION_TARGET_GROUPS) {
        const removed = list.shift()
        if (!removed) break
        s.visionTargets.delete(removed[0])
      }
    }
    return items
  }

  export function listVisionTargets(hash?: string): VisionTarget[] {
    const s = guiState()
    if (!s.isGuiSession) return []
    const key = hash ?? s.lastScreenshotHash
    if (key) {
      const exact = s.visionTargets.get(key)
      if (exact) return exact.items
    }
    const latest = Array.from(s.visionTargets.values()).sort((a, b) => b.step - a.step)[0]
    if (!latest) return []
    return latest.items
  }

  export function findVisionTarget(id: string, hash?: string): VisionTarget | null {
    const s = guiState()
    if (!s.isGuiSession) return null
    const key = hash ?? s.lastScreenshotHash
    if (key) {
      const exact = s.visionTargets.get(key)
      if (!exact) return null
      return exact.items.find((item) => item.id === id) ?? null
    }
    const list = Array.from(s.visionTargets.values()).sort((a, b) => b.step - a.step)
    for (const item of list) {
      const found = item.items.find((target) => target.id === id)
      if (found) return found
    }
    return null
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

  export function setClickMarker(input: { x: number; y: number; screenX?: number; screenY?: number; label?: string }): void {
    const s = guiState()
    if (!s.isGuiSession) return
    s.clickMarker = {
      x: input.x,
      y: input.y,
      screenX: input.screenX ?? input.x,
      screenY: input.screenY ?? input.y,
      label: input.label ?? null,
      time: Date.now(),
      step: s.currentStep,
    }
  }

  export function peekClickMarker(): ClickMarker | null {
    return guiState().clickMarker
  }

  export function consumeClickMarker(): ClickMarker | null {
    const s = guiState()
    const marker = s.clickMarker
    s.clickMarker = null
    return marker
  }

  export function clearClickMarker(): void {
    guiState().clickMarker = null
  }

  export function startVerification(input: {
    action: string
    expectation: VerificationExpectation
    coords?: { x: number; y: number }
    detail?: string
    target?: VerificationTarget | null
  }): void {
    const s = guiState()
    if (!s.isGuiSession) return
    s.verificationPending = {
      action: input.action,
      status: "pending",
      expectation: input.expectation,
      detail: input.detail ?? null,
      coords: input.coords ? { x: input.coords.x, y: input.coords.y } : null,
      target: input.target ?? null,
      hit: null,
      distanceToCenter: null,
      distanceToBBox: null,
      screenshotHash: null,
      time: Date.now(),
      step: s.currentStep,
    }
  }

  export function pendingVerification(): VerificationRecord | null {
    return guiState().verificationPending
  }

  export function lastVerification(): VerificationRecord | null {
    return guiState().verificationLast
  }

  export function resolveVerification(input: {
    changed: boolean
    marker: boolean
    markerPoint?: { x: number; y: number } | null
    screenshotHash: string
  }): VerificationRecord | null {
    const s = guiState()
    const pending = s.verificationPending
    if (!pending) return null

    const computed = hit(pending.target, input.markerPoint ?? null)
    const miss = computed.hit === false
    const status =
      pending.expectation === "must_change"
        ? input.changed
          ? miss
            ? "fail"
            : "pass"
          : input.marker
            ? miss
              ? "fail"
              : "uncertain"
            : "fail"
        : input.changed
          ? miss
            ? "fail"
            : "pass"
          : input.marker
            ? miss
              ? "fail"
              : "uncertain"
            : "uncertain"
    const detail =
      status === "pass"
        ? computed.hit === true
          ? "Observed expected screen progression and marker hit target."
          : "Observed expected screen progression."
        : status === "fail" && miss
          ? [
              "Marker missed the intended target.",
              computed.distanceToBBox !== null ? `distance_to_bbox=${computed.distanceToBBox}px` : null,
              computed.distanceToCenter !== null ? `distance_to_center=${computed.distanceToCenter}px` : null,
            ]
              .filter(Boolean)
              .join(" ")
        : status === "uncertain"
          ? computed.hit === true
            ? "Marker hit target, but no clear screen change detected."
            : "No clear screen change detected; marker/visual evidence is inconclusive."
          : "Screen did not change after action; previous strategy likely failed."
    const resolved: VerificationRecord = {
      ...pending,
      status,
      detail,
      hit: computed.hit,
      distanceToCenter: computed.distanceToCenter,
      distanceToBBox: computed.distanceToBBox,
      screenshotHash: input.screenshotHash,
      time: Date.now(),
      step: s.currentStep,
    }
    s.verificationPending = null
    s.verificationLast = resolved
    return resolved
  }

  export function clearVerification(): void {
    const s = guiState()
    s.verificationPending = null
    s.verificationLast = null
  }

  export function verificationGate(action: string, coords?: { x: number; y: number }): VerificationGate | null {
    const s = guiState()
    if (!s.isGuiSession) return null

    if (s.verificationPending) {
      return {
        reason: "verification_pending",
        action: s.verificationPending.action,
        status: s.verificationPending.status,
        detail: s.verificationPending.detail,
        coords: s.verificationPending.coords,
        step: s.verificationPending.step,
      }
    }

    const last = s.verificationLast
    if (!last || last.status === "pass") return null
    if (last.action !== action) return null
    if (last.coords && coords) {
      const near = Math.abs(last.coords.x - coords.x) <= 8 && Math.abs(last.coords.y - coords.y) <= 8
      if (!near) return null
    }
    if (last.coords && !coords) return null

    return {
      reason: "verification_recovery_required",
      action: last.action,
      status: last.status,
      detail: last.detail,
      coords: last.coords,
      step: last.step,
    }
  }

  export function verificationAlert(): string | null {
    const s = guiState()
    if (!s.isGuiSession) return null

    if (s.verificationPending) {
      const pending = s.verificationPending
      return [
        "<gui-verification-alert>",
        `VERIFY REQUIRED: Previous action "${pending.action}" at step ${pending.step} has not been verified.`,
        "Take screen.screenshot before any further input action.",
        "</gui-verification-alert>",
      ].join("\n")
    }

    const last = s.verificationLast
    if (!last || last.status === "pass") return null
    return [
      "<gui-verification-alert>",
      `RECOVERY REQUIRED: Last "${last.action}" verification is ${last.status.toUpperCase()}.`,
      last.detail ?? "Previous strategy did not verify cleanly.",
      "Do NOT repeat the same action/coordinates. Choose a different recovery path.",
      "</gui-verification-alert>",
    ].join("\n")
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

    // Grace period: don't trigger repetition alert within 3 steps of a focus change
    const inFocusGracePeriod = s.lastFocusChangeStep >= 0 && s.currentStep - s.lastFocusChangeStep <= 3
    if (inFocusGracePeriod) return null

    const alerts: string[] = []

    // Signal 1: consecutive no-change
    if (s.repetition.consecutiveNoChange >= 4) {
      alerts.push(
        `STOP: You have performed ${s.repetition.consecutiveNoChange} actions with NO screen change.`,
        `The UI is NOT responding to your actions. Do NOT repeat the same action.`,
      )
    }

    // Signal 2: same-area repeated clicks (within 30px radius, last 8 steps)
    const recentClicks = s.repetition.recentClickCoords.filter((c) => c.step >= s.currentStep - 8)
    if (recentClicks.length >= 4) {
      // Check if 4+ clicks cluster within 30px of each other
      for (let i = 0; i < recentClicks.length; i++) {
        const center = recentClicks[i]
        const nearby = recentClicks.filter((c) => Math.abs(c.x - center.x) <= 30 && Math.abs(c.y - center.y) <= 30)
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
        alerts.push(`STOP: The same screenshot has appeared ${record.seenCount} times. The screen is not changing.`)
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
