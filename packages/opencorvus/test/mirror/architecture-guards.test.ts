import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const MIRROR_SRC = path.join(import.meta.dir, "..", "..", "src", "mirror")

function readMirrorSource(relativePath: string): string {
  return fs.readFileSync(path.join(MIRROR_SRC, relativePath), "utf8")
}

describe("mirror architecture guards", () => {
  test("webpage_render stays URL-only and runtime-neutral", () => {
    const renderTool = readMirrorSource("tools/webpage-render.ts")
    const renderCore = readMirrorSource("visual/render.ts")
    const combined = `${renderTool}\n${renderCore}`

    expect(combined).not.toMatch(/static[- ]file fallback/i)
    expect(combined).not.toMatch(/static mode/i)
    expect(combined).not.toMatch(/live-server mode/i)
    expect(combined).not.toMatch(/\bbun run dev\b/i)
    expect(combined).not.toMatch(/\bnpm start\b/i)
    expect(combined).not.toMatch(/createStaticServer/)
    expect(combined).not.toMatch(/node:http/)
    expect(renderTool).toMatch(/url:\s*z\s*\.\s*string\(\)\s*\.\s*url\(\)/)
    expect(renderCore).toMatch(/headless:\s*true/)
  })

  test("vision judge failures do not synthesize verdict files", () => {
    const source = readMirrorSource("tools/webpage-vision-judge.ts")
    expect(source).not.toContain("failurePayload")
    expect(source).not.toMatch(/accepted:\s*false/)
    expect(source).toContain("No verdict was written")
  })

  test("tier graph rejects missing contracts instead of heuristic grouping", () => {
    const source = readMirrorSource("shared/tier-graph.ts")
    expect(source).not.toMatch(/heuristic fallback/i)
    expect(source).not.toMatch(/FOUNDATION_PATTERNS/)
    expect(source).not.toMatch(/buildHeuristic/)
    expect(source).toMatch(/without explicit contracts\.imports/)
  })

  test("url extraction treats selected image download failure as fatal", () => {
    const source = readMirrorSource("url/extract.ts")
    expect(source).not.toMatch(/browser context fallback/i)
    expect(source).not.toMatch(/best-effort/i)
    expect(source).not.toMatch(/non-fatal/i)
    expect(source).toMatch(/phase:\s*"asset"/)
    expect(source).toMatch(/image download failed/)
  })
})
