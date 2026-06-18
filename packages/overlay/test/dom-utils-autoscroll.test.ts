import { afterEach, beforeEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"
const { setupAutoScroll } = await import("../src/utils/dom-utils")

class FakeScrollElement extends EventTarget {
  scrollHeight = 0
  clientHeight = 0
  clientWidth = 180
  offsetWidth = 200
  dataset: Record<string, string> = {}
  private _scrollTop = 0

  get scrollTop() {
    return this._scrollTop
  }

  set scrollTop(value: number) {
    const maxTop = Math.max(0, this.scrollHeight - this.clientHeight)
    const next = Number.isFinite(value) ? value : 0
    this._scrollTop = Math.max(0, Math.min(next, maxTop))
  }

  getBoundingClientRect() {
    return {
      left: 0,
      right: this.offsetWidth,
      top: 0,
      bottom: this.clientHeight,
      width: this.offsetWidth,
      height: this.clientHeight,
      x: 0,
      y: 0,
      toJSON() {
        return {}
      },
    }
  }
}

const originalResizeObserver = globalThis.ResizeObserver
const originalMutationObserver = globalThis.MutationObserver
const originalRequestAnimationFrame = globalThis.requestAnimationFrame

beforeEach(() => {
  globalThis.ResizeObserver = class {
    constructor() {
      throw new Error("setupAutoScroll must not create ResizeObserver")
    }
  } as any
  globalThis.MutationObserver = class {
    constructor() {
      throw new Error("setupAutoScroll must not create MutationObserver")
    }
  } as any
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }) as any
})

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver
  globalThis.MutationObserver = originalMutationObserver
  globalThis.requestAnimationFrame = originalRequestAnimationFrame
})

function createScrollElement() {
  const el = new FakeScrollElement()
  el.clientHeight = 100
  el.scrollHeight = 300
  el.scrollTop = 999
  return el
}

function wheel(deltaY: number): Event {
  const event = new Event("wheel") as Event & { deltaY: number }
  event.deltaY = deltaY
  return event
}

test("controller upward scroll does not disable follow lock", () => {
  const el = createScrollElement()
  let tracking = true
  let disabled = 0

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => tracking,
    onUserScrollUp: () => {
      tracking = false
      disabled += 1
    },
  })

  ctrl.scrollToTop()
  el.dispatchEvent(new Event("scroll"))

  expect(disabled).toBe(0)
  expect(tracking).toBe(true)
  ctrl.cleanup()
})

test("wheel upward scroll away from bottom disables follow lock", () => {
  const el = createScrollElement()
  let tracking = true
  let disabled = 0

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => tracking,
    onUserScrollUp: () => {
      tracking = false
      disabled += 1
    },
  })

  el.dispatchEvent(wheel(-120))
  el.scrollTop = 140
  el.dispatchEvent(new Event("scroll"))

  expect(disabled).toBe(1)
  expect(tracking).toBe(false)
  ctrl.cleanup()
})

test("unmarked upward scroll away from bottom disables follow lock", () => {
  const el = createScrollElement()
  let tracking = true
  let disabled = 0

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => tracking,
    onUserScrollUp: () => {
      tracking = false
      disabled += 1
    },
  })

  el.scrollTop = 140
  el.dispatchEvent(new Event("scroll"))

  expect(disabled).toBe(1)
  expect(tracking).toBe(false)
  ctrl.cleanup()
})

test("ordinary content pointerdown does not block upward scroll release", () => {
  const el = createScrollElement()
  let tracking = true
  let disabled = 0

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => tracking,
    onUserScrollUp: () => {
      tracking = false
      disabled += 1
    },
  })

  el.dispatchEvent(new Event("pointerdown"))
  el.scrollTop = 140
  el.dispatchEvent(new Event("scroll"))

  expect(disabled).toBe(1)
  expect(tracking).toBe(false)
  ctrl.cleanup()
})

test("data-driven content changes keep the view pinned to bottom while tracking", () => {
  const el = createScrollElement()

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => true,
    onUserScrollUp: () => {},
  })

  el.scrollHeight = 420
  ctrl.contentChanged()

  expect(el.scrollTop).toBe(320)
  ctrl.cleanup()
})

test("setupAutoScroll does not construct DOM observers", () => {
  const el = createScrollElement()

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => true,
    onUserScrollUp: () => {},
  })

  ctrl.cleanup()
})

test("data-driven content changes preserve manual scroll position when tracking is disabled", () => {
  const el = createScrollElement()
  let tracking = true

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => tracking,
    onUserScrollUp: () => {
      tracking = false
    },
  })

  el.dispatchEvent(wheel(-120))
  el.scrollTop = 140
  el.dispatchEvent(new Event("scroll"))
  el.scrollHeight = 420
  ctrl.contentChanged()

  expect(tracking).toBe(false)
  expect(el.scrollTop).toBe(140)
  ctrl.cleanup()
})

test("transcript replacement can re-arm bottom follow after manual scroll lock", () => {
  const el = createScrollElement()
  let tracking = true

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => tracking,
    onUserScrollUp: () => {
      tracking = false
    },
  })

  el.dispatchEvent(wheel(-120))
  el.scrollTop = 140
  el.dispatchEvent(new Event("scroll"))
  expect(tracking).toBe(false)

  // Whole-transcript replacement clears the scroll range; the browser clamps
  // the viewport to the top while the old content is gone.
  el.scrollHeight = 0
  el.scrollTop = 0

  // The scroll owner must explicitly scope follow-lock to the new transcript
  // generation rather than leaking the old manual-scroll intent forward.
  tracking = true
  ctrl.scrollToBottom()

  el.scrollHeight = 420
  ctrl.contentChanged()

  expect(el.scrollTop).toBe(320)
  ctrl.cleanup()
})

