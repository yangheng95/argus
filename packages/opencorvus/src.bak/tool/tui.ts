import z from "zod"
import { Tool } from "./tool"
import { TuiRuntime } from "@/tui/runtime"
import { SessionStatus } from "@/session/status"
import { TuiCommand } from "@/tui/command"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Bus } from "@/bus"
import { Session } from "@/session"

const DESCRIPTION = `Control TUI lifecycle and interactions through a single tool.

Use this tool when you need reliable, explicit TUI automation instead of implicit UI assumptions.

Actions:
- status: Read runtime state, active session statuses, and command aliases.
- start: Spawn or connect a managed TUI runtime.
- stop: Stop managed TUI runtime.
- append_prompt: Add text to prompt input.
- submit_prompt: Submit prompt input.
- clear_prompt: Clear prompt input.
- open_help: Open help dialog.
- open_sessions: Open sessions dialog.
- open_themes: Open themes dialog.
- open_models: Open model dialog.
- execute_command: Execute a TUI command or alias.
- select_session: Navigate TUI to a session.
- show_toast: Show a toast in TUI.
- submit_task: Submit a task to a session and optionally wait for completion.
- proxy: Advanced passthrough to /tui/* on managed runtime.

Recommended workflow:
1) Call status.
2) If runtime is not running and you need a managed runtime, call start.
3) Use append_prompt/submit_prompt or submit_task.
4) Poll status to track session progress.`

const Params = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("status"),
  }),
  z.object({
    action: z.literal("start"),
    mode: z.enum(["spawn", "connect"]).default("spawn"),
    url: z.string().optional(),
    directory: z.string().optional(),
    sessionID: z.string().optional(),
    model: z.string().optional(),
    agent: z.string().optional(),
    prompt: z.string().optional(),
    continue: z.boolean().optional(),
    fork: z.boolean().optional(),
    port: z.number().int().optional(),
    hostname: z.string().optional(),
    bin: z.string().optional(),
  }),
  z.object({
    action: z.literal("stop"),
  }),
  z.object({
    action: z.literal("append_prompt"),
    text: z.string().min(1),
  }),
  z.object({
    action: z.literal("submit_prompt"),
  }),
  z.object({
    action: z.literal("clear_prompt"),
  }),
  z.object({
    action: z.literal("open_help"),
  }),
  z.object({
    action: z.literal("open_sessions"),
  }),
  z.object({
    action: z.literal("open_themes"),
  }),
  z.object({
    action: z.literal("open_models"),
  }),
  z.object({
    action: z.literal("execute_command"),
    command: z.string().min(1),
  }),
  z.object({
    action: z.literal("select_session"),
    sessionID: z.string(),
  }),
  z.object({
    action: z.literal("show_toast"),
    message: z.string().min(1),
    title: z.string().optional(),
    variant: z.enum(["info", "success", "warning", "error"]).default("info"),
    duration: z.number().int().positive().optional(),
  }),
  z.object({
    action: z.literal("submit_task"),
    text: z.string().min(1),
    sessionID: z.string().optional(),
    agent: z.string().optional(),
    wait: z.boolean().default(true).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(30 * 60 * 1000)
      .default(5 * 60 * 1000)
      .optional(),
  }),
  z.object({
    action: z.literal("proxy"),
    path: z.string().startsWith("/tui/"),
    body: z.any().optional(),
  }),
])

