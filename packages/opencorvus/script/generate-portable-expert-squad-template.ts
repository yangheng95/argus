#!/usr/bin/env bun

import { AgentBaseRuntimeContract } from "../src/agent/base-runtime-contract"
import { AgentRoleContract, type AgentRoleID } from "../src/agent/role-contract"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const PORTABLE_TEMPLATE_NAMESPACE = "template"
export const PORTABLE_TEMPLATE_ID = "portable-template"
export const PORTABLE_TEMPLATE_SKILL_REF = `${PORTABLE_TEMPLATE_ID}/shared/expert-squad-authoring`

export function resolvePortableExpertSquadTemplateRoot(repoRoot: string): string {
  return path.join(repoRoot, "specs", "artifacts", "portable-expert-squad-template")
}

export function resolvePortableExpertSquadTemplatePackageRoot(repoRoot: string): string {
  return path.join(resolvePortableExpertSquadTemplateRoot(repoRoot), "package")
}

export function portableTemplatePromptProfileRoles(): AgentRoleID[] {
  return AgentRoleContract.promptProfileTargets()
}

export function portableTemplateVirtualAgentRoles(): AgentRoleID[] {
  return AgentBaseRuntimeContract.all()
    .filter((projection) => projection.packageProjection.virtualAgent)
    .filter((projection) => AgentRoleContract.promptProfileTargetMode(projection.role) !== "none")
    .map((projection) => projection.role)
}

export function portableTemplateSkillProjectionRoles(): AgentRoleID[] {
  return portableTemplatePromptProfileRoles().filter((role) => AgentRoleContract.skillMountable(role))
}

