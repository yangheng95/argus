import { describe, expect, test } from "bun:test"
import { statusBadge } from "../src/utils/status-badge"

// Disambiguates the 6 terminal/active outcomes that previously all
// collapsed into 4 badges (running / done / error / pending). After the
// fix:
//   completed clean      → done    ✓ green
//   completed w/ concerns → concerns ⚠ amber  (integrity verdict)
//   cancelled / aborted  → cancelled ⊘ outline (terminalReason)
//   error                → error   ✗ red
//   running              → running tone
//   pending              → pending ·

const base: any = { id: "x", kind: "agent", title: "x", time: 0, parts: [] }

describe("statusBadge — terminal outcome disambiguation", () => {
  test("clean completed → done ✓", () => {
    expect(statusBadge({ ...base, status: "completed" } as any)).toEqual({
      tone: "done",
      glyph: "✓",
    })
  })

  test("completed with integrity concerns → amber ⚠", () => {
    const node: any = {
      ...base,
      status: "completed",
      integrity: { verdict: "concerns" },
    }
    expect(statusBadge(node)).toEqual({ tone: "concerns", glyph: "⚠" })
  })

  test("completed with integrity needs_correction → amber ⚠", () => {
    const node: any = {
      ...base,
      status: "completed",
      integrity: { verdict: "needs_correction" },
    }
    expect(statusBadge(node)).toEqual({ tone: "concerns", glyph: "⚠" })
  })

  test("integrity verdict pass does NOT downgrade to concerns", () => {
    const node: any = {
      ...base,
      status: "completed",
      integrity: { verdict: "pass" },
    }
    expect(statusBadge(node)).toEqual({ tone: "done", glyph: "✓" })
  })

  test("error with terminalReason cancelled → outline ⊘", () => {
    const node: any = { ...base, status: "error", terminalReason: "cancelled" }
    expect(statusBadge(node)).toEqual({ tone: "cancelled", glyph: "⊘" })
  })

  test("error with terminalReason aborted → outline ⊘", () => {
    const node: any = { ...base, status: "error", terminalReason: "aborted" }
    expect(statusBadge(node)).toEqual({ tone: "cancelled", glyph: "⊘" })
  })

  test("error without terminalReason → red ✗", () => {
    const node: any = { ...base, status: "error" }
    expect(statusBadge(node)).toEqual({ tone: "error", glyph: "✗" })
  })

  test("pending / running / skipped retain prior tones", () => {
    expect(statusBadge({ ...base, status: "pending" } as any).tone).toBe("pending")
    expect(statusBadge({ ...base, status: "running" } as any).tone).toBe("running")
    expect(statusBadge({ ...base, status: "skipped" } as any).tone).toBe("skipped")
  })
})
