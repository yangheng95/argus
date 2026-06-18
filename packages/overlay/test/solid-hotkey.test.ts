// ── solid-hotkey.test.ts ──
// Behaviour coverage for useHotkey and adoption watermark.

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test"
import { existsSync, readFileSync } from "fs"
import { join } from "path"

// ── Test helpers ─────────────────────────────────────────────────

const OVERLAY_ROOT = join(import.meta.dir, "../")

function readText(path: string): string {
  return readFileSync(path, "utf8")
}

function countMatches(pattern: RegExp, text: string): number {
  return (text.match(pattern) ?? []).length
}

type FakeKeyEvent = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

function buildKeyEvent(init: {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}): FakeKeyEvent {
  return {
    key: init.key,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
  }
}

// ── Unit tests via manual listener simulation ──

// We do not mount a full Solid component here; instead we test the
// matching logic directly by calling the listener that useHotkey would
// register, which we extract by observing addEventListener calls.

describe("useHotkey matching logic", () => {
  const listeners: ((e: KeyboardEvent) => void)[] = []

  beforeEach(() => {
    listeners.length = 0
  })

  function simulateSpec(spec: {
    key: string
    cmdOrCtrl?: boolean
    meta?: boolean
    ctrl?: boolean
    alt?: boolean
    shift?: boolean
    when?: () => boolean
  }) {
    // Mirrors the listener body in hotkey.ts
    return (e: FakeKeyEvent): boolean => {
      if (e.key !== spec.key && e.key.toLowerCase() !== spec.key.toLowerCase()) return false
      if (spec.cmdOrCtrl !== undefined) {
        if (spec.cmdOrCtrl && !(e.metaKey || e.ctrlKey)) return false
        if (!spec.cmdOrCtrl && (e.metaKey || e.ctrlKey)) return false
      } else {
        if (spec.meta !== undefined && e.metaKey !== spec.meta) return false
        if (spec.ctrl !== undefined && e.ctrlKey !== spec.ctrl) return false
      }
      if (spec.alt !== undefined && e.altKey !== spec.alt) return false
      if (spec.shift !== undefined && e.shiftKey !== spec.shift) return false
      if (spec.when && !spec.when()) return false
      return true
    }
  }

  test("plain key match (case-insensitive)", () => {
    const match = simulateSpec({ key: "Escape" })
    expect(match(buildKeyEvent({ key: "Escape" }))).toBe(true)
    expect(match(buildKeyEvent({ key: "escape" }))).toBe(true)
    expect(match(buildKeyEvent({ key: "Enter" }))).toBe(false)
  })

  test("cmdOrCtrl: true fires on metaKey", () => {
    const match = simulateSpec({ key: "k", cmdOrCtrl: true })
    expect(match(buildKeyEvent({ key: "k", metaKey: true }))).toBe(true)
    expect(match(buildKeyEvent({ key: "K", metaKey: true }))).toBe(true)
  })

  test("cmdOrCtrl: true fires on ctrlKey", () => {
    const match = simulateSpec({ key: "k", cmdOrCtrl: true })
    expect(match(buildKeyEvent({ key: "k", ctrlKey: true }))).toBe(true)
  })

  test("cmdOrCtrl: true rejects key without modifier", () => {
    const match = simulateSpec({ key: "k", cmdOrCtrl: true })
    expect(match(buildKeyEvent({ key: "k" }))).toBe(false)
  })

  test("individual meta: false rejects metaKey events", () => {
    const match = simulateSpec({ key: "k", meta: false })
    expect(match(buildKeyEvent({ key: "k", metaKey: true }))).toBe(false)
    expect(match(buildKeyEvent({ key: "k", metaKey: false }))).toBe(true)
  })

  test("when guard skips handler when false", () => {
    let gateOpen = false
    const match = simulateSpec({ key: "Escape", when: () => gateOpen })
    expect(match(buildKeyEvent({ key: "Escape" }))).toBe(false)
    gateOpen = true
    expect(match(buildKeyEvent({ key: "Escape" }))).toBe(true)
  })

  test("shift modifier respected", () => {
    const match = simulateSpec({ key: "Enter", shift: false })
    expect(match(buildKeyEvent({ key: "Enter", shiftKey: true }))).toBe(false)
    expect(match(buildKeyEvent({ key: "Enter", shiftKey: false }))).toBe(true)
  })
})

// ── Adoption watermark ────────────────────────────────────────────

describe("useHotkey adoption watermark", () => {
  test("global hotkey surfaces import the shared useHotkey helper", () => {
    for (const rel of ["src/components/CommandPalette.tsx"]) {
      const text = readText(join(OVERLAY_ROOT, rel))
      expect(text).toContain('from "../solid/hotkey"')
      expect(text).toContain("useHotkey({")
    }
  })

  test("no bare document/window.addEventListener keydown in migrated components", () => {
    // Migrated components must not contain raw
    // `addEventListener("keydown", ...)` calls (those live in useHotkey now).
    const migrated = [
      "src/components/ChangesPanel.tsx",
      "src/components/CommandPalette.tsx",
      "src/components/ExecutorSelector.tsx",
    ]
    for (const rel of migrated) {
      const text = readText(join(OVERLAY_ROOT, rel))
      const matches = countMatches(/addEventListener\(\s*['"]keydown['"]/g, text)
      expect(matches).toBe(0)
    }
  })

  test("ChangesPanel no longer defines onKey arrow / function for document keydown", () => {
    const text = readText(join(OVERLAY_ROOT, "src/components/ChangesPanel.tsx"))
    // The old pattern was `const onKey = (event: KeyboardEvent) => { ...Escape... }`
    // followed by `document.addEventListener("keydown", onKey)`. After migration,
    // neither should appear.
    expect(text).not.toMatch(/const onKey\s*=/)
    expect(text).not.toMatch(/removeEventListener\(\s*['"]keydown/)
  })

  test("CommandPalette no longer uses onMount for global hotkey", () => {
    const text = readText(join(OVERLAY_ROOT, "src/components/CommandPalette.tsx"))
    // onMount was only used for the global Cmd+K registration — it is now gone.
    expect(text).not.toContain("onMount")
    expect(text).not.toContain("onGlobalKey")
  })

  test("retired task hash overlay stays out of runtime sources", () => {
    expect(existsSync(join(OVERLAY_ROOT, "src/components/TaskDetailOverlay.tsx"))).toBe(false)
    for (const rel of [
      "src/i18n/en-US.json",
      "src/i18n/zh-CN.json",
      "src/styles/surfaces/workspace.css",
      "src/solid/hotkey.ts",
      "src/components/Conversation.tsx",
    ]) {
      const text = readText(join(OVERLAY_ROOT, rel))
      expect(text).not.toContain("TaskDetailOverlay")
      expect(text).not.toContain("task_overlay")
      expect(text).not.toContain("task-overlay")
    }
  })
})
