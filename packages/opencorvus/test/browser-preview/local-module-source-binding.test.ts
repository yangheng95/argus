import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import { eq } from "drizzle-orm"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import {
  bindLocalModuleToSourceRegion,
  collectSourceRegionCandidates,
  materializeLocalModuleBindingArtifacts,
  selectSourceRegionCandidate,
  type LocalModuleCapture,
  type SourceRegionCandidate,
} from "../../src/browser-preview/local-module-source-binding"
import type { BrowserPreviewRegionLocator } from "../../src/browser-preview/region-comparison"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { persistTestBrowserPreviewTarget } from "../fixture/browser-preview"

const LOCAL_MODULE_BINDING_TEST_TIMEOUT_MILLISECONDS = 60_000

describe("browser preview local module source binding", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("selects the source module matching local anchors over page-wide candidates", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "main-page",
        source: "visual-surface-candidate",
        bbox: { x: 0, y: 0, width: 1440, height: 5200 },
        text: "Economy Overview Countries Ideas Economic Calendar FAQ",
        sourceRefs: ["visual-surface-candidates.json"],
      },
      {
        id: "EconomicCalendarRegion",
        source: "source-dom-region",
        bbox: { x: 40, y: 4580, width: 1360, height: 320 },
        text: "Economic Calendar RBA Interest Rate Decision RBA Press Conference Auto Production YoY Auto Sales YoY",
        sourceRefs: ["sourceDomRegions.ts"],
      },
    ]
    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "economic-calendar",
      componentFiles: ["src/components/EconomicCalendar.tsx"],
      explicitTextAnchors: ["RBA Interest Rate Decision"],
      localCapture: {
        bbox: { x: 40, y: 200, width: 1200, height: 280 },
        textAnchors: ["Economic Calendar", "RBA Press Conference", "Auto Sales YoY"],
        fullText: "Economic Calendar RBA Press Conference Auto Sales YoY",
      },
    })

    expect(selected.id).toBe("EconomicCalendarRegion")
    expect(selected.matchedAnchors).toContain("economic calendar")
  })

  test("selects a module-sized candidate when page-wide source-dom text shares the same anchors", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "WorldEconomyPage",
        source: "source-dom-region",
        bbox: { x: 0, y: 0, width: 1440, height: 5200 },
        text: "Header Navigation Markets News Economy Calendar Countries Ideas Overview Bonds Stocks GDP Inflation Calendar",
        sourceRefs: ["sourceDomRegions.ts"],
      },
      {
        id: "HeaderNavigationSurface",
        source: "visual-surface-candidate",
        bbox: { x: 0, y: 0, width: 1440, height: 92 },
        text: "Header Navigation Markets News Economy Calendar",
        sourceRefs: ["visual-surface-candidates.json"],
      },
      {
        id: "MarketsWord",
        source: "layout-map",
        bbox: { x: 220, y: 28, width: 74, height: 20 },
        text: "Markets",
        sourceRefs: ["layout-map.json"],
      },
    ]

    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "header-navigation",
      componentFiles: ["src/pages/world-economy/components/HeaderNavigation.tsx"],
      explicitTextAnchors: ["Markets", "News", "Economy Calendar"],
      localCapture: {
        bbox: { x: 0, y: 0, width: 1280, height: 76 },
        textAnchors: ["Markets", "News", "Economy Calendar"],
        fullText: "Markets News Economy Calendar",
      },
    })

    expect(selected.id).toBe("HeaderNavigationSurface")
    expect(selected.matchedAnchors).toContain("header navigation")
  })

  test("matches non-Latin source and local anchors without dropping visible text", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "PageShell",
        source: "source-dom-region",
        bbox: { x: 0, y: 0, width: 1440, height: 3200 },
        text: "概览 市场 新闻 国内生产总值 同比增长 预测",
        sourceRefs: ["sourceDomRegions.ts"],
      },
      {
        id: "国内生产总值卡片",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 420, width: 360, height: 180 },
        text: "国内生产总值 同比增长 预测",
        sourceRefs: ["visual-surface-candidates.json"],
      },
    ]

    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "gdp-card",
      componentFiles: ["src/components/GdpCard.tsx"],
      explicitTextAnchors: ["国内生产总值", "同比增长"],
      localCapture: {
        bbox: { x: 40, y: 120, width: 360, height: 180 },
        textAnchors: ["国内生产总值", "同比增长", "预测"],
        fullText: "国内生产总值 同比增长 预测",
      },
    })

    expect(selected.id).toBe("国内生产总值卡片")
    expect(selected.matchedAnchors).toContain("国内生产总值")
  })

  test("preserves signed numeric anchors so positive and negative metric cards stay distinct", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "GdpPositiveCard",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 220, width: 320, height: 160 },
        text: "GDP Growth +2.1% Forecast",
        sourceRefs: ["visual-surface-candidates.json", "candidate:gdp-positive"],
      },
      {
        id: "GdpNegativeCard",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 420, width: 320, height: 160 },
        text: "GDP Growth -2.1% Forecast",
        sourceRefs: ["visual-surface-candidates.json", "candidate:gdp-negative"],
      },
    ]

    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "gdp-growth-card",
      componentFiles: ["src/components/GdpGrowthCard.tsx"],
      explicitTextAnchors: ["GDP Growth", "+2.1%", "Forecast"],
      localCapture: {
        bbox: { x: 32, y: 80, width: 320, height: 160 },
        textAnchors: ["GDP Growth", "+2.1%", "Forecast"],
        fullText: "GDP Growth +2.1% Forecast",
      },
    })

    expect(selected.id).toBe("GdpPositiveCard")
    expect(selected.matchedAnchors).toContain("+2.1%")
    expect(selected.matchedAnchors).not.toContain("-2.1%")
  })

  test("preserves grouped currency anchors so metric magnitudes stay distinct", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "RevenueSmallCard",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 220, width: 340, height: 160 },
        text: "Revenue $1,234.56 Quarterly",
        sourceRefs: ["visual-surface-candidates.json", "candidate:revenue-small"],
      },
      {
        id: "RevenueLargeCard",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 420, width: 340, height: 160 },
        text: "Revenue $1,234,567.89 Quarterly",
        sourceRefs: ["visual-surface-candidates.json", "candidate:revenue-large"],
      },
    ]

    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "revenue-card",
      componentFiles: ["src/components/RevenueCard.tsx"],
      explicitTextAnchors: ["Revenue", "$1,234,567.89", "Quarterly"],
      localCapture: {
        bbox: { x: 32, y: 80, width: 340, height: 160 },
        textAnchors: ["Revenue", "$1,234,567.89", "Quarterly"],
        fullText: "Revenue $1,234,567.89 Quarterly",
      },
    })

    expect(selected.id).toBe("RevenueLargeCard")
    expect(selected.matchedAnchors).toContain("$1,234,567.89")
    expect(selected.matchedAnchors).not.toContain("$1,234.56")
  })

  test("does not match metric acronyms inside longer unrelated words", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "PrivacyTile",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 220, width: 320, height: 160 },
        text: "GDPR",
        sourceRefs: ["visual-surface-candidates.json", "candidate:privacy"],
      },
      {
        id: "OutputTile",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 420, width: 320, height: 160 },
        text: "GDP",
        sourceRefs: ["visual-surface-candidates.json", "candidate:output"],
      },
    ]

    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "stat",
      componentFiles: ["src/components/Tile.tsx"],
      explicitTextAnchors: ["GDP"],
      localCapture: {
        bbox: { x: 32, y: 80, width: 320, height: 160 },
        textAnchors: ["GDP"],
        fullText: "GDP",
      },
    })

    expect(selected.id).toBe("OutputTile")
    expect(selected.matchedAnchors).toContain("gdp")
  })

  test("normalizes dotted acronyms without collapsing decimal numbers", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "EuroZoneCard",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 220, width: 360, height: 160 },
        text: "EU GDP $1,234.56",
        sourceRefs: ["visual-surface-candidates.json", "candidate:country-one"],
      },
      {
        id: "UnitedStatesCard",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 420, width: 360, height: 160 },
        text: "U.S. GDP $1,234.56",
        sourceRefs: ["visual-surface-candidates.json", "candidate:country-two"],
      },
    ]

    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "country-gdp",
      componentFiles: ["src/components/CountryGdpCard.tsx"],
      explicitTextAnchors: ["US GDP", "$1,234.56"],
      localCapture: {
        bbox: { x: 32, y: 80, width: 360, height: 160 },
        textAnchors: ["US GDP", "$1,234.56"],
        fullText: "US GDP $1,234.56",
      },
    })

    expect(selected.id).toBe("UnitedStatesCard")
    expect(selected.matchedAnchors).toContain("us gdp")
    expect(selected.matchedAnchors).toContain("$1,234.56")
  })

  test("normalizes period-over-period slash abbreviations to compact metric anchors", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "RateChangeOne",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 220, width: 380, height: 160 },
        text: "GDP Growth Rate Q/Q",
        sourceRefs: ["visual-surface-candidates.json", "candidate:rate-one"],
      },
      {
        id: "RateChangeTwo",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 420, width: 380, height: 160 },
        text: "GDP Growth Rate Y/Y",
        sourceRefs: ["visual-surface-candidates.json", "candidate:rate-two"],
      },
    ]

    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "rate-change",
      componentFiles: ["src/components/RateChange.tsx"],
      explicitTextAnchors: ["GDP Growth Rate QoQ"],
      localCapture: {
        bbox: { x: 32, y: 80, width: 380, height: 160 },
        textAnchors: ["GDP Growth Rate QoQ"],
        fullText: "GDP Growth Rate QoQ",
      },
    })

    expect(selected.id).toBe("RateChangeOne")
    expect(selected.matchedAnchors).toContain("gdp growth rate qoq")
  })

  test("normalizes single-letter ampersand tickers to compact metric anchors", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "MarketIndexCard",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 220, width: 420, height: 160 },
        text: "S&P 500 Index Futures",
        sourceRefs: ["visual-surface-candidates.json", "candidate:spx"],
      },
      {
        id: "AdjacentIndexCard",
        source: "source-dom-region",
        bbox: { x: 80, y: 420, width: 420, height: 160 },
        text: "SP Global Index Futures",
        sourceRefs: ["frontend-design-skeleton/src/data/sourceDomRegions.ts", "component:AdjacentIndexCard"],
      },
    ]

    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "index-module",
      componentFiles: ["src/components/IndexModule.tsx"],
      explicitTextAnchors: ["SP 500 Index Futures"],
      localCapture: {
        bbox: { x: 32, y: 80, width: 420, height: 160 },
        textAnchors: ["SP 500 Index Futures"],
        fullText: "SP 500 Index Futures",
      },
    })

    expect(selected.id).toBe("MarketIndexCard")
    expect(selected.matchedAnchors).toContain("sp 500 index futures")
  })

  test("normalizes numeric en dash ranges to hyphenated range anchors", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "RateRangeCard",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 220, width: 420, height: 160 },
        text: "Federal Funds Rate 4.25%–4.50%",
        sourceRefs: ["visual-surface-candidates.json", "candidate:rate-range"],
      },
      {
        id: "AdjacentRateCard",
        source: "source-dom-region",
        bbox: { x: 80, y: 420, width: 420, height: 160 },
        text: "Federal Funds Rate Forecast",
        sourceRefs: ["frontend-design-skeleton/src/data/sourceDomRegions.ts", "component:AdjacentRateCard"],
      },
    ]

    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "rate-range",
      componentFiles: ["src/components/RateRange.tsx"],
      explicitTextAnchors: ["Federal Funds Rate 4.25%-4.50%"],
      localCapture: {
        bbox: { x: 32, y: 80, width: 420, height: 160 },
        textAnchors: ["Federal Funds Rate 4.25%-4.50%"],
        fullText: "Federal Funds Rate 4.25%-4.50%",
      },
    })

    expect(selected.id).toBe("RateRangeCard")
    expect(selected.matchedAnchors).toContain("federal funds rate 4.25%-4.50%")
  })

  test("normalizes decimal comma metrics without collapsing grouped currency anchors", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "InflationMetricCard",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 220, width: 420, height: 160 },
        text: "Inflation Rate 1,2%",
        sourceRefs: ["visual-surface-candidates.json", "candidate:inflation-decimal"],
      },
      {
        id: "InflationForecastCard",
        source: "source-dom-region",
        bbox: { x: 80, y: 420, width: 420, height: 160 },
        text: "Inflation Rate Forecast",
        sourceRefs: ["frontend-design-skeleton/src/data/sourceDomRegions.ts", "component:InflationForecastCard"],
      },
    ]

    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "inflation-decimal",
      componentFiles: ["src/components/InflationDecimal.tsx"],
      explicitTextAnchors: ["Inflation Rate 1.2%"],
      localCapture: {
        bbox: { x: 32, y: 80, width: 420, height: 160 },
        textAnchors: ["Inflation Rate 1.2%", "$1,234.56"],
        fullText: "Inflation Rate 1.2% $1,234.56",
      },
    })

    expect(selected.id).toBe("InflationMetricCard")
    expect(selected.matchedAnchors).toContain("inflation rate 1.2%")
  })

  test("normalizes fullwidth numeric metric anchors to ASCII implementation text", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "FullwidthCpiCard",
        source: "visual-surface-candidate",
        bbox: { x: 80, y: 220, width: 420, height: 160 },
        text: "CPI ２.１％",
        sourceRefs: ["visual-surface-candidates.json", "candidate:cpi-fullwidth"],
      },
      {
        id: "CpiForecastCard",
        source: "source-dom-region",
        bbox: { x: 80, y: 420, width: 420, height: 160 },
        text: "CPI Forecast",
        sourceRefs: ["frontend-design-skeleton/src/data/sourceDomRegions.ts", "component:CpiForecastCard"],
      },
    ]

    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "cpi-card",
      componentFiles: ["src/components/CpiCard.tsx"],
      explicitTextAnchors: ["CPI 2.1%"],
      localCapture: {
        bbox: { x: 32, y: 80, width: 420, height: 160 },
        textAnchors: ["CPI 2.1%"],
        fullText: "CPI 2.1%",
      },
    })

    expect(selected.id).toBe("FullwidthCpiCard")
    expect(selected.matchedAnchors).toContain("cpi 2.1%")
  })

  test("fails ambiguous duplicate source candidates instead of choosing the first match", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "MetricCardNorth",
        source: "visual-surface-candidate",
        bbox: { x: 40, y: 220, width: 320, height: 160 },
        text: "GDP Growth Latest Value Forecast",
        sourceRefs: ["visual-surface-candidates.json", "candidate:north"],
      },
      {
        id: "MetricCardSouth",
        source: "visual-surface-candidate",
        bbox: { x: 40, y: 420, width: 320, height: 160 },
        text: "GDP Growth Latest Value Forecast",
        sourceRefs: ["visual-surface-candidates.json", "candidate:south"],
      },
    ]

    expect(() =>
      selectSourceRegionCandidate({
        candidates,
        regionID: "metric-card",
        componentFiles: ["src/components/MetricCard.tsx"],
        explicitTextAnchors: ["GDP Growth", "Latest Value", "Forecast"],
        localCapture: {
          bbox: { x: 32, y: 80, width: 320, height: 160 },
          textAnchors: ["GDP Growth", "Latest Value", "Forecast"],
          fullText: "GDP Growth Latest Value Forecast",
        },
      }),
    ).toThrow("Ambiguous source candidates")
  })

  test("fails present but malformed source evidence instead of silently dropping it", async () => {
    for (const [caseID, content] of [
      ["broken-json", "{broken-json"],
      ["empty-json", ""],
    ] as const) {
      await using tmp = await tmpdir({ git: true })
      const taskID = `tsk_local_module_malformed_source_${caseID}`
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await fs.mkdir(path.join(paths.skeletonProjectAbsolute, "src", "data"), { recursive: true })
      await fs.writeFile(path.join(paths.sourcePackageAbsolute, "visual-surface-candidates.json"), content, "utf8")
      await fs.writeFile(
        path.join(paths.skeletonProjectAbsolute, "src", "data", "sourceDomRegions.ts"),
        `export const sourceDomRegions = ${JSON.stringify([
          {
            componentName: "ValidRegion",
            sourceBounds: { x: 10, y: 20, width: 120, height: 80 },
            heading: "Valid Region",
            textPreview: "Valid Region",
          },
        ])} as const\n`,
        "utf8",
      )

      await expect(collectSourceRegionCandidates({ projectRoot: tmp.path, taskID })).rejects.toThrow(
        "visual-surface-candidates.json",
      )
    }
  })

  test("fails present but wrong-shaped source evidence instead of treating it as no candidates", async () => {
    for (const [caseID, relativePath, content] of [
      ["visual-surface-wrong-shape", ["visual-surface-candidates.json"], '{ "bad": true }'],
      ["layout-map-wrong-shape", ["source-ir", "layout-map.json"], '{ "bad": true }'],
    ] as const) {
      await using tmp = await tmpdir({ git: true })
      const taskID = `tsk_local_module_wrong_shape_source_${caseID}`
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      const expectedFile = relativePath[relativePath.length - 1]!
      await fs.mkdir(path.join(paths.sourcePackageAbsolute, ...relativePath.slice(0, -1)), { recursive: true })
      await fs.mkdir(path.join(paths.skeletonProjectAbsolute, "src", "data"), { recursive: true })
      await fs.writeFile(path.join(paths.sourcePackageAbsolute, ...relativePath), content, "utf8")
      await fs.writeFile(
        path.join(paths.skeletonProjectAbsolute, "src", "data", "sourceDomRegions.ts"),
        `export const sourceDomRegions = ${JSON.stringify([
          {
            componentName: "ValidRegion",
            sourceBounds: { x: 10, y: 20, width: 120, height: 80 },
            heading: "Valid Region",
            textPreview: "Valid Region",
          },
        ])} as const\n`,
        "utf8",
      )

      await expect(collectSourceRegionCandidates({ projectRoot: tmp.path, taskID })).rejects.toThrow(expectedFile)
    }
  })

  test("preserves visual surface source refs so repeated modules can bind by source node", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_local_module_visual_source_refs"
    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
    await fs.writeFile(
      path.join(paths.sourcePackageAbsolute, "visual-surface-candidates.json"),
      JSON.stringify(
        {
          candidates: [
            {
              id: "surface-one",
              name: "Repeated Metric",
              rootNodeId: "node-primary-region",
              bounds: { x: 20, y: 40, w: 260, h: 120 },
              textPreview: ["Repeated Metric", "Latest Value"],
              sourceRefs: ["node-primary-title", "node-primary-value"],
            },
            {
              id: "surface-two",
              name: "Repeated Metric",
              rootNodeId: "node-secondary-region",
              bounds: { x: 20, y: 220, w: 260, h: 120 },
              textPreview: ["Repeated Metric", "Latest Value"],
              sourceRefs: ["node-secondary-title", "node-secondary-value"],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    )

    const candidates = await collectSourceRegionCandidates({ projectRoot: tmp.path, taskID })
    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "repeated-metric",
      componentFiles: ["src/components/RepeatedMetric.tsx"],
      explicitTextAnchors: ["node-primary-region"],
      localCapture: {
        bbox: { x: 32, y: 80, width: 260, height: 120 },
        textAnchors: ["Repeated Metric", "Latest Value"],
        fullText: "Repeated Metric Latest Value",
      },
    })

    expect(selected.id).toBe("surface-one")
    expect(selected.matchedAnchors).toContain("node primary region")
    expect(selected.sourceRefs).toContain("root:node-primary-region")
  })

  test("preserves source DOM node and segment refs so generated regions can bind by source identity", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_local_module_source_dom_refs"
    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    await fs.mkdir(path.join(paths.skeletonProjectAbsolute, "src", "data"), { recursive: true })
    await fs.writeFile(
      path.join(paths.skeletonProjectAbsolute, "src", "data", "sourceDomRegions.ts"),
      `export const sourceDomRegions = ${JSON.stringify(
        [
          {
            componentName: "GeneratedMetricOne",
            sourceNodeId: "dom-alpha-card",
            sourceSegmentId: "segment-alpha",
            sourceBounds: { x: 20, y: 40, width: 260, height: 120 },
            heading: "Repeated Metric",
            textPreview: "Repeated Metric Latest Value",
          },
          {
            componentName: "GeneratedMetricTwo",
            sourceNodeId: "dom-beta-card",
            sourceSegmentId: "segment-beta",
            sourceBounds: { x: 20, y: 220, width: 260, height: 120 },
            heading: "Repeated Metric",
            textPreview: "Repeated Metric Latest Value",
          },
        ],
        null,
        2,
      )} as const\n`,
      "utf8",
    )

    const candidates = await collectSourceRegionCandidates({ projectRoot: tmp.path, taskID })
    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "repeated-source-region",
      componentFiles: ["src/components/RepeatedSourceRegion.tsx"],
      explicitTextAnchors: ["segment-alpha"],
      localCapture: {
        bbox: { x: 32, y: 80, width: 260, height: 120 },
        textAnchors: ["Repeated Metric", "Latest Value"],
        fullText: "Repeated Metric Latest Value",
      },
    })

    expect(selected.id).toBe("GeneratedMetricOne")
    expect(selected.matchedAnchors).toContain("segment alpha")
    expect(selected.sourceRefs).toContain("segment:segment-alpha")
  })

  test("preserves layout map selector refs so repeated layout nodes can bind by selector identity", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_local_module_layout_selector_refs"
    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    await fs.mkdir(path.join(paths.sourcePackageAbsolute, "source-ir"), { recursive: true })
    await fs.writeFile(
      path.join(paths.sourcePackageAbsolute, "source-ir", "layout-map.json"),
      JSON.stringify(
        {
          elements: [
            {
              nodeId: "layout-row-one",
              selector: "[data-source-node='calendar-primary']",
              role: "row",
              bounds: { x: 20, y: 40, w: 260, h: 120 },
              textPreview: "Economic Calendar Latest Value",
            },
            {
              nodeId: "layout-row-two",
              selector: "[data-source-node='calendar-secondary']",
              role: "row",
              bounds: { x: 20, y: 220, w: 260, h: 120 },
              textPreview: "Economic Calendar Latest Value",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    )

    const candidates = await collectSourceRegionCandidates({ projectRoot: tmp.path, taskID })
    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "calendar-row",
      componentFiles: ["src/components/CalendarRow.tsx"],
      explicitTextAnchors: ["calendar-primary"],
      localCapture: {
        bbox: { x: 32, y: 80, width: 260, height: 120 },
        textAnchors: ["Economic Calendar", "Latest Value"],
        fullText: "Economic Calendar Latest Value",
      },
    })

    expect(selected.id).toBe("layout-row-one")
    expect(selected.matchedAnchors).toContain("calendar primary")
    expect(selected.sourceRefs).toContain("selector:[data-source-node='calendar-primary']")
  })

  test("fails present but malformed sourceDomRegions evidence instead of silently dropping it", async () => {
    for (const [caseID, content] of [
      ["wrong-shape", "export const sourceDomRegions = { bad: true } as const\n"],
      ["empty-file", ""],
    ] as const) {
      await using tmp = await tmpdir({ git: true })
      const taskID = `tsk_local_module_malformed_source_dom_${caseID}`
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
      await fs.mkdir(path.join(paths.skeletonProjectAbsolute, "src", "data"), { recursive: true })
      await fs.writeFile(
        path.join(paths.skeletonProjectAbsolute, "src", "data", "sourceDomRegions.ts"),
        content,
        "utf8",
      )

      await expect(collectSourceRegionCandidates({ projectRoot: tmp.path, taskID })).rejects.toThrow(
        "sourceDomRegions.ts",
      )
    }
  })

  test("writes stable source/local binding puzzle artifacts", async () => {
    await using tmp = await tmpdir()
    const sourceImagePath = path.join(tmp.path, "source.png")
    const localImagePath = path.join(tmp.path, "local.png")
    await sharp({
      create: { width: 800, height: 600, channels: 4, background: "#ffffff" },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="420" height="180" xmlns="http://www.w3.org/2000/svg">
              <rect width="420" height="180" fill="#f2f7ff"/>
              <text x="20" y="54" font-family="Arial" font-size="30" fill="#111827">Economic Calendar</text>
              <text x="20" y="104" font-family="Arial" font-size="20" fill="#374151">RBA Interest Rate Decision</text>
            </svg>`,
          ),
          left: 120,
          top: 220,
        },
      ])
      .png()
      .toFile(sourceImagePath)
    await sharp({
      create: { width: 700, height: 500, channels: 4, background: "#ffffff" },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="380" height="160" xmlns="http://www.w3.org/2000/svg">
              <rect width="380" height="160" fill="#f2f7ff"/>
              <text x="18" y="52" font-family="Arial" font-size="28" fill="#111827">Economic Calendar</text>
              <text x="18" y="98" font-family="Arial" font-size="18" fill="#374151">RBA Interest Rate Decision</text>
            </svg>`,
          ),
          left: 80,
          top: 150,
        },
      ])
      .png()
      .toFile(localImagePath)

    const localCapture: LocalModuleCapture = {
      screenshotPath: localImagePath,
      bbox: { x: 80, y: 150, width: 380, height: 160 },
      textAnchors: ["Economic Calendar", "RBA Interest Rate Decision"],
      fullText: "Economic Calendar RBA Interest Rate Decision",
    }
    const artifacts = await materializeLocalModuleBindingArtifacts({
      outDir: path.join(tmp.path, "out"),
      regionID: "economic-calendar",
      sourceImagePath,
      sourceCandidate: {
        id: "EconomicCalendarRegion",
        source: "source-dom-region",
        bbox: { x: 120, y: 220, width: 420, height: 180 },
        text: "Economic Calendar RBA Interest Rate Decision",
        sourceRefs: ["sourceDomRegions.ts"],
      },
      localCapture,
    })

    for (const file of Object.values(artifacts)) {
      const metadata = await sharp(file).metadata()
      expect(metadata.format).toBe("png")
      expect(metadata.width).toBeGreaterThan(0)
      expect(metadata.height).toBeGreaterThan(0)
    }
    expect(path.basename(artifacts.binding_puzzle)).toBe("binding-puzzle.png")
  })

  test(
    "rejects hidden and zero-size local module implementation locators before writing passed binding evidence",
    async () => {
      for (const mode of ["hidden", "zero-size"] as const) {
        await using tmp = await tmpdir({ git: true })
        const taskID = await seedTask(tmp.path)
        const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
        await writeReferenceScreenshot(paths.sourcePackageAbsolute)
        const server = await startLocalModuleServer(mode)
        try {
          const target = await Instance.provide({
            directory: tmp.path,
            fn: () => persistTestBrowserPreviewTarget({ taskID, url: server.url }),
          })

          await expect(
            bindLocalModuleToSourceRegion({
              projectRoot: tmp.path,
              taskID,
              targetID: target.id,
              viewportID: "desktop",
              regionID: `local-${mode}`,
              route: "/",
              implementationLocator: { kind: "data-oc-region", value: "local-module" },
              componentFiles: ["src/LocalModule.tsx"],
              sourceReferenceArtifactID: "reference.png",
              textAnchors: ["Local Module"],
              sourcePadding: 0,
              localPadding: 0,
            }),
          ).rejects.toThrow("Implementation locator did not match any visible element.")

          const evidenceRows = await Instance.provide({
            directory: tmp.path,
            fn: () =>
              Database.use((db) =>
                db.select().from(EngineArtifactTable).where(eq(EngineArtifactTable.task_id, taskID)).all(),
              ),
          })
          expect(evidenceRows.filter((row) => row.kind === "browser_preview_evidence")).toHaveLength(0)
        } finally {
          await server.close()
        }
      }
    },
    { timeout: LOCAL_MODULE_BINDING_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "rejects late browser page errors before writing passed binding evidence",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await writeReferenceScreenshot(paths.sourcePackageAbsolute)
      await writeSourceCandidateFiles(paths.sourcePackageAbsolute)
      const server = await startLatePageErrorLocalModuleServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistTestBrowserPreviewTarget({ taskID, url: server.url }),
        })

        await expect(
          bindLocalModuleToSourceRegion({
            projectRoot: tmp.path,
            taskID,
            targetID: target.id,
            viewportID: "desktop",
            regionID: "local-module",
            route: "/",
            implementationLocator: { kind: "data-oc-region", value: "local-module" },
            componentFiles: ["src/LocalModule.tsx"],
            sourceReferenceArtifactID: "reference.png",
            textAnchors: ["Local Module", "Deep Anchor"],
            sourcePadding: 0,
            localPadding: 0,
          }),
        ).rejects.toThrow("late local module pageerror")

        const evidenceRows = await Instance.provide({
          directory: tmp.path,
          fn: () =>
            Database.use((db) =>
              db.select().from(EngineArtifactTable).where(eq(EngineArtifactTable.task_id, taskID)).all(),
            ),
        })
        expect(evidenceRows.filter((row) => row.kind === "browser_preview_evidence")).toHaveLength(0)
      } finally {
        await server.close()
      }
    },
    { timeout: LOCAL_MODULE_BINDING_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "binds local modules through test-id, role, and owned selector locators",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await writeReferenceScreenshot(paths.sourcePackageAbsolute)
      await writeLocatorVariantCandidateFiles(paths.sourcePackageAbsolute)
      const server = await startLocatorVariantServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistTestBrowserPreviewTarget({ taskID, url: server.url }),
        })

        const locators: Array<{ label: string; locator: BrowserPreviewRegionLocator }> = [
          { label: "test-id", locator: { kind: "test-id", value: "locator-module" } },
          { label: "role", locator: { kind: "role", role: "region", name: "Locator Module" } },
          {
            label: "selector",
            locator: { kind: "selector", value: ".locator-module", owner_file: "src/LocatorModule.tsx" },
          },
        ]

        for (const item of locators) {
          const result = await bindLocalModuleToSourceRegion({
            projectRoot: tmp.path,
            taskID,
            targetID: target.id,
            viewportID: "desktop",
            regionID: `locator-${item.label}`,
            route: "/",
            implementationLocator: item.locator,
            componentFiles: ["src/LocatorModule.tsx"],
            sourceReferenceArtifactID: "reference.png",
            textAnchors: ["Locator Module", "Shared Anchor"],
            sourcePadding: 0,
            localPadding: 0,
          })

          expect(result.status).toBe("passed")
          expect(result.sourceCandidate.id).toBe("LocatorModuleSurface")
          expect(result.binding.implementation.locator).toEqual(item.locator)
          expect(result.localCapture.textAnchors).toContain("Locator Module")
        }
      } finally {
        await server.close()
      }
    },
    { timeout: LOCAL_MODULE_BINDING_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "binds a visible below-fold local module using full-page screenshot coordinates",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await writeReferenceScreenshot(paths.sourcePackageAbsolute)
      await writeSourceCandidateFiles(paths.sourcePackageAbsolute)
      const server = await startBelowFoldModuleServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistTestBrowserPreviewTarget({ taskID, url: server.url }),
        })

        const result = await bindLocalModuleToSourceRegion({
          projectRoot: tmp.path,
          taskID,
          targetID: target.id,
          viewportID: "desktop",
          regionID: "local-module",
          route: "/",
          implementationLocator: { kind: "data-oc-region", value: "local-module" },
          componentFiles: ["src/LocalModule.tsx"],
          sourceReferenceArtifactID: "reference.png",
          textAnchors: ["Local Module", "Deep Anchor"],
          sourcePadding: 0,
          localPadding: 0,
        })

        expect(result.status).toBe("passed")
        expect(result.sourceCandidate.id).toBe("LocalModuleSurface")
        expect(result.localCapture.bbox.y).toBeGreaterThan(900)
        expect(result.localCapture.bbox.height).toBeGreaterThan(90)
        const implementationCrop = await sharp(result.artifacts.implementation_crop).metadata()
        expect(implementationCrop.width).toBeGreaterThan(160)
        expect(implementationCrop.height).toBeGreaterThan(90)
      } finally {
        await server.close()
      }
    },
    { timeout: LOCAL_MODULE_BINDING_TEST_TIMEOUT_MILLISECONDS },
  )
})

