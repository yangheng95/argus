import { ProjectRuntimePaths } from "@/project/runtime-paths"
import type { AgentContextPacket, AgentContextStructuredPart } from "@/agent/context-packet"
import {
  agentContextStructuredPartsBySchema,
  agentContextPacketText,
  renderAgentContextPackets,
  validateAgentContextPackets,
} from "@/agent/context-packet"
import {
  VISUAL_HANDOFF_CONTEXT_PACKET_SCHEMA,
  visualHandoffContextsFromPackets,
  visualHandoffStructuredPart,
  type VisualHandoffContextData,
  type VisualHandoffProjectMode,
} from "@/context-packets/visual-handoff"

export interface BuildPromptOverlayContext {
  contextPackets?: readonly AgentContextPacket[]
  taskID?: string
  projectDir?: string
  targetKind?: "goal" | "request"
}

export interface BuildPromptOverlayResult {
  ids: string[]
  sections: string[]
}

export const BUILD_REPAIR_CONTRACT_CONTEXT_PACKET_SCHEMA = "opencorvus.build.repair_contract.v1"
export const BUILD_VISUAL_HANDOFF_CONTEXT_PACKET_SCHEMA = VISUAL_HANDOFF_CONTEXT_PACKET_SCHEMA
export type BuildVisualHandoffContextData = VisualHandoffContextData
export const buildVisualHandoffStructuredPart = visualHandoffStructuredPart

export interface BuildRepairContractContextData {
  integrityBlockingFingerprints?: string[]
}

export function buildRepairContractStructuredPart(
  data: BuildRepairContractContextData,
): AgentContextStructuredPart | undefined {
  const rawFingerprints = data.integrityBlockingFingerprints ?? []
  const integrityBlockingFingerprints = uniqueIntegrityFingerprints(rawFingerprints)
  if (integrityBlockingFingerprints.length === 0) return undefined
  return {
    type: "structured",
    schema: BUILD_REPAIR_CONTRACT_CONTEXT_PACKET_SCHEMA,
    label: "build_repair_contract",
    summary: `integrity_blocking_fingerprints=${integrityBlockingFingerprints.length}`,
    data: { integrityBlockingFingerprints },
  }
}

function renderAgentContextPacketOverlay(packets: readonly AgentContextPacket[]): string {
  const sections = [
    "## Agent Context Packets",
    "",
    "The scheduler supplied the following typed context packets. Treat packet text and media refs as task evidence, and treat structured_ref schema labels as the machine-readable purpose and contract for this build attempt. Source labels are provenance only, not routing rules. Media appears as refs only, so inspect the cited refs through visible tools before making pixel-level claims.",
    "",
    renderAgentContextPackets(packets),
  ]
  return sections.join("\n")
}

export function buildRepairContractContextsFromPackets(
  packets: readonly AgentContextPacket[] | undefined,
): BuildRepairContractContextData[] {
  return agentContextStructuredPartsBySchema<BuildRepairContractContextData>(
    packets,
    BUILD_REPAIR_CONTRACT_CONTEXT_PACKET_SCHEMA,
  ).map(parseBuildRepairContractContextData)
}

export function buildIntegrityBlockingFingerprintsFromContextPackets(
  packets: readonly AgentContextPacket[] | undefined,
): string[] {
  return uniqueIntegrityFingerprints(
    buildRepairContractContextsFromPackets(packets).flatMap((context) => context.integrityBlockingFingerprints ?? []),
  )
}

