import { createHash } from "node:crypto"
import { AgentToolPool } from "@/agent/tool-pool-contract"
import { AgentRoleContract, type AgentRoleID } from "@/agent/role-contract"
import type { PromptProfileCatalogProfile, PromptProfileDefinition } from "@/agent/prompt-profile"
import type { ExpertSquadCatalogSummary } from "@/expert-squad/catalog"
import type { ExpertSquadRegistry } from "@/expert-squad/registry"
import {
  defaultMcpPromptProviderName,
  defaultMcpResourceProviderName,
  defaultMcpToolProviderName,
  defaultToolNameFromRef,
  defaultToolProviderName,
  packageMcpPromptProviderName,
  packageMcpResourceProviderName,
  packageMcpToolProviderName,
  packageToolProviderName,
} from "./provider-names"

export {
  defaultMcpPromptProviderName,
  defaultMcpResourceProviderName,
  defaultMcpToolProviderName,
  defaultToolNameFromRef,
  defaultToolProviderName,
  packageMcpPromptProviderName,
  packageMcpResourceProviderName,
  packageMcpToolProviderName,
  packageToolProviderName,
} from "./provider-names"

export type ExpertSquadCatalogPackage = {
  namespace: string
  id: string
  version?: string
  displayPrefix?: string
  selector?: ExpertSquadRegistry.SelectorMetadata
  selectorInstructions?: string
  readmeContent?: string
  root?: string
  manifestPath?: string
  readmePath?: string
  promptProfile: PromptProfileDefinition
  virtualAgents?: Record<string, ExpertSquadRegistry.VirtualAgentDefinition>
  manifest: {
    dynamic_attributes: ExpertSquadRegistry.Manifest["dynamic_attributes"]
    virtual_agents: ExpertSquadRegistry.Manifest["virtual_agents"]
    capability_projection: {
      scheduler: ExpertSquadRegistry.Projection
      agents: Record<string, ExpertSquadRegistry.Projection>
    }
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function projectionHash(input: {
  profileID: string
  projection: ExpertSquadRegistry.Projection
  toolIDs: string[]
  dynamicAttributes: ExpertSquadRegistry.Manifest["dynamic_attributes"]
  defaultMcpServers?: unknown
  resourceFingerprint?: unknown
}) {
  return createHash("sha256").update(stable(input)).digest("hex")
}

function virtualAgentSummaries(pkg: ExpertSquadCatalogPackage) {
  return Object.entries(pkg.manifest.virtual_agents ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([baseRole, virtualAgent]) => ({
      base_role: baseRole,
      virtual_agent_id: virtualAgent.id,
      label: virtualAgent.label,
      ...(virtualAgent.description ? { description: virtualAgent.description } : {}),
    }))
}

export function catalogProjectionEntry(projection: ExpertSquadRegistry.Projection) {
  return catalogProjectionEntryWithBuiltInTools(projection, projection.built_in_tool_ids)
}

function assertCanonicalBuiltInToolIDs(toolIDs: Iterable<string>, context: string) {
  const canonicalToolIDs = AgentToolPool.canonicalToolIDs()
  for (const toolID of toolIDs) {
    if (!canonicalToolIDs.has(toolID)) throw new Error(`${context} projects unknown built-in tool "${toolID}"`)
  }
}

export function schedulerBuiltInToolIDsFromProjection(projection: ExpertSquadRegistry.Projection): string[] {
  const toolIDs = new Set<string>()
  if (projection.role_base) {
    for (const toolID of AgentToolPool.orchestratorSchedulerRoleBaseToolIDs()) toolIDs.add(toolID)
  }
  for (const toolID of projection.built_in_tool_ids) toolIDs.add(toolID)
  assertCanonicalBuiltInToolIDs(toolIDs, "Orchestrator scheduler role base")
  return [...toolIDs]
}

export function workerBuiltInToolIDsFromProjection(
  agentID: AgentRoleID,
  projection: ExpertSquadRegistry.Projection,
): string[] {
  const toolIDs = new Set<string>()
  if (projection.role_base) {
    for (const toolID of AgentToolPool.visibleToolIDs(AgentToolPool.assignment(agentID))) toolIDs.add(toolID)
  }
  for (const toolID of projection.built_in_tool_ids) toolIDs.add(toolID)
  assertCanonicalBuiltInToolIDs(toolIDs, `Worker ${agentID}`)
  return [...toolIDs]
}

function catalogProjectionEntryWithBuiltInTools(
  projection: ExpertSquadRegistry.Projection,
  builtInToolIDs: readonly string[],
  expandedPackageMcpRefs: {
    packageMcpToolRefs?: readonly string[]
    packageMcpPromptRefs?: readonly string[]
    packageMcpResourceRefs?: readonly string[]
  } = {},
) {
  return {
    built_in_tool_ids: [...builtInToolIDs],
    default_skill_refs: [...projection.default_skill_refs],
    package_skill_refs: [...projection.package_skill_refs],
    default_tool_refs: [...projection.default_tool_refs],
    package_tool_refs: [...projection.package_tool_refs],
    default_mcp_server_refs: [...projection.default_mcp_server_refs],
    package_mcp_server_refs: [...projection.package_mcp_server_refs],
    default_mcp_tool_refs: [...projection.default_mcp_tool_refs],
    package_mcp_tool_refs: [...(expandedPackageMcpRefs.packageMcpToolRefs ?? projection.package_mcp_tool_refs)],
    default_mcp_prompt_refs: [...projection.default_mcp_prompt_refs],
    package_mcp_prompt_refs: [...(expandedPackageMcpRefs.packageMcpPromptRefs ?? projection.package_mcp_prompt_refs)],
    default_mcp_resource_refs: [...projection.default_mcp_resource_refs],
    package_mcp_resource_refs: [
      ...(expandedPackageMcpRefs.packageMcpResourceRefs ?? projection.package_mcp_resource_refs),
    ],
  }
}

function displayLabel(label: string, prefix: string | undefined): string {
  return prefix ? `${prefix}/${label}` : label
}

export function catalogProfileFromPackage(input: {
  id: string
  pkg: ExpertSquadCatalogPackage
  builtIn: boolean
  builtInToolIDs?: readonly string[]
  defaultMcpServers?: unknown
  packageMcpToolRefs?: readonly string[]
  packageMcpPromptRefs?: readonly string[]
  packageMcpResourceRefs?: readonly string[]
  agentPackageMcpRefs?: Record<
    string,
    {
      packageMcpToolRefs?: readonly string[]
      packageMcpPromptRefs?: readonly string[]
      packageMcpResourceRefs?: readonly string[]
    }
  >
  resourceFingerprint?: unknown
}): PromptProfileCatalogProfile {
  const scheduler = input.pkg.manifest.capability_projection.scheduler
  const schedulerBuiltInToolIDs = input.builtInToolIDs ?? schedulerBuiltInToolIDsFromProjection(scheduler)
  const defaultToolProviderNames = scheduler.default_tool_refs.map(defaultToolProviderName)
  const packageToolRefs = input.builtIn ? [] : scheduler.package_tool_refs
  const defaultMcpToolProviderNames = scheduler.default_mcp_tool_refs.map(defaultMcpToolProviderName)
  const packageMcpToolRefs = input.builtIn ? [] : (input.packageMcpToolRefs ?? scheduler.package_mcp_tool_refs)
  const projection = input.pkg.manifest.capability_projection
  return {
    id: input.id,
    label: input.pkg.promptProfile.label,
    description: input.pkg.promptProfile.description,
    built_in: input.builtIn,
    editable: false,
    agents: {},
    capability_profile_id: input.pkg.id,
    projection_hash: projectionHash({
      profileID: input.id,
      projection: scheduler,
      toolIDs: [
        ...schedulerBuiltInToolIDs,
        ...defaultToolProviderNames,
        ...packageToolRefs.map(packageToolProviderName),
        ...defaultMcpToolProviderNames,
        ...packageMcpToolRefs.map(packageMcpToolProviderName),
      ],
      dynamicAttributes: input.pkg.manifest.dynamic_attributes,
      defaultMcpServers: input.defaultMcpServers,
      resourceFingerprint: input.resourceFingerprint,
    }),
    projected_agents: Object.keys(projection.agents).sort(),
    virtual_agents: virtualAgentSummaries(input.pkg),
    capability_projection: {
      scheduler: catalogProjectionEntryWithBuiltInTools(projection.scheduler, schedulerBuiltInToolIDs, {
        packageMcpToolRefs: input.builtIn ? [] : input.packageMcpToolRefs,
        packageMcpPromptRefs: input.builtIn ? [] : input.packageMcpPromptRefs,
        packageMcpResourceRefs: input.builtIn ? [] : input.packageMcpResourceRefs,
      }),
      agents: Object.fromEntries(
        Object.entries(projection.agents)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([agentID, agentProjection]) => {
            if (!AgentRoleContract.isRoleID(agentID)) {
              throw new Error(`Unknown prompt profile target ${JSON.stringify(agentID)}`)
            }
            return [
              agentID,
              catalogProjectionEntryWithBuiltInTools(
                agentProjection,
                workerBuiltInToolIDsFromProjection(agentID, agentProjection),
                input.builtIn ? {} : input.agentPackageMcpRefs?.[agentID],
              ),
            ]
          }),
      ),
    },
  }
}

export function catalogSummaryFromPackage(input: {
  id: string
  pkg: ExpertSquadCatalogPackage
  builtIn: boolean
  builtInToolIDs?: readonly string[]
  defaultMcpServers?: unknown
  packageMcpToolRefs?: readonly string[]
  packageMcpPromptRefs?: readonly string[]
  packageMcpResourceRefs?: readonly string[]
  agentPackageMcpRefs?: Record<
    string,
    {
      packageMcpToolRefs?: readonly string[]
      packageMcpPromptRefs?: readonly string[]
      packageMcpResourceRefs?: readonly string[]
    }
  >
  resourceFingerprint?: unknown
}): ExpertSquadCatalogSummary {
  const profile = catalogProfileFromPackage(input)
  const selector = input.pkg.selector
    ? {
        ref: input.pkg.selector.ref,
        id: input.pkg.selector.id,
        label: input.pkg.selector.label,
        description: input.pkg.selector.description,
        summary: input.pkg.selector.summary,
        selection_guidance: input.pkg.selector.selection_guidance,
        instructions_path: "selector.md" as const,
        instructions: input.pkg.selectorInstructions ?? "",
      }
    : undefined
  if (selector && !selector.instructions.trim()) {
    throw new Error(`Expert squad ${input.id} selector requires top-level selector.md instructions.`)
  }
  const readme = input.pkg.readmeContent ?? ""
  if (!readme.trim()) throw new Error(`Expert squad ${input.id} README.md is blank.`)
  const source = input.builtIn
    ? { kind: "built_in" as const }
    : (() => {
        if (!input.pkg.root || !input.pkg.manifestPath || !input.pkg.readmePath) {
          throw new Error(`Project expert squad ${input.id} is missing canonical catalog paths.`)
        }
        return {
          kind: "project_package" as const,
          namespace: input.pkg.namespace,
          root: input.pkg.root,
          manifest_path: input.pkg.manifestPath,
          readme_path: input.pkg.readmePath,
        }
      })()
  return {
    ...profile,
    version: input.pkg.version,
    display_prefix: input.pkg.displayPrefix,
    display_label: displayLabel(profile.label, input.pkg.displayPrefix),
    source,
    readme: {
      path: "README.md",
      append_target: "orchestrator",
      content: readme,
    },
    selector,
    dynamic_attributes: input.pkg.manifest.dynamic_attributes,
  }
}
