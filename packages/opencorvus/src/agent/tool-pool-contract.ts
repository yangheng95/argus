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
    "browser_preview_bind_local_module",
    "browser_preview_compare_regions",
    "web_clone_prepare_context",
    "web_clone_generate_source_project",
    "web_clone_source_audit",
  ] as const

  const BUILD_PRIVATE_TOOL_IDS = [
    "browser_preview_bind_local_module",
    "browser_preview_compare_regions",
    "web_clone_source_audit",
  ] as const

  const STAGE_CONTEXT_GLOBAL_TOOL_IDS = ["read", "glob", "search_code", "list"] as const
  const STAGE_CONTEXT_PRIVATE_TOOL_IDS = ["memory_search", "memory_get"] as const

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
    "restart_from_stage",
    "fail_task",
    "cancel_task",
    "retry_task",
    "inject_operator_message",
    "steer_subagent",
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
      global: codingGlobal,
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
      global: [...STAGE_CONTEXT_GLOBAL_TOOL_IDS, "websearch", "skill", "todoread", "todowrite"],
      private: STAGE_CONTEXT_PRIVATE_TOOL_IDS,
    }),
    architect: pool({
      global: [...STAGE_CONTEXT_GLOBAL_TOOL_IDS, "websearch", "skill", "todoread", "todowrite"],
      private: STAGE_CONTEXT_PRIVATE_TOOL_IDS,
    }),
    "frontend-design": fromVisibleToolIDs(FRONTEND_DESIGN_STATIC_TOOL_IDS),
    "intent-analysis": pool({
      global: [...STAGE_CONTEXT_GLOBAL_TOOL_IDS, "skill", "todoread", "todowrite"],
      private: STAGE_CONTEXT_PRIVATE_TOOL_IDS,
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
      private: STAGE_CONTEXT_PRIVATE_TOOL_IDS,
    }),
    "deep-research": pool({
      global: [...STAGE_CONTEXT_GLOBAL_TOOL_IDS, "webfetch", "external_code_search", "todoread", "todowrite"],
      private: STAGE_CONTEXT_PRIVATE_TOOL_IDS,
    }),
    "frontend-research": pool({ global: ["skill"] }),
    "goal-workload-analyst": pool({
      global: [...STAGE_CONTEXT_GLOBAL_TOOL_IDS, "todoread", "todowrite"],
      private: STAGE_CONTEXT_PRIVATE_TOOL_IDS,
    }),
  }

  export function assignment(role: AgentRoleID): ToolPoolAssignment {
    return clone(roleAssignments[role])
  }

  export function customDefault(): ToolPoolAssignment {
    return pool({ global: GLOBAL_TOOL_IDS })
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

  export async function privateRegistryTools(
    agent: AgentRoleID | string,
    assignment?: Partial<ToolPoolAssignment>,
  ): Promise<Tool.Info[]> {
    const visible = visibleToolIDs(assignment ?? roleAssignments[agent as AgentRoleID])
    const tools: Tool.Info[] = []

    const add = (tool: Tool.Info) => {
      if (visible.has(tool.id)) tools.push(tool)
    }

    if (
      ["coding", "coding-assistant", "build", "general", "visual-qa", "integrity"].includes(agent) &&
      (visible.has("browser_preview_bind_local_module") || visible.has("browser_preview_compare_regions"))
    ) {
      const [{ BrowserPreviewBindLocalModuleTool }, { BrowserPreviewCompareRegionsTool }] = await Promise.all([
        import("@/tool/browser-preview-bind-local-module"),
        import("@/tool/browser-preview-compare-regions"),
      ])
      add(BrowserPreviewBindLocalModuleTool)
      add(BrowserPreviewCompareRegionsTool)
    }

    if (agent === "visual-qa" && visible.has("browser_preview_compare_scroll_slices")) {
      const { BrowserPreviewCompareScrollSlicesTool } = await import("@/tool/browser-preview-compare-scroll-slices")
      add(BrowserPreviewCompareScrollSlicesTool)
    }

    if (
      ["coding", "coding-assistant", "general"].includes(agent) &&
      (visible.has("web_clone_prepare_context") || visible.has("web_clone_generate_source_project"))
    ) {
      const [{ WebClonePrepareContextTool }, { WebCloneGenerateSourceProjectTool }] = await Promise.all([
        import("@/tool/web-clone-prepare-context"),
        import("@/tool/web-clone-generate-source-project"),
      ])
      add(WebClonePrepareContextTool)
      add(WebCloneGenerateSourceProjectTool)
    }

    if (["coding", "coding-assistant", "build", "general", "frontend-design"].includes(agent)) {
      const { WebCloneSourceAuditTool } = await import("@/tool/web-clone-source-audit")
      add(WebCloneSourceAuditTool)
    }

    if (
      agent === "frontend-design" &&
      (visible.has("webpage_extract") ||
        visible.has("webpage_compile") ||
        visible.has("webpage_analyze") ||
        visible.has("webpage_runtime_state"))
    ) {
      const [{ WebpageExtractTool }, { WebpageCompileTool }, { WebpageAnalyzeTool }, { WebpageRuntimeStateTool }] =
        await Promise.all([
          import("@/frontend-design/tools/webpage-extract"),
          import("@/frontend-design/tools/webpage-compile"),
          import("@/frontend-design/tools/webpage-analyze"),
          import("@/frontend-design/tools/webpage-runtime-state"),
        ])
      add(WebpageExtractTool)
      add(WebpageCompileTool)
      add(WebpageAnalyzeTool)
      add(WebpageRuntimeStateTool)
    }

    return tools
  }
}
