import z from "zod"
import type { AgentRoleID } from "@/agent/role-contract"

export const DEFAULT_PROMPT_PROFILE_ID = "frontend"

const USER_PROFILE_TARGETS = [
  "coding",
  "coding-assistant",
  "build",
  "visual-qa",
  "general",
  "explore",
  "mission",
  "requirements",
  "architect",
  "frontend-design",
  "intent-analysis",
  "fact-check",
  "deep-research",
  "frontend-research",
  "goal-workload-analyst",
] as const

const BUILT_IN_ONLY_PROFILE_TARGETS = ["orchestrator", "integrity"] as const

export type PromptProfileTargetID =
  | (typeof USER_PROFILE_TARGETS)[number]
  | (typeof BUILT_IN_ONLY_PROFILE_TARGETS)[number]

export const PromptProfileDefinitionSchema = z
  .object({
    label: z.string().min(1),
    description: z.string().optional(),
    agents: z.record(z.string(), z.string()).default({}),
  })
  .strict()

export const PromptProfileConfigSchema = z
  .object({
    active: z.string().min(1).default(DEFAULT_PROMPT_PROFILE_ID),
    profiles: z.record(z.string(), PromptProfileDefinitionSchema).optional(),
  })
  .strict()
  .default({ active: DEFAULT_PROMPT_PROFILE_ID })

export const PromptProfileOverlaySchema = z
  .object({
    active: z.string().min(1).nullable().optional(),
  })
  .strict()

export type PromptProfileDefinition = z.output<typeof PromptProfileDefinitionSchema>
export type PromptProfileConfig = z.output<typeof PromptProfileConfigSchema>
export type PromptProfileOverlay = z.output<typeof PromptProfileOverlaySchema>

type ConfigLike = {
  prompt_profile?: PromptProfileConfig
}

export interface PromptProfileAgentBlueprint {
  focus: string
  agents?: readonly string[]
  tools?: readonly string[]
  guardrails?: readonly string[]
}

export interface PromptProfileBlueprint {
  label: string
  description?: string
  agents: Partial<Record<PromptProfileTargetID, PromptProfileAgentBlueprint>>
}

const userTargetSet = new Set<string>(USER_PROFILE_TARGETS)
const builtInOnlyTargetSet = new Set<string>(BUILT_IN_ONLY_PROFILE_TARGETS)
const allTargetSet = new Set<string>([...USER_PROFILE_TARGETS, ...BUILT_IN_ONLY_PROFILE_TARGETS])

