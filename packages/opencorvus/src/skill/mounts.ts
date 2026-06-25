import type { Agent } from "@/agent/agent"
import { AgentToolPool } from "@/agent/tool-pool-contract"
import { Config } from "@/config/config"
import { EffectiveConfig } from "@/config/effective"
import { PermissionNext } from "@/permission/next"
import z from "zod"
import { Skill } from "./skill"
import { SkillManager } from "./manager"

export namespace SkillMount {
  export const Mounts = z
    .object({
      agents: z.record(z.string().min(1), z.array(z.string().min(1))).optional(),
    })
    .strict()
  export type Mounts = z.infer<typeof Mounts>

  export const DisabledReason = z.enum([
    "skill_tool_unavailable",
    "permission_denied",
    "platform_incompatible",
    "agent_incompatible",
    "missing_required_tool",
  ])
  export type DisabledReason = z.infer<typeof DisabledReason>

  export const MountedSkill = z.object({
    name: z.string(),
    description: z.string(),
    location: z.string(),
    enabled: z.boolean(),
    reason: DisabledReason.optional(),
  })
  export type MountedSkill = z.infer<typeof MountedSkill>

  export const AgentEntry = z.object({
    name: z.string(),
    description: z.string().optional(),
    mode: z.enum(["subagent", "primary", "all"]),
    native: z.boolean().optional(),
    hidden: z.boolean().optional(),
    skill_mountable: z.boolean(),
    skill_tool_available: z.boolean(),
  })
  export type AgentEntry = z.infer<typeof AgentEntry>

  export const PoolSkill = SkillManager.Installed.safeExtend({
    mounted_agents: z.array(z.string()),
    unmounted: z.boolean(),
    warning: z.literal("unmounted").optional(),
  })
  export type PoolSkill = z.infer<typeof PoolSkill>

  export const MatrixRow = z.object({
    agent: z.string(),
    mounted: z.array(MountedSkill),
  })
  export type MatrixRow = z.infer<typeof MatrixRow>

  export const Matrix = z.object({
    scope: z.enum(["project", "session"]),
    skills: z.array(PoolSkill),
    agents: z.array(AgentEntry),
    matrix: z.array(MatrixRow),
    project_mounts: Mounts,
    unmounted_count: z.number().int().nonnegative(),
  })
  export type Matrix = z.infer<typeof Matrix>

  export const MountInput = z.object({
    agent: z.string().min(1),
    skill: z.string().min(1),
    sessionID: z.string().min(1).optional(),
  })

  export const ImportAndMountInput = z.object({
    agent: z.string().min(1),
    sessionID: z.string().min(1).optional(),
    import: SkillManager.ImportFileInput,
  })

  export type ResolvedSkill = MountedSkill & {
    mounted: true
    skill: Skill.Info
  }

  export type ResolvedAgentSkillSurface = {
    agent: string
    scope: "project" | "session"
    tool_available: boolean
    unmounted_pool_count: number
    skills: ResolvedSkill[]
  }

  export async function resolve(input: {
    agent: Agent.Info
    config?: Config.Info
    sessionID?: string
    availableToolNames?: Iterable<string>
    skills?: Skill.Info[]
    agents?: Agent.Info[]
  }): Promise<ResolvedAgentSkillSurface> {
    const skills = input.skills ?? (await Skill.all())
    const allAgents: Agent.Info[] =
      input.agents ?? (await import("@/agent/agent").then(({ Agent }) => Agent.list({ config: input.config })))
    assertKnownMountedAgents(skills, allAgents)
    const byName = skillByName(skills)
    const mountedNames = skills
      .filter((skill) => skill.mounted_agents.includes(input.agent.name))
      .map((skill) => skill.name)
    const mountedAgents = mountedAgentsBySkill(skills)
    const availableToolNames = input.availableToolNames ? new Set(input.availableToolNames) : undefined
    const toolAvailable = agentCanUseSkillTool(input.agent, availableToolNames)
    const mounted = mountedNames.map((name) => {
      const skill = byName.get(name)!
      const reason = disabledReason(skill, input.agent, toolAvailable, availableToolNames)
      return {
        name: skill.name,
        description: skill.description,
        location: skill.location,
        enabled: reason === undefined,
        reason,
        mounted: true as const,
        skill,
      }
    })

    return {
      agent: input.agent.name,
      scope: input.sessionID ? "session" : "project",
      tool_available: toolAvailable,
      unmounted_pool_count: skills.filter((skill) => (mountedAgents.get(skill.name) ?? []).length === 0).length,
      skills: mounted,
    }
  }

