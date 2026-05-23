import { codingRuntimeEnv, record, text, type CodingEventInfo, type CodingProvider } from "./contract"
import { jsonLines } from "./external-process"
import { normalizeExecutableArgv } from "@/util/command"
import { gitCeilingEnvForWorktree } from "@/worktree/git-ceiling"

export namespace CodexCLIExecutor {
  export function create(input: { command: string[] }): CodingProvider {
    const baseCommand = normalizeExecutableArgv(input.command)
    return {
      name: "codex",
      capabilities() {
        return {
          builtinTools: true,
          customTools: false,
          stream: true,
          resume: true,
          interrupt: false,
          cwd: true,
          system: true,
        }
      },
      async *run(info) {
        const prompt = joinPrompt(info.system, info.prompt)
        const next = decoder()
        const stream = jsonLines({
          command: [
            ...baseCommand,
            "exec",
            "--json",
            "--skip-git-repo-check",
            ...(info.sandbox ? ["--sandbox", info.sandbox, "--ask-for-approval", "never"] : ["--full-auto"]),
            ...(info.cwd ? ["--cd", info.cwd] : []),
            ...(info.model ? ["--model", info.model] : []),
            "-",
          ],
          cwd: info.cwd,
          env: {
            ...process.env,
            ...gitCeilingEnvForWorktree(info.cwd),
            ...codingRuntimeEnv(info),
          },
          stdin: prompt,
          signal: info.signal,
        })
        for await (const item of stream) {
          yield* next.push(item)
        }
        yield next.done()
      },
      async *resume(info) {
        const prompt = joinPrompt(info.system, info.prompt)
        const next = decoder()
        const stream = jsonLines({
          command: [
            ...baseCommand,
            "exec",
            "resume",
            info.sessionID,
            "--json",
            "--skip-git-repo-check",
            ...(info.sandbox ? ["--sandbox", info.sandbox, "--ask-for-approval", "never"] : ["--full-auto"]),
            ...(info.model ? ["--model", info.model] : []),
            "-",
          ],
          cwd: info.cwd,
          env: {
            ...process.env,
            ...gitCeilingEnvForWorktree(info.cwd),
            ...codingRuntimeEnv(info),
          },
          stdin: prompt,
          signal: info.signal,
        })
        for await (const item of stream) {
          yield* next.push(item)
        }
        yield next.done()
      },
      async interrupt() {
        return false
      },
    }
  }
}

function decoder() {
  let sessionID = ""
  let output = ""

  return {
    push(raw: Record<string, unknown>): CodingEventInfo[] {
      const type = typeof raw.type === "string" ? raw.type : ""
      if (type === "thread.started") {
        sessionID = typeof raw.thread_id === "string" ? raw.thread_id : sessionID
        return [
          {
            type: "progress",
            phase: "init",
            summary: type,
            meta: raw,
          },
        ]
      }
      if (type === "turn.started" || type === "turn.completed") {
        return [
          {
            type: "progress",
            phase: type === "turn.started" ? "responding" : "turn_completed",
            summary: type,
            meta: raw,
          },
        ]
      }
      if (type !== "item.completed") return []

      const item = record(raw.item)
      if (!item) return []
      if (item.type === "agent_message") {
        const next = text(item.text)
        if (!next) return []
        output += next
        return [{ type: "text_delta", text: next }]
      }
      if ((item.type === "tool_call" || item.type === "function_call") && typeof item.id === "string") {
        return [
          {
            type: "tool_call",
            id: item.id,
            name: typeof item.name === "string" ? item.name : "tool",
            input: text(item.input || item.arguments),
          },
        ]
      }
      if ((item.type === "tool_result" || item.type === "function_call_output") && typeof item.id === "string") {
        return [
          {
            type: "tool_result",
            id: item.id,
            output: text(item.output || item.content),
          },
        ]
      }
      return []
    },
    done(): CodingEventInfo {
      return {
        type: "done",
        sessionID: sessionID || undefined,
        output: output || undefined,
      }
    },
  }
}

function joinPrompt(system: string | undefined, prompt: string) {
  if (!system) return prompt
  return `${system}\n\n${prompt}`
}