function parseBuildRepairContractContextData(data: unknown): BuildRepairContractContextData {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${BUILD_REPAIR_CONTRACT_CONTEXT_PACKET_SCHEMA} requires an object payload`)
  }
  const record = data as Record<string, unknown>
  const unsupported = Object.keys(record).filter((key) => key !== "integrityBlockingFingerprints")
  if (unsupported.length > 0) {
    throw new Error(`${BUILD_REPAIR_CONTRACT_CONTEXT_PACKET_SCHEMA} contains unsupported field ${unsupported[0]}`)
  }
  const rawFingerprints = record.integrityBlockingFingerprints
  if (rawFingerprints === undefined) {
    throw new Error(`${BUILD_REPAIR_CONTRACT_CONTEXT_PACKET_SCHEMA}.integrityBlockingFingerprints is required`)
  }
  if (!Array.isArray(rawFingerprints)) {
    throw new Error(`${BUILD_REPAIR_CONTRACT_CONTEXT_PACKET_SCHEMA}.integrityBlockingFingerprints must be an array`)
  }
  return {
    integrityBlockingFingerprints: uniqueIntegrityFingerprints(
      rawFingerprints.map((item, index) => {
        if (typeof item !== "string") {
          throw new Error(
            `${BUILD_REPAIR_CONTRACT_CONTEXT_PACKET_SCHEMA}.integrityBlockingFingerprints[${index}] must be a string`,
          )
        }
        return item
      }),
    ),
  }
}

function uniqueIntegrityFingerprints(values: readonly string[]): string[] {
  values.forEach((value, index) => {
    assertIntegrityFingerprint(value, `${BUILD_REPAIR_CONTRACT_CONTEXT_PACKET_SCHEMA}.integrityBlockingFingerprints[${index}]`)
  })
  return [...new Set(values)].sort()
}

function assertIntegrityFingerprint(value: string, path: string): void {
  if (!/^if_[a-f0-9]{16}$/.test(value)) {
    throw new Error(`${path} must match if_[a-f0-9]{16}`)
  }
}

function buildVisualHandoffContexts(
  packets: readonly AgentContextPacket[] | undefined,
): VisualHandoffContextData[] {
  validateAgentContextPackets(packets ?? [])
  return visualHandoffContextsFromPackets(packets)
}

function webCloneRuntimeRef(taskID: string | undefined, projectDir: string | undefined, child: string): string {
  const trimmedTaskID = taskID?.trim()
  const root = trimmedTaskID
    ? projectDir?.trim()
      ? ProjectRuntimePaths.frontendDesignPaths(projectDir.trim(), trimmedTaskID).absoluteDir
      : ProjectRuntimePaths.frontendDesignPaths("", trimmedTaskID).relativeDir
    : ".opencorvus/r/t/<task-key>/fd"
  return `${root}/${child}`
}

function visualHandoffProjectModeLabel(projectModes: readonly VisualHandoffProjectMode[]): string {
  return projectModes.length > 0 ? projectModes.join(", ") : "not specified"
}

function isVisualHandoffProjectMode(value: VisualHandoffProjectMode | undefined): value is VisualHandoffProjectMode {
  return Boolean(value)
}

function renderWebCloneSourceOverlay(
  taskID: string | undefined,
  projectDir: string | undefined,
  projectModes: readonly VisualHandoffProjectMode[],
  targetKind: BuildPromptOverlayContext["targetKind"],
): string {
  const goalScoped = targetKind === "goal"
  const runtimeDir = webCloneRuntimeRef(taskID, projectDir, "")
  const sourcePackage = webCloneRuntimeRef(taskID, projectDir, "web-clone-source")
  const sourceReference = goalScoped
    ? undefined
    : webCloneRuntimeRef(taskID, projectDir, "web-clone-source/reference.png")
  const skeletonProject = webCloneRuntimeRef(taskID, projectDir, "frontend-design-skeleton")
  const projectModeLabel = visualHandoffProjectModeLabel(projectModes)
  const lines = [
    "## Webpage Clone Source-Baseline Overlay",
    "",
    "This overlay applies because the frontend_design handoff supplies a structured webpage-clone visual handoff. Use the schema-bearing context packet and named artifact paths as the source of truth.",
    "",
    goalScoped
      ? `- Task runtime frontend-design root: \`${runtimeDir.replace(/\/$/, "")}\`. Resolve package-local refs under that root. This goal's visual target is the bound crop evidence named by the Reference Coverage Contract and Build Evidence Pack, not the full-page source reference image.`
      : `- Task runtime frontend-design root: \`${runtimeDir.replace(/\/$/, "")}\`. Resolve package-local refs under that root; for example \`web-clone-source/reference.png\` means \`${sourceReference}\`, not \`./web-clone-source/reference.png\` in the acceptance root.`,
    `- Resolve \`web-clone-source/...\` refs under \`${sourcePackage}/...\` and \`frontend-design-skeleton/...\` refs under \`${skeletonProject}/...\`. Bare package refs in frontend_design/frontend_research reports are source-package-relative names, not cwd-relative deliverables.`,
    `- Build starts from the frontend-design project mode supplied by \`structured_ref schema=opencorvus.context.visual_handoff.v1\`. The scheduler-derived project modes for this attempt are: \`${projectModeLabel}\`.`,
    "- If `project_mode=implementation_target`, adopt/copy/adapt the refined project into the acceptance root and perform only integration, precision visual repair, and acceptance fixes.",
    "- If `project_mode=visual_baseline`, transcribe it only when the frontend_design report records structured `visual_validation_evidence` with no blocking visual debt; otherwise report the missing screenshot/region debt as a frontend_design blocker instead of freehand rebuilding.",
    "- If `project_mode=source_baseline`, treat the named source debt as unfinished frontend_design work and do not hide it by starting a freehand rebuild.",
    "- If `project_mode=blocked`, report the frontend_design blocker instead of building from guesses.",
    "- `web-clone-source/` is evidence and implementation input. Read the compact package paths named by the handoff before editing; do not search sibling worktrees, primary project directories, absolute paths, or raw `webpage-evidence/` to repair missing source evidence.",
    `- Treat \`${runtimeDir.replace(/\/$/, "")}/\` as read-only input. Do not delete, move, rewrite, or clean runtime evidence directories; copy only the acceptance app files/assets you need into the root implementation.`,
    goalScoped
      ? "- Do not copy `web-clone-source/`, `frontend-design-skeleton/`, `webpage-evidence/`, or `references/` into the acceptance root as deliverables. Goal-bound reference crops and source packages are verification/evidence inputs, not app-owned source."
      : "- Do not copy `web-clone-source/`, `frontend-design-skeleton/`, `webpage-evidence/`, `references/`, or top-level `reference.png` into the acceptance root as deliverables. Reference images and source packages are verification/evidence inputs, not app-owned source.",
    "- If required source package files named by the handoff are missing, empty, corrupt, or unreadable, fail through `report_build_result` with a concrete blocker naming the missing files instead of inventing behavior.",
    "- For clone replicas, work from the frontend_design refined source first. Measure it against the reference/overlay and use the mismatch report for source-backed precision repair; do not restart the rawproject-to-maintainable conversion unless the handoff explicitly names remaining source debt.",
    "- Treat compact upstream packet pointers as a coverage index for evidence ids, bundle paths, component questions, interaction states, data questions, and fidelity risks; do not treat them as completed PRD facts or an implementation template.",
    "- Before editing UI code, use schema-bearing context refs and compact pointers to decide which handoff entries, task runtime artifacts, and bundle paths need drilldown for this goal. Preserve component-kind hypotheses unless deeper evidence disproves them. If a pointer names a chart, map, heatmap, table/grid, tabs, menu, modal, form, carousel, or other mature component, investigate and implement the real component/content contract with existing project primitives or a mature library; do not flatten it into SVG/image markup unless verified evidence identifies it as static decoration.",
    "- Use requirements, architect contracts, and schema-bearing visual handoff packets as the binding implementation contract. Use compact context pointers to make sure no assigned surface, evidence path, interaction state, data question, or fidelity risk is skipped.",
    "- CSS repair must be source-backed. Inspect `web-clone-source/source-ir/style-profile.json` first for the target region, then `web-clone-source/source-skeleton/critical.css`, `web-clone-source/source-skeleton/full-source.css`, `web-clone-source/source-skeleton/used-selectors.json`, source IR/layout evidence, and `frontend-design-skeleton/src/styles/**`; if runtime-generated classes are absent from those artifacts, report an extraction/frontend_design blocker instead of broad handwritten CSS reconstruction.",
    "- Maintainable replacement should already be completed by frontend_design for the requested surface. If the handoff names remaining generated/source-dom regions, treat them as explicit unfinished source debt: either finish the named vertical slice with evidence or report the blocker; do not disguise baseline-only output as a completed maintainable project.",
    "- Reuse existing project components/design-system primitives first, mature maintained libraries second, and only custom-code simple glue or page-specific layout when the handoff gives a concrete reason.",
    "- Preserve visible text, layout hierarchy, useful source ids, links, controls, repeated structures, CSS sidecars, and asset references. Reference assets by file path; never inline binary assets as base64/hex payloads.",
    "- Run source/visual audits only when the handoff or acceptance specs require them. Include the produced audit artifact in verification evidence when it applies.",
  ]
  if (!goalScoped && sourceReference) {
    lines.push(
      "",
      "### Required Reference Image",
      "",
      `Open and inspect \`${sourceReference}\` before writing or changing UI code for the replica surface. This is the concrete source reference screenshot for this webpage clone handoff; compare rendered implementation screenshots against it and report a frontend_design blocker if it is missing or unreadable.`,
    )
  }
  return lines.join("\n")
}

