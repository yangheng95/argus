import fs from "fs/promises"
import path from "node:path"
import { ExpertSquadRegistry } from "../../src/expert-squad/registry"

export const PROJECT_EXPERT_SQUAD_ID = "project-replica"

export function projectExpertSquadManifest(id = PROJECT_EXPERT_SQUAD_ID) {
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
        package_skill_refs: [`${id}/orchestrator/scheduler`],
        package_tool_refs: [`${id}/orchestrator/source-evidence`],
        package_mcp_server_refs: [`${id}/orchestrator/package-browser`],
        package_mcp_tool_refs: [`${id}/orchestrator/package-browser/tool/snapshot`],
        package_mcp_prompt_refs: [`${id}/orchestrator/package-browser/prompt/inspect`],
        package_mcp_resource_refs: [`${id}/orchestrator/package-browser/resource/dom`],
      },
      agents: {
        build: {
          role_base: true,
          package_skill_refs: [`${id}/build/implementation`],
          package_tool_refs: [`${id}/build/build-evidence`],
        },
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

export function projectExpertSquadFiles(id = PROJECT_EXPERT_SQUAD_ID, prefix = ""): Record<string, string> {
  const root = prefix ? `${prefix.replace(/\/+$/, "")}/` : ""
  return {
    [`${root}README.md`]: "# Project Replica\n",
    [`${root}agents/orchestrator/system.md`]: "project orchestrator overlay",
    [`${root}agents/build/system.md`]: "project build overlay",
    [`${root}agents/orchestrator/skills/scheduler/SKILL.md`]: "---\nname: scheduler\n---\n",
    [`${root}agents/build/skills/implementation/SKILL.md`]: "---\nname: implementation\n---\n",
    [`${root}agents/orchestrator/tools/source-evidence.ts`]: "export default {}",
    [`${root}agents/build/tools/build-evidence.ts`]: "export default {}",
    [`${root}agents/orchestrator/mcp/package-browser.jsonc`]: JSON.stringify(
      { command: "node", args: ["browser.js"], capabilities: { tools: ["snapshot"], prompts: ["inspect"], resources: ["dom"] } },
      null,
      2,
    ),
    [`${root}${ExpertSquadRegistry.MANIFEST}`]: JSON.stringify(projectExpertSquadManifest(id), null, 2),
  }
}

export async function writeProjectExpertSquadPackage(projectRoot: string, id = PROJECT_EXPERT_SQUAD_ID): Promise<string> {
  const packageRoot = path.join(projectRoot, ".opencorvus", ExpertSquadRegistry.DIRECTORY, id)
  for (const [relativePath, content] of Object.entries(projectExpertSquadFiles(id))) {
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