test("chat scroll keeps browser overflow anchoring enabled", () => {
  const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")
  const chatScrollRule = css.match(/\.chat-scroll\s*\{[^}]*\}/)?.[0] ?? ""
  const followLockRule = css.match(/\.chat-scroll\[data-follow-lock="true"\]\s*\{[^}]*\}/)?.[0] ?? ""
  expect(chatScrollRule).toContain("overflow-anchor: auto")
  expect(chatScrollRule).toMatch(/contain:\s*layout\b/)
  expect(chatScrollRule).not.toContain("overflow-anchor: none")
  expect(followLockRule).toContain("overflow-anchor: none")
})

test("conversation rows do not use content visibility because it destabilizes scrollbar height", () => {
  const conversationCss = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")
  const bubbleCss = readFileSync(join(import.meta.dir, "../src/styles/surfaces/chat-bubble.css"), "utf8")
  const cardCss = readFileSync(join(import.meta.dir, "../src/styles/surfaces/card.css"), "utf8")
  const structuredCardRule =
    conversationCss.match(/\.chat-scroll > \.card,\s*\.chat-scroll > \.interaction-card\s*\{[^}]*\}/)?.[0] ?? ""
  const bubbleRowRule = bubbleCss.match(/\.chat-bubble-row\s*\{[^}]*\}/)?.[0] ?? ""
  const cardRule = cardCss.match(/\.card\s*\{[^}]*\}/)?.[0] ?? ""

  expect(structuredCardRule).not.toContain("content-visibility")
  expect(structuredCardRule).not.toContain("contain-intrinsic-size")
  expect(bubbleRowRule).not.toContain("content-visibility")
  expect(bubbleRowRule).not.toContain("contain-intrinsic-size")
  expect(bubbleRowRule).not.toContain("overflow-clip-margin")
  expect(cardRule).not.toContain("content-visibility")
  expect(cardRule).not.toContain("contain-intrinsic-size")
})

test("auto-scroll source does not reference DOM observer constructors", () => {
  const source = readFileSync(join(import.meta.dir, "../src/utils/dom-utils.ts"), "utf8")
  expect(source).not.toContain("new ResizeObserver")
  expect(source).not.toContain("new MutationObserver")
})

test("late-paint layout shift between rAFs re-pins to the new bottom", () => {
  // Regression for the user-reported "messages escape the bottom-scroll lock"
  // drift. Images / video without explicit dimensions, async syntax
  // highlighting, web-font swaps, and short CSS transitions on descendants
  // all grow scrollHeight AFTER the scheduleFollowScroll rAF lands its
  // `scrollTop = scrollHeight` write. With `data-follow-lock="true"` we
  // explicitly disable the browser's `overflow-anchor`, so without a
  // correction frame the user sees the conversation drift upward by exactly
  // the height the late layout gained. setupAutoScroll schedules a
  // follow-up rAF that re-measures and re-pins iff distance-from-bottom
  // exceeded BOTTOM_TOLERANCE.
  const el = createScrollElement()
  const frameQueue: FrameRequestCallback[] = []
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frameQueue.push(cb)
    return frameQueue.length
  }) as any

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => true,
    onUserScrollUp: () => {},
  })

  // Drain the initial mount rAF: pin to bottom of the seeded 300 height.
  frameQueue.shift()!(0)
  expect(el.scrollTop).toBe(200)

  // Streamed content grew the scrollable area to 420.
  el.scrollHeight = 420
  ctrl.contentChanged()

  // Frame 1 of scheduleFollowScroll — `scrollTop = scrollHeight` lands the
  // viewport on the current bottom (420 - 100 = 320).
  frameQueue.shift()!(0)
  expect(el.scrollTop).toBe(320)

  // Simulate late paint between the two rAFs (e.g., an <img> finished
  // loading and grew its bubble by 180px, or syntax highlighting expanded a
  // code block). scrollTop did NOT change, so the viewport now sits well
  // above the true bottom.
  el.scrollHeight = 600
  expect(el.scrollHeight - el.clientHeight - el.scrollTop).toBe(180)

  // Frame 2 of scheduleFollowScroll — the post-pin correction frame must
  // detect the drift and re-pin (600 - 100 = 500).
  frameQueue.shift()!(0)
  expect(el.scrollTop).toBe(500)

  ctrl.cleanup()
})

test("late-paint correction respects a user who scrolled away between frames", () => {
  // The post-pin correction frame must NOT yank the user back if they
  // disabled tracking between the first and second rAF — e.g. the late
  // paint happened concurrently with a wheel scroll-up that already fired
  // `onUserScrollUp`. Otherwise the controller would fight the user.
  const el = createScrollElement()
  let tracking = true
  const frameQueue: FrameRequestCallback[] = []
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frameQueue.push(cb)
    return frameQueue.length
  }) as any

  const ctrl = setupAutoScroll(el as any, {
    isTracking: () => tracking,
    onUserScrollUp: () => {
      tracking = false
    },
  })

  // Mount frame snaps to bottom.
  frameQueue.shift()!(0)
  expect(el.scrollTop).toBe(200)

  el.scrollHeight = 420
  ctrl.contentChanged()
  // Frame 1 pins.
  frameQueue.shift()!(0)
  expect(el.scrollTop).toBe(320)

  // User scrolls upward between the two frames.
  el.dispatchEvent(wheel(-120))
  el.scrollTop = 140
  el.dispatchEvent(new Event("scroll"))
  expect(tracking).toBe(false)

  // Late paint grows scrollHeight. Correction frame must respect the
  // freshly-disabled tracking and leave the user where they parked.
  el.scrollHeight = 600
  frameQueue.shift()!(0)
  expect(el.scrollTop).toBe(140)

  ctrl.cleanup()
})
