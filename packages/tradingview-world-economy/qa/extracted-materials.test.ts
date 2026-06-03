import { describe, expect, test } from "bun:test"
import { sourceTables, sourceTextSignals } from "../src/data/sourceData"
import { sourceDomIterationState } from "../src/data/sourceDomIterationState"
import { highPrioritySourceDomReplacementPlan, sourceDomReplacementPlan } from "../src/data/sourceDomReplacementPlan"
import { sourceDomRegions } from "../src/data/sourceDomRegions"
import { economicMetricCards, gdpGrowthRows, inflationMapPaths, worldEconomyCountryLinks } from "../src/data/economicTrendsExtracted"

describe("frontend_design extracted material baseline", () => {
  test("keeps extracted page regions as the visual source", () => {
    expect(sourceDomIterationState.purpose).toBe("source-dom-maintainable-iteration-state")
    expect(sourceDomIterationState.generatedRegionCount).toBe(15)
    expect(sourceDomIterationState.remainingRegionCount).toBe(0)
    expect(sourceDomIterationState.completedReplacementCount).toBe(15)
    expect(sourceDomIterationState.semanticReplacementCount).toBe(5)
  })

  test("keeps extracted source data and empty replacement plan aligned", () => {
    expect(sourceTables.length).toBeGreaterThan(0)
    expect(sourceTextSignals).toContain("USA 2.70% \u202a29.18 T\u202c USD")
    expect(sourceDomReplacementPlan.length).toBe(sourceDomIterationState.remainingRegionCount)
    expect(sourceDomRegions).toHaveLength(sourceDomIterationState.remainingRegionCount)
    expect(highPrioritySourceDomReplacementPlan).toHaveLength(0)
  })

  test("renders from extracted economic trend materials instead of source DOM regions", () => {
    expect(inflationMapPaths).toHaveLength(205)
    expect(gdpGrowthRows.map((row) => row.name)).toEqual(["India", "Indonesia", "Mainland China", "South Korea", "Saudi Arabia", "USA"])
    expect(worldEconomyCountryLinks.length).toBeGreaterThanOrEqual(20)
    expect(economicMetricCards.map((card) => card.ticker)).toEqual(["USUR", "USINTR", "USBOT"])
  })
})
