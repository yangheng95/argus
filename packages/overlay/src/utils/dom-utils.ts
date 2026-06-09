// ── DOM Utilities ──
// Responsibilities:
// - jsonAttr: safely serialize a value to a JSON string for use in an
// HTML attribute (
// - eventClosest: walk from an event's target to the nearest ancestor
// matching a CSS selector (
// - sizeChat: auto-resize the chat textarea to its content, clamped between
// CSS-variable-defined min and max heights (
// lines 9164–9171).
// - ensureTaskSelection: select the first available task when no task is
// currently selected (
// The functions that operate on the DOM (#chatTextarea, task state) do so via
// document.getElementById / window globals so that no circular imports are
// introduced during the Solid migration.

import { boardStore } from "../store/board"
import { selectTask } from "../services/task"
import { settingsStore } from "../store/settings"
import { hasWorkspaceSelection } from "../services/workspace"
import { t } from "./i18n"
import { iconHtml } from "./icon-html"
import { escapeHtml } from "./markdown"

// ── Auto-scroll ──

/**
 * Set up user-controlled follow-to-bottom on a scrollable container.
 *
 * Behavior:
 * - Tracking state is owned by the caller (accessor `isTracking`). When true,
 *   new content triggers an rAF scroll-to-bottom; when false the container
 *   is left alone so the user can read without the viewport jumping.
 * - When tracking is ON and the user manually scrolls away from the bottom,
 *   `onUserScrollUp` is invoked so the caller can flip tracking off.
 * - On initial mount the container snaps to the bottom once, regardless of
 *   tracking state, so the user lands on the latest content.
 * - `contentChanged` is the only content-growth trigger. Callers wire it to
 *   their data source version; this utility does not observe DOM mutations.
 * - `scrollToBottom` on the returned controller jumps to the bottom without
 *   being mis-classified as a user scroll (used when the caller turns
 *   tracking on again).
 * - `scrollToTop` mirrors that behavior for explicit jumps to the start of
 *   the transcript without polluting user-scroll detection.
 *
 * Program-initiated scrolls (our own scrollTop writes) are distinguished
 * from user scrolls by tracking the last landing position we set. Scroll
 * events that land within `PROGRAM_TOLERANCE` px of that position are
 * treated as program-echo and never fire `onUserScrollUp`.
 *
 * Program-owned scroll jumps are suppressed explicitly. Any other upward
 * scroll that leaves the viewport away from the bottom is treated as operator
 * intent, because WebView2 can synthesize scroll events without a preceding
 * wheel/key marker.
 */
const BOTTOM_TOLERANCE = 8
const PROGRAM_TOLERANCE = 2
const USER_SCROLL_INTENT_MS = 600

export interface AutoScrollOptions {
  isTracking: () => boolean
  onUserScrollUp: () => void
  onAtBottom?: () => void
}

export interface AutoScrollController {
  cleanup: () => void
  contentChanged: () => void
  scrollToBottom: () => void
  scrollToTop: () => void
}