  export async function matrix(input?: { sessionID?: string; refresh?: boolean }): Promise<Matrix> {
    if (input?.refresh) {
      await SkillManager.refreshDiscoveryState()
    }
    const scope = input?.sessionID ? "session" : "project"
    const { Agent } = await import("@/agent/agent")
    const config = input?.sessionID
      ? await EffectiveConfig.effective({ sessionID: input.sessionID })
      : await Config.get()
    const [installed, agents] = await Promise.all([SkillManager.installed(), Agent.list({ config })])
    assertKnownMountedAgents(installed, agents)
    const mountableAgents = agents.filter((agent) => agentSkillMountable(agent) && agentCanUseSkillTool(agent))
    const mountedAgents = mountedAgentsBySkill(installed)
    const pool = installed.map((skill) => {
      const agents = mountedAgents.get(skill.name) ?? []
      return {
        ...skill,
        mounted_agents: agents,
        unmounted: agents.length === 0,
        ...(agents.length === 0 ? { warning: "unmounted" as const } : {}),
      }
    })
    const rows = await Promise.all(
      mountableAgents.map(async (agent) => {
        const surface = await resolve({ agent, config, sessionID: input?.sessionID, skills: installed, agents })
        return {
          agent: agent.name,
          mounted: surface.skills.map(({ skill: _skill, mounted: _mounted, ...item }) => item),
        }
      }),
    )

    return Matrix.parse({
      scope,
      skills: pool,
      agents: mountableAgents.map((agent) => ({
        name: agent.name,
        description: agent.description,
        mode: agent.mode,
        native: agent.native,
        hidden: agent.hidden,
        skill_mountable: agentSkillMountable(agent),
        skill_tool_available: agentCanUseSkillTool(agent),
      })),
      matrix: rows,
      project_mounts: mountsByAgent(installed),
      unmounted_count: pool.filter((skill) => skill.unmounted).length,
    })
  }

  export async function mount(raw: z.input<typeof MountInput>) {
    const input = MountInput.parse(raw)
    await updateMount(input, "mount")
    return matrix({ sessionID: input.sessionID })
  }

  export async function unmount(raw: z.input<typeof MountInput>) {
    const input = MountInput.parse(raw)
    await updateMount(input, "unmount")
    return matrix({ sessionID: input.sessionID })
  }

  export async function importAndMount(raw: z.input<typeof ImportAndMountInput>) {
    const input = ImportAndMountInput.parse(raw)
    const config = input.sessionID
      ? await EffectiveConfig.effective({ sessionID: input.sessionID })
      : await Config.get()
    const { Agent } = await import("@/agent/agent")
    const [agent, agents, preview] = await Promise.all([
      Agent.get(input.agent, { config }),
      Agent.list({ config }),
      SkillManager.previewImportFile(input.import),
    ])
    if (!agent) throw new Error(`Unknown agent: ${input.agent}`)
    if (!agentSkillMountable(agent)) {
      throw new Error(`Agent ${input.agent} does not allow operator-managed skill mounts.`)
    }
    if (!agentCanUseSkillTool(agent)) {
      throw new Error(`Agent ${input.agent} cannot mount skills because it does not expose the skill tool.`)
    }
    assertKnownMountedAgents(
      preview.skills.map((skill) => candidateSkillInfo(skill)),
      agents,
    )
    for (const skill of preview.skills) {
      const reason = mountBlockingReason(candidateSkillInfo(skill), agent)
      if (reason) throw new Error(`Skill ${skill.name} cannot be mounted to ${input.agent}: ${reason}`)
    }
    await SkillManager.importFile(input.import, { mountedAgent: input.agent })
    return matrix({ sessionID: input.sessionID })
  }

  async function updateMount(input: z.infer<typeof MountInput>, action: "mount" | "unmount") {
    await updateAgentMounts({ agent: input.agent, skills: [input.skill], sessionID: input.sessionID }, action)
  }

  async function updateAgentMounts(
    input: { agent: string; skills: string[]; sessionID: string | undefined },
    action: "mount" | "unmount",
  ) {
    const config = input.sessionID
      ? await EffectiveConfig.effective({ sessionID: input.sessionID })
      : await Config.get()
    const { Agent } = await import("@/agent/agent")
    const [agent, agents, initialSkills] = await Promise.all([
      Agent.get(input.agent, { config }),
      Agent.list({ config }),
      Skill.all(),
    ])
    if (!agent) throw new Error(`Unknown agent: ${input.agent}`)
    if (!agentSkillMountable(agent)) {
      throw new Error(`Agent ${input.agent} does not allow operator-managed skill mounts.`)
    }
    assertKnownMountedAgents(initialSkills, agents)
    let skills = initialSkills
    let byName = skillByName(skills)
    if (action === "mount" && !agentCanUseSkillTool(agent)) {
      throw new Error(`Agent ${input.agent} cannot mount skills because it does not expose the skill tool.`)
    }
    const uniqueInputSkills = Array.from(new Set(input.skills))
    const targets: Array<{ skill: Skill.Info; agents: string[] }> = []
    for (const name of uniqueInputSkills) {
      let skill = byName.get(name)
      if (!skill) throw new Error(`Unknown skill: ${name}`)
      if (skill.builtin) {
        await Skill.materializeBuiltinProjectSkill(skill.name, skill.mounted_agents)
        skills = await Skill.all()
        assertKnownMountedAgents(skills, agents)
        byName = skillByName(skills)
        skill = byName.get(name)
        if (!skill || skill.builtin) {
          throw new Error(`Skill ${name} cannot be mounted because it has no writable SKILL.md.`)
        }
      }
      if (action === "mount") {
        const reason = mountBlockingReason(skill, agent)
        if (reason) {
          throw new Error(`Skill ${name} cannot be mounted to ${input.agent}: ${reason}`)
        }
      }
      targets.push({ skill, agents: skill.mounted_agents })
    }

    for (const target of targets) {
      const next =
        action === "mount"
          ? target.agents.includes(input.agent)
            ? target.agents
            : [...target.agents, input.agent]
          : target.agents.filter((agentName) => agentName !== input.agent)
      await Skill.writeMountedAgents(target.skill.location, next)
    }
  }

