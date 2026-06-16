import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

import {
  primaryWebpageEvidenceArtifacts,
  type LiveWebpageEvidencePipeline,
} from "../../src/orchestrator/webpage-evidence"
import {
  WEBPAGE_REFERENCE_IMAGE_EVIDENCE_ID,
  readPreparedWebpagePrdEvidence,
  prepareWebpagePrdEvidence,
  renderWebpagePrdEvidencePromptSection,
} from "../../src/research/webpage-prd-evidence"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { prepareWebCloneContext } from "../../src/web-clone/context"
import { tmpdir } from "../fixture/fixture"

const WEBPAGE_PRD_EVIDENCE_TIMEOUT_MS = 60_000

describe("research webpage PRD evidence", () => {
  test(
    "prepares rendered webpage evidence as the research prompt surface",
    async () => {
      await using tmp = await tmpdir()
      const taskID = "tsk_research_webpage_prd"
      const calls: string[] = []

      const evidence = await prepareWebpagePrdEvidence({
        projectDir: tmp.path,
        worktreeDir: tmp.path,
        taskID,
        sourceUrls: ["https://example.com/markets/world-economy/"],
        pipeline: fakePipeline(calls),
      })

      expect(evidence?.status).toBe("generated")
      expect(calls).toEqual([
        "extract:https://example.com/markets/world-economy/",
        "compile",
        "analyze",
        "captureRuntimeState:https://example.com/markets/world-economy/",
      ])
      expect(evidence?.excerpts.some((item) => item.excerpt.includes("Economic trends"))).toBe(true)

      const prompt = renderWebpagePrdEvidencePromptSection(evidence)
      expect(prompt).toContain("Prepared Webpage PRD Evidence")
      expect(prompt).toContain("Do not re-fetch this same URL")
      expect(prompt).toContain(
        "missing metadata, source text, or linked-source confirmation becomes an investigation-packet risk",
      )
      expect(prompt).toContain("Return `document_outline` as the visible-flow investigation module list")
      expect(prompt).toContain("Also register `webpage_contract` chunks")
      expect(prompt).toContain("functional_surfaces, visual_layout, style_requirements, interaction_states")
      expect(prompt).toContain("Register bundle sections for this webpage contract")
      expect(prompt).toContain("complete but bounded single-line points")
      expect(prompt).toContain("do not submit raw markdown or JSON documents as string fields")
      expect(prompt).toContain("work-packet inputs")
      expect(prompt).toContain("component-kind hypotheses")
      expect(prompt).not.toContain("1000+ substantive non-empty lines")
      expect(prompt).toContain("source-ir/interaction-state-snapshots.json")
      expect(prompt).toContain("factual runtime evidence")
      expect(prompt).toContain("Do not substitute a raw artifact/material list for this contract")
      expect(prompt).toContain("source-ir/content-model.json")
      expect(prompt).toContain("web-clone-source/reference.png")
      expect(prompt).toContain(`Required reference image evidence id: ${WEBPAGE_REFERENCE_IMAGE_EVIDENCE_ID}`)
      expect(prompt).toContain(
        `Register the captured reference screenshot as research evidence with id \`${WEBPAGE_REFERENCE_IMAGE_EVIDENCE_ID}\``,
      )
      expect(prompt).toContain(
        `Use \`${WEBPAGE_REFERENCE_IMAGE_EVIDENCE_ID}\` in \`webpage_contract.reference_image_evidence_ids\``,
      )
      expect(prompt).toContain(
        "include a downstream implementation point stating that build must inspect and reference",
      )
      expect(prompt).toContain("using the screenshot as visual truth instead of reconstructing layout from prose alone")
      expect(prompt).not.toContain("singlefile.html")
      expect(prompt).not.toContain("extracted-page.json")
    },
    { timeout: WEBPAGE_PRD_EVIDENCE_TIMEOUT_MS },
  )

  test(
    "clips large artifact excerpts before adding them to the prompt",
    async () => {
      await using tmp = await tmpdir()
      const taskID = "tsk_research_webpage_prd_clip"

      const evidence = await prepareWebpagePrdEvidence({
        projectDir: tmp.path,
        worktreeDir: tmp.path,
        taskID,
        sourceUrls: ["https://example.com/markets/world-economy/"],
        pipeline: fakePipeline([], { longEvidenceSummary: true }),
      })

      const summaryExcerpt = evidence?.excerpts.find((item) => item.label === "PRD evidence summary")
      expect(summaryExcerpt?.clipped).toBe(true)
      expect(summaryExcerpt?.excerpt).toContain("[artifact excerpt clipped:")
      expect(summaryExcerpt?.excerpt.length).toBeLessThan(2_700)
    },
    { timeout: WEBPAGE_PRD_EVIDENCE_TIMEOUT_MS },
  )

  test(
    "reads existing frontend-design evidence without running the live webpage pipeline",
    async () => {
      await using tmp = await tmpdir()
      const taskID = "tsk_research_webpage_prd_existing"
      const url = "https://example.com/markets/world-economy/"
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)

      await writeCompleteEvidence(paths.webpageEvidenceAbsolute, url, {})
      await prepareWebCloneContext({
        webpageEvidenceDir: paths.webpageEvidenceAbsolute,
        outputDir: paths.sourcePackageAbsolute,
      })

      const evidence = await readPreparedWebpagePrdEvidence({
        projectDir: tmp.path,
        taskID,
        url,
      })

      expect(evidence.status).toBe("reused")
      expect(evidence.webpageEvidenceRelative).toBe(paths.webpageEvidenceRelative)
      expect(evidence.sourcePackageRelative).toBe(paths.sourcePackageRelative)
      expect(evidence.referenceImageRelative).toBe(`${paths.sourcePackageRelative}/reference.png`)
      expect(evidence.referenceImageEvidenceID).toBe(WEBPAGE_REFERENCE_IMAGE_EVIDENCE_ID)
      expect(evidence.artifacts).toContain(`${paths.webpageEvidenceRelative}/prd-evidence-summary.md`)
      expect(evidence.artifacts).toContain(`${paths.sourcePackageRelative}/implementation-blueprint.md`)
      expect(evidence.excerpts.some((item) => item.excerpt.includes("Economic trends"))).toBe(true)
    },
    { timeout: WEBPAGE_PRD_EVIDENCE_TIMEOUT_MS },
  )

  test("rejects prepared evidence reads when frontend-design has not prepared the runtime package", async () => {
    await using tmp = await tmpdir()

    await expect(
      readPreparedWebpagePrdEvidence({
        projectDir: tmp.path,
        taskID: "tsk_research_webpage_prd_missing",
        url: "https://example.com/markets/world-economy/",
      }),
    ).rejects.toThrow("requires a complete runtime webpage evidence package")
  })
})

