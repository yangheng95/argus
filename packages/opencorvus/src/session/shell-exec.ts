import path from "path"
import z from "zod"
import { Identifier } from "../id/id"
import { Message } from "./message"
import { Session } from "."
import { Instance } from "../project/instance"
import { Plugin } from "../plugin"
import { defer } from "../util/defer"
import { ulid } from "ulid"
import { Shell } from "@/shell/shell"
import { PidGuard } from "@/shell/pid-guard"
import { ProcessSupervisor } from "@/shell/process-supervisor"
import { SessionPromptState } from "./prompt/state"
import { gitCeilingEnvForWorktree } from "@/worktree/git-ceiling"
import { SessionContext } from "./context"
import { createBrowserPreviewProcessOutputMaterializer } from "@/browser-preview/extract"
import { taskIDForSession } from "@/orchestrator/task-event"

export namespace SessionShell {
  const { log, state, start, cancel } = SessionPromptState

  export const ShellInput = z.object({
    sessionID: Identifier.schema("session"),
    agent: z.string(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    command: z.string(),
  })
  export type ShellInput = z.infer<typeof ShellInput>
  export async function shell(input: ShellInput) {
    const abort = start(input.sessionID)
    if (!abort) {
      throw new Session.BusyError(input.sessionID)
    }

    await using _ = defer(async () => {
      const callbacks = state()[input.sessionID]?.callbacks ?? []
      if (callbacks.length === 0) {
        cancel(input.sessionID)
      } else {
        const { SessionLoop } = await import("./loop")
        const session = await Session.get(input.sessionID)
        SessionContext.provide(session, () =>
          SessionLoop.loop({ sessionID: input.sessionID, resume_existing: true }),
        ).catch((error: any) => {
          log.error("session loop failed to resume after shell command", { sessionID: input.sessionID, error })
        })
      }
    })

    // Single model resolver (spec §13.1): explicit > session overlay > base.
    const { resolveAgentModelRef } = await import("../agent/model")
    const session = await Session.get(input.sessionID)
    const model = await SessionContext.provide(session, () =>
      resolveAgentModelRef(input.agent, {
        explicitModel: input.model,
        sessionID: input.sessionID,
      }),
    )
    const userMsg: Message.User = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      time: {
        created: Date.now(),
      },
      role: "user",
      agent: input.agent,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
      },
    }
    await Session.updateMessage(userMsg)
    const userPart: Message.Part = {
      type: "text",
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: input.sessionID,
      text: "The following tool was executed by the user",
    }
    await Session.updatePart(userPart)

    const msg: Message.Assistant = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      parentID: userMsg.id,
      agent: input.agent,
      cost: 0,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      time: {
        created: Date.now(),
      },
      role: "assistant",
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.modelID,
      providerID: model.providerID,
    }
    await Session.updateMessage(msg)
    const part: Message.Part = {
      type: "tool",
      id: Identifier.ascending("part"),
      messageID: msg.id,
      sessionID: input.sessionID,
      tool: "bash",
      callID: ulid(),
      state: {
        status: "running",
        time: {
          start: Date.now(),
        },
        input: {
          command: input.command,
        },
      },
    }
    await Session.updatePart(part)
    const shellBin = Shell.preferred()
    const shellName = (
      process.platform === "win32" ? path.win32.basename(shellBin, ".exe") : path.basename(shellBin)
    ).toLowerCase()

    const invocationCommand: Record<string, string> = {
      nu: input.command,
      fish: input.command,
      zsh: `
            [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
            [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
      bash: `
            shopt -s expand_aliases
            [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
      cmd: input.command,
      powershell: input.command,
      pwsh: input.command,
      "": input.command,
    }

    const supervisedCommand = invocationCommand[shellName] ?? invocationCommand[""]

    const cwd = Instance.directory
    const shellEnv = await Plugin.trigger(
      "shell.env",
      { cwd, sessionID: input.sessionID, callID: part.callID },
      { env: {} },
    )
    const guardEnv = await PidGuard.env(shellBin)
    const supervisor = await ProcessSupervisor.spawnShell({
      command: supervisedCommand,
      shell: shellBin,
      cwd,
      env: {
        ...process.env,
        ...shellEnv.env,
        TERM: "dumb",
        ...gitCeilingEnvForWorktree(cwd, { ...process.env, ...shellEnv.env }),
        ...guardEnv,
      },
    })

    let output = ""
    const previewTargetMaterializer = createBrowserPreviewProcessOutputMaterializer({
      taskID: taskIDForSession(input.sessionID),
      command: input.command,
    })

    supervisor.stdout?.on("data", (chunk) => {
      const text = chunk.toString()
      output += text
      void previewTargetMaterializer.ingest(text)
      if (part.state.status === "running") {
        part.state.metadata = {
          output: output,
          description: "",
        }
        Session.updatePart(part)
      }
    })

    supervisor.stderr?.on("data", (chunk) => {
      const text = chunk.toString()
      output += text
      void previewTargetMaterializer.ingest(text)
      if (part.state.status === "running") {
        part.state.metadata = {
          output: output,
          description: "",
        }
        Session.updatePart(part)
      }
    })

    let aborted = false

    const terminate = () => supervisor.terminate()

    if (abort.aborted) {
      aborted = true
      await terminate()
    }

    const abortHandler = () => {
      aborted = true
      void terminate()
    }

    abort.addEventListener("abort", abortHandler, { once: true })

    try {
      await supervisor.exited
    } finally {
      abort.removeEventListener("abort", abortHandler)
      await previewTargetMaterializer.flush()
      await supervisor.dispose()
    }

    if (aborted) {
      output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
    }
    msg.time.completed = Date.now()
    await Session.updateMessage(msg)
    if (part.state.status === "running") {
      part.state = {
        status: "completed",
        time: {
          ...part.state.time,
          end: Date.now(),
        },
        input: part.state.input,
        title: "",
        metadata: {
          output,
          description: "",
        },
        output,
      }
      await Session.updatePart(part)
    }
    return { info: msg, parts: [part] }
  }
}
