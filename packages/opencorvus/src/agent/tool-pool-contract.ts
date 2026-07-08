import { FRONTEND_DESIGN_STATIC_TOOL_IDS } from "@/frontend-design/static-tools"
import { INTEGRITY_DECLARED_TOOL_IDS } from "@/integrity/static-tools"
import { GLOBAL_TOOL_IDS, GLOBAL_TOOL_ID_SET } from "@/tool/global-tools"
import type { Tool } from "@/tool/tool"
import { VISUAL_QA_STATIC_TOOL_IDS } from "@/visual-qa/static-tools"
import type { AgentRoleID } from "./role-contract"

export interface ToolPoolAssignment {
  global: string[]
  private: string[]
  defaultRuntimeToolSwitches?: Record<string, boolean>
}

export namespace AgentToolPool {
  const CODING_PRIVATE_TOOL_IDS = [
    "web_clone_prepare_context",
    "web_clone_generate_source_project",
  ] as const

  const BUILD_PRIVATE_TOOL_IDS = [
    "browser_preview_reference_regions",
  ] as const

  const BUILD_DEFAULT_DISABLED_RUNTIME_TOOL_IDS = [
    "task",
    "webfetch",
    "websearch",
    "external_code_search",
    "memory",
    "planner",
    "goal_report",
  ] as const

  const STAGE_CONTEXT_GLOBAL_TOOL_IDS = [
    "read",
    "glob",
    "search_code",
    "list",
    "memory",
    "skill",
    "request_orchestrator_decision",
  ] as const

  const ORCHESTRATOR_PRIVATE_TOOL_IDS = [
    "dispatch_agent",
    "manage_task",
    "select_expert_squad",
    "refine",
    "explore",
    "add_goal",
    "modify_goal",
    "complete_goal",
    "delete_goal",
    "propose_task",
    "inject_operator_message",
    "respond_agent_coordination",
    "cancel_subagent",
    "query_failed_goals",
    "read_context",
  ] as const

  const ORCHESTRATOR_SCHEDULER_ROLE_BASE_TOOL_IDS = [
    "select_expert_squad",
    "skill",
    "question",
    "read_context",
    "query_failed_goals",
    "dispatch_agent",
    "manage_task",
    "wait",
    "inject_operator_message",
    "respond_agent_coordination",
    "cancel_subagent",
  ] as const

  function unique(input: readonly string[]): string[] {
    return [...new Set(input)]
  }

  function pool(input: {
    global?: readonly string[]
    private?: readonly string[]
    defaultRuntimeToolSwitches?: Readonly<Record<string, boolean>>
  }): ToolPoolAssignment {
    return {
      global: unique(input.global ?? []),
      private: unique(input.private ?? []),
      ...(input.defaultRuntimeToolSwitches
        ? { defaultRuntimeToolSwitches: { ...input.defaultRuntimeToolSwitches } }
        : {}),
    }
  }

  function fromVisibleToolIDs(input: readonly string[]): ToolPoolAssignment {
    const global: string[] = []
    const privateTools: string[] = []
    for (const id of input) {
      if (GLOBAL_TOOL_ID_SET.has(id)) global.push(id)
      else privateTools.push(id)
    }
    return pool({ global, private: privateTools })
  }

  const codingGlobal = [
    "question",
    "bash",
    "browser_preview",
    "read",
    "glob",
    "search_code",
    "edit",
    "write",
    "task",
    "webfetch",
    "todowrite",
    "todoread",
    "websearch",
    "external_code_search",
    "skill",
    "apply_patch",
    "memory",
    "schedule",
    "planner",
    "mission_state",
    "goal_report",
    "lsp",
    "batch",
  ] as const

  const taskCodingGlobal = [...codingGlobal, "request_orchestrator_decision"] as const

