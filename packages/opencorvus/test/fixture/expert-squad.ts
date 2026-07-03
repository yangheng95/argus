import fs from "fs/promises"
import path from "node:path"

export const PROJECT_EXPERT_SQUAD_ID = "project-replica"
const EXPERT_SQUAD_DIRECTORY = "expert-squads"
const EXPERT_SQUAD_MANIFEST = "expert-squad.jsonc"

export interface ProjectExpertSquadManifestOptions {
  schedulerDefaultSkillRefs?: string[]
  schedulerPackageToolRefs?: string[]
  buildDefaultSkillRefs?: string[]
  agentDefaultSkillRefs?: Record<string, string[]>
}

export function projectExpertSquadManifest(id = PROJECT_EXPERT_SQUAD_ID, options: ProjectExpertSquadManifestOptions = {}) {
  const schedulerPackageToolRefs = options.schedulerPackageToolRefs ?? [`${id}/orchestrator/source-evidence`]
  const buildProjection = {
    role_base: true,
    ...(options.buildDefaultSkillRefs?.length ? { default_skill_refs: options.buildDefaultSkillRefs } : {}),
    package_skill_refs: [`${id}/build/implementation`],
    package_tool_refs: [`${id}/build/build-evidence`],
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
    id,
    label: "Project Replica",
    description: "Project-local replica squad",
    version: "2026.07.04",
    readme: "README.md",
    selector: {
      summary: "Use for project-local replica tasks.",
      selection_guidance: `Call select_expert_squad with profile_id ${id}.`,
    },
    capability_projection: {
      scheduler: {
        role_base: true,
        built_in_tool_ids: ["select_expert_squad", "skill", "build"],
        ...(options.schedulerDefaultSkillRefs?.length
          ? { default_skill_refs: options.schedulerDefaultSkillRefs }
          : {}),
        package_skill_refs: [`${id}/orchestrator/scheduler`],
        ...(schedulerPackageToolRefs.length ? { package_tool_refs: schedulerPackageToolRefs } : {}),
        package_mcp_server_refs: [`${id}/orchestrator/package-browser`],
        package_mcp_tool_refs: [`${id}/orchestrator/package-browser/tool/snapshot`],
        package_mcp_prompt_refs: [`${id}/orchestrator/package-browser/prompt/inspect`],
        package_mcp_resource_refs: [`${id}/orchestrator/package-browser/resource/dom`],
      },
      agents: {
        build: buildProjection,
        ...extraAgentProjections,
      },
    },
    agents: {
      orchestrator: {
        prompt: "agents/orchestrator/system.md",
        skill_refs: [`${id}/orchestrator/scheduler`],
        tool_refs: [`${id}/orchestrator/source-evidence`],
        mcp_server_refs: [`${id}/orchestrator/package-browser`],
      },
      build: {
        prompt: "agents/build/system.md",
        skill_refs: [`${id}/build/implementation`],
        tool_refs: [`${id}/build/build-evidence`],
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
    [`${root}README.md`]: "# Project Replica\n",
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
    [`${root}agents/orchestrator/mcp/package-browser.jsonc`]: JSON.stringify(
      { command: "node", args: ["browser.js"], capabilities: { tools: ["snapshot"], prompts: ["inspect"], resources: ["dom"] } },
      null,
      2,
    ),
    [`${root}${EXPERT_SQUAD_MANIFEST}`]: JSON.stringify(projectExpertSquadManifest(id, options), null, 2),
  }
}

export async function writeProjectExpertSquadPackage(
  projectRoot: string,
  id = PROJECT_EXPERT_SQUAD_ID,
  options: ProjectExpertSquadManifestOptions = {},
): Promise<string> {
  const packageRoot = path.join(projectRoot, ".opencorvus", EXPERT_SQUAD_DIRECTORY, id)
  for (const [relativePath, content] of Object.entries(projectExpertSquadFiles(id, "", options))) {
    const target = path.join(packageRoot, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
  return packageRoot
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