export function setupAutoScroll(el: HTMLElement, opts: AutoScrollOptions): AutoScrollController {
  let rafPending = false
  let disposed = false
  let expectedTop = el.scrollTop
  let programScrollTarget: number | null = null
  let userScrollIntentUntil = 0

  function markUserScrollIntent() {
    userScrollIntentUntil = Date.now() + USER_SCROLL_INTENT_MS
  }

  function syncFollowLockAttribute() {
    el.dataset.followLock = opts.isTracking() ? "true" : "false"
  }

  function distanceFromBottom(): number {
    return el.scrollHeight - el.clientHeight - el.scrollTop
  }

  function onScroll() {
    const nextTop = el.scrollTop
    const delta = nextTop - expectedTop
    const bottomDistance = distanceFromBottom()
    if (programScrollTarget !== null && Math.abs(nextTop - programScrollTarget) <= PROGRAM_TOLERANCE) {
      programScrollTarget = null
      expectedTop = nextTop
      if (bottomDistance <= BOTTOM_TOLERANCE) opts.onAtBottom?.()
      syncFollowLockAttribute()
      return
    }
    if (Math.abs(delta) <= PROGRAM_TOLERANCE) {
      expectedTop = nextTop
      if (bottomDistance <= BOTTOM_TOLERANCE) opts.onAtBottom?.()
      syncFollowLockAttribute()
      return
    }
    const movedUp = delta < -PROGRAM_TOLERANCE
    const hasUserScrollIntent = Date.now() <= userScrollIntentUntil
    expectedTop = nextTop
    if (opts.isTracking() && movedUp && bottomDistance > BOTTOM_TOLERANCE && hasUserScrollIntent) {
      opts.onUserScrollUp()
      syncFollowLockAttribute()
      return
    }
    if (bottomDistance <= BOTTOM_TOLERANCE) opts.onAtBottom?.()
    syncFollowLockAttribute()
  }

  function pinToBottom() {
    el.scrollTop = el.scrollHeight
    programScrollTarget = el.scrollTop
    expectedTop = el.scrollTop
  }

  function scheduleFollowScroll() {
    syncFollowLockAttribute()
    if (!opts.isTracking() || rafPending) return
    rafPending = true
    requestAnimationFrame(() => {
      rafPending = false
      if (disposed) return
      syncFollowLockAttribute()
      if (!opts.isTracking()) return
      pinToBottom()
      // Post-pin correction frame. Late-painting content — images and
      // <video> without explicit dimensions, syntax-highlighted code
      // blocks whose tokenisation runs after first paint, web-font
      // FOUT swaps, and short `transition: max-height` animations on
      // descendants — grows `scrollHeight` AFTER the rAF above set
      // `scrollTop = scrollHeight`. With `data-follow-lock="true"` we
      // explicitly disable the browser's `overflow-anchor` (so the
      // controller owns all anchoring), so without this follow-up
      // frame the user sees the conversation drift upward by exactly
      // the height the late layout gained. The spec forbids
      // MutationObserver / ResizeObserver inside setupAutoScroll
      // (specs/new-arch/2026-05-15-overlay-scroll-single-source-plan.md)
      // — a single extra rAF re-pin is the bounded, observer-free way
      // to catch the drift. Gated on `isTracking()` so a user who has
      // scrolled away never gets yanked back.
      requestAnimationFrame(() => {
        if (disposed || !opts.isTracking()) return
        if (distanceFromBottom() > BOTTOM_TOLERANCE) pinToBottom()
      })
    })
  }

  function onWheel() {
    markUserScrollIntent()
  }

  function onPointerDown(event: PointerEvent) {
    const rect = el.getBoundingClientRect()
    const scrollbarWidth = Math.max(0, el.offsetWidth - el.clientWidth)
    const gutterStart = rect.right - Math.max(12, scrollbarWidth)
    if (event.clientX >= gutterStart && el.scrollHeight > el.clientHeight) {
      markUserScrollIntent()
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "PageUp" ||
      event.key === "PageDown" ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === " "
    ) {
      markUserScrollIntent()
    }
  }

  el.addEventListener("scroll", onScroll, { passive: true })
  el.addEventListener("wheel", onWheel, { passive: true })
  el.addEventListener("pointerdown", onPointerDown, { passive: true })
  el.addEventListener("keydown", onKeyDown)

  requestAnimationFrame(() => {
    if (disposed) return
    syncFollowLockAttribute()
    el.scrollTop = el.scrollHeight
    programScrollTarget = el.scrollTop
    expectedTop = el.scrollTop
  })

  return {
    cleanup: () => {
      disposed = true
      el.removeEventListener("scroll", onScroll)
      el.removeEventListener("wheel", onWheel)
      el.removeEventListener("pointerdown", onPointerDown)
      el.removeEventListener("keydown", onKeyDown)
      delete el.dataset.followLock
    },
    contentChanged: scheduleFollowScroll,
    scrollToBottom: () => {
      syncFollowLockAttribute()
      el.scrollTop = el.scrollHeight
      programScrollTarget = el.scrollTop
      expectedTop = el.scrollTop
    },
    scrollToTop: () => {
      syncFollowLockAttribute()
      el.scrollTop = 0
      programScrollTarget = el.scrollTop
      expectedTop = el.scrollTop
    },
  }
}

// ── Public API ──

/**
 * Serialize `value` to a JSON string suitable for embedding in an HTML
 * attribute. The value is first coerced to a string via String() so that
 * primitives (numbers, booleans) and null/undefined all produce predictable
 * output.
 * @example
 * // In a template literal:
 * `<div data-id=${jsonAttr(task.id)}>`
 */
export function jsonAttr(value: unknown): string {
  return JSON.stringify(String(value ?? ""))
}

/**
 * Return the nearest ancestor of `event.target` that matches `selector`, or
 * `null` if none is found.
 * Handles the case where the event target is not an Element (e.g. a Text node)
 * by falling back to the target's parentElement.
 */
export function eventClosest(event: Event, selector: string): Element | null {
  const target = event?.target
  if (target instanceof Element) return target.closest(selector)
  const parent = (target as Node | null)?.parentElement
  if (parent instanceof Element) return parent.closest(selector)
  return null
}

/**
 * Resize the chat textarea to fit its current content.
 * The height is set to "auto" first so that scrollHeight reflects the natural
 * content height, then clamped between `--ui-chat-min-height` (default 72 px)
 * and `--ui-chat-max-height` (default 180 px) from the document root's
 * computed style.
 * When a `textarea` argument is provided it is resized directly; otherwise
 * the function queries `#chatTextarea` from the live DOM.
 */