  const CUSTOM_AGENT_DENIED_GLOBAL_TOOL_IDS = new Set<string>([
    "panel",
    "request_orchestrator_decision",
    "wait",
  ])
  const customDefaultGlobal = GLOBAL_TOOL_IDS.filter((id) => !CUSTOM_AGENT_DENIED_GLOBAL_TOOL_IDS.has(id))

  export const roleAssignments: Record<AgentRoleID, ToolPoolAssignment> = {
    coding: pool({
      global: codingGlobal,
      private: CODING_PRIVATE_TOOL_IDS,
    }),
    "coding-assistant": pool({
      global: [...codingGlobal, "panel"],
      private: CODING_PRIVATE_TOOL_IDS,
    }),
    build: pool({
      global: taskCodingGlobal,
      private: BUILD_PRIVATE_TOOL_IDS,
      defaultRuntimeToolSwitches: {
        skill: true,
        ...Object.fromEntries(BUILD_DEFAULT_DISABLED_RUNTIME_TOOL_IDS.map((toolID) => [toolID, false])),
      },
    }),
    "visual-qa": fromVisibleToolIDs(VISUAL_QA_STATIC_TOOL_IDS),
    general: pool({
      global: [
        "question",
        "bash",
        "browser_preview",
        "read",
        "glob",
        "search_code",
        "edit",
        "write",
        "task",
        "webfetch",
        "websearch",
        "external_code_search",
        "skill",
        "apply_patch",
        "memory",
        "schedule",
        "mission_state",
        "goal_report",
        "lsp",
        "batch",
      ],
      private: CODING_PRIVATE_TOOL_IDS,
    }),
    explore: pool({
      global: [
        "read",
        "glob",
        "search_code",
        "external_code_search",
        "lsp",
        "webfetch",
        "websearch",
        "panel",
        "memory",
        "request_orchestrator_decision",
      ],
    }),
    compaction: pool({}),
    title: pool({}),
    summary: pool({}),
    control: pool({ global: ["panel"] }),
    orchestrator: pool({
      global: [
        "analytics",
        "browser_preview",
        "bash",
        "wait",
        "skill",
        "question",
        "todowrite",
        "todoread",
        "goal_report",
      ],
      private: ORCHESTRATOR_PRIVATE_TOOL_IDS,
    }),
    mission: pool({
      global: [
        "read",
        "glob",
        "search_code",
        "lsp",
        "webfetch",
        "websearch",
        "mission_state",
        "panel",
        "memory",
        "wait",
        "todoread",
        "todowrite",
        "question",
      ],
    }),
    requirements: pool({
      global: [...STAGE_CONTEXT_GLOBAL_TOOL_IDS, "websearch", "todoread", "todowrite"],
    }),
    architect: pool({
      global: [...STAGE_CONTEXT_GLOBAL_TOOL_IDS, "websearch", "todoread", "todowrite"],
    }),
    "frontend-design": fromVisibleToolIDs(FRONTEND_DESIGN_STATIC_TOOL_IDS),
    "intent-analysis": pool({
      global: [...STAGE_CONTEXT_GLOBAL_TOOL_IDS, "todoread", "todowrite"],
    }),
    integrity: fromVisibleToolIDs(INTEGRITY_DECLARED_TOOL_IDS),
    "fact-check": pool({
      global: [
        ...STAGE_CONTEXT_GLOBAL_TOOL_IDS,
        "websearch",
        "webfetch",
        "external_code_search",
        "todoread",
        "todowrite",
      ],
    }),
    "deep-research": pool({
      global: [...STAGE_CONTEXT_GLOBAL_TOOL_IDS, "webfetch", "external_code_search", "todoread", "todowrite"],
    }),
    "frontend-research": pool({ global: ["skill", "request_orchestrator_decision"] }),
    "goal-workload-analyst": pool({
      global: [...STAGE_CONTEXT_GLOBAL_TOOL_IDS, "todoread", "todowrite"],
    }),
  }

  export function assignment(role: AgentRoleID): ToolPoolAssignment {
    return clone(roleAssignments[role])
  }

