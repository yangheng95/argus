import { spawn, execSync } from "node:child_process"
import { type ConfigGetResponse } from "./gen/types.gen.js"
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT } from "./defaults.js"

type Config = ConfigGetResponse

export type ServerOptions = {
  hostname?: string
  port?: number
  signal?: AbortSignal
  timeout?: number
  config?: Config
}

function resolveCommand() {
  if (process.env.OPENCORVUS_BIN_PATH) {
    return process.env.OPENCORVUS_BIN_PATH
  }
  try {
    execSync("opencorvus --version", { stdio: "ignore", timeout: 3000 })
    return "opencorvus"
  } catch {}
  return "opencorvus"
}

export async function createOpenCorvusServer(options?: ServerOptions) {
  options = Object.assign(
    {
      hostname: DEFAULT_SERVER_HOST,
      port: DEFAULT_SERVER_PORT,
      timeout: 5000,
    },
    options ?? {},
  )

  const args = [`serve`, `--hostname=${options.hostname}`, `--port=${options.port}`]
  if (options.config?.logLevel) args.push(`--log-level=${options.config.logLevel}`)
  const config = options.config === undefined ? process.env.OPENCORVUS_CONFIG_CONTENT : JSON.stringify(options.config)

  const proc = spawn(resolveCommand(), args, {
    signal: options.signal,
    env: {
      ...process.env,
      ...(config === undefined ? {} : { OPENCORVUS_CONFIG_CONTENT: config }),
    },
  })
  const stopProcess = () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill()
    }
  }

  const url = await new Promise<string>((resolve, reject) => {
    const id = setTimeout(() => {
      stopProcess()
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
        stopProcess()
        reject(new Error("Aborted"))
      })
    }
  })

  return {
    url,
    close() {
      stopProcess()
    },
  }
}