function renderVisualReferenceOverlay(): string {
  return [
    "## Visual Reference Overlay",
    "",
    "This overlay applies because the build context includes visual design specs or a frontend_design visual handoff. Referenced images, captures, and visual specs are binding source material for the relevant surface.",
    "",
    "- Reproduce the relevant visible surface as closely as the stack allows; do not treat screenshots or webpage captures as loose inspiration.",
    "- If required visual evidence is missing or unreadable, name the gap or blocker in your report instead of guessing from prose.",
    "- Verify through the real runtime path or a faithful harness, repair visible mismatches you can own, and explicitly report any remaining gap when no further safe optimization is available.",
  ].join("\n")
}

export function renderBuildPromptOverlays(context: BuildPromptOverlayContext | undefined): BuildPromptOverlayResult {
  const ids: string[] = []
  const sections: string[] = []
  const contextPackets = (context?.contextPackets ?? []).filter((packet) => packet.parts.length > 0)
  const visualHandoffs = buildVisualHandoffContexts(contextPackets)
  const projectModes = Array.from(
    new Set(visualHandoffs.map((handoff) => handoff.projectMode).filter(isVisualHandoffProjectMode)),
  )
  const hasFrontendDesignProjectMode = projectModes.length > 0
  const hasWebCloneHandoff = visualHandoffs.some((handoff) => handoff.webCloneSource) || hasFrontendDesignProjectMode
  const hasVisualReferenceHandoff =
    visualHandoffs.some((handoff) => handoff.visualReference || handoff.webCloneSource) || hasFrontendDesignProjectMode

  if (contextPackets.length > 0) {
    ids.push("agent-context-packets")
    sections.push(renderAgentContextPacketOverlay(contextPackets))
  }

  if (hasWebCloneHandoff) {
    ids.push("webpage-clone-source-baseline")
    sections.push(renderWebCloneSourceOverlay(context?.taskID, context?.projectDir, projectModes, context?.targetKind))
  }

  if (hasVisualReferenceHandoff) {
    ids.push("visual-reference")
    sections.push(renderVisualReferenceOverlay())
  }

  return { ids, sections }
}

export function buildContextPacketText(
  packets: readonly AgentContextPacket[] | undefined,
): string | undefined {
  const text = (packets ?? []).map(agentContextPacketText).join("\n\n").trim()
  return text.length > 0 ? text : undefined
}
