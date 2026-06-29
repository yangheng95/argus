/**
 * Coverage guard for Step 9.A (flat redesign migration contract §9.1).
 *
 * Two layers:
 *   1. Behaviour test — the hook itself returns a coherent open/toggle/
 *      close/openIt/set surface and the reactive accessor tracks
 *      mutations.
 *   2. Adoption guard — at least the migrated disclosure callsites in
 *      the codebase reference `useDisclosure` (a positive watermark,
 *      so future drift back to inline `createSignal(false)` fails the
 *      ratchet rather than going unnoticed).
 */

import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { useDisclosure } from "../src/solid/disclosure"

describe("useDisclosure — behaviour", () => {
  test("default initial is false", () => {
    createRoot((dispose) => {
      const { open } = useDisclosure()
      expect(open()).toBe(false)
      dispose()
    })
  })

  test("explicit initial overrides the default", () => {
    createRoot((dispose) => {
      const { open } = useDisclosure(true)
      expect(open()).toBe(true)
      dispose()
    })
  })

  test("toggle flips the state both directions", () => {
    createRoot((dispose) => {
      const { open, toggle } = useDisclosure()
      toggle()
      expect(open()).toBe(true)
      toggle()
      expect(open()).toBe(false)
      dispose()
    })
  })

  test("openIt forces true and is idempotent", () => {
    createRoot((dispose) => {
      const { open, openIt } = useDisclosure(false)
      openIt()
      expect(open()).toBe(true)
      openIt()
      expect(open()).toBe(true)
      dispose()
    })
  })

  test("close forces false and is idempotent", () => {
    createRoot((dispose) => {
      const { open, close, openIt } = useDisclosure(false)
      openIt()
      close()
      expect(open()).toBe(false)
      close()
      expect(open()).toBe(false)
      dispose()
    })
  })

  test("set accepts an explicit value", () => {
    createRoot((dispose) => {
      const { open, set } = useDisclosure(false)
      set(true)
      expect(open()).toBe(true)
      set(false)
      expect(open()).toBe(false)
      dispose()
    })
  })
})

describe("useDisclosure — adoption", () => {
  /** Walk the components/ tree and count `useDisclosure(...)` callsites.
   * A positive watermark — if Step 9.A migrated N callsites, future
   * drift back to inline `createSignal(false)` shows up as the count
   * dropping, not as a passing test that masks regression. */
  function countCallsites(): number {
    const COMPONENTS_ROOT = join(import.meta.dir, "..", "src", "components")
    let count = 0
    function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (name.endsWith(".tsx")) {
          const text = readFileSync(full, "utf8")
          const matches = text.matchAll(/\buseDisclosure\s*\(/g)
          for (const _ of matches) count++
        }
      }
    }
    walk(COMPONENTS_ROOT)
    return count
  }

  test("at least 5 components adopt useDisclosure", () => {
    // Step 9.A migrated 5 surfaces as the first batch (CommandPalette,
    // ExecutorSelector, ChatComposer expand, ChangesPanel goal-picker,
    // ConnectionBanner). Subsequent batches in 9.H lift the watermark.
    expect(countCallsites()).toBeGreaterThanOrEqual(5)
  })
})
