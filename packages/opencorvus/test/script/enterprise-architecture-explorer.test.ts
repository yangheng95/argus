import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
}

function requiredSection(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start)
  const endIndex = text.indexOf(end, startIndex + start.length)
  if (startIndex === -1 || endIndex === -1) throw new Error(`missing section ${start}`)
  return text.slice(startIndex, endIndex)
}

function currentEngineArtifactKinds(): string[] {
  const typeBody = requiredSection(
    read("packages/opencorvus/src/engine/engine.sql.ts"),
    "export type EngineArtifactKind =",
    "export type EngineAcceptanceStatus",
  )
  return [...typeBody.matchAll(/\|\s+"([^"]+)"/g)].map((match) => match[1]!)
}

function explorerArtifactKinds(component: string): string[] {
  const arrayBody = requiredSection(component, "const currentEngineArtifactKinds = [", "  const architectureViews")
  return [...arrayBody.matchAll(/"([^"]+)"/g)].map((match) => match[1]!)
}

describe("enterprise architecture explorer", () => {
  const component = read("packages/web/src/components/EnterpriseArchitectureExplorer.astro")

  test("full-screen routes reuse the same architecture workbench component", () => {
    const enRoute = read("packages/web/src/pages/architecture-explorer.astro")
    const zhRoute = read("packages/web/src/pages/zh-cn/architecture-explorer.astro")

    expect(enRoute).toContain('<EnterpriseArchitectureExplorer locale="en" standalone={true} />')
    expect(zhRoute).toContain('<EnterpriseArchitectureExplorer locale="zh" standalone={true} />')
    expect(enRoute).toContain("<!doctype html>")
    expect(zhRoute).toContain("<!doctype html>")
  })

  test("artifact stat follows the current EngineArtifactKind source", () => {
    const sourceKinds = currentEngineArtifactKinds().sort()
    const renderedKinds = explorerArtifactKinds(component).sort()

    expect(renderedKinds).toEqual(sourceKinds)
    expect(component).toContain("String(currentEngineArtifactKinds.length)")
    expect(component).toContain(
      '["run", "goal_run_attempt", "build_attempt_outcome", "verification-evidence", "integrity_attempt", "agent_coordination_request", "agent_coordination_response", "agent_coordination_action"].length',
    )
  })

  test("source map includes current workflow and coordination surfaces", () => {
    for (const token of [
      "frontend_research",
      "frontend_design",
      "analyze_intent",
      "requirements",
      "architect",
      "workload_analysis",
      "build",
      "visual_qa",
      "integrity",
      "fact_check",
      "agent_coordination_request",
      "agent_coordination_response",
      "agent_coordination_action",
      "packages/opencorvus/src/plugin/index.ts",
      "packages/opencorvus/src/skill/manager.ts",
      "packages/overlay/src/components/ScreenshotBrowserPanel.tsx",
    ]) {
      expect(component).toContain(token)
    }
  })

  test("docs governance sources stay on current specs, records, and implementation surfaces", () => {
    const docsOps = requiredSection(component, 'id: "docs-ops"', 'id: "operator-surfaces"')

    expect(docsOps).toContain("specs/current/architecture/01-agents.md")
    expect(docsOps).toContain("specs/current/architecture/09-verification-evidence.md")
    expect(docsOps).toContain("specs/records/2026-06/2026-06-25-visual-evidence-no-hard-gate-root-repair.md")
    expect(docsOps).not.toContain("specs/artifacts/")
    expect(docsOps).not.toContain(["specs", "new-arch"].join("/"))
  })

  test("search filters and moves selection to the matching view", () => {
    expect(component).toContain("activeViewID = preferredViewForDomain(firstMatch.id)")
    expect(component).toContain("if (search.length > 0 && !isMatch) continue")
    expect(component).toContain("if (search.length > 0 && !componentMatches(component)) continue")
    expect(component).toContain(
      '[component.id, component.title, localize(component.responsibility, locale), component.sources.join(" ")]',
    )
  })

  test("component selection exposes source-level evidence", () => {
    expect(component).toContain(
      "type ArchComponent = { id: string; title: string; responsibility: LocalizedText; sources: string[] }",
    )
    expect(component).toContain("selectionPath(found.domain, found.component)")
    expect(component).toContain("localize(found.component.responsibility, locale)")
    expect(component).toContain("found.component.sources")
    expect(component).toContain("found.domain.records")
    expect(component).not.toContain("summary: LocalizedText; sources: string[]")
  })

  test("domain cards keep component buttons outside the domain select button", () => {
    const renderDomainGrid = requiredSection(
      component,
      "function renderDomainGrid(): void",
      "function renderContracts(): void",
    )
    const selectBlock = requiredSection(
      renderDomainGrid,
      'const select = createElement("button", "oc-arch-domain-select")',
      "card.appendChild(select)",
    )

    expect(renderDomainGrid).toContain('const card = createElement("article", "oc-arch-domain-card")')
    expect(renderDomainGrid).toContain('const chips = createElement("div", "oc-arch-component-list")')
    expect(selectBlock).not.toContain("oc-arch-component-chip")
    expect(renderDomainGrid.indexOf("card.appendChild(select)")).toBeLessThan(
      renderDomainGrid.indexOf('const chips = createElement("div", "oc-arch-component-list")'),
    )
  })

  test("medium desktop layout does not squeeze the inspector into a third column", () => {
    const mediumDesktop = requiredSection(component, "@media (max-width: 86rem)", "@media (max-width: 1120px)")

    expect(mediumDesktop).toContain(".oc-arch-control-strip")
    expect(mediumDesktop).toContain("grid-template-columns: 1fr")
    expect(mediumDesktop).toContain(".oc-arch-shell")
    expect(mediumDesktop).toContain("grid-template-columns: 220px minmax(0, 1fr)")
    expect(mediumDesktop).toContain(".oc-arch-domain-rail")
    expect(mediumDesktop).toContain("position: static")
    expect(mediumDesktop).toContain(".oc-arch-inspector")
    expect(mediumDesktop).toContain("grid-column: 1 / -1")
  })

  test("evaluator URL content is the current integrity review reference", () => {
    const enEvaluator = read("packages/web/src/content/docs/reference/evaluator.mdx")
    const zhEvaluator = read("packages/web/src/content/docs/zh-cn/reference/evaluator.mdx")

    expect(enEvaluator).toContain("title: Integrity Review")
    expect(zhEvaluator).toContain("title: Integrity Review")
    expect(enEvaluator).toContain("latest post-build `integrity_attempt`")
    expect(zhEvaluator).toContain("最新 post-build `integrity_attempt`")
    expect(enEvaluator).not.toContain("Evaluator")
    expect(zhEvaluator).not.toContain("Evaluator")
  })
})