function fakePipeline(calls: string[], options: { longEvidenceSummary?: boolean } = {}): LiveWebpageEvidencePipeline {
  return {
    extract: async ({ outputDir, url }) => {
      calls.push(`extract:${url}`)
      await fs.mkdir(outputDir, { recursive: true })
      await fs.writeFile(path.join(outputDir, "extracted-page.json"), JSON.stringify({ url }), "utf8")
    },
    compile: async ({ outputDir }) => {
      calls.push("compile")
      await fs.mkdir(outputDir, { recursive: true })
    },
    analyze: async ({ outputDir }) => {
      calls.push("analyze")
      const extracted = JSON.parse(await fs.readFile(path.join(outputDir, "extracted-page.json"), "utf8"))
      await writeCompleteEvidence(outputDir, extracted.url, options)
    },
    captureRuntimeState: async ({ outputDir, url }) => {
      calls.push(`captureRuntimeState:${url}`)
      await writeRuntimeStateEvidence(outputDir, url)
    },
  }
}

async function writeCompleteEvidence(
  webpageEvidenceDir: string,
  url: string,
  options: { longEvidenceSummary?: boolean },
): Promise<void> {
  await fs.mkdir(webpageEvidenceDir, { recursive: true })
  for (const artifact of primaryWebpageEvidenceArtifacts()) {
    const relative = artifact.replace(/^webpage-evidence[\\/]/, "")
    const file = path.join(webpageEvidenceDir, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    if (relative === "reference.png" || relative === "reference-mobile.png") {
      await fs.writeFile(file, minimalPngBytes())
      continue
    }
    if (relative.startsWith("interaction-states/") && relative.endsWith(".png")) {
      await fs.writeFile(file, minimalPngBytes())
      continue
    }
    await fs.writeFile(file, artifactContent(relative, url, options), "utf8")
  }
}

function artifactContent(relative: string, url: string, options: { longEvidenceSummary?: boolean }): string {
  if (relative === "extracted-page.json") return JSON.stringify({ url })
  if (relative === "prd-evidence-summary.md") {
    const base = [
      "# Webpage frontend template Evidence Summary",
      "",
      "## Page Inventory",
      "- Header: logo, search, navigation, account CTA.",
      "- Economic trends: inflation map, GDP growth table, indicator cards.",
      "- News, calendar, FAQ, footer.",
    ].join("\n")
    return options.longEvidenceSummary ? `${base}\n${"Economic trends detail.\n".repeat(400)}` : base
  }
  if (relative === "source-ir/content-model.json") {
    return JSON.stringify(
      {
        tables: [{ title: "GDP growth", headers: ["Country", "GDP Growth", "Nominal GDP"] }],
        cards: [{ title: "US unemployment rate", text: ["Actual 4.3%", "Forecast 4.3%"] }],
        textSignals: ["Economy", "Overview", "Economic indicators heatmap"],
      },
      null,
      2,
    )
  }
  if (relative === "source-ir/component-tree.json") {
    return JSON.stringify({ components: [{ name: "Economic trends", kind: "section" }] }, null, 2)
  }
  if (relative === "source-ir/layout-map.json") {
    return JSON.stringify(
      { regions: [{ name: "Economic trends", bounds: { x: 40, y: 440, w: 1360, h: 620 } }] },
      null,
      2,
    )
  }
  if (relative === "source-ir/style-tokens.json") {
    return JSON.stringify({ colors: ["#ffffff", "#131722", "#2962ff"], fonts: ["Inter"] }, null, 2)
  }
  if (relative === "source-ir/style-profile.json") {
    return JSON.stringify(
      {
        version: 1,
        purpose: "web-clone-style-profile",
        regions: [
          {
            id: "economic-trends",
            name: "EconomicTrendsSkeleton",
            kind: "section",
            rootNodeId: "node-economic-trends",
            bounds: { x: 40, y: 440, w: 1360, h: 620 },
            styleSummary: {
              typography: [{ value: "font-size=14px; line-height=20px", count: 3 }],
              colors: [{ value: "#131722", count: 4 }],
              spacing: [{ value: "padding=40px", count: 1 }],
            },
          },
        ],
      },
      null,
      2,
    )
  }
  if (relative === "source-ir/interaction-hints.json") {
    return JSON.stringify({ interactions: [{ type: "tabs", label: "Popular Recent Video" }] }, null, 2)
  }
  if (relative === "source-ir/interaction-state-snapshots.json") {
    return JSON.stringify(
      {
        version: 1,
        purpose: "webpage-runtime-interaction-state-evidence",
        source: { url, viewport: { width: 1440, height: 900 }, captureEngine: "playwright" },
        snapshots: [
          { id: "initial", scrollY: 0, navigationClusters: [{ texts: ["Overview", "Countries", "Ideas"] }] },
          { id: "scroll-50", scrollY: 600, navigationClusters: [{ texts: ["Overview", "Countries", "Ideas"] }] },
        ],
        observations: [
          {
            kind: "persistent-viewport-position",
            elementKey: "tab:overview countries ideas",
            description: "Element text and viewport Y remain stable while document scroll position changes.",
          },
        ],
      },
      null,
      2,
    )
  }
  if (relative === "source-skeleton/source-skeleton-audit.json" || relative === "source-ir/source-quality-audit.json") {
    return JSON.stringify({ passed: true }, null, 2)
  }
  if (relative.endsWith(".json")) return JSON.stringify({ version: 1 }, null, 2)
  return `${relative}\n`
}

async function writeRuntimeStateEvidence(outputDir: string, url: string): Promise<void> {
  await fs.mkdir(path.join(outputDir, "source-ir"), { recursive: true })
  await fs.mkdir(path.join(outputDir, "interaction-states"), { recursive: true })
  for (const name of ["initial.png", "scroll-25.png", "scroll-50.png", "scroll-75.png"]) {
    await fs.writeFile(path.join(outputDir, "interaction-states", name), minimalPngBytes())
  }
  await fs.writeFile(
    path.join(outputDir, "source-ir", "interaction-state-snapshots.json"),
    artifactContent("source-ir/interaction-state-snapshots.json", url, {}),
    "utf8",
  )
}

function minimalPngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
    0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
}
