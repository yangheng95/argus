import { createHash } from "node:crypto"
import type { PromptProfileCatalogProfile, PromptProfileDefinition } from "@/agent/prompt-profile"
import type { ExpertSquadRegistry } from "@/expert-squad/registry"

export type ExpertSquadCatalogPackage = {
  id: string
  promptProfile: PromptProfileDefinition
  manifest: {
    dynamic_attributes: ExpertSquadRegistry.Manifest["dynamic_attributes"]
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
}) {
  return createHash("sha256").update(stable(input)).digest("hex")
}

export function catalogProjectionEntry(projection: ExpertSquadRegistry.Projection) {
  return {
    built_in_tool_ids: [...projection.built_in_tool_ids],
    default_skill_refs: [...projection.default_skill_refs],
    package_skill_refs: [...projection.package_skill_refs],
    default_tool_refs: [...projection.default_tool_refs],
    package_tool_refs: [...projection.package_tool_refs],
    default_mcp_server_refs: [...projection.default_mcp_server_refs],
    package_mcp_server_refs: [...projection.package_mcp_server_refs],
    default_mcp_tool_refs: [...projection.default_mcp_tool_refs],
    package_mcp_tool_refs: [...projection.package_mcp_tool_refs],
    default_mcp_prompt_refs: [...projection.default_mcp_prompt_refs],
    package_mcp_prompt_refs: [...projection.package_mcp_prompt_refs],
    default_mcp_resource_refs: [...projection.default_mcp_resource_refs],
    package_mcp_resource_refs: [...projection.package_mcp_resource_refs],
  }
}

function packageProviderName(prefix: string, ref: string): string {
  const hint = ref
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
  const hash = createHash("sha256").update(ref).digest("hex").slice(0, 12)
  return `${prefix}__${hint || "tool"}__${hash}`
}

export function packageToolProviderName(ref: string): string {
  return packageProviderName("pkg_tool", ref)
}

export function packageMcpToolProviderName(ref: string): string {
  return packageProviderName("pkg_mcp_tool", ref)
}

export function packageMcpPromptProviderName(ref: string): string {
  return packageProviderName("pkg_mcp_prompt", ref)
}

export function packageMcpResourceProviderName(ref: string): string {
  return packageProviderName("pkg_mcp_resource", ref)
}

export function defaultToolNameFromRef(ref: string): string {
  const prefix = "default/tool/"
  if (!ref.startsWith(prefix)) throw new Error(`Invalid default tool ref ${JSON.stringify(ref)}`)
  const name = ref.slice(prefix.length)
  if (!name || /[/\\]/.test(name)) throw new Error(`Invalid default tool ref ${JSON.stringify(ref)}`)
  return name
}

export function defaultMcpToolProviderName(ref: string): string {
  return packageProviderName("default_mcp_tool", ref)
}

export function defaultMcpPromptProviderName(ref: string): string {
  return packageProviderName("default_mcp_prompt", ref)
}

export function defaultMcpResourceProviderName(ref: string): string {
  return packageProviderName("default_mcp_resource", ref)
}

export function catalogProfileFromPackage(input: {
  id: string
  pkg: ExpertSquadCatalogPackage
  builtIn: boolean
  builtInToolIDs: readonly string[]
}): PromptProfileCatalogProfile {
  const scheduler = input.pkg.manifest.capability_projection.scheduler
  const defaultToolProviderNames = scheduler.default_tool_refs.map(defaultToolNameFromRef)
  const packageToolRefs = input.builtIn ? [] : scheduler.package_tool_refs
  const defaultMcpToolProviderNames = scheduler.default_mcp_tool_refs.map(defaultMcpToolProviderName)
  const packageMcpToolRefs = input.builtIn ? [] : scheduler.package_mcp_tool_refs
  const projection = input.pkg.manifest.capability_projection
  return {
    id: input.id,
    label: input.pkg.promptProfile.label,
    description: input.pkg.promptProfile.description,
    built_in: input.builtIn,
    editable: false,
    agents: { ...(input.pkg.promptProfile.agents ?? {}) },
    capability_profile_id: input.pkg.id,
    projection_hash: projectionHash({
      profileID: input.id,
      projection: scheduler,
      toolIDs: [
        ...input.builtInToolIDs,
        ...defaultToolProviderNames,
        ...packageToolRefs.map(packageToolProviderName),
        ...defaultMcpToolProviderNames,
        ...packageMcpToolRefs.map(packageMcpToolProviderName),
      ],
      dynamicAttributes: input.pkg.manifest.dynamic_attributes,
    }),
    projected_agents: Object.keys(projection.agents).sort(),
    capability_projection: {
      scheduler: catalogProjectionEntry(projection.scheduler),
      agents: Object.fromEntries(
        Object.entries(projection.agents)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([agentID, agentProjection]) => [agentID, catalogProjectionEntry(agentProjection)]),
      ),
    },
  }
}
