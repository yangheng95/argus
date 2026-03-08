import { ClaudeCodeExecutor } from "./claude-code"
import { decode, type CodingProvider } from "./compat"
import { jsonLines } from "./external-process"

export namespace ClaudeCLIExecutor {
  export function create(input: { command: string[] }): CodingProvider {
    return {
      name: "claude-code",
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
        const stream = jsonLines({
          command: [
            ...input.command,
            "-p",
            "--verbose",
            "--input-format",
            "text",
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            ...(info.cwd ? ["--add-dir", info.cwd] : []),
            ...(info.model ? ["--model", info.model] : []),
            ...(info.system ? ["--append-system-prompt", info.system] : []),
            ...tools(info.tools?.flatMap((item) => (item.type === "builtin" ? [item.name] : [])) ?? []),
          ],
          cwd: info.cwd,
          stdin: info.prompt,
          signal: info.signal,
        })
        yield* decode(stream, ClaudeCodeExecutor.decoder().push)
      },
      async *resume(info) {
        const stream = jsonLines({
          command: [
            ...input.command,
            "-p",
            "--verbose",
            "--resume",
            info.sessionID,
            "--input-format",
            "text",
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            ...(info.cwd ? ["--add-dir", info.cwd] : []),
            ...(info.model ? ["--model", info.model] : []),
            ...(info.system ? ["--append-system-prompt", info.system] : []),
            ...tools(info.tools?.flatMap((item) => (item.type === "builtin" ? [item.name] : [])) ?? []),
          ],
          cwd: info.cwd,
          stdin: info.prompt,
          signal: info.signal,
        })
        yield* decode(stream, ClaudeCodeExecutor.decoder().push)
      },
      async interrupt() {
        return false
      },
    }
  }
}

function tools(items: string[]) {
  if (items.length === 0) return []
  return ["--tools", items.join(",")]
}
