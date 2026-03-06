import z from "zod"
import { Tool } from "./tool"
import { GUI } from "../opencorvus/gui/index"
import { Coordinates } from "../opencorvus/gui/coordinates"
import { DesktopState } from "./desktop-state"
import { GuiState } from "./gui-state"
import { WindowManager } from "../opencorvus/perception/window"
import { Log } from "../util/log"
import { overlayDiagnostic, requestOverlayConfirm, showOverlay } from "./overlay-client"
import { Capability } from "../platform/capability"
import { InputPostcondition } from "./input-postcondition"
import { runInputPipeline } from "./input-pipeline"
import { InputPreflight } from "./input-preflight"

const log = Log.create({ service: "input" })
type Target = Exclude<ReturnType<typeof GuiState.findVisionTarget>, null>

function coordinateSpace(): Coordinates.CoordinateSpace {
  const value = process.env.OPENCORVUS_COORDINATE_SPACE?.toLowerCase()
  if (value === "physical" || value === "logical" || value === "auto") return value
  return "auto"
}

function split(input: string) {
  return input
    .split("+")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
}

function focusKey(key: string) {
  const parts = split(key)
  if (!parts.includes("tab")) return false
  return parts.some(
    (part) =>
      part === "alt" ||
      part === "cmd" ||
      part === "command" ||
      part === "meta" ||
      part === "super" ||
      part === "win" ||
      part === "windows",
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function uniq(input: Array<{ x: number; y: number }>) {
  const seen = new Set<string>()
  return input.filter((item) => {
    const id = `${item.x},${item.y}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function points(target: Target) {
  const center = {
    x: Math.round(target.x),
    y: Math.round(target.y),
  }
  if (!target.bbox) return [center]
  const minX = Math.round(target.bbox.x)
  const minY = Math.round(target.bbox.y)
  const maxX = Math.round(target.bbox.x + target.bbox.width - 1)
  const maxY = Math.round(target.bbox.y + target.bbox.height - 1)
  const insetX = Math.max(2, Math.round(target.bbox.width * 0.2))
  const insetY = Math.max(2, Math.round(target.bbox.height * 0.2))
  const left = clamp(minX + insetX, minX, maxX)
  const right = clamp(maxX - insetX, minX, maxX)
  const top = clamp(minY + insetY, minY, maxY)
  const bottom = clamp(maxY - insetY, minY, maxY)
  return uniq([
    center,
    { x: left, y: center.y },
    { x: right, y: center.y },
    { x: center.x, y: top },
    { x: center.x, y: bottom },
  ])
}

function recover() {
  const last = GuiState.lastVerification()
  if (!last) return null
  if (last.action !== "click") return null
  if (last.status === "pass") return null
  if (!last.coords) return null
  return {
    x: last.coords.x,
    y: last.coords.y,
  }
}

function choose(list: Array<{ x: number; y: number }>, avoid: { x: number; y: number } | null) {
  if (!avoid) {
    return {
      index: 0,
      point: list[0],
    }
  }
  const found = list.findIndex((item) => Math.abs(item.x - avoid.x) > 8 || Math.abs(item.y - avoid.y) > 8)
  const index = found >= 0 ? found : 0
  return {
    index,
    point: list[index],
  }
}

const DESCRIPTION = `Interact with the desktop environment. Use this tool to click, type text, press keys, scroll, drag, move mouse, wait, and request desktop confirmation.

Actions:
- click: Click by target_id (preferred) or by (x, y) coordinates. Button: "left" (default), "right", "double", "middle".
- type: Type text by pasting from clipboard (more reliable than keystroke simulation).
- key: Press a key or combination (e.g. "enter", "ctrl+c", "alt+f4", "win", "ctrl+shift+s").
- scroll: Scroll up or down at the current mouse position.
- drag: Drag from (startX, startY) to (endX, endY).
- move: Move mouse to (x, y) without clicking. Useful for hover effects.
- wait: Wait for a short pause in milliseconds. Prefer skipping it; when needed, start with 10ms.
- confirm: Open a desktop confirmation dialog and wait for user choice before continuing.

If a window is bound via the screen tool, all coordinates are relative to that window.
Pointer actions (click/drag/move) require a recent screen.screenshot anchor. If no anchor exists, they are blocked.

Advanced options for interactive actions:
- driver (optional): "auto" (default), "desktop", "playwright", "appium".
  Pointer actions (click/drag/move) only support "auto" or "desktop".
- post (optional): postcondition template. "bound_window_foreground" (default) or "none".

Key names (case-insensitive): enter, esc, tab, space, backspace, delete, insert,
  ctrl, alt, shift, win/super/meta/cmd, f1-f24, a-z, 0-9,
  up/down/left/right, home, end, pageup, pagedown, capslock, printscreen, pause.
Combinations: use "+" separator, e.g. "ctrl+c", "alt+f4", "ctrl+shift+s", "win+e".

IMPORTANT: All coordinate parameters (x, y, startX, startY, endX, endY) must be single integer values, NOT arrays.
  Correct: {"x": 500, "y": 300}
  Wrong:   {"x": [500, 300]} or {"x": "[500]"}

Best practices:
- Always take a screenshot BEFORE interacting to see current state.
- After performing an action, take another screenshot to VERIFY the result.
- Prefer target_id from vision_analyze over raw coordinates to reduce miss clicks.
- Click on a text field BEFORE typing to ensure it has focus.
- Avoid long waits; prefer 10ms wait + screenshot verification loop, or use screen.screenshot wait_for_change.`

// Robust number parser: handles any format LLMs might produce.
// Examples: 500, "500", "[500]", "[500, 300]", "([714, 584],)", "(500)", etc. → first integer
const coord = z.preprocess((val) => {
  if (typeof val === "number") return Math.round(val)
  if (typeof val === "string") {
    // Extract the first number from any string format
    const match = val.match(/-?\d+/)
    if (match) return Number(match[0])
    return undefined
  }
  if (Array.isArray(val)) {
    // [500] or [500, 300] → first element
    const first = val[0]
    return typeof first === "number" ? Math.round(first) : Number(first)
  }
  return undefined
}, z.number().int())

const DriverMode = z.enum(["auto", "desktop", "playwright", "appium"]).optional()
const PostMode = z.enum(["none", "bound_window_foreground"]).optional()

const ClickAction = z
  .object({
    action: z.literal("click"),
    x: coord.optional().describe("X coordinate to click (window-relative). Optional when target_id is provided"),
    y: coord.optional().describe("Y coordinate to click (window-relative). Optional when target_id is provided"),
    target_id: z
      .string()
      .min(1)
      .optional()
      .describe("Preferred click target from vision_analyze output, e.g. send_button"),
    screenshot_hash: z
      .string()
      .min(1)
      .optional()
      .describe("Screenshot hash used to resolve target_id. Must match the latest anchor screenshot when provided."),
    button: z
      .enum(["left", "right", "double", "middle"])
      .default("left")
      .describe("Mouse button: left, right, double, or middle"),
    driver: DriverMode.describe("Optional automation driver override: auto, desktop, playwright, or appium"),
    post: PostMode.describe("Optional postcondition template. Default for interactive actions: bound_window_foreground"),
  })
  .superRefine((value, ctx) => {
    if (value.target_id) return
    if (value.x !== undefined && value.y !== undefined) return
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `click requires either "target_id" or both "x" and "y"`,
      path: ["x"],
    })
  })

const TypeAction = z.object({
  action: z.literal("type"),
  text: z.string().describe("Text to type (pasted via clipboard for reliability)"),
  driver: DriverMode.describe("Optional automation driver override: auto, desktop, playwright, or appium"),
  post: PostMode.describe("Optional postcondition template. Default for interactive actions: bound_window_foreground"),
})

const KeyAction = z.object({
  action: z.literal("key"),
  key: z.string().describe('Key or combination to press (e.g. "Enter", "ctrl+c", "alt+tab")'),
  driver: DriverMode.describe("Optional automation driver override: auto, desktop, playwright, or appium"),
  post: PostMode.describe("Optional postcondition template. Default for interactive actions: bound_window_foreground"),
})

const ScrollAction = z.object({
  action: z.literal("scroll"),
  direction: z.enum(["up", "down"]).describe("Scroll direction"),
  amount: z
    .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().default(3))
    .describe("Number of scroll steps"),
  driver: DriverMode.describe("Optional automation driver override: auto, desktop, playwright, or appium"),
  post: PostMode.describe("Optional postcondition template. Default for interactive actions: bound_window_foreground"),
})

const DragAction = z.object({
  action: z.literal("drag"),
  startX: coord.describe("Start X coordinate"),
  startY: coord.describe("Start Y coordinate"),
  endX: coord.describe("End X coordinate"),
  endY: coord.describe("End Y coordinate"),
  driver: DriverMode.describe("Optional automation driver override: auto, desktop, playwright, or appium"),
  post: PostMode.describe("Optional postcondition template. Default for interactive actions: bound_window_foreground"),
})

const MoveAction = z.object({
  action: z.literal("move"),
  x: coord.describe("X coordinate to move to"),
  y: coord.describe("Y coordinate to move to"),
  driver: DriverMode.describe("Optional automation driver override: auto, desktop, playwright, or appium"),
  post: PostMode.describe("Optional postcondition template. Default for interactive actions: bound_window_foreground"),
})

const WaitAction = z.object({
  action: z.literal("wait"),
  ms: z
    .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().min(10).max(1000).default(10))
    .describe("Milliseconds to wait (10-1000, default 10)"),
})

const ConfirmAction = z.object({
  action: z.literal("confirm"),
  title: z.string().min(1).max(120).describe("Dialog title"),
  message: z.string().min(1).max(1000).describe("Dialog body text"),
  confirm: z.string().min(1).max(30).default("Confirm").describe("Confirm button label"),
  cancel: z.string().min(1).max(30).default("Cancel").describe("Cancel button label"),
  timeoutMs: z
    .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().min(1000).max(120000).default(30000))
    .describe("Dialog timeout in milliseconds"),
})

const InputParams = z.discriminatedUnion("action", [
  ClickAction,
  TypeAction,
  KeyAction,
  ScrollAction,
  DragAction,
  MoveAction,
  WaitAction,
  ConfirmAction,
])

export const InputTool = Tool.define("input", {
  description: DESCRIPTION,
  parameters: InputParams,
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: Record<string, unknown> }> {
    await ctx.ask({
      permission: "input",
      patterns: [params.action],
      always: ["*"],
      metadata: { action: params.action },
    })

    GuiState.activate()
    DesktopState.markTask(GuiState.get().taskEpoch)
    await WindowManager.rebindForTask(GuiState.get().taskEpoch)
    const space = coordinateSpace()

    const postcheck = (
      input: "none" | "bound_window_foreground" | undefined,
      opt: Parameters<typeof InputPostcondition.resolve>[1] = {},
    ) => InputPostcondition.resolve(input ?? "bound_window_foreground", opt)
    const verify = (
      action: string,
      expectation: "must_change" | "may_change",
      coords?: { x: number; y: number },
      detail?: string,
      target?: {
        id?: string | null
        center?: { x: number; y: number } | null
        bbox?: { x: number; y: number; width: number; height: number } | null
      },
    ) => {
      GuiState.startVerification({
        action,
        expectation,
        coords,
        detail,
        target: target
          ? {
              id: target.id ?? null,
              center: target.center ?? null,
              bbox: target.bbox ?? null,
            }
          : null,
      })
      return {
        state: "pending",
        action,
        expected: expectation,
        next: "Take screen.screenshot to verify this action before the next input step.",
      }
    }

    switch (params.action) {
      case "click": {
        const hash = params.screenshot_hash?.trim()
        const anchorHash = DesktopState.getAnchorHash()
        if (hash && anchorHash && hash !== anchorHash) {
          return {
            title: "Click blocked: stale screenshot hash",
            output:
              `Cannot run input.click with screenshot_hash=${hash} because the current anchor is ${anchorHash}. ` +
              "Take a fresh screenshot (or vision_analyze), then retry with the latest hash.",
            metadata: {
              blocked: true,
              reason: "stale_screenshot_hash",
              screenshotHash: hash,
              anchorHash,
            },
          }
        }
        const lookup = hash ?? anchorHash ?? GuiState.get().lastScreenshotHash ?? undefined
        if (params.target_id && !lookup) {
          return {
            title: "Click blocked: missing screenshot anchor",
            output:
              `Cannot resolve target_id "${params.target_id}" without an active screenshot anchor. ` +
              "Run screen.screenshot or vision_analyze first, then retry.",
            metadata: {
              blocked: true,
              reason: "missing_screenshot_anchor",
              targetID: params.target_id,
            },
          }
        }
        const target = params.target_id ? GuiState.findVisionTarget(params.target_id, lookup) : null
        if (params.target_id && !target) {
          const ids = GuiState.listVisionTargets(lookup).map((item) => item.id).slice(0, 20)
          return {
            title: "Click blocked: target_id not found",
            output:
              `Target "${params.target_id}" is not available for screenshot ${lookup ?? "unknown"}. ` +
              `Known targets: ${ids.length > 0 ? ids.join(", ") : "none"}. Re-run vision_analyze and retry.`,
            metadata: {
              blocked: true,
              reason: "target_id_not_found",
              targetID: params.target_id,
              screenshotHash: lookup ?? null,
              knownTargetIDs: ids,
            },
          }
        }
        const variants = target ? points(target) : null
        const pick = variants ? choose(variants, recover()) : null
        const x = pick ? pick.point.x : params.x
        const y = pick ? pick.point.y : params.y
        if (x === undefined || y === undefined) {
          return {
            title: "Click blocked: missing coordinates",
            output: `input.click requires target_id or both x and y.`,
            metadata: {
              blocked: true,
              reason: "missing_click_coordinates",
            },
          }
        }
        const gate = await InputPreflight.pointer("click", params.driver, { x, y })
        if (!gate.ok) return gate.block
        const anchored = gate.value.anchored
        const binding = gate.value.binding
        const resolvedSpace = Coordinates.resolveSpace(x, y, anchored, space)
        const screen = Coordinates.resolveDetailed(x, y, anchored, space)
        const action =
          params.button === "double"
            ? "double"
            : params.button === "right"
              ? "right"
              : params.button === "middle"
                ? "middle"
                : "click"
        log.info("click-resolve", {
          windowRelative: `${x},${y}`,
          screenAbsolute: `${screen.x},${screen.y}`,
          bounds: anchored ? `${anchored.width}x${anchored.height}@${anchored.x},${anchored.y}` : "none",
          coordinateSpaceRequested: space,
          coordinateSpaceResolved: resolvedSpace,
          button: params.button ?? "left",
          source: target ? "target_id" : "coordinates",
          targetID: target?.id ?? null,
          candidateIndex: pick ? pick.index : null,
          candidateTotal: variants ? variants.length : null,
          clamped: screen.clamped,
        })
        if (screen.clamped) {
          log.warn("click-coordinate-clamped", {
            requested: `${x},${y}`,
            clampedTo: `${screen.x},${screen.y}`,
            bounds: `${anchored.width}x${anchored.height}`,
          })
        }
        await runInputPipeline({
          id: `input.click.${params.button ?? "left"}`,
          action: `click.${params.button ?? "left"}`,
          abort: ctx.abort,
          driver: gate.value.driver,
          post: postcheck(params.post, {
            binding,
            target: DesktopState.getTarget(),
          }),
          run: async () => {
            if (params.button === "double") return GUI.doubleClick(screen.x, screen.y)
            if (params.button === "right") return GUI.rightClick(screen.x, screen.y)
            if (params.button === "middle") return GUI.middleClick(screen.x, screen.y)
            return GUI.click(screen.x, screen.y)
          },
          start: {
            x: screen.x,
            y: screen.y,
            action,
            label: target
              ? `${params.button ?? "left"} ${target.id}${pick && variants ? ` #${pick.index + 1}/${variants.length}` : ""}`
              : `${params.button ?? "left"} (${x},${y})`,
          },
          done: {
            x: screen.x,
            y: screen.y,
            action,
            label: "done",
          },
          retryMeta: {
            x: screen.x,
            y: screen.y,
          },
        })
        const coordDetail = anchored
          ? ` (window-relative: ${x},${y} → screen: ${screen.x},${screen.y}${screen.clamped ? " [CLAMPED]" : ""})`
          : ""
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "click",
          coords: { x, y },
          detail: target ? `${params.button ?? "left"} target=${target.id}` : (params.button ?? "left"),
          screenshotHashAfter: null,
          screenChanged: null,
        })
        GuiState.updateRepetition(null, { x, y })
        GuiState.setClickMarker({
          x,
          y,
          screenX: screen.x,
          screenY: screen.y,
          label: `${params.button ?? "left"} click`,
        })
        const verification = verify(
          "click",
          "must_change",
          { x, y },
          `${params.button ?? "left"} click`,
          target
            ? {
                id: target.id,
                center: { x: target.x, y: target.y },
                bbox: target.bbox,
              }
            : undefined,
        )
        const title = target ? `Clicked target "${target.id}"` : `Clicked (${x}, ${y})`
        const output = target
          ? `${params.button ?? "left"} click on target "${target.id}" at (${x}, ${y})${pick && variants ? ` [candidate ${pick.index + 1}/${variants.length}]` : ""}${coordDetail}`
          : `${params.button ?? "left"} click at (${x}, ${y})${coordDetail}`
        return {
          title,
          output,
          metadata: {
            x,
            y,
            screenX: screen.x,
            screenY: screen.y,
            button: params.button,
            source: target ? "target_id" : "coordinates",
            targetID: target?.id ?? null,
            targetDescription: target?.description ?? null,
            targetConfidence: target?.confidence ?? null,
            targetCandidateIndex: pick ? pick.index : null,
            targetCandidateTotal: variants ? variants.length : null,
            screenshotHash: lookup ?? null,
            anchorHash,
            markerProducer: "tool.input.setClickMarker",
            clamped: screen.clamped,
            clampedX: screen.clampedX,
            clampedY: screen.clampedY,
            coordinateSpaceRequested: space,
            coordinateSpace: resolvedSpace,
            verification,
          },
        }
      }

      case "type": {
        const gate = await InputPreflight.interactive("type", params.driver)
        if (!gate.ok) return gate.block
        await runInputPipeline({
          id: "input.type",
          action: "type",
          abort: ctx.abort,
          driver: params.driver,
          act: { kind: "type", text: params.text },
          post:
            gate.value.selected === "desktop"
              ? postcheck(params.post, {
                  target: DesktopState.getTarget(),
                })
              : undefined,
          run: () => GUI.paste(params.text),
          start: {
            action: "type",
            label: params.text.length > 20 ? params.text.slice(0, 20) : params.text,
          },
          done: {
            action: "type",
            label: `done ${params.text.length} chars`,
          },
          retryMeta: {
            length: params.text.length,
          },
        })
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "type",
          detail: `"${params.text.length > 40 ? params.text.slice(0, 37) + "..." : params.text}"`,
          screenshotHashAfter: null,
          screenChanged: null,
        })
        const verification = verify("type", "must_change", undefined, "typed text")
        return {
          title: "Typed text",
          output: `Typed ${params.text.length} characters via clipboard paste`,
          metadata: { length: params.text.length, verification },
        }
      }

      case "key": {
        const gate = await InputPreflight.interactive("key", params.driver, focusKey(params.key))
        if (!gate.ok) return gate.block
        const parts = params.key.split("+").map((k) => k.trim())
        await runInputPipeline({
          id: parts.length > 1 ? "input.key.hotkey" : "input.key.single",
          action: parts.length > 1 ? "key.hotkey" : "key.single",
          abort: ctx.abort,
          driver: params.driver,
          act: {
            kind: "hotkey",
            keys: parts,
          },
          post:
            gate.value.selected === "desktop"
              ? postcheck(params.post, {
                  target: DesktopState.getTarget(),
                })
              : undefined,
          run: () => {
            if (parts.length > 1) return GUI.hotkey(...parts)
            return GUI.pressKey(parts[0])
          },
          start: {
            action: "key",
            label: params.key,
          },
          done: {
            action: "key",
            label: `done ${params.key}`,
          },
          retryMeta: {
            key: params.key,
          },
        })
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "key",
          detail: params.key,
          screenshotHashAfter: null,
          screenChanged: null,
        })
        const verification = verify("key", "may_change", undefined, params.key)
        return {
          title: `Pressed ${params.key}`,
          output: `Pressed key: ${params.key}`,
          metadata: { key: params.key, verification },
        }
      }

      case "scroll": {
        const gate = await InputPreflight.interactive("scroll", params.driver)
        if (!gate.ok) return gate.block
        await runInputPipeline({
          id: "input.scroll",
          action: "scroll",
          abort: ctx.abort,
          driver: params.driver,
          act: {
            kind: "scroll",
            direction: params.direction,
            amount: params.amount,
          },
          post:
            gate.value.selected === "desktop"
              ? postcheck(params.post, {
                  target: DesktopState.getTarget(),
                })
              : undefined,
          run: () => GUI.scroll(params.direction, params.amount),
          start: {
            action: "scroll",
            label: `${params.direction} ${params.amount}`,
          },
          done: {
            action: "scroll",
            label: `done ${params.direction}`,
          },
          retryMeta: {
            direction: params.direction,
            amount: params.amount,
          },
        })
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "scroll",
          detail: `${params.direction} ${params.amount}`,
          screenshotHashAfter: null,
          screenChanged: null,
        })
        const verification = verify("scroll", "must_change", undefined, `${params.direction} ${params.amount}`)
        return {
          title: `Scrolled ${params.direction}`,
          output: `Scrolled ${params.direction} by ${params.amount} steps`,
          metadata: { direction: params.direction, amount: params.amount, verification },
        }
      }

      case "drag": {
        const gate = await InputPreflight.pointer("drag", params.driver, { x: params.startX, y: params.startY })
        if (!gate.ok) return gate.block
        const anchored = gate.value.anchored
        const binding = gate.value.binding
        const resolvedSpace = Coordinates.resolveSpace(params.startX, params.startY, anchored, space)
        const start = Coordinates.resolveDetailed(params.startX, params.startY, anchored, space)
        const end = Coordinates.resolveDetailed(params.endX, params.endY, anchored, space)
        await runInputPipeline({
          id: "input.drag",
          action: "drag",
          abort: ctx.abort,
          driver: gate.value.driver,
          post: postcheck(params.post, {
            binding,
            target: DesktopState.getTarget(),
          }),
          run: () => GUI.drag(start.x, start.y, end.x, end.y),
          start: {
            x: start.x,
            y: start.y,
            action: "drag",
            label: `→(${params.endX},${params.endY})`,
          },
          done: {
            x: end.x,
            y: end.y,
            action: "drag",
            label: "done",
          },
          retryMeta: {
            startX: start.x,
            startY: start.y,
            endX: end.x,
            endY: end.y,
          },
        })
        const coordDetail = anchored
          ? ` (window-relative: ${params.startX},${params.startY}→${params.endX},${params.endY} | screen: ${start.x},${start.y}→${end.x},${end.y}${start.clamped || end.clamped ? " [CLAMPED]" : ""})`
          : ""
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "drag",
          coords: { x: params.startX, y: params.startY },
          detail: `→(${params.endX},${params.endY})`,
          screenshotHashAfter: null,
          screenChanged: null,
        })
        const verification = verify("drag", "must_change", { x: params.startX, y: params.startY }, "drag interaction")
        return {
          title: `Dragged (${params.startX},${params.startY}) → (${params.endX},${params.endY})`,
          output: `Dragged from (${params.startX},${params.startY}) to (${params.endX},${params.endY})${coordDetail}`,
          metadata: {
            startX: params.startX,
            startY: params.startY,
            endX: params.endX,
            endY: params.endY,
            screenStartX: start.x,
            screenStartY: start.y,
            screenEndX: end.x,
            screenEndY: end.y,
            clampedStart: start.clamped,
            clampedEnd: end.clamped,
            coordinateSpaceRequested: space,
            coordinateSpace: resolvedSpace,
            verification,
          },
        }
      }

      case "move": {
        const gate = await InputPreflight.pointer("move", params.driver, { x: params.x, y: params.y })
        if (!gate.ok) return gate.block
        const anchored = gate.value.anchored
        const binding = gate.value.binding
        const resolvedSpace = Coordinates.resolveSpace(params.x, params.y, anchored, space)
        const screen = Coordinates.resolveDetailed(params.x, params.y, anchored, space)
        await runInputPipeline({
          id: "input.move",
          action: "move",
          abort: ctx.abort,
          driver: gate.value.driver,
          post: postcheck(params.post, {
            binding,
            target: DesktopState.getTarget(),
          }),
          run: () => GUI.moveTo(screen.x, screen.y),
          start: {
            x: screen.x,
            y: screen.y,
            action: "move",
            label: `(${params.x},${params.y})`,
          },
          done: {
            x: screen.x,
            y: screen.y,
            action: "move",
            label: "done",
          },
          retryMeta: {
            x: screen.x,
            y: screen.y,
          },
        })
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "move",
          coords: { x: params.x, y: params.y },
          detail: "",
          screenshotHashAfter: null,
          screenChanged: null,
        })
        const verification = verify("move", "may_change", { x: params.x, y: params.y }, "mouse move")
        return {
          title: `Moved to (${params.x}, ${params.y})`,
          output: `Mouse moved to (${params.x}, ${params.y})${screen.clamped ? " [CLAMPED]" : ""}`,
          metadata: {
            x: params.x,
            y: params.y,
            screenX: screen.x,
            screenY: screen.y,
            clamped: screen.clamped,
            clampedX: screen.clampedX,
            clampedY: screen.clampedY,
            coordinateSpaceRequested: space,
            coordinateSpace: resolvedSpace,
            verification,
          },
        }
      }

      case "wait": {
        await new Promise((resolve) => setTimeout(resolve, params.ms))
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "wait",
          detail: `${params.ms}ms`,
          screenshotHashAfter: null,
          screenChanged: null,
        })
        return {
          title: `Waited ${params.ms}ms`,
          output: `Waited ${params.ms} milliseconds`,
          metadata: { ms: params.ms },
        }
      }

      case "confirm": {
        showOverlay(undefined, undefined, "confirm", params.title, "running")
        const answer = await requestOverlayConfirm({
          title: params.title,
          message: params.message,
          confirm: params.confirm,
          cancel: params.cancel,
          timeoutMs: params.timeoutMs,
        })
        const accepted = answer === "confirm"
        const unavailable = answer === "unavailable"
        const overlay = overlayDiagnostic()
        const unavailableReason = unavailable ? (overlay.reason ?? "unknown") : undefined
        const capabilityHint = unavailable
          ? Capability.cachedItem("overlay_confirm")?.hint || Capability.overlayItem().hint
          : undefined
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "confirm",
          detail: `${params.title} => ${answer}`,
          screenshotHashAfter: null,
          screenChanged: null,
        })
        if (unavailable) {
          showOverlay(undefined, undefined, "confirm", `unavailable ${unavailableReason}`, "error")
          log.warn("overlay-confirm-unavailable", {
            reason: unavailableReason,
            path: overlay.path,
          })
        } else if (accepted) {
          showOverlay(undefined, undefined, "confirm", "confirmed", "done")
        } else if (answer === "timeout") {
          showOverlay(undefined, undefined, "confirm", "timeout", "error")
        } else {
          showOverlay(undefined, undefined, "confirm", "cancelled", "error")
        }
        return {
          title: accepted ? "User confirmed" : unavailable ? "Desktop confirm unavailable" : "User did not confirm",
          output: unavailable
            ? `Desktop confirmation window is unavailable (${unavailableReason}). Continue with a fallback flow (question tool or safe default).${capabilityHint ? ` Hint: ${capabilityHint}` : ""}`
            : accepted
              ? "User confirmed to continue with the next step."
              : answer === "timeout"
                ? "Confirmation timed out. Treat as not confirmed and ask a follow-up if needed."
                : "User cancelled the next step.",
          metadata: {
            answer,
            confirmed: accepted,
            timeout: answer === "timeout",
            unavailable,
            unavailableReason,
            capabilityHint,
          },
        }
      }
    }
  },
})