async function seedTask(directory: string): Promise<string> {
  const taskID = `tsk_local_module_visible_${Date.now()}_${Math.random().toString(16).slice(2)}`
  await Instance.provide({
    directory,
    fn: () => {
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "Local module visible locator task",
            request: "Bind local module",
            source: "api",
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run(),
      )
    },
  })
  return taskID
}

async function writeReferenceScreenshot(sourcePackageAbsolute: string): Promise<void> {
  await fs.mkdir(sourcePackageAbsolute, { recursive: true })
  await sharp({
    create: {
      width: 240,
      height: 180,
      channels: 4,
      background: "#ffffff",
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="120" height="80" xmlns="http://www.w3.org/2000/svg">
            <rect width="120" height="80" fill="#e0f2fe"/>
            <text x="12" y="44" font-family="Arial" font-size="18" fill="#075985">Local Module</text>
          </svg>`,
        ),
        left: 20,
        top: 20,
      },
    ])
    .png()
    .toFile(path.join(sourcePackageAbsolute, "reference.png"))
}

async function writeSourceCandidateFiles(sourcePackageAbsolute: string): Promise<void> {
  await fs.writeFile(
    path.join(sourcePackageAbsolute, "visual-surface-candidates.json"),
    JSON.stringify(
      {
        candidates: [
          {
            id: "LocalModuleSurface",
            name: "Local Module",
            bounds: { x: 20, y: 20, w: 120, h: 80 },
            textPreview: ["Local Module", "Deep Anchor"],
          },
          {
            id: "PageShell",
            name: "Page Shell",
            bounds: { x: 0, y: 0, w: 240, h: 180 },
            textPreview: ["Local Module", "Deep Anchor", "Overview"],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  )
}

async function writeLocatorVariantCandidateFiles(sourcePackageAbsolute: string): Promise<void> {
  await fs.writeFile(
    path.join(sourcePackageAbsolute, "visual-surface-candidates.json"),
    JSON.stringify(
      {
        candidates: [
          {
            id: "LocatorModuleSurface",
            name: "Locator Module",
            bounds: { x: 20, y: 20, w: 120, h: 80 },
            textPreview: ["Locator Module", "Shared Anchor"],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  )
}

async function startLocalModuleServer(
  mode: "hidden" | "zero-size",
): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((_req, res) => {
    const regionRule =
      mode === "hidden"
        ? "display: none; width: 180px; height: 120px;"
        : "width: 0; height: 0; overflow: hidden; padding: 0; margin: 0;"
    const body = `<!doctype html>
      <html>
        <head>
          <title>Local module visible locator</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            [data-oc-region="local-module"] {
              ${regionRule}
              background: #e0f2fe;
              color: #075985;
            }
          </style>
        </head>
        <body><section data-oc-region="local-module">Local Module</section></body>
      </html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("local module test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function startLatePageErrorLocalModuleServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((_req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Late local module pageerror</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; min-height: 900px; }
            [data-oc-region="local-module"] {
              margin: 36px;
              width: 260px;
              height: 128px;
              box-sizing: border-box;
              padding: 18px;
              background: #e0f2fe;
              color: #075985;
            }
          </style>
          <script>setTimeout(() => { throw new Error("late local module pageerror") }, 100)</script>
        </head>
        <body>
          <section data-oc-region="local-module"><h2>Local Module</h2><p>Deep Anchor</p></section>
        </body>
      </html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("late pageerror test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function startLocatorVariantServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((_req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Locator variant module</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            main { padding: 42px; }
            .locator-module {
              width: 240px;
              height: 128px;
              box-sizing: border-box;
              padding: 18px;
              background: #dcfce7;
              color: #14532d;
            }
            h2 { margin: 0 0 14px; font-size: 24px; }
            p { margin: 0; font-size: 18px; }
          </style>
        </head>
        <body>
          <main>
            <section class="locator-module" data-testid="locator-module" role="region" aria-label="Locator Module">
              <h2>Locator Module</h2>
              <p>Shared Anchor</p>
            </section>
          </main>
        </body>
      </html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("locator variant test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function startBelowFoldModuleServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((_req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Below fold local module</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; min-height: 1500px; }
            [data-oc-region="local-module"] {
              margin-top: 1120px;
              margin-left: 36px;
              width: 220px;
              height: 118px;
              box-sizing: border-box;
              padding: 18px;
              background: #e0f2fe;
              color: #075985;
            }
            h2 { margin: 0 0 12px; font-size: 24px; }
            p { margin: 0; font-size: 18px; }
          </style>
        </head>
        <body>
          <section data-oc-region="local-module"><h2>Local Module</h2><p>Deep Anchor</p></section>
        </body>
      </html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("below-fold test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}
