import { installProcessShims } from "@/runtime/shims"
import { MCPServe } from "./serve"

installProcessShims()

const args = parseArgs(process.argv.slice(2))

await MCPServe.serve({
  cwd: required(args.cwd, "--cwd"),
  toolset: args.toolset === "executor" || args.toolset === undefined ? "executor" : invalidToolset(args.toolset),
})

function parseArgs(input: string[]) {
  const output: Record<string, string | undefined> = {}
  for (let index = 0; index < input.length; index++) {
    const item = input[index]
    if (item === "--cwd" || item === "--toolset") {
      output[item.slice(2)] = input[++index]
      continue
    }
    if (item.startsWith("--cwd=")) {
      output.cwd = item.slice("--cwd=".length)
      continue
    }
    if (item.startsWith("--toolset=")) {
      output.toolset = item.slice("--toolset=".length)
      continue
    }
  }
  return output
}

function required(input: string | undefined, name: string) {
  if (input) return input
  throw new Error(`${name} is required`)
}

function invalidToolset(input: string): never {
  throw new Error(`Unsupported MCP toolset: ${input}`)
}
