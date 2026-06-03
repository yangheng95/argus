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

  test("webpage_render stays URL-only and runtime-neutral", () => {
    const renderTool = readSource("frontend-design/tools/webpage-render.ts")
    const renderCore = readSource("browser/webpage/render.ts")
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
    const source = readSource("frontend-design/tools/webpage-vision-judge.ts")
    expect(source).not.toContain("failurePayload")
    expect(source).not.toMatch(/accepted:\s*false/)
    expect(source).toContain("No verdict was written")
  })

  test("url extraction treats selected image download failure as fatal", () => {
    const source = readSource("browser/webpage/extract.ts")
    expect(source).not.toMatch(/browser context fallback/i)
    expect(source).not.toMatch(/best-effort/i)
    expect(source).not.toMatch(/non-fatal/i)
    expect(source).toMatch(/phase:\s*"asset"/)
    expect(source).toMatch(/image download failed/)
  })
})