  function skillByName<T extends Pick<Skill.Info, "name">>(skills: T[]) {
    return new Map(skills.map((skill) => [skill.name, skill]))
  }

  function mountedAgentsBySkill(skills: Array<Pick<Skill.Info, "name" | "mounted_agents">>) {
    const result = new Map<string, string[]>()
    for (const skill of skills) {
      result.set(skill.name, Array.from(new Set(skill.mounted_agents)))
    }
    return result
  }

  function mountsByAgent(skills: Array<Pick<Skill.Info, "name" | "mounted_agents">>) {
    const agents: Record<string, string[]> = {}
    for (const skill of skills) {
      for (const agent of skill.mounted_agents) {
        agents[agent] = [...(agents[agent] ?? []), skill.name]
      }
    }
    return Mounts.parse({ agents })
  }

  function assertKnownMountedAgents(
    skills: Array<Pick<Skill.Info, "name" | "mounted_agents">>,
    agents: Array<Pick<Agent.Info, "name">>,
  ) {
    const known = new Set(agents.map((agent) => agent.name))
    for (const skill of skills) {
      const unique = new Set(skill.mounted_agents)
      if (unique.size !== skill.mounted_agents.length) {
        throw new Error(`Skill ${skill.name} mounted_agents contains duplicate agent names.`)
      }
      const unknown = skill.mounted_agents.filter((agent) => !known.has(agent))
      if (unknown.length > 0) {
        throw new Error(`Skill ${skill.name} mounted_agents contains unknown agent(s): ${unknown.join(", ")}`)
      }
    }
  }

  function candidateSkillInfo(
    skill: Pick<Skill.Info, "name" | "description" | "platforms" | "required_tools" | "agents" | "mounted_agents">,
  ): Skill.Info {
    return {
      name: skill.name,
      description: skill.description,
      platforms: skill.platforms,
      builtin: false,
      location: "<pending-import>",
      content: "",
      priority: 0,
      required_tools: skill.required_tools,
      agents: skill.agents,
      mounted_agents: skill.mounted_agents,
      duplicate_locations: [],
    }
  }

  export function agentCanUseSkillTool(agent: Agent.Info, availableToolNames?: ReadonlySet<string>): boolean {
    if (availableToolNames && !availableToolNames.has("skill")) return false
    if (!AgentToolPool.hasTool(agent.tools, "skill")) return false
    return !PermissionNext.disabled(["skill"], agent.permission).has("skill")
  }

  export function agentSkillMountable(agent: Pick<Agent.Info, "skill_mountable">): boolean {
    return agent.skill_mountable === true
  }

  function disabledReason(
    skill: Skill.Info,
    agent: Agent.Info,
    toolAvailable: boolean,
    availableToolNames: ReadonlySet<string> | undefined,
  ): DisabledReason | undefined {
    if (!toolAvailable) return "skill_tool_unavailable"
    const rule = PermissionNext.evaluate("skill", skill.name, agent.permission)
    if (rule.action === "deny") return "permission_denied"
    const platform = process.platform as "win32" | "darwin" | "linux"
    if (skill.platforms.length > 0 && !skill.platforms.includes(platform)) return "platform_incompatible"
    if (skill.agents.length > 0 && !skill.agents.includes(agent.name)) return "agent_incompatible"
    if ((skill.required_tools ?? []).some((toolID) => !agentCanUseRequiredTool(agent, toolID, availableToolNames))) {
      return "missing_required_tool"
    }
    return undefined
  }

  function mountBlockingReason(skill: Skill.Info, agent: Agent.Info): DisabledReason | undefined {
    const reason = disabledReason(skill, agent, true, undefined)
    return reason === "permission_denied" ? undefined : reason
  }

  function agentCanUseRequiredTool(
    agent: Agent.Info,
    toolID: string,
    availableToolNames: ReadonlySet<string> | undefined,
  ): boolean {
    if (availableToolNames && !availableToolNames.has(toolID)) return false
    if (!AgentToolPool.hasTool(agent.tools, toolID)) return false

    const rule = PermissionNext.evaluate(toolID, "*", agent.permission)
    return rule.action !== "deny"
  }
}
