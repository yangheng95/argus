import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const BASE_CSS = readFileSync(join(import.meta.dir, "../src/styles/cascade/base.css"), "utf8")

const LIVE_SCROLLERS = ["#chatScroll", "#workLedgerPanel"]

function normalize(input: string): string {
  return input.replace(/\s+/g, " ").trim()
}

function ruleBodyForSelectorGroup(selectorGroup: string): string {
  const escaped = selectorGroup.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\s\+/g, "\\s+")
  const match = BASE_CSS.match(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`))
  if (!match) throw new Error(`Missing scrollbar selector group: ${selectorGroup}`)
  return normalize(match[1] ?? "")
}

function group(...selectors: string[]): string {
  return selectors.join(",\n")
}

describe("visible scrollbar whitelist", () => {
  test("primary live scroll containers share one visible scrollbar source", () => {
    const baseGroup = group(...LIVE_SCROLLERS)
    const scrollbarGroup = group(...LIVE_SCROLLERS.map((selector) => `${selector}::-webkit-scrollbar`))
    const trackGroup = group(...LIVE_SCROLLERS.map((selector) => `${selector}::-webkit-scrollbar-track`))
    const thumbGroup = group(...LIVE_SCROLLERS.map((selector) => `${selector}::-webkit-scrollbar-thumb`))
    const hoverGroup = group(...LIVE_SCROLLERS.map((selector) => `${selector}::-webkit-scrollbar-thumb:hover`))

    expect(ruleBodyForSelectorGroup(baseGroup)).toContain("scrollbar-width: auto")
    expect(ruleBodyForSelectorGroup(baseGroup)).toContain(
      "scrollbar-color: var(--scrollbar-thumb) var(--session-scrollbar-track)",
    )
    expect(ruleBodyForSelectorGroup(scrollbarGroup)).toContain("width: var(--session-scrollbar-size)")
    expect(ruleBodyForSelectorGroup(trackGroup)).toContain("background: var(--session-scrollbar-track)")
    expect(ruleBodyForSelectorGroup(thumbGroup)).toContain("background: var(--scrollbar-thumb)")
    expect(ruleBodyForSelectorGroup(hoverGroup)).toContain("background: var(--scrollbar-thumb-hover)")
  })

  test("retired Mission conversation scrollbar selector is not reintroduced", () => {
    expect(BASE_CSS).not.toContain("mission-conversation-body")
  })
})
