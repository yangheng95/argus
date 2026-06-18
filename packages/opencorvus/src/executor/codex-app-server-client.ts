import type { JsonRpcTransport } from "./protocol/json-rpc"
import { JsonRpcLineTransport } from "./protocol/json-rpc"
import type { CodexAppServerClient, CodexInbound } from "./codex-app-server"

export namespace CodexAppServerClientProcess {
  export function create(input: {
    command: string[]
    cwd?: string
    env?: NodeJS.ProcessEnv
    requestIdleMs: number
  }): CodexAppServerClient {
    const transport = JsonRpcLineTransport.create({
      command: input.command,
      cwd: input.cwd,
      env: input.env,
      requestIdleMs: input.requestIdleMs,
    })
    return fromTransport(transport)
  }

  export function fromTransport(transport: JsonRpcTransport): CodexAppServerClient {
    return {
      initialize(input, options) {
        return transport.request("initialize", input as unknown as Record<string, unknown>, options)
      },
      threadStart(input, options) {
        return transport.request("thread/start", input, options).then((result) => result as { thread: { id: string } })
      },
      threadResume(input, options) {
        return transport.request("thread/resume", input, options).then((result) => result as { thread: { id: string } })
      },
      turnStart(input, options) {
        return transport.request("turn/start", input, options).then((result) => result as { turn: { id: string } })
      },
      turnInterrupt(input, options) {
        return transport.request("turn/interrupt", input, options)
      },
      respond(input) {
        return transport.respond(input)
      },
      async *events(input) {
        for await (const event of transport.events(input?.signal)) {
          yield map(event)
        }
      },
      close() {
        return transport.close()
      },
    }
  }
}

function map(
  input:
    | {
        type: "request"
        id: string | number
        method: string
        params?: Record<string, unknown>
      }
    | {
        type: "notification"
        method: string
        params?: Record<string, unknown>
      },
): CodexInbound {
  if (input.type === "request") {
    return {
      type: "request",
      id: input.id,
      method: input.method,
      params: input.params,
    }
  }
  return {
    type: "notification",
    method: input.method,
    params: input.params,
  }
}