function displayLabel(role: AgentRoleID): string {
  return role
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function renderHumanTutorial(): string {
  const roles = portableTemplatePromptProfileRoles()
  const virtualRoles = portableTemplateVirtualAgentRoles()
  return [
    "# Portable Expert Squad Template",
    "",
    "This artifact is a copy-and-edit template for an external OpenCorvus expert squad package.",
    "",
    "The valid package root is `package/`. The file at `package/README.md` is runtime Orchestrator prompt content, not a human manual. Keep human instructions in this artifact README or in external docs outside the installed package root.",
    "",
    "## Why The Template Lists Every Available Role",
    "",
    "The template derives its default role list from `AgentRoleContract.promptProfileTargets()`, so it includes every OpenCorvus role that can participate in prompt-profile projection:",
    "",
    ...roles.map((role) => `- \`${role}\`: ${AgentRoleContract.description(role)}`),
    "",
    "A real expert squad should delete roles it does not actually use before installation. Keeping unused roles widens `dispatch_agent` and worker projection, which makes failures harder to diagnose.",
    "",
    "## Directory Rules",
    "",
    "- `capability_projection.agents` is the explicit projection source for runtime visibility.",
    "- Absence of `agents.<role>` means the base OpenCorvus prompt and runtime contract remain in force.",
    "- `agents/orchestrator/system.md` is the scheduler overlay for package-specific coordination.",
    "- `virtual_agents.<role>` plus `virtual-agents/<role>/system.md` creates a package-owned expert identity on an existing base role.",
    "- Do not keep `agents/<role>` and `virtual_agents.<role>` for the same role.",
    "- Package root `README.md` is appended to the active Orchestrator prompt. Do not put tutorial prose there.",
    "",
    "## Roles With Virtual-Agent Stubs",
    "",
    ...virtualRoles.map((role) => `- \`${role}\``),
    "",
    "## Create A Real Squad From This Template",
    "",
    "1. Copy `package/` to `.opencorvus/expert-squads/<namespace>/<id>/`.",
    "2. Rename `namespace`, `id`, `label`, package refs, virtual-agent IDs, and selector guidance.",
    "3. Delete every role projection that is not actually part of the squad.",
    "4. Keep only the virtual-agent prompts that express real package-owned expert identity.",
    "5. Add package skills, tools, or MCP definitions under the package root and project them through `capability_projection`.",
    "6. Validate with `ExpertSquadRegistry.loadPackage()` or the focused expert-squad tests before release.",
    "",
    "## Good Portable Squad Checklist",
    "",
    "- The selector explains when to choose the squad and when not to choose it.",
    "- The Orchestrator README defines coordination contracts, not long tutorial text.",
    "- Every projected role has a concrete job, evidence surface, and stop condition.",
    "- Every package tool, skill, and MCP ref is explicitly projected and has one owner.",
    "- Virtual-agent labels never become dispatch inputs. Dispatch remains on base role IDs.",
    "- The package does not add fallback aliases, hidden routing, workflow engines, or config mutations.",
    "",
  ].join("\n")
}

function schedulerToolIDs(): string[] {
  return [
    "select_expert_squad",
    "skill",
    "question",
    "read_context",
    "dispatch_agent",
    "manage_task",
    "refine",
    "wait",
    "browser_preview",
    "bash",
    "respond_agent_coordination",
    "cancel_subagent",
  ]
}

function renderManifest(): string {
  const skillRoles = new Set(portableTemplateSkillProjectionRoles())
  const agents = Object.fromEntries(
    portableTemplatePromptProfileRoles().map((role) => [
      role,
      {
        role_base: true,
        ...(skillRoles.has(role) ? { package_skill_refs: [PORTABLE_TEMPLATE_SKILL_REF] } : {}),
      },
    ]),
  )
  const virtualAgents = Object.fromEntries(
    portableTemplateVirtualAgentRoles().map((role) => [
      role,
      {
        id: `portable-${role}`,
        label: `Portable ${displayLabel(role)}`,
        description: `Template virtual agent identity projected onto the existing ${role} base role.`,
        prompt: `virtual-agents/${role}/system.md`,
      },
    ]),
  )
  return (
    JSON.stringify(
      {
        schema_version: 1,
        namespace: PORTABLE_TEMPLATE_NAMESPACE,
        id: PORTABLE_TEMPLATE_ID,
        label: "Portable Expert Squad Template",
        description:
          "Copy-and-edit template for portable OpenCorvus expert squads; prune unused roles before installation.",
        version: "2026.07.07",
        readme: "README.md",
        selector: {
          summary:
            "Template selector. Replace this before installation; do not select an unedited template for production work.",
          selection_guidance:
            "After this template is renamed and specialized, use select_expert_squad with the new profile_id when the task matches its domain.",
          instructions: "selector.md",
        },
        capability_projection: {
          scheduler: {
            role_base: false,
            built_in_tool_ids: schedulerToolIDs(),
            package_skill_refs: [PORTABLE_TEMPLATE_SKILL_REF],
          },
          agents,
        },
        agents: {
          orchestrator: {
            prompt: "agents/orchestrator/system.md",
            skill_refs: [PORTABLE_TEMPLATE_SKILL_REF],
          },
        },
        virtual_agents: virtualAgents,
      },
      null,
      2,
    ) + "\n"
  )
}

function renderPackageReadme(): string {
  return [
    "# Portable Expert Squad Runtime Prompt",
    "",
    "This README is appended to the Orchestrator prompt only when this expert squad is active.",
    "",
    "Before installing a real squad from this template, replace this text with the squad's coordination contract:",
    "",
    "- the domain boundary;",
    "- the roles that are actually projected;",
    "- the evidence each role must produce or consume;",
    "- the package skills, tools, and MCP providers that are the single source for domain behavior;",
    "- the conditions that make the Orchestrator ask the user, dispatch a worker, retry a worker, or finish.",
    "",
    "Do not put human tutorial prose, setup instructions, or alternate fallback behavior in this runtime prompt.",
    "",
  ].join("\n")
}

function renderSelector(): string {
  return [
    "# Portable Expert Squad Selector",
    "",
    "This selector is intentionally a template.",
    "",
    "Before installing the package, replace this file with concise selection evidence:",
    "",
    "- choose this squad only for its explicit domain;",
    "- name examples that should not select this squad;",
    "- call `select_expert_squad` with the renamed manifest `id`, never with a namespace, label, folder name, or virtual-agent ID;",
    "- do not select an unmodified template package for production work.",
    "",
  ].join("\n")
}

function renderOrchestratorPrompt(): string {
  return [
    "# Portable Template Orchestrator Overlay",
    "",
    "Use the projected `portable-template/shared/expert-squad-authoring` skill to review the package contract before dispatch.",
    "",
    "For a real squad, replace this overlay with the scheduler-specific coordination rules. Keep workflow dispatch on base role IDs from `capability_projection.agents`; virtual-agent IDs are display and prompt metadata only.",
    "",
  ].join("\n")
}

function renderAuthoringSkill(): string {
  return [
    "---",
    "name: expert-squad-authoring",
    "description: Use when designing or reviewing a portable OpenCorvus expert squad package.",
    "---",
    "",
    "# Expert Squad Authoring",
    "",
    "Use this skill to define or review an expert squad before it is installed.",
    "",
    "A good expert squad has one narrow domain boundary, explicit selection guidance, and role projections that match real work. It does not copy every OpenCorvus role into production just because the template lists them.",
    "",
    "Checklist:",
    "",
    "- Start from existing base roles; do not invent runtime roles.",
    "- Keep `prompt_profile.active` as the only active selection source.",
    "- Use `capability_projection.agents` for explicit runtime visibility.",
    "- Use `virtual_agents.<role>` only for package-owned expert identity on an existing base role.",
    "- Keep `agents/orchestrator/system.md` for scheduler coordination overlay.",
    "- Put human manuals outside the package root; package `README.md` is runtime prompt content.",
    "- Put durable protocol rules in one package tool, skill, MCP server, or data file; do not duplicate them across prompts.",
    "- Project package skills, tools, and MCP refs explicitly. Do not rely on directory scanning or inactive packages.",
    "- Delete unused roles from the real manifest before release.",
    "- Add registry, resolver, catalog, route, and payload tests for every touched surface.",
    "",
    "Reject these designs:",
    "",
    "- aliasing or guessing squad identity from folder names, labels, ZIP names, or selector names;",
    "- automatic role union into an existing external squad;",
    "- package-owned workflow engines, hidden dispatch, or second active state;",
    "- virtual-agent IDs used as `dispatch_agent.target` or `target_agent` inputs;",
    "- fallback tools or compatibility paths that hide missing package resources.",
    "",
  ].join("\n")
}

function renderVirtualPrompt(role: AgentRoleID): string {
  return [
    `# Portable ${displayLabel(role)} Virtual Agent`,
    "",
    `Base role: \`${role}\`.`,
    "",
    `Base contract: ${AgentRoleContract.description(role)}`,
    "",
    "Replace this template text with the package-owned expert identity for the role.",
    "",
    "Keep runtime identity, workflow dispatch, terminal submit protocol, and artifact ownership on the base role. This file may specialize reasoning, evidence expectations, and domain review criteria; it must not create fallback behavior or a second workflow.",
    "",
  ].join("\n")
}

export function renderPortableExpertSquadTemplateFiles(): Record<string, string> {
  return {
    "README.md": renderHumanTutorial(),
    "package/expert-squad.jsonc": renderManifest(),
    "package/README.md": renderPackageReadme(),
    "package/selector.md": renderSelector(),
    "package/agents/orchestrator/system.md": renderOrchestratorPrompt(),
    "package/skills/expert-squad-authoring/SKILL.md": renderAuthoringSkill(),
    ...Object.fromEntries(
      portableTemplateVirtualAgentRoles().map((role) => [
        `package/virtual-agents/${role}/system.md`,
        renderVirtualPrompt(role),
      ]),
    ),
  }
}

export async function generatePortableExpertSquadTemplate(repoRoot: string): Promise<string> {
  const root = resolvePortableExpertSquadTemplateRoot(repoRoot)
  const files = renderPortableExpertSquadTemplateFiles()
  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(root, ...relativePath.split("/"))
    await fs.mkdir(path.dirname(file), { recursive: true })
    const current = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (current !== content) await fs.writeFile(file, content)
  }
  return root
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
  const root = await generatePortableExpertSquadTemplate(repoRoot)
  console.log(`Generated ${path.relative(repoRoot, root).replaceAll(path.sep, "/")}`)
}

if (import.meta.main) {
  await main()
}
