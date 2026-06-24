import { createBatchTool } from "./batch"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Instance, lazyInstanceState } from "../project/instance"
import { Config } from "../config/config"
import path from "path"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencorvus-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { Log } from "@/util/log"
import { Truncate } from "./truncation"
import { Glob } from "../util/glob"
import { pathToFileURL } from "url"
import { AgentToolPool } from "@/agent/tool-pool-contract"
import { BATCH_TOOL_ID, builtInGlobalTools } from "./global-tools"

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

  async function all(): Promise<Tool.Info[]> {
    const custom = await state().then((x) => x.custom)
    return [...(await builtInGlobalTools()), ...custom]
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
    let items = await all()
    if (agent) items = [...items, ...(await AgentToolPool.privateRegistryTools(agent.name, agent.tools))]

    const visibleToolIDs = agent ? AgentToolPool.visibleToolIDs(agent.tools) : undefined
    if (visibleToolIDs) items = items.filter((t) => visibleToolIDs.has(t.id))

    const batchToolAllowed =
      config?.experimental?.batch_tool === true && (!agent || AgentToolPool.hasTool(agent.tools, BATCH_TOOL_ID))

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
