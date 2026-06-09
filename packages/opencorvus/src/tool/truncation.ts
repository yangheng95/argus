import fs from "fs/promises"
import path from "path"
import { Identifier } from "../id/id"
import { PermissionNext } from "../permission/next"
import type { Agent } from "../agent/agent"
import { Scheduler } from "../scheduler"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { taskIDForSession } from "@/orchestrator/task-event"

export namespace Truncate {
  export const MAX_LINES = 2000
  export const MAX_BYTES = 50 * 1024
  const RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
  const HOUR_MS = 60 * 60 * 1000

  export type Result = { content: string; truncated: false } | { content: string; truncated: true; outputPath: string }

  export interface Options {
    maxLines?: number
    maxBytes?: number
    direction?: "head" | "tail"
    sessionID?: string
    taskID?: string
  }

  export function init() {
    Scheduler.register({
      id: "tool.truncation.cleanup",
      interval: HOUR_MS,
      run: cleanup,
      scope: "global",
    })
  }

  export async function cleanup() {
    const cutoff = Identifier.timestamp(Identifier.create("tool", false, Date.now() - RETENTION_MS))
    const root = ProjectRuntimePaths.projectRuntimeRoot(Instance.directory)
    const entries = await Glob.scan("tasks/*/sessions/*/tool-output/tool_*", { cwd: root, include: "file" }).catch(
      () => [] as string[],
    )
    for (const entry of entries) {
      if (Identifier.timestamp(path.basename(entry)) >= cutoff) continue
      await fs.unlink(path.join(root, entry)).catch(() => {})
    }
  }

  function hasTool(agent: Agent.Info | undefined, tool: string): boolean {
    if (!agent?.permission) return false
    const rule = PermissionNext.evaluate(tool, "*", agent.permission)
    return rule.action !== "deny"
  }

  function hasRecoveryPath(agent?: Agent.Info): { ok: true; via: "task" | "read+search_code" } | { ok: false } {
    if (!agent) return { ok: false }
    if (hasTool(agent, "task")) return { ok: true, via: "task" }
    if (hasTool(agent, "read") && hasTool(agent, "search_code")) return { ok: true, via: "read+search_code" }
    return { ok: false }
  }

  /**
   * Tool output too large for the prompt is shipped to disk and replaced with
   * a preview + recovery hint. The recovery hint is an active contract: the
   * receiving agent MUST be able to read the saved file (via task delegation
   * or read+search_code). When the agent has neither path we throw rather than
   * silently truncate — silent truncation here is a CLAUDE.md rule #1
   * violation (information loss with no recovery).
   *
   * `direction` defaults to "tail" because the most useful piece of a long
   * tool output (build log, test failure, error trace) is almost always at
   * the END. Callers that genuinely want the head can override.
   */
  export async function output(text: string, options: Options = {}, agent?: Agent.Info): Promise<Result> {
    const maxLines = options.maxLines ?? MAX_LINES
    const maxBytes = options.maxBytes ?? MAX_BYTES
    const direction = options.direction ?? "tail"
    const lines = text.split("\n")
    const totalBytes = Buffer.byteLength(text, "utf-8")

    if (lines.length <= maxLines && totalBytes <= maxBytes) {
      return { content: text, truncated: false }
    }

    const recovery = hasRecoveryPath(agent)
    if (!recovery.ok) {
      // No recovery path → truncating would lose information silently.
      // Surface the failure so the caller can react (split the request,
      // route through an agent that owns read/search_code, or fail the task).
      throw new Error(
        `Truncate.output: tool result is ${totalBytes} bytes / ${lines.length} lines ` +
          `(limit ${maxBytes}/${maxLines}) and the calling agent ` +
          `${agent?.name ?? "(unknown)"} has neither the 'task' nor 'read'+'search_code' tools to ` +
          `re-read a saved copy. Truncating here would silently lose data — denying the call instead.`,
      )
    }

    const out: string[] = []
    let i = 0
    let bytes = 0
    let hitBytes = false

    if (direction === "head") {
      for (i = 0; i < lines.length && i < maxLines; i++) {
        const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
        if (bytes + size > maxBytes) {
          hitBytes = true
          break
        }
        out.push(lines[i])
        bytes += size
      }
    } else {
      for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
        const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
        if (bytes + size > maxBytes) {
          hitBytes = true
          break
        }
        out.unshift(lines[i])
        bytes += size
      }
    }

    const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
    const unit = hitBytes ? "bytes" : "lines"
    const preview = out.join("\n")

    const id = Identifier.ascending("tool")
    const sessionID = options.sessionID
    const taskID = options.taskID ?? (sessionID ? taskIDForSession(sessionID) : undefined)
    if (!sessionID || !taskID) {
      throw new Error("Truncate.output: sessionID and taskID are required for runtime-scoped tool output")
    }
    const filepath = path.join(ProjectRuntimePaths.toolOutputDir(Instance.directory, taskID, sessionID), id)
    await Filesystem.write(filepath, text)

    const hint =
      recovery.via === "task"
        ? `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}\nUse the Task tool to have explore agent process this file with search_code and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context.`
        : `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}\nUse search_code to search the full content or Read with offset/limit to view specific sections.`
    const message =
      direction === "head"
        ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
        : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`

    return { content: message, truncated: true, outputPath: filepath }
  }
}
