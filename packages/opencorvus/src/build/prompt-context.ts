export interface BuildPromptOverlayContext {
  frontendResearch?: string
  frontendDesign?: string
  integrityFeedback?: string
  acceptanceFeedback?: string
  designSpecs?: readonly unknown[]
  taskID?: string
}

export interface BuildPromptOverlayResult {
  ids: string[]
  sections: string[]
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function hasWebCloneSourceHandoff(frontendDesign: string | undefined): boolean {
  if (!hasText(frontendDesign)) return false
  return frontendDesign.includes("web-clone-source/") || frontendDesign.includes("source_baseline_input")
}

function renderFrontendDesignOverlay(frontendDesign: string): string {
  const sections = [
    "## Frontend Design Handoff",
    "",
    "The section below is task-specific upstream context from frontend_design / decision_log. Treat it as the source for this build attempt; do not infer frontend or visual policy from the build role core.",
    "",
    frontendDesign.trim(),
  ]
  return sections.join("\n")
}

function renderFrontendResearchOverlay(frontendResearch: string): string {
  const sections = [
    "## Frontend Research Investigation Plan",
    "",
    "The section below is task-specific webpage investigation division from frontend_research. Treat it as a coverage checklist and work-packet index, mediated by the active REQ-N list, Architect Contract Graph, and frontend_design handoff; do not treat it as completed PRD facts.",
    "Before editing UI code, read the named work packets and verify the referenced evidence through the frontend_design handoff or task runtime artifacts. Preserve component-kind hypotheses unless deeper evidence disproves them. If a packet names a chart, map, heatmap, table/grid, tabs, menu, modal, form, carousel, or other mature component, investigate and implement the real component/content contract with existing project primitives or a mature library; do not flatten it into SVG/image markup unless verified evidence identifies it as static decoration.",
    "Use requirements, architect contracts, and frontend_design as the binding implementation contract. Use frontend_research to make sure no assigned surface, evidence path, interaction state, data question, or fidelity risk is skipped.",
    "",
    frontendResearch.trim(),
  ]
  return sections.join("\n")
}

function webCloneRuntimeRef(taskID: string | undefined, child: string): string {
  const root = taskID?.trim()
    ? `.opencorvus/runtime/tasks/${taskID.trim()}/frontend-design`
    : ".opencorvus/runtime/tasks/<taskID>/frontend-design"
  return `${root}/${child}`
}

function renderWebCloneSourceOverlay(taskID: string | undefined): string {
  const runtimeDir = webCloneRuntimeRef(taskID, "")
  const sourcePackage = webCloneRuntimeRef(taskID, "web-clone-source")
  const sourceReference = webCloneRuntimeRef(taskID, "web-clone-source/reference.png")
  const skeletonProject = webCloneRuntimeRef(taskID, "frontend-design-skeleton")
  return [
    "## Webpage Clone Source-Baseline Overlay",
    "",
    "This overlay applies because the frontend_design handoff names a webpage-clone source package or source baseline. Use the named handoff fields and artifact paths as the source of truth.",
    "",
    `- Task runtime frontend-design root: \`${runtimeDir.replace(/\/$/, "")}\`. Resolve package-local refs under that root; for example \`web-clone-source/reference.png\` means \`${sourceReference}\`, not \`./web-clone-source/reference.png\` in the acceptance root.`,
    `- Resolve \`web-clone-source/...\` refs under \`${sourcePackage}/...\` and \`frontend-design-skeleton/...\` refs under \`${skeletonProject}/...\`. Bare package refs in frontend_design/frontend_research reports are source-package-relative names, not cwd-relative deliverables.`,
    "- Build starts from the frontend-design source project named by `frontend_project` when that field is present. If `role=implementation_target`, adopt/copy/adapt that refined project into the acceptance root and perform only integration, precision visual repair, and acceptance fixes. If `role=source_baseline_input`, treat the named source debt as unfinished frontend_design work and do not hide it by starting a freehand rebuild.",
    "- `web-clone-source/` is evidence and implementation input. Read the compact package paths named by the handoff before editing; do not search sibling worktrees, primary project directories, absolute paths, or raw `webpage-evidence/` to repair missing source evidence.",
    `- Treat \`${runtimeDir.replace(/\/$/, "")}/\` as read-only input. Do not delete, move, rewrite, or clean runtime evidence directories; copy only the acceptance app files/assets you need into the root implementation.`,
    "- Do not copy `web-clone-source/`, `frontend-design-skeleton/`, `webpage-evidence/`, `references/`, or top-level `reference.png` into the acceptance root as deliverables. Reference images and source packages are verification/evidence inputs, not app-owned source.",
    "- If required source package files named by the handoff are missing, empty, corrupt, or unreadable, fail through `report_build_result` with a concrete blocker naming the missing files instead of inventing behavior.",
    "- For clone replicas, work from the frontend_design refined source first. Measure it against the reference/overlay and use the mismatch report for source-backed precision repair; do not restart the rawproject-to-maintainable conversion unless the handoff explicitly names remaining source debt.",
    "- CSS repair must be source-backed. Inspect `web-clone-source/source-skeleton/critical.css`, `web-clone-source/source-skeleton/full-source.css`, `web-clone-source/source-skeleton/used-selectors.json`, source IR/layout evidence, and `frontend-design-skeleton/src/styles/**`; if runtime-generated classes are absent from those artifacts, report an extraction/frontend_design blocker instead of broad handwritten CSS reconstruction.",
    "- Maintainable replacement should already be completed by frontend_design for the requested surface. If the handoff names remaining generated/source-dom regions, treat them as explicit unfinished source debt: either finish the named vertical slice with evidence or report the blocker; do not disguise baseline-only output as a completed maintainable project.",
    "- Reuse existing project components/design-system primitives first, mature maintained libraries second, and only custom-code simple glue or page-specific layout when the handoff gives a concrete reason.",
    "- Preserve visible text, layout hierarchy, useful source ids, links, controls, repeated structures, CSS sidecars, and asset references. Reference assets by file path; never inline binary assets as base64/hex payloads.",
    "- Run source/visual audits only when the handoff or acceptance specs require them. Include the produced audit artifact in verification evidence when it applies.",
  ].join("\n")
}

function renderVisualReferenceOverlay(): string {
  return [
    "## Visual Reference Overlay",
    "",
    "This overlay applies because the build context includes visual design specs or a frontend_design visual handoff. Referenced images, captures, and visual specs are binding source material for the relevant surface.",
    "",
    "- Reproduce the relevant visible surface as closely as the stack allows; do not treat screenshots or webpage captures as loose inspiration.",
    "- If required visual evidence is missing or unreadable, fail with a blocker naming the missing evidence instead of guessing from prose.",
    "- Verify through the real runtime path or a faithful harness before reporting success.",
  ].join("\n")
}

function renderIntegrityReworkOverlay(integrityFeedback: string): string {
  return [
    "## Integrity Rework Overlay",
    "",
    "The workflow review supplied the following task-specific findings. Treat blocking findings as must-fix items for this attempt, or fail with the exact blocker that prevents the repair.",
    "",
    integrityFeedback.trim(),
  ].join("\n")
}

function renderAcceptanceRepairOverlay(acceptanceFeedback: string): string {
  return [
    "## Acceptance Repair Overlay",
    "",
    "The persisted acceptance review supplied the following rejection packet. Use it as task-specific repair evidence; do not replace the goal/request contract with a generic summary.",
    "",
    acceptanceFeedback.trim(),
  ].join("\n")
}

export function renderBuildPromptOverlays(context: BuildPromptOverlayContext | undefined): BuildPromptOverlayResult {
  const ids: string[] = []
  const sections: string[] = []
  const frontendResearch = context?.frontendResearch
  const frontendDesign = context?.frontendDesign

  if (hasText(frontendResearch)) {
    ids.push("frontend-research-investigation-plan")
    sections.push(renderFrontendResearchOverlay(frontendResearch))
  }

  if (hasText(frontendDesign)) {
    ids.push("frontend-design-handoff")
    sections.push(renderFrontendDesignOverlay(frontendDesign))
  }

  if (hasWebCloneSourceHandoff(frontendDesign)) {
    ids.push("webpage-clone-source-baseline")
    sections.push(renderWebCloneSourceOverlay(context?.taskID))
  }

  if ((context?.designSpecs?.length ?? 0) > 0 || hasText(frontendDesign)) {
    ids.push("visual-reference")
    sections.push(renderVisualReferenceOverlay())
  }

  if (hasText(context?.integrityFeedback)) {
    ids.push("integrity-rework")
    sections.push(renderIntegrityReworkOverlay(context.integrityFeedback))
  }

  if (hasText(context?.acceptanceFeedback)) {
    ids.push("acceptance-repair")
    sections.push(renderAcceptanceRepairOverlay(context.acceptanceFeedback))
  }

  return { ids, sections }
}