  export function customDefault(): ToolPoolAssignment {
    return pool({ global: customDefaultGlobal })
  }

  export function customAssignment(input: Partial<ToolPoolAssignment> | undefined): ToolPoolAssignment {
    const normalized = normalize(input)
    for (const toolID of normalized.global) {
      if (CUSTOM_AGENT_DENIED_GLOBAL_TOOL_IDS.has(toolID)) {
        throw new Error(`Custom agents cannot use scoped orchestration tool "${toolID}".`)
      }
    }
    return normalized
  }

  export function orchestratorSchedulerRoleBaseToolIDs(): string[] {
    return unique(ORCHESTRATOR_SCHEDULER_ROLE_BASE_TOOL_IDS)
  }

  export function normalize(input: Partial<ToolPoolAssignment> | undefined): ToolPoolAssignment {
    return pool({
      global: input?.global ?? [],
      private: input?.private ?? [],
    })
  }

  export function clone(input: ToolPoolAssignment): ToolPoolAssignment {
    return pool(input)
  }

  export function defaultRuntimeToolSwitches(role: AgentRoleID): Record<string, boolean> {
    return { ...(roleAssignments[role].defaultRuntimeToolSwitches ?? {}) }
  }

  export function visibleToolIDs(input: Partial<ToolPoolAssignment> | undefined): Set<string> {
    const normalized = normalize(input)
    return new Set([...normalized.global, ...normalized.private])
  }

  export function hasTool(input: Partial<ToolPoolAssignment> | undefined, toolID: string): boolean {
    return visibleToolIDs(input).has(toolID)
  }

  export function canonicalToolIDs(): Set<string> {
    const ids = new Set<string>(GLOBAL_TOOL_IDS)
    for (const assignment of Object.values(roleAssignments)) {
      for (const toolID of [...assignment.global, ...assignment.private]) ids.add(toolID)
    }
    return ids
  }

  type PrivateRegistryToolLoader = () => Promise<Tool.Info>

  const privateRegistryToolLoaders: Record<string, PrivateRegistryToolLoader> = {
    browser_preview_reference_regions: async () =>
      (await import("@/tool/browser-preview-reference-regions")).BrowserPreviewReferenceRegionsTool,
    browser_preview_compare_scroll_slices: async () =>
      (await import("@/tool/browser-preview-compare-scroll-slices")).BrowserPreviewCompareScrollSlicesTool,
    browser_preview_layout_geometry: async () =>
      (await import("@/tool/browser-preview-layout-geometry")).BrowserPreviewLayoutGeometryTool,
    web_clone_prepare_context: async () =>
      (await import("@/tool/web-clone-prepare-context")).WebClonePrepareContextTool,
    web_clone_generate_source_project: async () =>
      (await import("@/tool/web-clone-generate-source-project")).WebCloneGenerateSourceProjectTool,
    webpage_extract: async () => (await import("@/frontend-design/tools/webpage-extract")).WebpageExtractTool,
    webpage_compile: async () => (await import("@/frontend-design/tools/webpage-compile")).WebpageCompileTool,
    webpage_analyze: async () => (await import("@/frontend-design/tools/webpage-analyze")).WebpageAnalyzeTool,
    webpage_runtime_state: async () =>
      (await import("@/frontend-design/tools/webpage-runtime-state")).WebpageRuntimeStateTool,
  }

  export async function privateRegistryTools(
    agent: AgentRoleID | string,
    assignment?: Partial<ToolPoolAssignment>,
  ): Promise<Tool.Info[]> {
    const visible = visibleToolIDs(assignment ?? roleAssignments[agent as AgentRoleID])
    const tools = await Promise.all(
      [...visible].map(async (toolID) => {
        const load = privateRegistryToolLoaders[toolID]
        return load ? load() : undefined
      }),
    )
    return tools.filter((tool): tool is Tool.Info => Boolean(tool))
  }
}
