import { describe, expect, test } from "bun:test"
import { PromptProfile } from "../../src/agent/prompt-profile"

function readSource(relativePath: string) {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("frontend replica desktop-only generation scope", () => {
  test("expert squad forbids default tablet/mobile requirements, goals, and build work", async () => {
    const skill = await readSource("../../src/skill/builtin/frontend-replica-expert-squad.md")

    expect(skill).toContain("## Desktop-only replica scope")
    expect(skill).toContain("Frontend replica, clone, visual parity, and source-page recreation tasks")
    expect(skill).toContain("Do not ask Requirements, Architect, Build, Visual QA, or Integrity")
    expect(skill).toContain("requirements, goals, acceptance specs, build objectives")
    expect(skill).toContain("Generic tablet/mobile/responsive wording")
    expect(skill).toContain('profile_id: "frontend-replica"')
    expect(skill).toContain("## Browser preview evidence ownership")
    expect(skill).toContain("Build owns changed-region parity proof")
    expect(skill).toContain("Visual QA owns independent final rendered parity proof")
    expect(skill).toContain("browser_preview_reference_regions")
    expect(skill).toContain("browser_preview_compare_scroll_slices")
    expect(skill).not.toContain("responsive state")
  })

  test("frontend replica profile overlays protect every model decision surface", () => {
    const agents = PromptProfile.builtIns["frontend-replica"].agents

    expect(agents.coding).toContain("desktop source information architecture")
    expect(agents.requirements).toContain("Do not create tablet/mobile/non-desktop REQ rows")
    expect(agents.architect).toContain("Do not register tablet/mobile/non-desktop goals")
    expect(agents.build).toContain("browser_preview_reference_regions")
    expect(agents.build).toContain("browser_preview_compare_scroll_slices")
    expect(agents.build).toContain("Treat non-desktop goals as scope defects")
    expect(agents["visual-qa"]).toContain("Do not require mobile/tablet evidence")
    expect(agents["visual-qa"]).toContain("Own final region proof with browser_preview_reference_regions")
    expect(agents["visual-qa"]).toContain("browser_preview_compare_scroll_slices only for page-slice visual_diff")
    expect(agents.orchestrator).toContain("keep template mobile text out of goals")
    expect(agents.orchestrator).toContain("reference-region proof and scroll-slice supporting evidence")
    expect(agents.coding).not.toContain("responsive behavior")
  })

  test("core prompts keep replica generation desktop-only unless explicitly authorized", async () => {
    const requirements = await readSource("../../src/prompt/core/requirements-core.txt")
    const architect = await readSource("../../src/prompt/core/architect-core.txt")
    const frontendResearch = await readSource("../../src/prompt/core/frontend-research-core.txt")
    const frontendDesign = await readSource("../../src/prompt/core/frontend-design-core.txt")
    const build = await readSource("../../src/prompt/core/build-core.txt")
    const visualQa = await readSource("../../src/prompt/core/visual-qa-core.txt")
    const orchestrator = await readSource("../../src/prompt/core/orchestrator-core.txt")

    expect(requirements).toContain("Do not register tablet, mobile, non-desktop")
    expect(architect).toContain("Do not register or modify goals")
    expect(frontendResearch).toContain("Do not create tablet/mobile/non-desktop/responsive work packets")
    expect(frontendDesign).toContain("Do not create tablet/mobile/non-desktop/responsive rules")
    expect(build).toContain("invalid-goal-scope blocker")
    expect(build).toContain("Do not request, evaluate, or block on mobile/tablet reference evidence")
    expect(visualQa).toContain("Do not request, evaluate, or block on mobile/tablet reference evidence")
    expect(orchestrator).toContain(
      "tablet/mobile/non-desktop packets require explicit current multi-end migration authorization",
    )
  })

  test("model-readable frontend design tools and handoffs do not imply multi-viewport default work", async () => {
    const schema = await readSource("../../src/frontend-design/schema.ts")
    const agent = await readSource("../../src/frontend-design/agent.ts")
    const outputTools = await readSource("../../src/frontend-design/output-tools.ts")
    const skeletonTool = await readSource("../../src/frontend-design/skeleton-project-tool.ts")
    const sourceProjectGenerator = await readSource("../../src/web-clone/source-project-generator.ts")
    const hostPrepared = await readSource("../../src/frontend-design/host-prepared-source-project.ts")
    const webCloneTool = await readSource("../../src/tool/web-clone-generate-source-project.ts")

    expect(schema).toContain("For replica tasks this is desktop-only by default")
    expect(outputTools).toContain(
      "Use only when the current operator asked for tablet/mobile/responsive/multi-end migration",
    )
    expect(sourceProjectGenerator).toContain("Desktop visual iteration viewport")
    expect(hostPrepared).toContain("Desktop visual iteration viewport")
    expect(webCloneTool).toContain("Desktop visual iteration viewport")

    const modelReadableText = [
      schema,
      agent,
      outputTools,
      skeletonTool,
      sourceProjectGenerator,
      hostPrepared,
      webCloneTool,
    ]
      .join("\n")
      .replace(/\s+/g, " ")

    expect(modelReadableText).not.toContain("Visual iteration viewport matrix")
    expect(modelReadableText).not.toContain("Visual iteration matrix:")
    expect(modelReadableText).not.toContain("responsive widths")
    expect(modelReadableText).not.toContain("responsive rules from selected source evidence")
    expect(modelReadableText).not.toContain("responsive-review captures")
    expect(modelReadableText).not.toContain("desktop/mobile screenshots")
    expect(modelReadableText).not.toContain("do not block on mobile or tablet reference evidence")
  })
})