function renderAgentOverlay(
  profileID: string,
  blueprint: PromptProfileAgentBlueprint,
): string {
  const sections = [`Active prompt profile: ${profileID} expert squad.`, blueprint.focus.trim()]
  if (blueprint.agents?.length) {
    sections.push(`Keep these agent handoffs front-of-mind: ${blueprint.agents.map((name) => `\`${name}\``).join(", ")}.`)
  }
  if (blueprint.tools?.length) {
    sections.push(`Prioritize these tools when available: ${blueprint.tools.map((name) => `\`${name}\``).join(", ")}.`)
  }
  if (blueprint.guardrails?.length) {
    sections.push(blueprint.guardrails.map((item) => item.trim()).join(" "))
  }
  return sections.filter((part) => part.trim().length > 0).join(" ")
}

function materializeProfile(
  profileID: string,
  blueprint: PromptProfileBlueprint,
): PromptProfileDefinition {
  return {
    label: blueprint.label,
    description: blueprint.description,
    agents: Object.fromEntries(
      Object.entries(blueprint.agents).map(([agentID, policy]) => [agentID, renderAgentOverlay(profileID, policy!)]),
    ),
  }
}

export namespace PromptProfile {
  export const builtInBlueprints: Record<string, PromptProfileBlueprint> = {
    general: {
      label: "General",
      description: "No domain-specific expert overlay.",
      agents: {},
    },
    frontend: {
      label: "Frontend",
      description: "UI, interaction, visual verification, and design-system focused expert squad.",
      agents: {
        coding: {
          focus:
            "Treat visual references, responsive layout, interaction truth, and accessibility regressions as first-class requirements while keeping implementation rooted in the existing codebase.",
          tools: ["read", "glob", "search_code", "edit", "write", "bash", "webfetch", "memory"],
        },
        "coding-assistant": {
          focus:
            "In direct assistant sessions, bias toward UI structure, styling, interaction states, and evidence-backed frontend fixes rather than abstract discussion.",
          tools: ["read", "glob", "search_code", "edit", "write", "bash", "webfetch", "panel", "memory"],
        },
        general: {
          focus:
            "For multi-step frontend work, keep the task grounded in concrete screens, component behavior, responsive states, and runtime-visible evidence.",
          tools: ["read", "glob", "search_code", "edit", "write", "bash", "websearch", "webfetch", "memory"],
          guardrails: ["If the request becomes visual cloning or webpage evidence work, route that need to `frontend_design` instead of improvising."],
        },
        explore: {
          focus:
            "When exploring for a frontend task, extract component structure, styling systems, state transitions, and any prior visual evidence without mutating the workspace.",
          tools: ["read", "glob", "search_code", "external_code_search", "lsp", "websearch", "webfetch", "panel", "memory"],
        },
        mission: {
          focus:
            "Coordinate long-running frontend work around screen fidelity, task-scoped preview targets, interaction semantics, and explicit visual acceptance evidence.",
          agents: ["requirements", "frontend_research", "frontend_design", "build", "visual_qa", "integrity"],
          tools: ["read", "glob", "search_code", "webfetch", "websearch", "mission_state", "panel", "memory", "wait", "question"],
        },
        "intent-analysis": {
          focus:
            "Disambiguate frontend requests into visual requirements, reference assets, breakpoints, interaction flows, accessibility expectations, and missing preview evidence.",
          tools: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "skill", "todoread", "todowrite"],
        },
        requirements: {
          focus:
            "Extract source-backed UI requirements: information architecture, component states, responsive rules, accessibility, visual acceptance, and missing design evidence.",
          tools: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "websearch", "skill", "todoread", "todowrite"],
        },
        architect: {
          focus:
            "Turn frontend requirements into component boundaries, route/data contracts, preview-target ownership, and explicit visual acceptance handoffs.",
          tools: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "websearch", "skill", "todoread", "todowrite"],
        },
        "frontend-design": {
          focus:
            "Own visual evidence extraction, source audit, component/material inventory, skeleton generation, and the frontend handoff package for implementation.",
          tools: [
            "url_screenshot",
            "webpage_extract",
            "webpage_compile",
            "webpage_analyze",
            "webpage_runtime_state",
            "create_frontend_skeleton_project",
            "create_visual_region_coordinate_atlas",
            "create_visual_region_binding_package",
            "web_clone_source_audit",
            "webpage_render",
            "webpage_evaluate",
            "webpage_text_diff",
            "webpage_vision_judge",
          ],
        },
        "frontend-research": {
          focus:
            "Publish the one-shot source-backed webpage investigation brief that downstream frontend-design and build work must follow.",
          tools: ["skill"],
          guardrails: ["Do not implement UI or call build from this stage; stay in investigation and handoff mode."],
        },
        build: {
          focus:
            "When implementing frontend work, preserve structure and behavior, verify real runtime states, and fix the underlying UI defect instead of approximating the intended appearance.",
          tools: ["read", "glob", "search_code", "edit", "write", "apply_patch", "bash", "browser_preview", "memory"],
        },
        "visual-qa": {
          focus:
            "Audit rendered UI and interactions with real evidence, capture the mismatch precisely, and repair in-scope frontend defects before final sign-off.",
          tools: ["browser_preview", "webpage_render", "webpage_evaluate", "webpage_text_diff", "webpage_vision_judge", "bash", "edit", "write", "apply_patch"],
        },
        integrity: {
          focus:
            "Reject frontend delivery unless task-scoped preview evidence, interaction truth, and visual acceptance all match the requested surface.",
          tools: ["browser_preview"],
        },
        orchestrator: {
          focus:
            "Keep the same workflow, but bias planning and retries toward UI evidence, preview-target truth, and final visual acceptance rather than abstract implementation completion.",
          agents: ["requirements", "frontend_research", "frontend_design", "build", "visual_qa", "integrity"],
          tools: ["requirements", "frontend_research", "frontend_design", "build", "visual_qa", "integrity", "browser_preview", "read_context", "question"],
        },
      },
    },
    backend: {
      label: "Backend",
      description: "API, state, data, integration, and operational correctness focused expert squad.",
      agents: {
        coding: {
          focus:
            "Bias direct coding work toward API contracts, state ownership, persistence boundaries, observability, and deterministic failure handling.",
          tools: ["read", "glob", "search_code", "edit", "write", "bash", "webfetch", "memory"],
        },
        "coding-assistant": {
          focus:
            "In direct assistant sessions, keep backend changes contract-driven and integration-aware, with explicit handling of data flow and error surfaces.",
          tools: ["read", "glob", "search_code", "edit", "write", "bash", "webfetch", "panel", "memory"],
        },
        general: {
          focus:
            "For backend tasks, reason from contracts, data flow, concurrency, persistence, and operational evidence instead of UI polish or loose brainstorming.",
          tools: ["read", "glob", "search_code", "edit", "write", "bash", "websearch", "webfetch", "memory"],
        },
        explore: {
          focus:
            "When exploring for backend work, map routes, schemas, data ownership, error paths, and shared runtime invariants with source citations.",
          tools: ["read", "glob", "search_code", "external_code_search", "lsp", "websearch", "webfetch", "panel", "memory"],
        },
        mission: {
          focus:
            "Coordinate long-running backend work around contract boundaries, storage/state transitions, integration evidence, and operational failure modes.",
          agents: ["requirements", "architect", "deep_research", "build", "fact_check", "integrity"],
          tools: ["read", "glob", "search_code", "webfetch", "websearch", "mission_state", "panel", "memory", "wait", "question"],
        },
        "intent-analysis": {
          focus:
            "Disambiguate backend requests into APIs, state transitions, persistence, concurrency concerns, migration policy, integration points, and observability gaps.",
          tools: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "skill", "todoread", "todowrite"],
        },
        requirements: {
          focus:
            "Extract source-backed backend requirements around request/response contracts, storage semantics, lifecycle events, concurrency, and failure handling.",
          tools: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "websearch", "skill", "todoread", "todowrite"],
        },
        architect: {
          focus:
            "Turn backend requirements into route, schema, storage, ownership, and integration contracts with explicit verification ownership.",
          tools: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "websearch", "skill", "todoread", "todowrite"],
        },
        build: {
          focus:
            "Implement backend work with explicit contracts, deterministic state transitions, integration-safe edits, and command-backed verification of the real runtime path.",
          tools: ["read", "glob", "search_code", "edit", "write", "apply_patch", "bash", "webfetch", "memory"],
        },
        "deep-research": {
          focus:
            "Gather durable backend evidence for APIs, library behavior, external protocols, migration constraints, and operational assumptions before implementation commits to them.",
          tools: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "webfetch", "external_code_search", "todoread", "todowrite"],
        },
        "fact-check": {
          focus:
            "Verify backend factual claims such as API behavior, version details, schema assumptions, and operational numbers against source evidence.",
          tools: ["read_file", "find_files", "search_code", "list_directory", "websearch", "webfetch", "external_code_search", "memory_search", "memory_get", "todoread", "todowrite"],
        },
        integrity: {
          focus:
            "Reject backend delivery unless the claimed contracts, state transitions, and integration evidence are actually demonstrated by the changed code and tests.",
          tools: ["browser_preview"],
        },
        orchestrator: {
          focus:
            "Keep the same workflow, but route planning and retries toward contract boundaries, storage changes, integration evidence, and operational failure modes.",
          agents: ["requirements", "architect", "deep_research", "build", "fact_check", "integrity"],
          tools: ["requirements", "architect", "deep_research", "build", "fact_check", "integrity", "read_context", "analytics", "question"],
        },
      },
    },
    algorithm: {
      label: "Algorithm",
      description: "Correctness, complexity, benchmark, and adversarial-case focused expert squad.",
      agents: {
        coding: {
          focus:
            "Bias direct coding work toward precise problem formulation, invariants, complexity, numerical behavior, and benchmarkable correctness.",
          tools: ["read", "glob", "search_code", "edit", "write", "bash", "webfetch", "memory"],
        },
        "coding-assistant": {
          focus:
            "In direct assistant sessions, prefer reasoning that exposes invariants, edge cases, complexity tradeoffs, and reproducible verification steps.",
          tools: ["read", "glob", "search_code", "edit", "write", "bash", "webfetch", "panel", "memory"],
        },
        general: {
          focus:
            "For algorithm-heavy work, reason explicitly about invariants, asymptotic cost, pathological cases, reproducibility, and proof obligations.",
          tools: ["read", "glob", "search_code", "edit", "write", "bash", "websearch", "webfetch", "memory"],
        },
        explore: {
          focus:
            "When exploring for algorithm work, extract the exact current behavior, data shapes, hot paths, and benchmark hooks from source evidence.",
          tools: ["read", "glob", "search_code", "external_code_search", "lsp", "websearch", "webfetch", "panel", "memory"],
        },
        mission: {
          focus:
            "Coordinate long-running algorithm work around proof obligations, benchmark evidence, adversarial cases, and explicit correctness review.",
          agents: ["requirements", "architect", "goal_workload_analyst", "deep_research", "build", "fact_check", "integrity"],
          tools: ["read", "glob", "search_code", "webfetch", "websearch", "mission_state", "panel", "memory", "wait", "question"],
        },
        "intent-analysis": {
          focus:
            "Disambiguate algorithm requests into formal objectives, constraints, success metrics, input bounds, precision requirements, and missing benchmark expectations.",
          tools: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "skill", "todoread", "todowrite"],
        },
        requirements: {
          focus:
            "Extract algorithm requirements as explicit invariants, constraints, input ranges, correctness expectations, edge cases, and measurable performance targets.",
          tools: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "websearch", "skill", "todoread", "todowrite"],
        },
        architect: {
          focus:
            "Turn algorithm requirements into data, execution, and verification contracts that make complexity and correctness review explicit.",
          tools: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "websearch", "skill", "todoread", "todowrite"],
        },
        build: {
          focus:
            "Implement algorithm work with invariant-preserving edits, benchmarkable test scaffolds, and concrete evidence for complexity and correctness claims.",
          tools: ["read", "glob", "search_code", "edit", "write", "apply_patch", "bash", "webfetch", "memory"],
        },
        "deep-research": {
          focus:
            "Gather durable evidence for algorithm references, external formulas, protocol constraints, numeric pitfalls, and benchmark methodology before implementation commits to them.",
          tools: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "webfetch", "external_code_search", "todoread", "todowrite"],
        },
        "fact-check": {
          focus:
            "Verify algorithm factual claims such as formulas, complexity statements, benchmark assumptions, and numeric limits against source evidence.",
          tools: ["read_file", "find_files", "search_code", "list_directory", "websearch", "webfetch", "external_code_search", "memory_search", "memory_get", "todoread", "todowrite"],
        },
        "goal-workload-analyst": {
          focus:
            "Stress-test the goal graph for hidden algorithmic complexity, missing benchmark scope, and under-specified correctness obligations before execution begins.",
          tools: ["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "todoread", "todowrite"],
        },
        integrity: {
          focus:
            "Reject algorithm delivery unless correctness, edge cases, and benchmark evidence are explicitly demonstrated rather than implied.",
          tools: ["browser_preview"],
        },
        orchestrator: {
          focus:
            "Keep the same workflow, but route planning and retries toward formal constraints, benchmark evidence, adversarial coverage, and explicit correctness review.",
          agents: ["requirements", "architect", "workload_analysis", "deep_research", "build", "fact_check", "integrity"],
          tools: ["requirements", "architect", "workload_analysis", "deep_research", "build", "fact_check", "integrity", "read_context", "analytics", "question"],
        },
      },
    },
  }

  export const builtIns: Record<string, PromptProfileDefinition> = Object.fromEntries(
    Object.entries(builtInBlueprints).map(([profileID, blueprint]) => [profileID, materializeProfile(profileID, blueprint)]),
  )

  export function catalog(config: ConfigLike): Record<string, PromptProfileDefinition> {
    return {
      ...builtIns,
      ...(config.prompt_profile?.profiles ?? {}),
    }
  }

  export function activeID(config: ConfigLike): string {
    if (!config.prompt_profile?.active) {
      throw new Error("Config prompt_profile.active is not materialized.")
    }
    return config.prompt_profile.active
  }

  export function overlayFor(agentID: string, config: ConfigLike): string | undefined {
    const profiles = catalog(config)
    const active = activeID(config)
    const profile = profiles[active]
    if (!profile) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(active)}`)
    }
    const prompt = profile.agents[agentID]
    return typeof prompt === "string" && prompt.trim().length > 0 ? prompt : undefined
  }

  export function composeAgentPrompt(input: {
    agentID: string
    base: string
    userAppend?: string | null
    config: ConfigLike
  }): string {
    const profilePrompt = overlayFor(input.agentID, input.config)
    return [input.base, profilePrompt, input.userAppend]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join("\n\n")
  }

  export function list(config: ConfigLike) {
    const active = activeID(config)
    const profiles = Object.entries(catalog(config)).map(([id, profile]) => ({
      id,
      label: profile.label,
      description: profile.description,
      built_in: Object.hasOwn(builtIns, id),
    }))
    return { active, default: DEFAULT_PROMPT_PROFILE_ID, profiles }
  }

  export function assertKnownProfileID(profileID: string, config: ConfigLike): void {
    if (!Object.hasOwn(catalog(config), profileID)) {
      throw new Error(`Unknown prompt profile ${JSON.stringify(profileID)}`)
    }
  }

  export function validateConfig(
    config: ConfigLike,
    ctx: z.RefinementCtx,
    path: Array<string | number> = ["prompt_profile"],
  ) {
    const profileConfig = config.prompt_profile
    if (!profileConfig) return
    const configuredProfiles = profileConfig.profiles ?? {}
    for (const id of Object.keys(configuredProfiles)) {
      if (Object.hasOwn(builtIns, id)) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "profiles", id],
          message: `prompt_profile.profiles.${id} cannot override a built-in prompt profile.`,
        })
      }
    }
    const knownProfiles = catalog(config)
    if (!Object.hasOwn(knownProfiles, profileConfig.active)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, "active"],
        message: `Unknown prompt profile ${JSON.stringify(profileConfig.active)}.`,
      })
    }
    for (const [profileID, profile] of Object.entries(configuredProfiles)) {
      for (const target of Object.keys(profile.agents ?? {})) {
        if (!allTargetSet.has(target)) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "profiles", profileID, "agents", target],
            message: `Unknown prompt profile target ${JSON.stringify(target)}.`,
          })
          continue
        }
        if (!userTargetSet.has(target) || builtInOnlyTargetSet.has(target)) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "profiles", profileID, "agents", target],
            message: `prompt profile target ${target} is built-in-only and cannot be configured by project profiles.`,
          })
        }
      }
    }
  }

  export function assertKnownAgentTarget(agentID: AgentRoleID | string): void {
    if (!allTargetSet.has(agentID)) {
      throw new Error(`Unknown prompt profile target ${JSON.stringify(agentID)}`)
    }
  }
}
