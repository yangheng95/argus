import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { AgentBaseRuntimeContract } from "../../src/agent/base-runtime-contract"
import { AgentRoleContract } from "../../src/agent/role-contract"
import { ExpertSquadRegistry } from "../../src/expert-squad/registry"
import {
  PORTABLE_TEMPLATE_ID,
  PORTABLE_TEMPLATE_SKILL_REF,
  portableTemplatePromptProfileRoles,
  portableTemplateSkillProjectionRoles,
  portableTemplateVirtualAgentRoles,
  renderPortableExpertSquadTemplateFiles,
  resolvePortableExpertSquadTemplatePackageRoot,
  resolvePortableExpertSquadTemplateRoot,
} from "../../script/generate-portable-expert-squad-template"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")

async function collectFiles(root: string): Promise<string[]> {
  const result: string[] = []

  async function walk(current: string): Promise<void> {
    const entries = (await fs.readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const entry of entries) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      result.push(path.relative(root, absolute).replaceAll(path.sep, "/"))
    }
  }

  await walk(root)
  return result.sort()
}

describe("portable expert-squad template", () => {
  test("checked-in artifact is generated from the current base role contract", async () => {
    const root = resolvePortableExpertSquadTemplateRoot(repoRoot)
    const expected = renderPortableExpertSquadTemplateFiles()
    const actualFiles = await collectFiles(root)

    expect(actualFiles).toEqual(Object.keys(expected).sort())
    for (const file of actualFiles) {
      expect(await fs.readFile(path.join(root, ...file.split("/")), "utf8")).toBe(expected[file])
    }
  })

  test("package sample loads through the expert-squad registry", async () => {
    const packageRoot = resolvePortableExpertSquadTemplatePackageRoot(repoRoot)
    const loaded = await ExpertSquadRegistry.loadSourcePackage(packageRoot)

    expect(loaded.id).toBe(PORTABLE_TEMPLATE_ID)
    expect(Object.keys(loaded.manifest.capability_projection.agents)).toEqual(
      portableTemplatePromptProfileRoles(),
    )
    expect(Object.keys(loaded.manifest.virtual_agents)).toEqual(portableTemplateVirtualAgentRoles())
    expect(Object.keys(loaded.manifest.agents)).toEqual(["orchestrator"])
    expect(loaded.manifest.agents.orchestrator.skill_refs).toEqual([PORTABLE_TEMPLATE_SKILL_REF])
    expect(loaded.promptProfile.agents.orchestrator).toContain("base role IDs")
    expect(loaded.packageSkillRefs.has(PORTABLE_TEMPLATE_SKILL_REF)).toBe(true)
  })

  test("template separates all available projections from virtual-agent-capable roles", async () => {
    const packageRoot = resolvePortableExpertSquadTemplatePackageRoot(repoRoot)
    const loaded = await ExpertSquadRegistry.loadSourcePackage(packageRoot)
    const skillProjectionRoles = new Set(portableTemplateSkillProjectionRoles())
    const virtualRoles = new Set(portableTemplateVirtualAgentRoles())

    expect(portableTemplatePromptProfileRoles()).toEqual(AgentRoleContract.promptProfileTargets())
    expect(portableTemplateVirtualAgentRoles()).toEqual(
      AgentBaseRuntimeContract.all()
        .filter((projection) => projection.packageProjection.virtualAgent)
        .filter((projection) => AgentRoleContract.promptProfileTargetMode(projection.role) !== "none")
        .map((projection) => projection.role),
    )

    for (const role of portableTemplatePromptProfileRoles()) {
      const projection = loaded.manifest.capability_projection.agents[role]
      expect(projection?.role_base).toBe(true)
      expect(Boolean(loaded.manifest.agents[role] && loaded.manifest.virtual_agents[role])).toBe(false)
      if (skillProjectionRoles.has(role)) {
        expect(projection?.package_skill_refs).toEqual([PORTABLE_TEMPLATE_SKILL_REF])
      } else {
        expect(projection?.package_skill_refs).toEqual([])
      }
    }

    for (const role of virtualRoles) {
      expect(loaded.manifest.virtual_agents[role]?.prompt).toBe(`virtual-agents/${role}/system.md`)
      expect(loaded.promptProfile.virtualAgents[role]?.promptContent).toContain(`Base role: \`${role}\``)
    }

    for (const role of portableTemplatePromptProfileRoles().filter((role) => !virtualRoles.has(role))) {
      expect(loaded.manifest.virtual_agents[role]).toBeUndefined()
    }
  })
})
