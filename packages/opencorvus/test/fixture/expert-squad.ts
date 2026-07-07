import nodeFs from "node:fs"
import fs from "fs/promises"
import path from "node:path"
import { ExpertSquadRegistry } from "../../src/expert-squad/registry"

export const PROJECT_EXPERT_SQUAD_ID = "project-replica"
export const PROJECT_EXPERT_SQUAD_NAMESPACE = "project"
export const REPOSITORY_ROOT = path.resolve(import.meta.dir, "../../../..")
const EXPERT_SQUAD_DIRECTORY = "expert-squads"
const EXPERT_SQUAD_MANIFEST = "expert-squad.jsonc"

export function repositoryExpertSquadRoot(id: string): string {
  const base = path.join(REPOSITORY_ROOT, ".opencorvus", EXPERT_SQUAD_DIRECTORY)
  const matches: string[] = []
  for (const namespaceEntry of nodeFs.readdirSync(base, { withFileTypes: true })) {
    if (!namespaceEntry.isDirectory()) continue
    const candidate = path.join(base, namespaceEntry.name, id)
    if (nodeFs.existsSync(path.join(candidate, EXPERT_SQUAD_MANIFEST))) matches.push(candidate)
  }
  if (matches.length !== 1) throw new Error(`Expected one repository expert squad package for ${id}, found ${matches.length}`)
  return matches[0]!
}

export interface ProjectExpertSquadManifestOptions {
  schedulerDefaultSkillRefs?: string[]
  schedulerPackageToolRefs?: string[]
  schedulerPackageMcpServerRefs?: string[]
  schedulerPackageMcpToolRefs?: string[]
  schedulerPackageMcpPromptRefs?: string[]
  schedulerPackageMcpResourceRefs?: string[]
  schedulerDefaultToolRefs?: string[]
  schedulerDefaultMcpToolRefs?: string[]
  schedulerDefaultMcpPromptRefs?: string[]
  schedulerDefaultMcpResourceRefs?: string[]
  packageMcpDefinition?: Record<string, unknown>
  buildDefaultSkillRefs?: string[]
  buildDefaultToolRefs?: string[]
  buildDefaultMcpToolRefs?: string[]
  buildDefaultMcpPromptRefs?: string[]
  buildDefaultMcpResourceRefs?: string[]
  buildPackageToolRefs?: string[]
  buildPackageMcpServerRefs?: string[]
  buildPackageMcpToolRefs?: string[]
  buildPackageMcpPromptRefs?: string[]
  buildPackageMcpResourceRefs?: string[]
  agentDefaultSkillRefs?: Record<string, string[]>
}

