import { describe, expect, test } from "bun:test"
import { compileImageAnalysisToXML } from "../../../src/mirror/image/compile"
import { ImageAnalysisSchema, type ImageAnalysis } from "../../../src/mirror/ir/image-analysis"

const FIXTURE: ImageAnalysis = {
  description: "Single-screen demo",
  viewport: { width: 1440, height: 900 },
  tokens: {
    colors: { primary: "#1890ff", bg: "#ffffff", text: "#1f2937" },
    fonts: ["Inter", "PingFang SC"],
    textStyles: [
      { name: "h1", font: "Inter", size: 32, weight: 700, color: "#1f2937", lineHeight: 40 },
      { name: "body", size: 14, weight: 400, color: "#4b5563" },
    ],
  },
  tree: [
    {
      name: "page-root",
      role: "section",
      bounds: { x: 0, y: 0, w: 1440, h: 900 },
      layout: { direction: "vertical", gap: 24 },
      children: [
        {
          name: "hero-headline",
          bounds: { x: 24, y: 24, w: 1392, h: 48 },
          text: { content: "Welcome <home>", font: "Inter", size: 32, weight: 700, color: "#1f2937" },
        },
        {
          name: "primary-cta",
          role: "button",
          bounds: { x: 24, y: 88, w: 200, h: 44 },
          style: { bg: "#1890ff", borderRadius: 6, padding: [8, 16, 8, 16] },
          text: { content: "Get started", color: "#ffffff", weight: 500, size: 16 },
        },
        {
          name: "logo",
          bounds: { x: 1300, y: 24, w: 116, h: 32 },
          image: { alt: "Acme & Co.", aspectRatio: "29:8" },
        },
        {
          name: "card-grid",
          role: "grid",
          bounds: { x: 24, y: 200, w: 1392, h: 400 },
          layout: { direction: "grid", gridCols: 3, gap: 16 },
          repeatCount: 3,
          children: [
            { name: "card-1", role: "card", bounds: { x: 0, y: 0, w: 450, h: 400 }, style: { border: "1px solid #e5e7eb", borderRadius: 8 } },
            { name: "card-2", role: "card", bounds: { x: 466, y: 0, w: 450, h: 400 }, style: { border: "1px solid #e5e7eb", borderRadius: 8 } },
            { name: "card-3", role: "card", bounds: { x: 932, y: 0, w: 450, h: 400 }, style: { border: "1px solid #e5e7eb", borderRadius: 8 } },
          ],
        },
      ],
    },
  ],
  confidence: 0.82,
}

describe("compileImageAnalysisToXML", () => {
  test("produces XmlIR with deterministic structure for the demo fixture", () => {
    const ir = compileImageAnalysisToXML(FIXTURE)

    expect(ir.source).toBe("url")
    expect(ir.bytes).toBe(Buffer.byteLength(ir.xml, "utf8"))
    expect(ir.estimatedTokens).toBeGreaterThan(0)

    expect(ir.xml).toContain("<!-- Image Analysis: Single-screen demo")
    expect(ir.xml).toContain("Viewport: 1440x900")
    expect(ir.xml).toContain("Confidence: 82%")

    expect(ir.xml).toContain("<!-- Design Tokens: Colors")
    expect(ir.xml).toContain("primary: #1890ff")
    expect(ir.xml).toContain("Fonts: Inter, PingFang SC")
    expect(ir.xml).toContain("h1 Inter 32px w700 #1f2937 lh:40px")
  })

  test("renders text leaves, image leaves, and button containers correctly", () => {
    const ir = compileImageAnalysisToXML(FIXTURE)

    // Text leaf with XML-escaping
    expect(ir.xml).toMatch(/<Text name="hero-headline"[^>]*>Welcome &lt;home&gt;<\/Text>/)

    // Button — text leaf with bg attribute
    expect(ir.xml).toMatch(/<Text name="button"[^>]*bg="#1890ff">Get started<\/Text>/)

    // Image leaf with alt + aspect attributes
    expect(ir.xml).toContain('<Image name="logo" size="116x32" alt="Acme &amp; Co." aspect="29:8" />')
  })

  test("serialises grid layout with cols and gap and emits role attribute", () => {
    const ir = compileImageAnalysisToXML(FIXTURE)
    expect(ir.xml).toContain('layout="GRID cols:3 gap:16px"')
    // Card grid has role="grid" and repeat="3"
    expect(ir.xml).toMatch(/<Container name="grid"[^>]*role="grid" repeat="3">/)
  })

  test("rejects malformed input via the Zod boundary", () => {
    let caught: unknown
    try {
      compileImageAnalysisToXML({
        description: "broken",
        viewport: { width: 1440, height: 900 },
        tokens: { colors: {}, fonts: [], textStyles: [] },
        tree: [],
        confidence: 0.5,
      } as unknown as ImageAnalysis)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    const data = (caught as { data?: { reason?: string } }).data
    expect(data?.reason).toMatch(/ImageAnalysisSchema rejected payload/)
  })

  test("ImageAnalysisSchema accepts the demo fixture round-trip", () => {
    const parsed = ImageAnalysisSchema.parse(FIXTURE)
    // Round-trip must compile without throwing.
    expect(() => compileImageAnalysisToXML(parsed)).not.toThrow()
  })
})
