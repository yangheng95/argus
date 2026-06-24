import type { Tool } from "./tool"
import { Flag } from "@/flag/flag"

export const BATCH_TOOL_ID = "batch" as const

export const GLOBAL_TOOL_IDS = [
  "question",
  "bash",
  "browser_preview",
  "read",
  "glob",
  "search_code",
  "list",
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
  "panel",
  "mission_state",
  "wait",
  "task_report",
  "goal_report",
  "analytics",
  "lsp",
  BATCH_TOOL_ID,
] as const

export const GLOBAL_TOOL_ID_SET = new Set<string>(GLOBAL_TOOL_IDS)

export const LEGACY_DUPLICATE_TOOL_ID_REPLACEMENTS = {
  read_file: "read",
  find_files: "glob",
  list_directory: "list",
} as const

export const LEGACY_DUPLICATE_TOOL_ID_SET = new Set<string>(Object.keys(LEGACY_DUPLICATE_TOOL_ID_REPLACEMENTS))

export function legacyDuplicateToolMessage(toolID: string): string {
  const replacement =
    LEGACY_DUPLICATE_TOOL_ID_REPLACEMENTS[toolID as keyof typeof LEGACY_DUPLICATE_TOOL_ID_REPLACEMENTS]
  return replacement
    ? `${toolID} is a legacy duplicate tool ID; use canonical tool ID ${replacement}`
    : `${toolID} is not a legacy duplicate tool ID`
}

export async function builtInGlobalTools(): Promise<Tool.Info[]> {
  const [
    { QuestionTool },
    { BashTool },
    { BrowserPreviewTool },
    { ReadTool },
    { GlobTool },
    { SearchCodeTool },
    { ListTool },
    { EditTool },
    { WriteTool },
    { TaskTool },
    { WebFetchTool },
    { TodoWriteTool, TodoReadTool },
    { WebSearchTool },
    { ExternalCodeSearchTool },
    { SkillTool },
    { ApplyPatchTool },
    { MemoryTool },
    { ScheduleTool },
    { PlannerTool },
    { PanelTool },
    { MissionStateTool },
    { WaitTool },
    { TaskReportTool },
    { GoalReportTool },
    { AnalyticsTool },
    { LspTool },
  ] = await Promise.all([
    import("./question"),
    import("./bash"),
    import("./browser-preview"),
    import("./read"),
    import("./glob"),
    import("./grep"),
    import("./ls"),
    import("./edit"),
    import("./write"),
    import("./task"),
    import("./webfetch"),
    import("./todo"),
    import("./websearch"),
    import("./codesearch"),
    import("./skill"),
    import("./apply_patch"),
    import("./memory"),
    import("./schedule"),
    import("./planner"),
    import("./panel"),
    import("./mission-state"),
    import("./wait"),
    import("./task-report"),
    import("./goal-report"),
    import("./analytics"),
    import("./lsp"),
  ])

  const question = ["app", "cli", "desktop"].includes(Flag.OPENCORVUS_CLIENT) || Flag.OPENCORVUS_ENABLE_QUESTION_TOOL

  return [
    ...(question ? [QuestionTool] : []),
    BashTool,
    BrowserPreviewTool,
    ReadTool,
    GlobTool,
    SearchCodeTool,
    ListTool,
    EditTool,
    WriteTool,
    TaskTool,
    WebFetchTool,
    TodoWriteTool,
    TodoReadTool,
    WebSearchTool,
    ExternalCodeSearchTool,
    SkillTool,
    ApplyPatchTool,
    MemoryTool,
    ScheduleTool,
    PlannerTool,
    PanelTool,
    MissionStateTool,
    WaitTool,
    TaskReportTool,
    GoalReportTool,
    AnalyticsTool,
    ...(Flag.OPENCORVUS_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
  ]
}
