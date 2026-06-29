import { createInterface } from "readline"
import { Process } from "@/util/process"
import { normalizeExecutableArgv } from "@/util/command"
import { withStreamActivity, type StreamActivityMonitor } from "@/util/stream-activity"

type RequestID = string | number

type JsonRpcResponse = {
  jsonrpc?: string
  id?: RequestID
  result?: unknown
  error?: unknown
}

type JsonRpcInbound =
  | {
      type: "request"
      id: RequestID
      method: string
      params?: Record<string, unknown>
    }
  | {
      type: "notification"
      method: string
      params?: Record<string, unknown>
    }

type JsonRpcRequestOptions = {
  signal?: AbortSignal
}

export type JsonRpcTransport = ReturnType<typeof JsonRpcLineTransport.create>

export const JsonRpcLineTransport = {
  create(input: { command: string[]; cwd?: string; env?: NodeJS.ProcessEnv; requestIdleMs: number }) {
    const command = spawnCommand(input.command)
    const requestIdleMs = input.requestIdleMs
    if (!Number.isFinite(requestIdleMs) || requestIdleMs <= 0) {
      throw new Error(`JSON-RPC requestIdleMs must be a positive finite number (got ${requestIdleMs})`)
    }
    const proc = Process.spawn(command, {
      cwd: input.cwd,
      env: input.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    if (!proc.stdout || !proc.stdin || !proc.stderr) {
      throw new Error(`JSON-RPC transport unavailable: ${command.join(" ")}`)
    }

    const pending = new Map<
      RequestID,
      {
        resolve(value: unknown): void
        reject(reason?: unknown): void
        cleanup(): void
      }
    >()
    const queue: JsonRpcInbound[] = []
    let wake: (() => void) | undefined
    let nextID = 0
    let closed = false
    let requestActivityMonitor: StreamActivityMonitor | undefined

    const clearRequestActivityMonitor = () => {
      requestActivityMonitor?.dispose()
      requestActivityMonitor = undefined
    }

    const failAll = (error: unknown) => {
      for (const item of pending.values()) {
        item.cleanup()
        item.reject(error)
      }
      pending.clear()
      clearRequestActivityMonitor()
    }

    const failTransport = (error: unknown) => {
      if (closed) return
      closed = true
      reader.close()
      proc.kill("SIGTERM")
      failAll(error)
      wake?.()
    }

    const observeRequestActivity = () => {
      if (pending.size === 0) return
      requestActivityMonitor?.observe()
    }

    const ensureRequestActivityMonitor = () => {
      if (requestActivityMonitor) {
        requestActivityMonitor.observe()
        return
      }
      requestActivityMonitor = withStreamActivity({
        idleMs: requestIdleMs,
        label: `json-rpc request: ${command.join(" ")}`,
      })
      requestActivityMonitor.signal.addEventListener(
        "abort",
        () => {
          failTransport(
            requestActivityMonitor?.signal.reason ?? new Error(`JSON-RPC request idle timeout: ${command.join(" ")}`),
          )
        },
        { once: true },
      )
    }

    const settlePending = (id: RequestID, settle: () => void) => {
      const item = pending.get(id)
      item?.cleanup()
      pending.delete(id)
      if (pending.size === 0) clearRequestActivityMonitor()
      settle()
    }

    const push = (item: JsonRpcInbound) => {
      queue.push(item)
      wake?.()
    }

    const reader = createInterface({
      input: proc.stdout,
      crlfDelay: Infinity,
    })

    proc.stdout.on("data", observeRequestActivity)
    proc.stderr.on("data", observeRequestActivity)
    ;(async () => {
      try {
        for await (const line of reader) {
          const trimmed = line.trim()
          if (!trimmed) continue
          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(trimmed)
          } catch {
            continue
          }
          if (typeof parsed.method === "string") {
            if (parsed.id !== undefined) {
              push({
                type: "request",
                id: parsed.id as RequestID,
                method: parsed.method,
                params: record(parsed.params),
              })
              continue
            }
            push({
              type: "notification",
              method: parsed.method,
              params: record(parsed.params),
            })
            continue
          }
          const response = parsed as JsonRpcResponse
          if (response.id === undefined) continue
          const item = pending.get(response.id)
          if (!item) continue
          if (response.error !== undefined) {
            settlePending(response.id, () => item.reject(response.error))
            continue
          }
          settlePending(response.id, () => item.resolve(response.result))
        }
      } catch (error) {
        failAll(error)
      } finally {
        closed = true
        proc.stdout?.off("data", observeRequestActivity)
        proc.stderr?.off("data", observeRequestActivity)
        failAll(new Error(`JSON-RPC transport closed: ${command.join(" ")}`))
        wake?.()
      }
    })()
    ;(async () => {
      const code = await proc.exited.catch(() => 1)
      if (closed) return
      closed = true
      failAll(new Error(`JSON-RPC process exited with code ${code}: ${command.join(" ")}`))
      wake?.()
    })()

    const send = (message: Record<string, unknown>) => {
      if (closed) throw new Error(`JSON-RPC transport closed: ${command.join(" ")}`)
      proc.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)
    }

    return {
      async request(method: string, params?: Record<string, unknown>, options?: JsonRpcRequestOptions) {
        const id = ++nextID
        options?.signal?.throwIfAborted()
        const onAbort = () => {
          failTransport(
            options?.signal?.reason ?? new DOMException(`JSON-RPC request aborted: ${command.join(" ")}`, "AbortError"),
          )
        }
        options?.signal?.addEventListener("abort", onAbort, { once: true })
        const cleanup = () => options?.signal?.removeEventListener("abort", onAbort)
        const result = new Promise<unknown>((resolve, reject) => {
          pending.set(id, { resolve, reject, cleanup })
        })
        try {
          ensureRequestActivityMonitor()
          send({
            id,
            method,
            params,
          })
        } catch (error) {
          cleanup()
          pending.delete(id)
          if (pending.size === 0) clearRequestActivityMonitor()
          throw error
        }
        return result
      },
      async respond(input: { id: RequestID; result?: Record<string, unknown>; error?: Record<string, unknown> }) {
        if (input.error !== undefined) {
          send({
            id: input.id,
            error: input.error,
          })
          return
        }
        send({
          id: input.id,
          result: input.result ?? {},
        })
      },
      async notify(method: string, params?: Record<string, unknown>) {
        send({
          method,
          params,
        })
      },
      async *events(signal?: AbortSignal) {
        // Wire the caller's abort signal into the wake primitive so an
        // upstream idle monitor (e.g. build/agent.ts withStreamActivity)
        // can actually unwind this generator. Without the listener the
        // signal-aborted branch only fires AFTER the next event arrives —
        // which is exactly the scenario the idle monitor exists to handle.
        const onAbort = () => {
          const w = wake
          wake = undefined
          w?.()
        }
        signal?.addEventListener("abort", onAbort, { once: true })
        try {
          while (true) {
            while (queue.length > 0) {
              yield queue.shift()!
            }
            if (signal?.aborted) return
            if (closed) return
            await new Promise<void>((resolve) => {
              wake = resolve
            })
            wake = undefined
          }
        } finally {
          signal?.removeEventListener("abort", onAbort)
        }
      },
      async close() {
        if (closed) return
        closed = true
        reader.close()
        proc.kill("SIGTERM")
        failAll(new Error(`JSON-RPC transport closed: ${command.join(" ")}`))
      },
    }
  },
}

function record(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  return input as Record<string, unknown>
}

function spawnCommand(command: string[]) {
  if (command.length === 0) throw new Error("Command is required")
  const [file, ...rest] = normalizeExecutableArgv(command)
  const lower = file.toLowerCase()
  if (process.platform === "win32" && (lower.endsWith(".cmd") || lower.endsWith(".bat"))) {
    return ["cmd.exe", "/c", file, ...rest]
  }
  if (process.platform === "win32" && lower.endsWith(".ps1")) {
    return ["pwsh.exe", "-File", file, ...rest]
  }
  return command
}
