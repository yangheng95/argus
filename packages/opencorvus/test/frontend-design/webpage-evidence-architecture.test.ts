import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const PACKAGE_ROOT = path.join(import.meta.dir, "..", "..")
const SRC_ROOT = path.join(PACKAGE_ROOT, "src")
const TEST_ROOT = path.join(PACKAGE_ROOT, "test")

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), "utf8")
}

describe("webpage evidence architecture guards", () => {
  test("legacy mirror and package-level webpage evidence modules are retired", () => {
    expect(fs.existsSync(path.join(SRC_ROOT, "mirror"))).toBe(false)
    expect(fs.existsSync(path.join(SRC_ROOT, "webpage-evidence"))).toBe(false)
    expect(fs.existsSync(path.join(TEST_ROOT, "mirror"))).toBe(false)
    expect(fs.existsSync(path.join(TEST_ROOT, "webpage-evidence"))).toBe(false)
  })

  test("retired image-to-code tools are not registered", () => {
    const combined = [
      readSource("frontend-design/static-tools.ts"),
      readSource("frontend-design/tools/ids.ts"),
      readSource("tool/registry.ts"),
      readSource("frontend-design/agent.ts"),
    ].join("\n")
    expect(combined).not.toContain("webpage_image_")
    expect(combined).not.toContain("WebpageImage")
  })

  test("retired webpage visual gate tools have no implementation or runtime exposure", () => {
    const retiredToolIDs = ["webpage_render", "webpage_evaluate", "webpage_text_diff", "webpage_vision_judge"]
    const retiredFiles = [
      "frontend-design/tools/webpage-render.ts",
      "frontend-design/tools/webpage-evaluate.ts",
      "frontend-design/tools/webpage-text-diff.ts",
      "frontend-design/tools/webpage-vision-judge.ts",
    ]
    for (const file of retiredFiles) {
      expect(fs.existsSync(path.join(SRC_ROOT, file))).toBe(false)
    }

    const runtimeSources = [
      readSource("frontend-design/static-tools.ts"),
      readSource("visual-qa/static-tools.ts"),
      readSource("tool/registry.ts"),
      readSource("frontend-design/agent.ts"),
      readSource("visual-qa/agent.ts"),
      readSource("agent/agent.ts"),
    ].join("\n")
    for (const toolID of retiredToolIDs) {
      expect(runtimeSources).not.toContain(toolID)
    }

    const idsSource = readSource("frontend-design/tools/ids.ts")
    expect(idsSource).toContain("WEBPAGE_EVIDENCE_RETIRED_VISUAL_TOOL_IDS")
    for (const toolID of retiredToolIDs) {
      expect(idsSource).toContain(toolID)
    }
  })

  test("url extraction keeps DOM evidence independent from external image mirroring", () => {
    const source = readSource("browser/webpage/extract.ts")
    expect(source).not.toMatch(/browser context fallback/i)
    expect(source).not.toMatch(/reason:\s*`image download failed/)
    expect(source).toMatch(/skipped image/)
    expect(source).toMatch(/skipped \${skipped} unavailable images/)
  })
})
