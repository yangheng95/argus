import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { PromptProfileResolver } from "../../src/expert-squad/prompt-profile-resolver"
import { REPOSITORY_ROOT } from "../fixture/expert-squad"

function readSource(relativePath: string) {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

async function frontendReplicaSelectorSkill(): Promise<string> {
  const projection = await PromptProfileResolver.resolveSkillProjection({
    projectDirectory: REPOSITORY_ROOT,
    config: Config.Info.parse({ prompt_profile: { active: "general" } }),
    defaultSkills: [],
  })
  const skill = projection.skills.find((source) => source.name === "frontend-replica-expert-squad")
  expect(skill).toBeDefined()
  return skill!.content
}

async function frontendReplicaAgents() {
  const definitions = await PromptProfileResolver.definitions(REPOSITORY_ROOT)
  const profile = definitions["frontend-replica"]
  expect(profile).toBeDefined()
  return profile!.agents
}

describe("frontend replica desktop-only generation scope", () => {
  test("expert squad forbids default tablet/mobile requirements, goals, and build work", async () => {
    const skill = await frontendReplicaSelectorSkill()

    expect(skill).toContain("## Desktop-only replica scope")
    expect(skill).toContain("Frontend replica, clone, visual parity, and source-page recreation tasks")
    expect(skill).toContain("Do not ask Requirements, Architect, Build, Visual QA, or Integrity")
    expect(skill).toContain("requirements, goals, acceptance specs, build objectives")
    expect(skill).toContain("Tablet/mobile/responsive wording")
    expect(skill).toContain("multiple desktop-class viewport widths")
    expect(skill).toContain("Keep those checks under desktop scope")
    expect(skill).toContain('profile_id: "frontend-replica"')
    expect(skill).toContain("## Browser preview evidence ownership")
    expect(skill).toContain("multi-agent source-evidence implementation task")
    expect(skill).toContain("not as a single blind Build pass")
    expect(skill).not.toContain("workflow / pipeline task")
    expect(skill).not.toContain("direct single Build task")
    expect(skill).toContain("After an agent has already produced its task-scope artifact")
    expect(skill).toContain("explicit retry of a failed/incomplete call")
    expect(skill).toContain("Build implementation or repair")
    expect(skill).toContain("Visual QA review or re-review")
    expect(skill).toContain("Integrity review or re-review after repair")
    expect(skill).toContain("Do not re-run Requirements, Architect, `frontend_research`, `frontend_design`, or the whole workflow")
    expect(skill).toContain("## Source authority")
    expect(skill).toContain("Source URL/screenshot/DOM/computed-style/interaction evidence defines the replica contract")
    expect(skill).toContain("create_visual_region_binding_package")
    expect(skill).toContain("update_frontend_visual_region_binding")
    expect(skill).toContain("reference_region_key")
    expect(skill).toContain("## Replica surface model")
    expect(skill).toContain("current Visual QA / Integrity blockers, and acceptance-attempt count")
    expect(skill).toContain("A Build result with no target project diff")
    expect(skill).toContain("## Acceptance attempt budget")
    expect(skill).toContain("evidence-backed non-pass rounds")
    expect(skill).toContain("After the second consecutive evidence-backed rendered-feedback non-pass round")
    expect(skill).toContain("Integrity non-pass rows are implementation completeness evidence")
    expect(skill).toContain("mark the surface/task not accepted")
    expect(skill).toContain("## Goal decomposition discipline")
    expect(skill).toContain("default to one user-visible implementation component or meaningful source-backed page region per Build goal")
    expect(skill).toContain("Source rows, visual-source rows, style-profile rows, DOM records, evidence-table rows")
    expect(skill).toContain("Do not register them as Build goal titles")
    expect(skill).toContain("Do not mix several user-visible source components")
    expect(skill).toContain("generally needs 10 or more goals")
    expect(skill).toContain("source registry or shared mock contracts")
    expect(skill).toContain("reference_coverage.reference_regions")
    expect(skill).toContain("Do not accept `no_project_diff`, documentation-only output")
    expect(skill).toContain("## Failure taxonomy")
    expect(skill).toContain("Implementation non-delivery")
    expect(skill).toContain("Verification blocker")
    expect(skill).toContain("## Visual QA and Integrity feedback consumption")
    expect(skill).toContain("Implementation repair after Visual QA or Integrity must consume the latest blocker evidence")
    expect(skill).toContain("Annotated Visual QA screenshots and DOM diagnostics are repair inputs")
    expect(skill).toContain("current workflow implementation owner owns changed-region module binding proof")
    expect(skill).toContain("Visual QA owns independent final rendered parity review")
    expect(skill).toContain("Browser MCP screenshot/observe tools")
    expect(skill).toContain("browser_preview_reference_regions")
    expect(skill).toContain("browser_preview_compare_scroll_slices")
    expect(skill).toContain("not first-viewport slices")
    expect(skill).toContain("page-shell locators")
    expect(skill).toContain("does not run a second `reference-comparison` pass")
    expect(skill).toContain("aligned `scrollY` and `sliceHeight`")
    expect(skill).toContain("comparison_guidance")
    expect(skill).toContain("LEFT is the source/reference image")
    expect(skill).toContain("RIGHT is the rendered/local implementation")
    expect(skill).toContain("content hallucinations or omissions")
    expect(skill).toContain("## Blank filler geometry boundary")
    expect(skill).toContain("source page height")
    expect(skill).toContain("footer transition positions")
    expect(skill).toContain("not implementation targets by themselves")
    expect(skill).toContain("empty spacer bands")
    expect(skill).toContain("blank margin/padding")
    expect(skill).toContain("height`/`min-height` filler")
    expect(skill).toContain("unrendered media slots")
    expect(skill).toContain("restore the missing source-backed content/assets/interactions")
    expect(skill).toContain("large blank bands between completed regions")
    expect(skill).not.toContain("responsive state")
  })

  test("frontend replica profile overlays protect every model decision surface", async () => {
    const agents = await frontendReplicaAgents()

    expect(agents.coding).toContain("desktop source information architecture")
    expect(agents.requirements).toContain("Do not create tablet/mobile/non-desktop REQ rows")
    expect(agents.requirements).toContain("desktop-class viewport layout/alignment requirements")
    expect(agents.architect).toContain("Do not register tablet/mobile/non-desktop goals")
    expect(agents.architect).toContain("generally produce 10 or more source-component goals")
    expect(agents.architect).toContain("never register source rows, visual-source rows, style-profile rows, DOM records")
    expect(agents.architect).toContain("no_project_diff work")
    expect(agents.architect).toContain("desktop adaptive viewport acceptance stays on desktop goals")
    expect(agents.architect).toContain("footer/page y alignment")
    expect(agents.architect).toContain("empty CSS spacing")
    expect(agents["frontend-design"]).toContain("visible content, assets, canvas/image captures")
    expect(agents["frontend-design"]).toContain("create_visual_region_coordinate_atlas")
    expect(agents["frontend-design"]).toContain("update_frontend_visual_region_binding")
    expect(agents["frontend-design"]).toContain("reference_region_key")
    expect(agents["frontend-design"]).toContain("instead of emitting page-height or min-height filler instructions")
    expect(agents.architect).toContain("reference_coverage.reference_regions")
    expect(agents.architect).toContain("source_reference_artifact")
    expect(agents.build).toContain("browser_preview_reference_regions")
    expect(agents.build).toContain("goal-scoped target reference crops")
    expect(agents.build).toContain("missing `reference_region_key` blocker")
    expect(agents.build).not.toContain("browser_preview_compare_scroll_slices")
    expect(agents.build).toContain("leave screen-by-screen scroll-slice visual_diff to Visual QA")
    expect(agents.build).toContain("comparison_guidance LEFT reference / RIGHT implementation")
    expect(agents.build).toContain("content hallucinations")
    expect(agents.build).toContain("consumed diagnostic refs")
    expect(agents.build).toContain("no_project_diff")
    expect(agents.build).toContain("unchanged visible surfaces")
    expect(agents.build).toContain("Do not use page-shell/whole-page/body/main/app-root locators")
    expect(agents.build).toContain("first-viewport reference-region proof")
    expect(agents.build).toContain("multiple desktop-class widths")
    expect(agents.build).toContain("Treat non-desktop goals as scope defects")
    expect(agents.build).toContain("Do not satisfy source page height")
    expect(agents.build).toContain("blank margin, padding, height/min-height filler")
    expect(agents.build).toContain("restore missing source-backed content/assets/interactions")
    expect(agents["visual-qa"]).toContain("Do not require mobile/tablet evidence")
    expect(agents["visual-qa"]).toContain("inspect multiple desktop-class widths")
    expect(agents["visual-qa"]).toContain("Own final module source-binding review with browser_preview_reference_regions")
    expect(agents["visual-qa"]).toContain("Browser MCP screenshot/observe tools")
    expect(agents["visual-qa"]).toContain("browser_preview_compare_scroll_slices only for first-viewport and page-slice visual_diff")
    expect(agents["visual-qa"]).toContain("comparison_guidance LEFT reference / RIGHT implementation")
    expect(agents["visual-qa"]).toContain("chart/table/map geometry")
    expect(agents["visual-qa"]).toContain("Reject large blank filler bands")
    expect(agents["visual-qa"]).toContain("empty thumbnail/canvas/image slots")
    expect(agents["visual-qa"]).toContain("owning DOM/source module")
    expect(agents["visual-qa"]).toContain("carry unresolved prior blockers forward")
    expect(agents.integrity).toContain("blank CSS space")
    expect(agents.integrity).toContain("second evidence-backed implementation non-pass")
    expect(agents.integrity).toContain("Do not count Integrity review as the rendered visual verdict")
    expect(agents.orchestrator).toContain("not to padding blank page space")
    expect(agents.orchestrator).toContain("one source component or meaningful region per goal")
    expect(agents.orchestrator).toContain("generally 10 or more goals")
    expect(agents.orchestrator).toContain("raw source-row goals")
    expect(agents.orchestrator).toContain("reject bundled multi-component goals")
    expect(agents.orchestrator).toContain("per-surface rendered-feedback ledger")
    expect(agents.orchestrator).toContain("second consecutive evidence-backed rendered-feedback non-pass")
    expect(agents.orchestrator).toContain("per-surface rendered-feedback ledger")
    expect(agents.orchestrator?.toLowerCase()).toContain("keep template mobile text out of goals")
    expect(agents.orchestrator).toContain("scoped desktop adaptive viewport checks")
    expect(agents.orchestrator).toContain("Build produces reference-region proof while Visual QA owns scroll-slice supporting evidence")
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
    expect(requirements).toContain("desktop-class viewport layout/alignment requirements")
    expect(architect).toContain("Do not register or modify goals")
    expect(architect).toContain("Desktop adaptive/responsive layout remains desktop scope")
    expect(frontendResearch).toContain("Do not create tablet/mobile/non-desktop work packets")
    expect(frontendResearch).toContain("Desktop-class adaptive layout observations are allowed")
    expect(frontendDesign).toContain("Do not create tablet/mobile/non-desktop rules")
    expect(frontendDesign).toContain("Desktop-class adaptive layout obligations are allowed")
    expect(build).toContain("invalid-goal-scope blocker")
    expect(build).toContain("Do not request, evaluate, or block on mobile/tablet reference evidence")
    expect(build).toContain("verify multiple desktop-class viewports")
    expect(visualQa).toContain("Do not request, evaluate, or block on mobile/tablet reference evidence")
    expect(visualQa).toContain("additional desktop-class constrained or wide viewports")
    expect(orchestrator).not.toContain(
      "tablet/mobile/non-desktop packets require explicit current multi-end migration authorization",
    )
    expect(orchestrator).toContain("Domain-specific replica scope, desktop/mobile policy")

    const agents = await frontendReplicaAgents()
    expect(agents.orchestrator?.toLowerCase()).toContain("keep template mobile text out of goals")
    expect(agents.orchestrator).toContain("scoped desktop adaptive viewport checks")
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
