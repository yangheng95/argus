import { FRONTEND_DESIGN_STATIC_TOOL_IDS } from "@/frontend-design/static-tools"
import { INTEGRITY_DECLARED_TOOL_IDS } from "@/integrity/static-tools"
import { GLOBAL_TOOL_IDS, GLOBAL_TOOL_ID_SET } from "@/tool/global-tools"
import type { Tool } from "@/tool/tool"
import { VISUAL_QA_STATIC_TOOL_IDS } from "@/visual-qa/static-tools"
import type { AgentRoleID } from "./role-contract"

export interface ToolPoolAssignment {
  global: string[]
  private: string[]
}

export namespace AgentToolPool {
  const CODING_PRIVATE_TOOL_IDS = [
    "web_clone_prepare_context",
    "web_clone_generate_source_project",
  ] as const

  const BUILD_PRIVATE_TOOL_IDS = [
    "browser_preview_compare_scroll_slices",
    "browser_preview_layout_geometry",
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
    "build",
    "select_expert_squad",
    "requirements",
    "deep_research",
    "frontend_research",
    "frontend_design",
    "visual_qa",
    "architect",
    "workload_analysis",
    "integrity",
    "fact_check",
    "propose_task",
    "analyze_intent",
    "explore",
    "add_goal",
    "modify_goal",
    "refine",
    "complete_task",
    "fail_task",
    "cancel_task",
    "retry_task",
    "inject_operator_message",
    "respond_agent_coordination",
    "cancel_subagent",
    "query_failed_goals",
    "read_context",
  ] as const

  function unique(input: readonly string[]): string[] {
    return [...new Set(input)]
  }

  function pool(input: { global?: readonly string[]; private?: readonly string[] }): ToolPoolAssignment {
    return {
      global: unique(input.global ?? []),
      private: unique(input.private ?? []),
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
    "wait",
    "goal_report",
    "lsp",
    "batch",
  ] as const

  const taskCodingGlobal = [...codingGlobal, "request_orchestrator_decision"] as const

  const customDefaultGlobal = GLOBAL_TOOL_IDS.filter((id) => id !== "request_orchestrator_decision")

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
        "wait",
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

  export function normalize(input: Partial<ToolPoolAssignment> | undefined): ToolPoolAssignment {
    return pool({
      global: input?.global ?? [],
      private: input?.private ?? [],
    })
  }

  export function clone(input: ToolPoolAssignment): ToolPoolAssignment {
    return pool(input)
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
