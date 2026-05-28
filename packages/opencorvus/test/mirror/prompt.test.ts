import { expect, test } from "bun:test"
import { buildClonePrompt, buildCloneFeedback } from "@/mirror/url/prompt"
import type { ProjectScaffold } from "@/mirror/ir/scaffold"
import type { EvaluationReport } from "@/mirror/visual/evaluate"

const scaffoldStub = {
  version: 2,
  surfaces: [{
    id: "header-navigation",
    name: "HeaderNavigation",
    kind: "navigation",
    bounds: { x: 0, y: 0, w: 1440, h: 64 },
    sourceRefs: [{ source: "url", path: "0", selector: "header" }],
    view: {
      filePath: "app/surfaces/header-navigation.tsx",
      exportName: "HeaderNavigation",
      isDefaultExport: false,
      propsInterface: "",
      imports: {},
      patterns: [],
    },
    slots: [],
    repeatedPatterns: [],
    containerContract: {
      owner: "business-container",
      states: ["ready"],
      interactions: [],
      unknowns: [],
    },
  }],
  sharedViews: [],
  catalog: { patterns: [], totalElements: 0, coveredElements: 0 },
  tokens: { colors: [], fonts: [], spacing: [], radii: [], shadows: [], customProperties: {} },
  tokensFile: {
    filePath: "app/tokens/generated.ts",
    exportName: "COLORS",
    isDefaultExport: false,
    propsInterface: "",
    imports: {},
    patterns: [],
  },
  appFile: {
    filePath: "app/root/GeneratedApp.tsx",
    exportName: "AppView",
    isDefaultExport: true,
    propsInterface: "",
    imports: {},
    patterns: [],
  },
} as unknown as ProjectScaffold

test("buildClonePrompt enforces generated React source contract", () => {
  const p = buildClonePrompt({
    iter: 1,
    referenceUrl: "https://example.com/",
    targetScore: 85,
    viewport: { width: 1440, height: 900 },
    outputDir: "/tmp/x",
    sharedContext: "ctx",
    xmlIRBytes: 1234,
    scaffold: scaffoldStub,
  })
  expect(p).toContain("generated View source")
  expect(p).toContain("app/root/GeneratedApp.tsx")
  expect(p).toContain("app/tokens/generated.ts")
  expect(p).toContain("Generated View source paths from visual-surface-scaffold.json")
  expect(p).not.toContain("src/App.tsx")
  expect(p).not.toContain("src/design-tokens.ts")
  expect(p).toContain("not create a parallel deliverable")
  expect(p).toContain("webpage_evaluate.overallScore >= 85")
  expect(p).toContain("Do not invent a higher score target")
  expect(p).not.toContain("cdn.tailwindcss.com")
  expect(p).not.toMatch(/use tailwind|with tailwind/i)
  expect(p).not.toContain("vanilla CSS")
})

test("buildClonePrompt iter > 1 instructs edit-not-rewrite", () => {
  const p = buildClonePrompt({
    iter: 2,
    referenceUrl: "https://example.com/",
    targetScore: 85,
    viewport: { width: 1440, height: 900 },
    outputDir: "/tmp/x",
    sharedContext: "ctx",
    xmlIRBytes: 1234,
    scaffold: scaffoldStub,
    previousFeedback: "Score 70, missing 'foo'",
  })
  expect(p).toContain("Iteration 2")
  expect(p).toContain("edit")
  expect(p).toContain("Score 70, missing 'foo'")
})

test("buildCloneFeedback surfaces score, missing tokens, regression guard", () => {
  const fb = buildCloneFeedback({
    iter: 2,
    evalReport: {
      overallScore: 70,
      ssimScore: 0.7,
      pixelDiffPercent: 30,
      mismatchedPixels: 1,
      totalPixels: 100,
      diffImageDataUrl: "",
      dimensionsMatch: true,
      comparisonDimensions: { width: 1440, height: 900 },
    } satisfies EvaluationReport,
    diffPath: "/tmp/diff.png",
    referencePath: "/tmp/reference.png",
    targetScore: 85,
    bestScore: 75,
    consecutiveNoImprovement: 0,
    missingTokens: ["新闻", "百度一下"],
  })
  expect(fb).toContain("70/100")
  expect(fb).toContain("Numeric threshold: 85/100")
  expect(fb).toContain("新闻")
  expect(fb).toContain("百度一下")
  expect(fb).toContain("Regression guard")
})

test("buildCloneFeedback omits regression guard when current is best", () => {
  const fb = buildCloneFeedback({
    iter: 1,
    evalReport: {
      overallScore: 90,
      ssimScore: 0.9,
      pixelDiffPercent: 5,
      mismatchedPixels: 1,
      totalPixels: 100,
      diffImageDataUrl: "",
      dimensionsMatch: true,
      comparisonDimensions: { width: 1440, height: 900 },
    } satisfies EvaluationReport,
    diffPath: "/tmp/diff.png",
    referencePath: "/tmp/reference.png",
    targetScore: 85,
    bestScore: 90,
    consecutiveNoImprovement: 0,
    missingTokens: [],
  })
  expect(fb).not.toContain("Regression guard")
  expect(fb).toContain("Text coverage is complete")
})
