import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { BrowserPreviewBindLocalModuleTool } from "./browser-preview-bind-local-module"
import { BrowserPreviewCompareRegionsTool } from "./browser-preview-compare-regions"
import { BrowserPreviewTool } from "./browser-preview"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { SearchCodeTool } from "./grep"
import { createBatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoReadTool, TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { SkillTool } from "./skill"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Instance, lazyInstanceState } from "../project/instance"
import { Config } from "../config/config"
import path from "path"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencorvus-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { WebSearchTool } from "./websearch"
import { ExternalCodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncation"

import { AnalyticsTool } from "./analytics"
import { ApplyPatchTool } from "./apply_patch"
import { MemoryTool } from "./memory"
import { ScheduleTool } from "./schedule"
import { PlannerTool } from "./planner"
import { PanelTool } from "./panel"
import { MissionStateTool } from "./mission-state"
import { WaitTool } from "./wait"
import { TaskReportTool } from "./task-report"
import { GoalReportTool } from "./goal-report"
import { WebCloneGenerateSourceProjectTool } from "./web-clone-generate-source-project"
import { WebClonePrepareContextTool } from "./web-clone-prepare-context"
import { WebCloneSourceAuditTool } from "./web-clone-source-audit"
import {
  WebpageExtractTool,
  WebpageCompileTool,
  WebpageAnalyzeTool,
  WebpageRuntimeStateTool,
} from "@/frontend-design/tools"
import { isWebpageEvidenceAnalysisToolId, isWebpageEvidenceToolId } from "@/frontend-design/tools/ids"
import { Glob } from "../util/glob"
import { pathToFileURL } from "url"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  export const state = lazyInstanceState(async () => {
    const custom = [] as Tool.Info[]

    const matches = await Config.directories().then((dirs) =>
      dirs.flatMap((dir) =>
        Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
      ),
    )
    if (matches.length) await Config.waitForDependencies()
    for (const match of matches) {
      const namespace = path.basename(match, path.extname(match))
      try {
        const mod = await import(pathToFileURL(match).href)
        for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
          custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
        }
      } catch (err) {
        log.warn("failed to load custom tool", { path: match, error: err })
      }
    }

    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      for (const [id, def] of Object.entries(plugin.tool ?? {})) {
        custom.push(fromPlugin(id, def))
      }
    }

    return { custom }
  })

  function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
    return {
      id,
      init: async (initCtx) => ({
        parameters: z.object(def.args),
        description: def.description,
        execute: async (args, ctx) => {
          const pluginCtx = {
            ...ctx,
            directory: Instance.directory,
            worktree: Instance.worktree,
          } as unknown as PluginToolContext
          const result = await def.execute(args as any, pluginCtx)
          const out = await Truncate.output(result, { sessionID: ctx.sessionID }, initCtx?.agent)
          return {
            title: "",
            output: out.truncated ? out.content : result,
            metadata: { truncated: out.truncated, outputPath: out.truncated ? out.outputPath : undefined },
          }
        },
      }),
    }
  }

  export async function register(tool: Tool.Info) {
    const { custom } = await state()
    const idx = custom.findIndex((t) => t.id === tool.id)
    if (idx >= 0) {
      custom.splice(idx, 1, tool)
      return
    }
    custom.push(tool)
  }

  async function all(config?: Config.Info): Promise<Tool.Info[]> {
    const custom = await state().then((x) => x.custom)
    const cfg = config ?? (await Config.get())
    const question = ["app", "cli", "desktop"].includes(Flag.OPENCORVUS_CLIENT) || Flag.OPENCORVUS_ENABLE_QUESTION_TOOL

    return [
      ...(question ? [QuestionTool] : []),
      BashTool,
      BrowserPreviewTool,
      BrowserPreviewBindLocalModuleTool,
      BrowserPreviewCompareRegionsTool,
      ReadTool,
      GlobTool,
      SearchCodeTool,
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
      WebClonePrepareContextTool,
      WebCloneGenerateSourceProjectTool,
      WebCloneSourceAuditTool,
      AnalyticsTool,
      WebpageExtractTool,
      WebpageCompileTool,
      WebpageAnalyzeTool,
      WebpageRuntimeStateTool,
      ...(Flag.OPENCORVUS_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
      ...custom,
    ]
  }

  export async function ids() {
    return all().then((x) => x.map((t) => t.id))
  }

  export async function tools(
    model: {
      providerID: string
      modelID: string
    },
    agent?: Agent.Info,
    config?: Config.Info,
  ) {
    let items = await all(config)

    // Agent tool adapter: filter by agent's declared tool set.
    // frontend_design owns webpage evidence acquisition. Other agents consume
    // prepared task-runtime evidence and public frontend_design handoff files
    // instead of reopening URL/Figma/image extraction through registry tools.
    if (agent?.name === "visual-qa") {
      items = items.filter((t) => !isWebpageEvidenceAnalysisToolId(t.id))
    } else if (agent?.name !== "frontend-design") {
      items = items.filter((t) => !isWebpageEvidenceToolId(t.id))
    }

    if (agent?.tools?.include) {
      const set = new Set(agent.tools.include)
      items = items.filter((t) => set.has(t.id))
    } else if (agent?.tools?.exclude) {
      const set = new Set(agent.tools.exclude)
      items = items.filter((t) => !set.has(t.id))
    }

    const batchToolAllowed =
      config?.experimental?.batch_tool === true &&
      (agent?.tools?.include ? agent.tools.include.includes("batch") : !agent?.tools?.exclude?.includes("batch"))

    const result = await Promise.all(
      items
        .filter((t) => {
          // use apply tool in same format as codex
          const usePatch =
            model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
          if (t.id === "apply_patch") return usePatch
          if (t.id === "edit" || t.id === "write") return !usePatch

          return true
        })
        .map(async (t) => {
          using _ = log.time(t.id)
          const tool = await t.init({ agent, config })
          const output = {
            description: tool.description,
            parameters: tool.parameters,
          }
          await Plugin.trigger("tool.definition", { toolID: t.id }, output)
          return {
            id: t.id,
            ...tool,
            description: output.description,
            parameters: output.parameters,
          }
        }),
    )
    if (batchToolAllowed) {
      const batchInfo = createBatchTool(result)
      const tool = await batchInfo.init({ agent, config })
      const output = {
        description: tool.description,
        parameters: tool.parameters,
      }
      await Plugin.trigger("tool.definition", { toolID: batchInfo.id }, output)
      result.push({
        id: batchInfo.id,
        ...tool,
        description: output.description,
        parameters: output.parameters,
      })
    }
    return result
  }
}