export function projectExpertSquadManifest(id = PROJECT_EXPERT_SQUAD_ID, options: ProjectExpertSquadManifestOptions = {}) {
  const schedulerPackageToolRefs = options.schedulerPackageToolRefs ?? [`${id}/orchestrator/source-evidence`]
  const schedulerPackageMcpServerRefs = options.schedulerPackageMcpServerRefs ?? []
  const schedulerPackageMcpToolRefs = options.schedulerPackageMcpToolRefs ?? []
  const schedulerPackageMcpPromptRefs = options.schedulerPackageMcpPromptRefs ?? []
  const schedulerPackageMcpResourceRefs = options.schedulerPackageMcpResourceRefs ?? []
  const schedulerDefaultToolRefs = options.schedulerDefaultToolRefs ?? []
  const schedulerDefaultMcpToolRefs = options.schedulerDefaultMcpToolRefs ?? []
  const schedulerDefaultMcpPromptRefs = options.schedulerDefaultMcpPromptRefs ?? []
  const schedulerDefaultMcpResourceRefs = options.schedulerDefaultMcpResourceRefs ?? []
  const buildPackageToolRefs = options.buildPackageToolRefs ?? [`${id}/build/build-evidence`]
  const buildPackageMcpServerRefs = options.buildPackageMcpServerRefs ?? []
  const buildPackageMcpToolRefs = options.buildPackageMcpToolRefs ?? []
  const buildPackageMcpPromptRefs = options.buildPackageMcpPromptRefs ?? []
  const buildPackageMcpResourceRefs = options.buildPackageMcpResourceRefs ?? []
  const buildDefaultToolRefs = options.buildDefaultToolRefs ?? []
  const buildDefaultMcpToolRefs = options.buildDefaultMcpToolRefs ?? []
  const buildDefaultMcpPromptRefs = options.buildDefaultMcpPromptRefs ?? []
  const buildDefaultMcpResourceRefs = options.buildDefaultMcpResourceRefs ?? []
  const buildProjection = {
    role_base: true,
    ...(options.buildDefaultSkillRefs?.length ? { default_skill_refs: options.buildDefaultSkillRefs } : {}),
    ...(buildDefaultToolRefs.length ? { default_tool_refs: buildDefaultToolRefs } : {}),
    ...(buildDefaultMcpToolRefs.length ? { default_mcp_tool_refs: buildDefaultMcpToolRefs } : {}),
    ...(buildDefaultMcpPromptRefs.length ? { default_mcp_prompt_refs: buildDefaultMcpPromptRefs } : {}),
    ...(buildDefaultMcpResourceRefs.length ? { default_mcp_resource_refs: buildDefaultMcpResourceRefs } : {}),
    package_skill_refs: [`${id}/build/implementation`],
    ...(buildPackageToolRefs.length ? { package_tool_refs: buildPackageToolRefs } : {}),
    ...(buildPackageMcpServerRefs.length ? { package_mcp_server_refs: buildPackageMcpServerRefs } : {}),
    ...(buildPackageMcpToolRefs.length ? { package_mcp_tool_refs: buildPackageMcpToolRefs } : {}),
    ...(buildPackageMcpPromptRefs.length ? { package_mcp_prompt_refs: buildPackageMcpPromptRefs } : {}),
    ...(buildPackageMcpResourceRefs.length ? { package_mcp_resource_refs: buildPackageMcpResourceRefs } : {}),
  }
  const extraAgentProjections = Object.fromEntries(
    Object.entries(options.agentDefaultSkillRefs ?? {})
      .filter(([agentID]) => agentID !== "build")
      .map(([agentID, refs]) => [
        agentID,
        {
          role_base: true,
          ...(refs.length ? { default_skill_refs: refs } : {}),
        },
      ]),
  )
  return {
    schema_version: 1,
    namespace: PROJECT_EXPERT_SQUAD_NAMESPACE,
    id,
    label: "Project Replica",
    description: "Project-local replica squad",
    version: "2026.07.04",
    readme: "README.md",
    selector: {
      summary: "Use for project-local replica tasks.",
      selection_guidance: `Call select_expert_squad with profile_id ${id}.`,
      instructions: "selector.md",
    },
    capability_projection: {
      scheduler: {
        role_base: true,
        built_in_tool_ids: ["select_expert_squad", "skill", "dispatch_agent", "manage_task"],
        ...(options.schedulerDefaultSkillRefs?.length
          ? { default_skill_refs: options.schedulerDefaultSkillRefs }
          : {}),
        ...(schedulerDefaultToolRefs.length ? { default_tool_refs: schedulerDefaultToolRefs } : {}),
        ...(schedulerDefaultMcpToolRefs.length ? { default_mcp_tool_refs: schedulerDefaultMcpToolRefs } : {}),
        ...(schedulerDefaultMcpPromptRefs.length ? { default_mcp_prompt_refs: schedulerDefaultMcpPromptRefs } : {}),
        ...(schedulerDefaultMcpResourceRefs.length ? { default_mcp_resource_refs: schedulerDefaultMcpResourceRefs } : {}),
        package_skill_refs: [`${id}/orchestrator/scheduler`],
        ...(schedulerPackageToolRefs.length ? { package_tool_refs: schedulerPackageToolRefs } : {}),
        ...(schedulerPackageMcpServerRefs.length ? { package_mcp_server_refs: schedulerPackageMcpServerRefs } : {}),
        ...(schedulerPackageMcpToolRefs.length ? { package_mcp_tool_refs: schedulerPackageMcpToolRefs } : {}),
        ...(schedulerPackageMcpPromptRefs.length ? { package_mcp_prompt_refs: schedulerPackageMcpPromptRefs } : {}),
        ...(schedulerPackageMcpResourceRefs.length ? { package_mcp_resource_refs: schedulerPackageMcpResourceRefs } : {}),
      },
      agents: {
        general: { role_base: true },
        build: buildProjection,
        ...extraAgentProjections,
      },
    },
    agents: {
      general: {
        prompt: "agents/general/system.md",
      },
      orchestrator: {
        prompt: "agents/orchestrator/system.md",
        skill_refs: [`${id}/orchestrator/scheduler`],
        tool_refs: [`${id}/orchestrator/source-evidence`],
        ...(schedulerPackageMcpServerRefs.length ? { mcp_server_refs: schedulerPackageMcpServerRefs } : {}),
      },
      build: {
        prompt: "agents/build/system.md",
        skill_refs: [`${id}/build/implementation`],
        tool_refs: [`${id}/build/build-evidence`],
        ...(buildPackageMcpServerRefs.length ? { mcp_server_refs: buildPackageMcpServerRefs } : {}),
      },
    },
  }
}

