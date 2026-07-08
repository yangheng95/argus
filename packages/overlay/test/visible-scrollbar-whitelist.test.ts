import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const BASE_CSS = readFileSync(join(import.meta.dir, "../src/styles/cascade/base.css"), "utf8")

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
  test("work ledger keeps the always-visible primary scrollbar source", () => {
    expect(ruleBodyForSelectorGroup("#workLedgerPanel")).toContain("scrollbar-width: auto")
    expect(ruleBodyForSelectorGroup("#workLedgerPanel")).toContain(
      "scrollbar-color: var(--scrollbar-thumb) var(--session-scrollbar-track)",
    )
    expect(ruleBodyForSelectorGroup(group("#chatScroll::-webkit-scrollbar", "#workLedgerPanel::-webkit-scrollbar"))).toContain(
      "width: var(--session-scrollbar-size)",
    )
    expect(ruleBodyForSelectorGroup("#workLedgerPanel::-webkit-scrollbar-track")).toContain(
      "background: var(--session-scrollbar-track)",
    )
    expect(ruleBodyForSelectorGroup("#workLedgerPanel::-webkit-scrollbar-thumb")).toContain(
      "background: var(--scrollbar-thumb)",
    )
    expect(ruleBodyForSelectorGroup("#workLedgerPanel::-webkit-scrollbar-thumb:hover")).toContain(
      "background: var(--scrollbar-thumb-hover)",
    )
  })

  test("chat transcript scrollbar is visually revealed by hover or focus", () => {
    expect(ruleBodyForSelectorGroup("#chatScroll")).toContain("scrollbar-width: auto")
    expect(ruleBodyForSelectorGroup("#chatScroll")).toContain("scrollbar-color: transparent transparent")
    expect(ruleBodyForSelectorGroup(group("#chatScroll:hover", "#chatScroll:focus", "#chatScroll:focus-within"))).toContain(
      "scrollbar-color: var(--scrollbar-thumb) var(--session-scrollbar-track)",
    )
    expect(ruleBodyForSelectorGroup("#chatScroll::-webkit-scrollbar-track")).toContain("background: transparent")
    expect(ruleBodyForSelectorGroup("#chatScroll::-webkit-scrollbar-thumb")).toContain("background: transparent")
    expect(
      ruleBodyForSelectorGroup(
        group(
          "#chatScroll:hover::-webkit-scrollbar-track",
          "#chatScroll:focus::-webkit-scrollbar-track",
          "#chatScroll:focus-within::-webkit-scrollbar-track",
        ),
      ),
    ).toContain("background: var(--session-scrollbar-track)")
    expect(
      ruleBodyForSelectorGroup(
        group(
          "#chatScroll:hover::-webkit-scrollbar-thumb",
          "#chatScroll:focus::-webkit-scrollbar-thumb",
          "#chatScroll:focus-within::-webkit-scrollbar-thumb",
        ),
      ),
    ).toContain("background: var(--scrollbar-thumb)")
    expect(
      ruleBodyForSelectorGroup(
        group(
          "#chatScroll:hover::-webkit-scrollbar-thumb:hover",
          "#chatScroll:focus::-webkit-scrollbar-thumb:hover",
          "#chatScroll:focus-within::-webkit-scrollbar-thumb:hover",
        ),
      ),
    ).toContain("background: var(--scrollbar-thumb-hover)")
  })

  test("retired Mission conversation scrollbar selector is not reintroduced", () => {
    expect(BASE_CSS).not.toContain("mission-conversation-body")
  })
})