export const TuiTool = Tool.define("tui", {
  description: DESCRIPTION,
  parameters: Params,
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: Record<string, any> }> {
    await ctx.ask({
      permission: "tui",
      patterns: [params.action],
      always: ["*"],
      metadata: { action: params.action },
    })

    const send = async (path: string, body: unknown, fn: () => Promise<void>) => {
      const state = TuiRuntime.status()
      if (!state.running) {
        await fn()
        return true
      }
      await TuiRuntime.proxy({ path, body })
      return true
    }

    switch (params.action) {
      case "status": {
        const output = {
          runtime: TuiRuntime.status(),
          sessions: SessionStatus.list(),
          commands: { aliases: TuiCommand.aliases },
        }
        return {
          title: "TUI status",
          output: JSON.stringify(output),
          metadata: output,
        }
      }

      case "start": {
        const output = await TuiRuntime.start({
          mode: params.mode,
          url: params.url,
          directory: params.directory,
          sessionID: params.sessionID,
          model: params.model,
          agent: params.agent,
          prompt: params.prompt,
          continue: params.continue,
          fork: params.fork,
          port: params.port,
          hostname: params.hostname,
          bin: params.bin,
        })
        return {
          title: "TUI runtime started",
          output: JSON.stringify(output),
          metadata: output,
        }
      }

      case "stop": {
        await TuiRuntime.stop()
        return {
          title: "TUI runtime stopped",
          output: JSON.stringify({ stopped: true }),
          metadata: { stopped: true },
        }
      }

      case "append_prompt": {
        await send("/tui/append-prompt", { text: params.text }, async () => {
          await Bus.publish(TuiEvent.PromptAppend, { text: params.text })
        })
        return {
          title: "Prompt appended",
          output: JSON.stringify({ ok: true }),
          metadata: { ok: true },
        }
      }

      case "submit_prompt": {
        await send("/tui/submit-prompt", {}, async () => {
          await Bus.publish(TuiEvent.CommandExecute, { command: TuiCommand.action.submit })
        })
        return {
          title: "Prompt submitted",
          output: JSON.stringify({ ok: true }),
          metadata: { ok: true },
        }
      }

      case "clear_prompt": {
        await send("/tui/clear-prompt", {}, async () => {
          await Bus.publish(TuiEvent.CommandExecute, { command: TuiCommand.action.clear })
        })
        return {
          title: "Prompt cleared",
          output: JSON.stringify({ ok: true }),
          metadata: { ok: true },
        }
      }

      case "open_help": {
        await send("/tui/open-help", {}, async () => {
          await Bus.publish(TuiEvent.CommandExecute, { command: TuiCommand.action.help })
        })
        return {
          title: "Help opened",
          output: JSON.stringify({ ok: true }),
          metadata: { ok: true },
        }
      }

      case "open_sessions": {
        await send("/tui/open-sessions", {}, async () => {
          await Bus.publish(TuiEvent.CommandExecute, { command: TuiCommand.action.sessions })
        })
        return {
          title: "Sessions opened",
          output: JSON.stringify({ ok: true }),
          metadata: { ok: true },
        }
      }

      case "open_themes": {
        await send("/tui/open-themes", {}, async () => {
          await Bus.publish(TuiEvent.CommandExecute, { command: TuiCommand.action.themes })
        })
        return {
          title: "Themes opened",
          output: JSON.stringify({ ok: true }),
          metadata: { ok: true },
        }
      }

      case "open_models": {
        await send("/tui/open-models", {}, async () => {
          await Bus.publish(TuiEvent.CommandExecute, { command: TuiCommand.action.models })
        })
        return {
          title: "Models opened",
          output: JSON.stringify({ ok: true }),
          metadata: { ok: true },
        }
      }

      case "execute_command": {
        const command = TuiCommand.normalize(params.command)
        await send("/tui/execute-command", { command: params.command }, async () => {
          await Bus.publish(TuiEvent.CommandExecute, { command })
        })
        return {
          title: "Command executed",
          output: JSON.stringify({ command }),
          metadata: { command },
        }
      }

      case "select_session": {
        await Session.get(params.sessionID)
        await send("/tui/select-session", { sessionID: params.sessionID }, async () => {
          await Bus.publish(TuiEvent.SessionSelect, { sessionID: params.sessionID })
        })
        return {
          title: "Session selected",
          output: JSON.stringify({ sessionID: params.sessionID }),
          metadata: { sessionID: params.sessionID },
        }
      }

      case "show_toast": {
        await send(
          "/tui/show-toast",
          {
            title: params.title,
            message: params.message,
            variant: params.variant,
            duration: params.duration,
          },
          async () => {
            await Bus.publish(TuiEvent.ToastShow, {
              title: params.title,
              message: params.message,
              variant: params.variant,
              duration: params.duration,
            })
          },
        )
        return {
          title: "Toast shown",
          output: JSON.stringify({ ok: true }),
          metadata: { ok: true },
        }
      }

      case "submit_task": {
        const output = await TuiRuntime.submitTask({
          text: params.text,
          sessionID: params.sessionID,
          agent: params.agent,
          wait: params.wait,
          timeoutMs: params.timeoutMs,
        })
        return {
          title: "Task submitted",
          output: JSON.stringify(output),
          metadata: output,
        }
      }

      case "proxy": {
        const output = await TuiRuntime.proxy({
          path: params.path,
          body: params.body,
        })
        return {
          title: "Proxy executed",
          output: JSON.stringify(output),
          metadata: { ok: true },
        }
      }
    }
  },
})
