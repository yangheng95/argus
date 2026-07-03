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
        text: "Header Navigation Markets News Economy Calendar Countries Ideas Overview Reports GDP Inflation Calendar",
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

  test("skips unbounded and zero-area source component patterns without dropping bounded candidates", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_local_module_mixed_content_model_patterns"
    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    await fs.mkdir(path.join(paths.sourcePackageAbsolute, "source-ir"), { recursive: true })
    await fs.writeFile(
      path.join(paths.sourcePackageAbsolute, "source-ir", "content-model.json"),
      JSON.stringify(
        {
          sourceComponentPatterns: [
            {
              nodeId: "page-structure-only",
              tag: "div",
              kind: "data_grid_surface",
              textPreview: "Page shell Calendar Metrics News",
              signals: { elementCount: 120, textLength: 64 },
            },
            {
              nodeId: "sticky-navigation-wrapper",
              tag: "div",
              kind: "navigation_surface",
              bounds: { x: 0, y: 302, w: 1440, h: 0 },
              textPreview: "Overview Reports Alerts Integrations Settings",
              signals: { elementCount: 29, linkCount: 8, textLength: 58 },
            },
            sourcePatternRow({
              nodeId: "service-availability-chart",
              kind: "media_chart_surface",
              bounds: { x: 40, y: 454, w: 899, h: 587 },
              textPreview: "Service availability 99.95% Incidents Response time",
              recommendedReplacementKind: "chart_component",
            }),
          ],
        },
        null,
        2,
      ),
      "utf8",
    )

    const candidates = await collectSourceRegionCandidates({ projectRoot: tmp.path, taskID })
    expect(candidates.map((candidate) => candidate.id)).not.toContain("page-structure-only")
    expect(candidates.map((candidate) => candidate.id)).not.toContain("sticky-navigation-wrapper")
    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "service-availability-chart",
      componentFiles: ["src/components/ServiceAvailabilityChart.tsx"],
      explicitTextAnchors: ["Service availability", "Incidents", "Response time"],
      localCapture: {
        bbox: { x: 40, y: 420, width: 900, height: 560 },
        textAnchors: ["Service availability", "Incidents", "Response time"],
        fullText: "Service availability 99.95% Incidents Response time",
      },
    })

    expect(selected.id).toBe("service-availability-chart")
    expect(selected.source).toBe("source-component-pattern")
  })

  test("merges duplicate source component patterns with identical visual crop geometry", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_local_module_duplicate_content_model_patterns"
    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    await fs.mkdir(path.join(paths.sourcePackageAbsolute, "source-ir"), { recursive: true })
    await fs.writeFile(
      path.join(paths.sourcePackageAbsolute, "source-ir", "content-model.json"),
      JSON.stringify(
        {
          sourceComponentPatterns: [
            sourcePatternRow({
              nodeId: "node-service-chart-inner-a",
              kind: "media_chart_surface",
              bounds: { x: 57, y: 471, w: 865, h: 553 },
              textPreview: "Service availability 99.95% Incidents Response time",
              recommendedReplacementKind: "chart_component",
              signals: {
                display: "block",
                elementCount: 46,
                gridOrFlex: false,
                linkCount: 1,
                mediaCount: 4,
                tableRowCount: 2,
                textLength: 90,
              },
            }),
            sourcePatternRow({
              nodeId: "node-service-chart-inner-b",
              kind: "media_chart_surface",
              bounds: { x: 57, y: 471, w: 865, h: 553 },
              textPreview: "Service availability 99.95% Incidents Response time",
              recommendedReplacementKind: "chart_component",
              signals: {
                display: "flex",
                elementCount: 45,
                gridOrFlex: true,
                linkCount: 1,
                mediaCount: 4,
                tableRowCount: 2,
                textLength: 90,
              },
            }),
          ],
        },
        null,
        2,
      ),
      "utf8",
    )

    const candidates = await collectSourceRegionCandidates({ projectRoot: tmp.path, taskID })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.sourceRefs).toEqual(
      expect.arrayContaining(["node:node-service-chart-inner-a", "node:node-service-chart-inner-b"]),
    )
    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "service-availability-chart",
      componentFiles: ["src/components/ServiceAvailabilityChart.tsx"],
      explicitTextAnchors: ["Service availability", "Incidents", "Response time"],
      localCapture: {
        bbox: { x: 40, y: 420, width: 900, height: 560 },
        textAnchors: ["Service availability", "Incidents", "Response time"],
        fullText: "Service availability 99.95% Incidents Response time",
      },
    })

    expect(selected.id).toBe("node-service-chart-inner-a")
  })

  test("explicit region anchors outrank incidental local table text from a stronger source kind", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "node-operations-summary",
        source: "source-component-pattern",
        bbox: { x: 40, y: 362, width: 1360, height: 679 },
        text: "data_grid_surface Operations summary Open tickets Assigned owner Queue SLA Customer alpha Customer beta Escalated",
        sourceRefs: [
          "web-clone-source/source-ir/content-model.json",
          "node:node-operations-summary",
          "kind:data_grid_surface",
        ],
      },
      {
        id: "node-catalog-analysis-grid",
        source: "layout-map",
        bbox: { x: 40, y: 2042, width: 1360, height: 1238 },
        text: "Catalog analysis Inventory ranking Product Demand change Inventory level Supplier ranking Backorders Returns See all products Customer alpha Customer beta",
        sourceRefs: [
          "web-clone-source/source-ir/layout-map.json",
          "node:node-catalog-analysis-grid",
          "selector:section.catalog-analysis-grid",
        ],
      },
    ]

    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "catalog-analysis-grid",
      componentFiles: ["src/components/CatalogAnalysisGrid.tsx"],
      explicitTextAnchors: [
        "Catalog analysis",
        "Inventory ranking",
        "Supplier ranking",
        "Backorders",
        "Returns",
        "See all products",
      ],
      localCapture: {
        bbox: { x: 40, y: 2038, width: 1360, height: 1390 },
        textAnchors: ["Catalog analysis", "Customer alpha", "Customer beta", "Open tickets"],
        fullText:
          "Catalog analysis Inventory ranking Product Demand change Inventory level Customer alpha Customer beta Open tickets Supplier ranking Backorders Returns See all products",
      },
    })

    expect(selected.id).toBe("node-catalog-analysis-grid")
    expect(selected.source).toBe("layout-map")
    expect(selected.matchedAnchors).toEqual(expect.arrayContaining(["catalog analysis", "inventory ranking"]))
  })

  test("binds composite hero regions to the owning source section instead of a child tab strip", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "CountriesIdeasEconomicIndicatorsHeatRegion3",
        source: "layout-map",
        bbox: { x: 40, y: 222, width: 1360, height: 44 },
        text: "Overview Countries Ideas Economic indicators Heatmap",
        sourceRefs: ["web-clone-source/source-ir/layout-map.json", "selector:nav.section-tabs"],
      },
      {
        id: "node_000805",
        source: "layout-map",
        bbox: { x: 0, y: 56, width: 1440, height: 202 },
        text: "World Economy Global economy overview with markets, countries, ideas, and economic indicators for macro analysis",
        sourceRefs: ["web-clone-source/source-ir/layout-map.json", "node:node_000805"],
      },
    ]

    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "breadcrumb-hero-section-tabs",
      componentFiles: ["src/components/BreadcrumbHeroAndSectionTabs.tsx"],
      explicitTextAnchors: ["World Economy", "Countries", "Ideas", "Economic indicators"],
      localCapture: {
        bbox: { x: 0, y: 56, width: 1360, height: 202 },
        textAnchors: [
          "World Economy",
          "Global economy overview",
          "Markets",
          "Countries",
          "Ideas",
          "Economic indicators",
        ],
        fullText: "World Economy Global economy overview Markets Countries Ideas Economic indicators",
      },
    })

    expect(selected.id).toBe("node_000805")
    expect(selected.moduleCoverage?.accepted).toBe(true)
    expect(selected.matchedPrimaryPhrases).toEqual(expect.arrayContaining(["world economy", "global economy overview"]))
  })

  test("binds heatmap tables to table source regions instead of same-page section tabs", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "CountriesIdeasEconomicIndicatorsHeatRegion3",
        source: "layout-map",
        bbox: { x: 40, y: 222, width: 1360, height: 44 },
        text: "Overview Countries Ideas Economic indicators Heatmap",
        sourceRefs: ["web-clone-source/source-ir/layout-map.json", "selector:nav.section-tabs"],
      },
      {
        id: "node_002052",
        source: "layout-map",
        bbox: { x: 40, y: 2124, width: 1360, height: 688 },
        text: "Economic indicators heatmap GDP GDP Growth Interest Rate Inflation Rate Unemployment Rate Balance of Trade Current Account United States Germany China Japan",
        sourceRefs: ["web-clone-source/source-ir/layout-map.json", "node:node_002052"],
      },
    ]

    const selected = selectSourceRegionCandidate({
      candidates,
      regionID: "economic-indicators-heatmap-table",
      componentFiles: ["src/components/EconomicIndicatorsHeatmapTable.tsx"],
      explicitTextAnchors: ["Economic indicators heatmap", "GDP", "GDP Growth", "Interest Rate", "Inflation Rate"],
      localCapture: {
        bbox: { x: 40, y: 720, width: 1360, height: 650 },
        textAnchors: [
          "Economic indicators heatmap",
          "GDP",
          "GDP Growth",
          "Interest Rate",
          "Inflation Rate",
          "Unemployment Rate",
          "Balance of Trade",
          "Current Account",
        ],
        fullText:
          "Economic indicators heatmap GDP GDP Growth Interest Rate Inflation Rate Unemployment Rate Balance of Trade Current Account",
      },
    })

    expect(selected.id).toBe("node_002052")
    expect(selected.moduleCoverage?.accepted).toBe(true)
    expect(selected.moduleCoverage?.matchedCoveragePrimaryPhraseCount).toBeGreaterThanOrEqual(4)
  })

  test("rejects a tab-only source candidate for a full heatmap table module", () => {
    const candidates: SourceRegionCandidate[] = [
      {
        id: "CountriesIdeasEconomicIndicatorsHeatRegion3",
        source: "layout-map",
        bbox: { x: 40, y: 222, width: 1360, height: 44 },
        text: "Overview Countries Ideas Economic indicators Heatmap",
        sourceRefs: ["web-clone-source/source-ir/layout-map.json", "selector:nav.section-tabs"],
      },
    ]

    expect(() =>
      selectSourceRegionCandidate({
        candidates,
        regionID: "economic-indicators-heatmap-table",
        componentFiles: ["src/components/EconomicIndicatorsHeatmapTable.tsx"],
        explicitTextAnchors: ["Economic indicators heatmap", "GDP", "GDP Growth", "Interest Rate", "Inflation Rate"],
        localCapture: {
          bbox: { x: 40, y: 720, width: 1360, height: 650 },
          textAnchors: [
            "Economic indicators heatmap",
            "GDP",
            "GDP Growth",
            "Interest Rate",
            "Inflation Rate",
            "Unemployment Rate",
            "Balance of Trade",
            "Current Account",
          ],
          fullText:
            "Economic indicators heatmap GDP GDP Growth Interest Rate Inflation Rate Unemployment Rate Balance of Trade Current Account",
        },
      }),
    ).toThrow("No source candidate satisfied local module identity/coverage")
  })

  test("fails content component patterns whose bounds field is present but invalid", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_local_module_invalid_content_model_bounds"
    const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
    await fs.mkdir(path.join(paths.sourcePackageAbsolute, "source-ir"), { recursive: true })
    await fs.writeFile(
      path.join(paths.sourcePackageAbsolute, "source-ir", "content-model.json"),
      JSON.stringify(
        {
          sourceComponentPatterns: [
            {
              nodeId: "bad-pattern",
              tag: "section",
              kind: "data_grid_surface",
              bounds: { x: 10, y: 20 },
              textPreview: "Bad bounds",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    )

    await expect(collectSourceRegionCandidates({ projectRoot: tmp.path, taskID })).rejects.toThrow("invalid bounds")
  })

  test("benchmark binds constructed webpage components above ninety percent", async () => {
    const cases: BindingBenchmarkCase[] = [
      {
        id: "component-tree-navigation",
        expectedID: "PrimaryNavigation",
        regionID: "primary-navigation",
        componentFiles: ["src/components/PrimaryNavigation.tsx"],
        explicitTextAnchors: ["Markets", "Screeners", "Community"],
        localText: "Markets Screeners Community Products",
        localAnchors: ["Markets", "Screeners", "Community"],
        localBox: { x: 0, y: 0, width: 1280, height: 72 },
        componentTree: [
          componentTreeRow({
            id: "cmp-nav",
            name: "PrimaryNavigation",
            kind: "navigation",
            rootNodeId: "source-nav-root",
            bounds: { x: 0, y: 0, w: 1440, h: 82 },
            textPreview: ["Markets", "Screeners", "Community", "Products"],
          }),
        ],
      },
      {
        id: "pattern-card-collection",
        expectedID: "catalog-grid",
        regionID: "catalog-cards",
        componentFiles: ["src/components/CatalogCards.tsx"],
        explicitTextAnchors: ["Alpha Lamp", "Beta Chair"],
        localText: "Alpha Lamp Ships today Beta Chair Ships tomorrow",
        localAnchors: ["Alpha Lamp", "Beta Chair"],
        localBox: { x: 40, y: 120, width: 980, height: 340 },
        sourceComponentPatterns: [
          sourcePatternRow({
            nodeId: "catalog-grid",
            kind: "card_collection_surface",
            bounds: { x: 48, y: 140, w: 1020, h: 360 },
            textPreview: "Alpha Lamp Ships today Beta Chair Ships tomorrow Gamma Desk Ships Friday",
            recommendedReplacementKind: "card_collection_component",
          }),
        ],
      },
      {
        id: "pattern-data-grid",
        expectedID: "earnings-table",
        regionID: "earnings-table",
        componentFiles: ["src/components/EarningsTable.tsx"],
        explicitTextAnchors: ["Company", "Revenue", "EPS"],
        localText: "Company Revenue EPS Acme 12.4B 1.42",
        localAnchors: ["Company", "Revenue", "EPS"],
        localBox: { x: 60, y: 260, width: 1120, height: 420 },
        sourceComponentPatterns: [
          sourcePatternRow({
            nodeId: "earnings-table",
            kind: "data_grid_surface",
            bounds: { x: 72, y: 300, w: 1160, h: 460 },
            textPreview: "Company Revenue EPS Acme 12.4B 1.42",
            recommendedReplacementKind: "data_table_or_heatmap_component",
          }),
        ],
      },
      {
        id: "repeated-card-source-node",
        expectedID: "AnalystCardList",
        regionID: "analyst-cards",
        componentFiles: ["src/components/AnalystCardList.tsx"],
        explicitTextAnchors: ["node-analyst-cards"],
        localText: "Analyst Picks Buy Hold Sell",
        localAnchors: ["Analyst Picks", "Buy", "Hold"],
        localBox: { x: 40, y: 120, width: 860, height: 260 },
        componentTree: [
          componentTreeRow({
            id: "cmp-page",
            name: "PageShell",
            kind: "page",
            rootNodeId: "node-page",
            bounds: { x: 0, y: 0, w: 1440, h: 2400 },
            textPreview: ["Analyst Picks", "Buy", "Hold", "Sell", "Overview"],
          }),
          componentTreeRow({
            id: "cmp-analyst",
            name: "AnalystCardList",
            kind: "list",
            rootNodeId: "node-analyst-cards",
            bounds: { x: 56, y: 180, w: 900, h: 300 },
            textPreview: ["Analyst Picks", "Buy", "Hold", "Sell"],
          }),
        ],
      },
      {
        id: "repeated-table-source-node",
        expectedID: "CalendarTable",
        regionID: "calendar-table",
        componentFiles: ["src/components/CalendarTable.tsx"],
        explicitTextAnchors: ["node-calendar-table"],
        localText: "Time Event Actual Forecast GDP Growth CPI Rate",
        localAnchors: ["Time", "Event", "Actual", "Forecast"],
        localBox: { x: 32, y: 180, width: 1180, height: 520 },
        componentTree: [
          componentTreeRow({
            id: "cmp-calendar",
            name: "CalendarTable",
            kind: "table",
            rootNodeId: "node-calendar-table",
            bounds: { x: 42, y: 220, w: 1220, h: 560 },
            textPreview: ["Time", "Event", "Actual", "Forecast", "GDP Growth", "CPI Rate"],
          }),
        ],
        layoutMap: [
          layoutMapRow({
            nodeId: "calendar-time-cell",
            selector: "td.time",
            role: "cell",
            bounds: { x: 48, y: 260, w: 80, h: 24 },
            textPreview: "Time",
          }),
        ],
      },
      {
        id: "generic-page-shell-shared-words",
        expectedID: "OverviewMetrics",
        regionID: "overview-metrics",
        componentFiles: ["src/components/OverviewMetrics.tsx"],
        explicitTextAnchors: ["Overview", "Price", "Volume"],
        localText: "Overview Price Volume Market Cap",
        localAnchors: ["Overview", "Price", "Volume"],
        localBox: { x: 70, y: 240, width: 740, height: 220 },
        componentTree: [
          componentTreeRow({
            id: "cmp-shell",
            name: "PageOverviewShell",
            kind: "page",
            rootNodeId: "node-page-shell",
            bounds: { x: 0, y: 0, w: 1440, h: 3800 },
            textPreview: ["Overview", "Price", "Volume", "Market Cap", "News", "Ideas"],
          }),
          componentTreeRow({
            id: "cmp-metrics",
            name: "OverviewMetrics",
            kind: "section",
            rootNodeId: "node-overview-metrics",
            bounds: { x: 80, y: 260, w: 760, h: 240 },
            textPreview: ["Overview", "Price", "Volume", "Market Cap"],
          }),
        ],
      },
      {
        id: "component-level-outranks-tiny-layout-leaf",
        expectedID: "ResourceTabs",
        regionID: "resource-tabs",
        componentFiles: ["src/components/ResourceTabs.tsx"],
        explicitTextAnchors: ["Docs", "API", "Tutorials"],
        localText: "Docs API Tutorials Changelog",
        localAnchors: ["Docs", "API", "Tutorials"],
        localBox: { x: 100, y: 110, width: 620, height: 56 },
        componentTree: [
          componentTreeRow({
            id: "cmp-tabs",
            name: "ResourceTabs",
            kind: "control",
            rootNodeId: "node-resource-tabs",
            bounds: { x: 112, y: 124, w: 640, h: 64 },
            textPreview: ["Docs", "API", "Tutorials", "Changelog"],
          }),
        ],
        layoutMap: [
          layoutMapRow({
            nodeId: "tutorials-tab-text",
            selector: "button:nth-child(3)",
            role: "button",
            bounds: { x: 240, y: 132, w: 48, h: 18 },
            textPreview: "Tutorials",
          }),
        ],
      },
      {
        id: "non-latin-component-tree",
        expectedID: "国内生产总值卡片",
        regionID: "gdp-card",
        componentFiles: ["src/components/GdpCard.tsx"],
        explicitTextAnchors: ["国内生产总值", "同比增长"],
        localText: "国内生产总值 同比增长 预测",
        localAnchors: ["国内生产总值", "同比增长"],
        localBox: { x: 40, y: 120, width: 360, height: 180 },
        componentTree: [
          componentTreeRow({
            id: "cmp-cn-gdp",
            name: "国内生产总值卡片",
            kind: "card",
            rootNodeId: "node-cn-gdp",
            bounds: { x: 80, y: 420, w: 380, h: 200 },
            textPreview: ["国内生产总值", "同比增长", "预测"],
          }),
        ],
      },
      {
        id: "signed-numeric-pattern",
        expectedID: "gdp-negative-card",
        regionID: "gdp-growth-card",
        componentFiles: ["src/components/GdpGrowthCard.tsx"],
        explicitTextAnchors: ["GDP Growth", "-2.1%", "Forecast"],
        localText: "GDP Growth -2.1% Forecast",
        localAnchors: ["GDP Growth", "-2.1%", "Forecast"],
        localBox: { x: 32, y: 80, width: 320, height: 160 },
        sourceComponentPatterns: [
          sourcePatternRow({
            nodeId: "gdp-positive-card",
            kind: "section_shell_surface",
            bounds: { x: 80, y: 220, w: 320, h: 160 },
            textPreview: "GDP Growth +2.1% Forecast",
          }),
          sourcePatternRow({
            nodeId: "gdp-negative-card",
            kind: "section_shell_surface",
            bounds: { x: 80, y: 420, w: 320, h: 160 },
            textPreview: "GDP Growth -2.1% Forecast",
          }),
        ],
      },
      {
        id: "sparse-chart-identity",
        expectedID: "LiquidityChart",
        regionID: "liquidity-chart",
        componentFiles: ["src/components/LiquidityChart.tsx"],
        explicitTextAnchors: ["node-liquidity-chart", "Liquidity"],
        localText: "Liquidity",
        localAnchors: ["Liquidity"],
        localBox: { x: 72, y: 300, width: 860, height: 360 },
        componentTree: [
          componentTreeRow({
            id: "cmp-chart",
            name: "LiquidityChart",
            kind: "chart",
            rootNodeId: "node-liquidity-chart",
            bounds: { x: 86, y: 340, w: 900, h: 380 },
            textPreview: ["Liquidity"],
          }),
        ],
        sourceComponentPatterns: [
          sourcePatternRow({
            nodeId: "node-liquidity-chart",
            kind: "media_chart_surface",
            bounds: { x: 86, y: 340, w: 900, h: 380 },
            textPreview: "Liquidity",
            recommendedReplacementKind: "map_or_chart_asset_component",
          }),
        ],
      },
      {
        id: "footer-duplicated-links",
        expectedID: "GlobalFooterLinks",
        regionID: "footer-links",
        componentFiles: ["src/components/GlobalFooterLinks.tsx"],
        explicitTextAnchors: ["Products", "Community", "Company"],
        localText: "Products Community Company Terms Privacy",
        localAnchors: ["Products", "Community", "Company"],
        localBox: { x: 0, y: 1600, width: 1440, height: 280 },
        componentTree: [
          componentTreeRow({
            id: "cmp-header",
            name: "HeaderLinks",
            kind: "navigation",
            rootNodeId: "node-header-links",
            bounds: { x: 0, y: 0, w: 1440, h: 72 },
            textPreview: ["Products", "Community", "Markets"],
          }),
          componentTreeRow({
            id: "cmp-footer",
            name: "GlobalFooterLinks",
            kind: "footer",
            rootNodeId: "node-footer-links",
            bounds: { x: 0, y: 1680, w: 1440, h: 300 },
            textPreview: ["Products", "Community", "Company", "Terms", "Privacy"],
          }),
        ],
      },
      {
        id: "source-dom-region-identity",
        expectedID: "GeneratedWatchlistPanel",
        regionID: "watchlist-panel",
        componentFiles: ["src/components/WatchlistPanel.tsx"],
        explicitTextAnchors: ["segment-watchlist"],
        localText: "Watchlist Symbol Last Change",
        localAnchors: ["Watchlist", "Symbol", "Last"],
        localBox: { x: 980, y: 160, width: 360, height: 620 },
        sourceDomRegions: [
          {
            componentName: "GeneratedWatchlistPanel",
            sourceNodeId: "node-watchlist",
            sourceSegmentId: "segment-watchlist",
            sourceBounds: { x: 1000, y: 180, width: 380, height: 640 },
            heading: "Watchlist",
            textPreview: "Watchlist Symbol Last Change",
          },
        ],
        componentTree: [
          componentTreeRow({
            id: "cmp-watchlist-shell",
            name: "WatchlistShell",
            kind: "section",
            rootNodeId: "node-watchlist-shell",
            bounds: { x: 960, y: 140, w: 420, h: 700 },
            textPreview: ["Watchlist", "Symbol", "Last", "Change"],
          }),
        ],
      },
    ]

    const outcomes: Array<{ id: string; expected: string; actual?: string; error?: string }> = []
    for (const [index, item] of cases.entries()) {
      await using tmp = await tmpdir({ git: true })
      const taskID = `tsk_component_binding_benchmark_${index}_${item.id}`
      await writeBindingBenchmarkSourceEvidence(tmp.path, taskID, item)
      try {
        const candidates = await collectSourceRegionCandidates({ projectRoot: tmp.path, taskID })
        const selected = selectSourceRegionCandidate({
          candidates,
          regionID: item.regionID,
          componentFiles: item.componentFiles,
          explicitTextAnchors: item.explicitTextAnchors,
          localCapture: {
            bbox: item.localBox,
            textAnchors: item.localAnchors,
            fullText: item.localText,
          },
        })
        outcomes.push({ id: item.id, expected: item.expectedID, actual: selected.id })
      } catch (error) {
        outcomes.push({
          id: item.id,
          expected: item.expectedID,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const passed = outcomes.filter((item) => item.actual === item.expected).length
    const ratio = passed / outcomes.length
    expect(
      passed,
      `component binding benchmark exact failures=${JSON.stringify(
        outcomes.filter((item) => item.actual !== item.expected),
        null,
        2,
      )}`,
    ).toBe(outcomes.length)
    expect(
      ratio,
      `component binding benchmark passed ${passed}/${outcomes.length}; failures=${JSON.stringify(
        outcomes.filter((item) => item.actual !== item.expected),
        null,
        2,
      )}`,
    ).toBeGreaterThanOrEqual(0.9)
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

  test("writes stable source/local module comparison artifacts", async () => {
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
    expect(path.basename(artifacts.module_comparison)).toBe("module-comparison.png")
    const sourceCrop = await sharp(artifacts.source_crop).metadata()
    const implementationCrop = await sharp(artifacts.implementation_crop).metadata()
    const moduleComparison = await sharp(artifacts.module_comparison).metadata()
    expect(moduleComparison.width).toBeGreaterThanOrEqual(
      (sourceCrop.width ?? 0) + (implementationCrop.width ?? 0) + 24,
    )
    expect(moduleComparison.height).toBeGreaterThan(Math.max(sourceCrop.height ?? 0, implementationCrop.height ?? 0))
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
          expect(result.comparison_guidance.side_by_side_legend.source_of_truth).toBe("left")
          expect(result.comparison_guidance.side_by_side_legend.left.label).toBe("LEFT: source/reference image")
          expect(result.comparison_guidance.side_by_side_legend.right.label).toBe(
            "RIGHT: rendered/local implementation",
          )
          expect(result.comparison_guidance.inspection_checklist.map((check) => check.id)).toEqual(
            expect.arrayContaining(["layout_alignment", "icon_asset_fidelity", "implementation_artifacts"]),
          )
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
        const cropPixels = await sharp(result.artifacts.implementation_crop).raw().toBuffer({ resolveWithObject: true })
        const sampleOffset = (8 * cropPixels.info.width + 8) * cropPixels.info.channels
        expect(cropPixels.data[sampleOffset]).toBeGreaterThan(180)
        expect(cropPixels.data[sampleOffset + 1]).toBeGreaterThan(220)
        expect(cropPixels.data[sampleOffset + 2]).toBeGreaterThan(230)
      } finally {
        await server.close()
      }
    },
    { timeout: LOCAL_MODULE_BINDING_TEST_TIMEOUT_MILLISECONDS },
  )
})

type BindingBenchmarkCase = {
  id: string
  expectedID: string
  regionID: string
  componentFiles: string[]
  explicitTextAnchors: string[]
  localText: string
  localAnchors: string[]
  localBox: LocalModuleCapture["bbox"]
  componentTree?: unknown[]
  sourceComponentPatterns?: unknown[]
  visualSurfaceCandidates?: unknown[]
  layoutMap?: unknown[]
  sourceDomRegions?: unknown[]
}

function componentTreeRow(input: {
  id: string
  name: string
  kind: string
  rootNodeId: string
  bounds: { x: number; y: number; w: number; h: number }
  textPreview: string[]
}): Record<string, unknown> {
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    rootNodeId: input.rootNodeId,
    tag: input.kind === "navigation" ? "nav" : input.kind === "footer" ? "footer" : "section",
    strategy: "dom-component",
    bounds: input.bounds,
    classNames: [],
    textPreview: input.textPreview,
    assetSummary: { total: 0, byKind: {} },
    assetRefs: [],
    childElementCount: input.textPreview.length,
    implementationHint: "Benchmark source component.",
  }
}

function sourcePatternRow(input: {
  nodeId: string
  kind: string
  bounds: { x: number; y: number; w: number; h: number }
  textPreview: string
  recommendedReplacementKind?: string
  signals?: Record<string, unknown>
}): Record<string, unknown> {
  return {
    nodeId: input.nodeId,
    tag: input.kind === "navigation_surface" ? "nav" : "section",
    classNames: [],
    bounds: input.bounds,
    textPreview: input.textPreview,
    kind: input.kind,
    signals: input.signals ?? {
      elementCount: 8,
      linkCount: input.kind === "navigation_surface" ? 5 : 0,
      mediaCount: input.kind === "media_chart_surface" ? 2 : 0,
      tableRowCount: input.kind === "data_grid_surface" ? 6 : 0,
      maxRepeatedSiblingCount: input.kind === "card_collection_surface" ? 3 : 0,
      textLength: input.textPreview.length,
    },
    recommendedReplacementKind: input.recommendedReplacementKind ?? "baseline_defer",
    implementationHint: "Benchmark source component pattern.",
  }
}

function layoutMapRow(input: {
  nodeId: string
  selector: string
  role: string
  bounds: { x: number; y: number; w: number; h: number }
  textPreview: string
}): Record<string, unknown> {
  return {
    nodeId: input.nodeId,
    tag: input.role === "button" ? "button" : "div",
    selector: input.selector,
    role: input.role,
    bounds: input.bounds,
    styles: {},
    textPreview: input.textPreview,
  }
}

async function writeBindingBenchmarkSourceEvidence(
  projectRoot: string,
  taskID: string,
  item: BindingBenchmarkCase,
): Promise<void> {
  const paths = ProjectRuntimePaths.frontendDesignPaths(projectRoot, taskID)
  await fs.mkdir(paths.sourcePackageAbsolute, { recursive: true })
  await fs.mkdir(path.join(paths.sourcePackageAbsolute, "source-ir"), { recursive: true })
  await fs.mkdir(path.join(paths.skeletonProjectAbsolute, "src", "data"), { recursive: true })

  if (item.componentTree) {
    await fs.writeFile(
      path.join(paths.sourcePackageAbsolute, "source-ir", "component-tree.json"),
      JSON.stringify(
        {
          version: 1,
          purpose: "web-clone-component-tree",
          components: item.componentTree,
        },
        null,
        2,
      ),
      "utf8",
    )
  }
  if (item.sourceComponentPatterns) {
    await fs.writeFile(
      path.join(paths.sourcePackageAbsolute, "source-ir", "content-model.json"),
      JSON.stringify(
        {
          version: 1,
          purpose: "web-clone-content-model",
          tables: [],
          lists: [],
          cards: [],
          controls: [],
          links: [],
          media: [],
          repeatedGroups: [],
          sourceComponentPatterns: item.sourceComponentPatterns,
        },
        null,
        2,
      ),
      "utf8",
    )
  }
  if (item.visualSurfaceCandidates) {
    await fs.writeFile(
      path.join(paths.sourcePackageAbsolute, "visual-surface-candidates.json"),
      JSON.stringify({ candidates: item.visualSurfaceCandidates }, null, 2),
      "utf8",
    )
  }
  if (item.layoutMap) {
    await fs.writeFile(
      path.join(paths.sourcePackageAbsolute, "source-ir", "layout-map.json"),
      JSON.stringify({ version: 1, purpose: "web-clone-layout-map", elements: item.layoutMap }, null, 2),
      "utf8",
    )
  }
  if (item.sourceDomRegions) {
    await fs.writeFile(
      path.join(paths.skeletonProjectAbsolute, "src", "data", "sourceDomRegions.ts"),
      `export const sourceDomRegions = ${JSON.stringify(item.sourceDomRegions, null, 2)} as const\n`,
      "utf8",
    )
  }
}

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
            header {
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              height: 96px;
              z-index: 20;
              display: flex;
              align-items: center;
              padding-left: 24px;
              box-sizing: border-box;
              background: #020617;
              color: white;
            }
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
          <header>Fixed Header Should Not Pollute Crop</header>
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
