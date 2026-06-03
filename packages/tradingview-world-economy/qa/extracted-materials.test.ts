import { describe, expect, test } from "bun:test"
import { sourceComponents, sourceTables, sourceTextSignals } from "../src/data/sourceData"
import { sourceDomIterationState } from "../src/data/sourceDomIterationState"
import { highPrioritySourceDomReplacementPlan, sourceDomReplacementPlan } from "../src/data/sourceDomReplacementPlan"

describe("frontend_design extracted material baseline", () => {
  test("keeps extracted page regions as the visual source", () => {
    expect(sourceDomIterationState.purpose).toBe("source-dom-maintainable-iteration-state")
    expect(sourceDomIterationState.generatedRegionCount).toBeGreaterThan(0)
    expect(sourceDomIterationState.remainingRegionCount).toBe(sourceDomIterationState.generatedRegionCount)
    expect(sourceDomIterationState.semanticReplacementCount).toBe(2)
  })

  test("keeps source data and replacement plan available for maintainable iteration", () => {
    expect(sourceComponents.map((component) => component.name)).toContain("WEBCLONECSSSkeleton")
    expect(sourceTables.length).toBeGreaterThan(0)
    expect(sourceTextSignals).toContain("USA 2.70% \u202a29.18 T\u202c USD")
    expect(sourceDomReplacementPlan.length).toBe(sourceDomIterationState.remainingRegionCount)
    expect(highPrioritySourceDomReplacementPlan.map((item) => item.recommendedComponentName)).toContain("EconomicTrendsTable")
  })
})
