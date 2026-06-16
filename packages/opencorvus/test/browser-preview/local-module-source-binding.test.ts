import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import {
  materializeLocalModuleBindingArtifacts,
  selectSourceRegionCandidate,
  type LocalModuleCapture,
  type SourceRegionCandidate,
} from "../../src/browser-preview/local-module-source-binding"
import { tmpdir } from "../fixture/fixture"

describe("browser preview local module source binding", () => {
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
})