export function sizeChat(textarea?: HTMLTextAreaElement): void {
  const el = textarea ?? (document.getElementById("chatTextarea") as HTMLTextAreaElement | null)
  if (!el) return

  el.style.height = "auto"

  const style = getComputedStyle(document.documentElement)
  const min = Number.parseFloat(style.getPropertyValue("--ui-chat-min-height")) || 72
  const max = Number.parseFloat(style.getPropertyValue("--ui-chat-max-height")) || 180

  const h = Math.min(el.scrollHeight, max)
  el.style.height = `${Math.max(h, min)}px`
}

/**
 * Ensure that at least one task is selected.
 * If a workspace selection already exists (checked
 * `hasWorkspaceSelection` window global) this is a no-op and returns `false`.
 * Otherwise the first task in boardStore.tasks is selected and `true` is
 * returned. Returns `false` if there are no tasks available.
 */
export async function ensureTaskSelection(): Promise<boolean> {
  if (hasWorkspaceSelection()) {
    return false
  }

  const tasks = boardStore.tasks as any[]
  const taskID = tasks[0]?.task?.id || ""
  if (!taskID) return false

  await selectTask(taskID)
  return true
}

// ── Path Utilities ──
// (lines 4125–4218).

/**
 * Decompose a file-system path string into an array of label/path objects,
 * one per component. Handles Windows absolute paths (e.g. `C:\`), Unix
 * absolute paths, and relative paths.
 */
export function pathItems(value: string): Array<{ label: string; path: string }> {
  const text = String(value || "").trim()
  if (!text) return []
  const windows = /^[A-Za-z]:[\\/]/.test(text)
  const unix = text.startsWith("/")
  const parts = text.split(/[\\/]+/).filter(Boolean)
  if (!parts.length) return []

  function joinPath(a: string, b: string): string {
    return a.replace(/[\\/]+$/, "") + "/" + b
  }

  if (windows) {
    let path = `${parts[0]}\\`
    const items: Array<{ label: string; path: string }> = [{ label: parts[0], path }]
    return items.concat(
      parts.slice(1).map((part) => {
        path = joinPath(path, part)
        return { label: part, path }
      }),
    )
  }
  if (unix) {
    let path = "/"
    const items: Array<{ label: string; path: string }> = [{ label: "/", path }]
    return items.concat(
      parts.map((part) => {
        path = path === "/" ? `/${part}` : `${path}/${part}`
        return { label: part, path }
      }),
    )
  }
  let path = parts[0]
  const items: Array<{ label: string; path: string }> = [{ label: parts[0], path }]
  return items.concat(
    parts.slice(1).map((part) => {
      path = path.replace(/[\\/]+$/, "") + "/" + part
      return { label: part, path }
    }),
  )
}

/**
 * Return the Icon primitive HTML for the given path-action button kind.
 * Supported kinds: "browse" | any (returns × close icon).
 */
export function pathIcon(kind: string): string {
  if (kind === "browse") {
    return iconHtml("folder", 13)
  }
  return iconHtml("close", 13)
}

/**
 * Build the HTML string for the directory breadcrumb bar shown in the task
 * header. Reads the current directory from `settingsStore.directory`.
 */
export function pathBreadcrumb(value: string): string {
  const browse = escapeHtml(t("cwd.browse"))
  const actions = [
    `<button type="button" class="task-dir-tool" data-path-action="browse" title="${browse}" aria-label="${browse}">${pathIcon("browse")}</button>`,
  ].join("")
  if (!value) {
    return `
      <span class="task-dir-empty">${escapeHtml(t("cwd.unavailable"))}</span>
      <span class="task-dir-actions">${actions}</span>
    `
  }
  const items = pathItems(value)
  const open = t("cwd.open")
  const choose = t("cwd.choose_level")
  const nodes = items
    .map((item, index) => {
      const current = index === items.length - 1 ? ' data-current="true"' : ""
      const step = index
        ? `<button type="button" class="task-dir-step" data-path-set=${jsonAttr(items[index - 1].path)} title="${escapeHtml(`${choose}: ${items[index - 1].path}`)}" aria-label="${escapeHtml(`${choose}: ${items[index - 1].path}`)}">/</button>`
        : ""
      return `${step}<button type="button" class="task-dir-node" data-path-open=${jsonAttr(item.path)} title="${escapeHtml(`${open}: ${item.path}`)}" aria-label="${escapeHtml(`${open}: ${item.path}`)}"${current}>${escapeHtml(item.label)}</button>`
    })
    .join("")
  return `
    <span class="task-dir-path">${nodes}</span>
    <span class="task-dir-actions">${actions}</span>
  `
}