export function projectExpertSquadFiles(
  id = PROJECT_EXPERT_SQUAD_ID,
  prefix = "",
  options: ProjectExpertSquadManifestOptions = {},
): Record<string, string> {
  const root = prefix ? `${prefix.replace(/\/+$/, "")}/` : ""
  return {
    [`${root}README.md`]: "# Project Replica\n\nPROJECT_README_ORCHESTRATOR_APPEND_ONLY\n",
    [`${root}selector.md`]: [
      "# Project Replica Selector",
      "",
      "PROJECT_SELECTOR_FULL_INSTRUCTIONS: inspect the current task evidence before selecting this package.",
      `Call select_expert_squad with profile_id ${id} only when the task matches project-local replica work.`,
      "",
    ].join("\n"),
    [`${root}agents/general/system.md`]: "project general overlay",
    [`${root}agents/orchestrator/system.md`]: "project orchestrator overlay",
    [`${root}agents/build/system.md`]: "project build overlay",
    [`${root}agents/orchestrator/skills/scheduler/SKILL.md`]:
      "---\nname: scheduler\ndescription: Project scheduler skill.\n---\n",
    [`${root}agents/build/skills/implementation/SKILL.md`]:
      "---\nname: implementation\ndescription: Project implementation skill.\n---\n",
    [`${root}agents/orchestrator/tools/source-evidence.ts`]: [
      'import { tool } from "@opencorvus-ai/plugin"',
      "",
      "export default tool({",
      '  description: "Project source evidence tool.",',
      "  args: {",
      "    label: tool.schema.string().optional(),",
      "  },",
      "  async execute(args, context) {",
      '    return `source-evidence:${context.agent}:${args.label ?? ""}:${context.directory}`',
      "  },",
      "})",
      "",
    ].join("\n"),
    [`${root}agents/build/tools/build-evidence.ts`]: [
      'import { tool } from "@opencorvus-ai/plugin"',
      "",
      "export default tool({",
      '  description: "Project build evidence tool.",',
      "  args: {},",
      "  async execute(_args, context) {",
      "    return `build-evidence:${context.agent}:${context.directory}`",
      "  },",
      "})",
      "",
    ].join("\n"),
    ...(options.packageMcpDefinition
      ? {
          ...(options.schedulerPackageMcpServerRefs?.length
            ? {
                [`${root}agents/orchestrator/mcp/package-browser.jsonc`]: JSON.stringify(
                  options.packageMcpDefinition,
                  null,
                  2,
                ),
              }
            : {}),
          ...(options.buildPackageMcpServerRefs?.length
            ? {
                [`${root}agents/build/mcp/package-browser.jsonc`]: JSON.stringify(
                  options.packageMcpDefinition,
                  null,
                  2,
                ),
              }
            : {}),
        }
      : {}),
    [`${root}${EXPERT_SQUAD_MANIFEST}`]: JSON.stringify(projectExpertSquadManifest(id, options), null, 2),
  }
}

export async function writeProjectExpertSquadPackage(
  projectRoot: string,
  id = PROJECT_EXPERT_SQUAD_ID,
  options: ProjectExpertSquadManifestOptions = {},
): Promise<string> {
  const packageRoot = path.join(projectRoot, ".opencorvus", EXPERT_SQUAD_DIRECTORY, PROJECT_EXPERT_SQUAD_NAMESPACE, id)
  for (const [relativePath, content] of Object.entries(projectExpertSquadFiles(id, "", options))) {
    const target = path.join(packageRoot, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
  return packageRoot
}

export async function copyRepositoryExpertSquadPackage(projectRoot: string, id: string): Promise<string> {
  const sourceRoot = repositoryExpertSquadRoot(id)
  const loaded = await ExpertSquadRegistry.loadPackage(sourceRoot)
  const targetRoot = path.join(projectRoot, ".opencorvus", EXPERT_SQUAD_DIRECTORY, loaded.namespace, loaded.id)
  await fs.mkdir(path.dirname(targetRoot), { recursive: true })
  await fs.cp(sourceRoot, targetRoot, {
    recursive: true,
    force: false,
    errorOnExist: true,
    verbatimSymlinks: true,
  })
  return targetRoot
}

export async function writeSourceExpertSquadPackage(root: string, folder = "uploaded-folder", id = PROJECT_EXPERT_SQUAD_ID) {
  const packageRoot = path.join(root, folder)
  for (const [relativePath, content] of Object.entries(projectExpertSquadFiles(id))) {
    const target = path.join(packageRoot, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
  return packageRoot
}
