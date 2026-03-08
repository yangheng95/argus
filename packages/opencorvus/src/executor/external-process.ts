import { createInterface } from "readline"
import { text } from "node:stream/consumers"
import { Process } from "@/util/process"

export async function* jsonLines(input: {
  command: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdin?: string
  signal?: AbortSignal
}) {
  const proc = Process.spawn(input.command, {
    cwd: input.cwd,
    env: input.env,
    stdin: input.stdin !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    abort: input.signal,
  })
  if (!proc.stdout || !proc.stderr) {
    throw new Error(`Command output not available: ${input.command.join(" ")}`)
  }

  const stderr = text(proc.stderr)
  if (input.stdin !== undefined && proc.stdin) {
    proc.stdin.write(input.stdin)
    proc.stdin.end()
  }

  const rl = createInterface({
    input: proc.stdout,
    crlfDelay: Infinity,
  })

  try {
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        yield JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        // ignore non-json lines from progress or human-readable stderr bridges
      }
    }
  } finally {
    rl.close()
  }

  const [code, err] = await Promise.all([proc.exited, stderr])
  if (code === 0) return
  const detail = err.trim() || `Command failed with exit code ${code}: ${input.command.join(" ")}`
  throw new Error(detail)
}
