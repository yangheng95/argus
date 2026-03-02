import { spawn, execSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { type Config } from "./gen/types.gen.js"

export type ServerOptions = {
  hostname?: string
  port?: number
  signal?: AbortSignal
  timeout?: number
  config?: Config
}

export type TuiOptions = {
  project?: string
  model?: string
  session?: string
  agent?: string
  signal?: AbortSignal
  config?: Config
}

function resolveArgusCommand(): { cmd: string; prefix: string[]; cwd?: string } {
  const root = path.resolve(import.meta.dirname ?? __dirname, "../../../..")
  const argusDir = path.join(root, "packages/argus")
  const localEntry = path.join(argusDir, "src/index.ts")
  const preferLocal = process.env.ARGUS_USE_GLOBAL_BINARY !== "1"

  // In monorepo/dev, prefer local source so server changes are picked up immediately.
  if (preferLocal && existsSync(localEntry)) {
    return { cmd: "bun", prefix: ["run", "--conditions=browser", "./src/index.ts"], cwd: argusDir }
  }

  // Fallback to compiled binary if available.
  try {
    execSync("opencorvus --version", { stdio: "ignore", timeout: 3000 })
    return { cmd: "opencorvus", prefix: [] }
  } catch {}
  try {
    execSync("argus --version", { stdio: "ignore", timeout: 3000 })
    return { cmd: "argus", prefix: [] }
  } catch {}

  // Last fallback: local source mode.
  return { cmd: "bun", prefix: ["run", "--conditions=browser", "./src/index.ts"], cwd: argusDir }
}

export async function createOpenCorvusServer(options?: ServerOptions) {
  options = Object.assign(
    {
      hostname: "127.0.0.1",
      port: 4096,
      timeout: 30000,
    },
    options ?? {},
  )

  const { cmd, prefix, cwd } = resolveArgusCommand()
  const args = [...prefix, `serve`, `--hostname=${options.hostname}`, `--port=${options.port}`]
  if (options.config?.logLevel) args.push(`--log-level=${options.config.logLevel}`)
  const config = options.config === undefined ? process.env.ARGUS_CONFIG_CONTENT : JSON.stringify(options.config)

  const proc = spawn(cmd, args, {
    signal: options.signal,
    cwd,
    env: {
      ...process.env,
      ...(config === undefined ? {} : { ARGUS_CONFIG_CONTENT: config }),
    },
  })

  const url = await new Promise<string>((resolve, reject) => {
    const id = setTimeout(() => {
      reject(new Error(`Timeout waiting for server to start after ${options.timeout}ms`))
    }, options.timeout)
    let output = ""
    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString()
      const lines = output.split("\n")
      for (const line of lines) {
        if (line.includes("server listening")) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
          if (!match) {
            throw new Error(`Failed to parse server url from output: ${line}`)
          }
          clearTimeout(id)
          resolve(match[1]!)
          return
        }
      }
    })
    proc.stderr?.on("data", (chunk) => {
      output += chunk.toString()
    })
    proc.on("exit", (code) => {
      clearTimeout(id)
      let msg = `Server exited with code ${code}`
      if (output.trim()) {
        msg += `\nServer output: ${output}`
      }
      reject(new Error(msg))
    })
    proc.on("error", (error) => {
      clearTimeout(id)
      reject(error)
    })
    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        clearTimeout(id)
        reject(new Error("Aborted"))
      })
    }
  })

  return {
    url,
    close() {
      proc.kill()
    },
  }
}

export function createOpenCorvusTui(options?: TuiOptions) {
  const { cmd, prefix, cwd } = resolveArgusCommand()
  const args = [...prefix]

  if (options?.project) {
    args.push(`--project=${options.project}`)
  }
  if (options?.model) {
    args.push(`--model=${options.model}`)
  }
  if (options?.session) {
    args.push(`--session=${options.session}`)
  }
  if (options?.agent) {
    args.push(`--agent=${options.agent}`)
  }

  const config = options?.config === undefined ? process.env.ARGUS_CONFIG_CONTENT : JSON.stringify(options.config)
  const proc = spawn(cmd, args, {
    signal: options?.signal,
    stdio: "inherit",
    cwd,
    env: {
      ...process.env,
      ...(config === undefined ? {} : { ARGUS_CONFIG_CONTENT: config }),
    },
  })

  return {
    close() {
      proc.kill()
    },
  }
}

export const createOpencodeServer = createOpenCorvusServer
export const createOpencodeTui = createOpenCorvusTui

