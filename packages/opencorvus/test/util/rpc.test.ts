import { describe, expect, test } from "bun:test"
import { Rpc } from "../../src/util/rpc"

function rpcTarget(
  handler: (
    packet: Record<string, unknown>,
    target: { onmessage: ((evt: MessageEvent<string>) => void) | null },
  ) => void,
) {
  const target = {
    onmessage: null as ((evt: MessageEvent<string>) => void) | null,
    postMessage(data: string) {
      handler(JSON.parse(data) as Record<string, unknown>, target)
    },
  }
  return target
}

describe("util.rpc", () => {
  test("client call resolves rpc.result payload", async () => {
    const target = rpcTarget((packet, bus) => {
      const id = packet.id as number
      const input = packet.input as number
      const result = {
        type: "rpc.result",
        id,
        result: input + 1,
      }
      bus.onmessage?.({ data: JSON.stringify(result) } as MessageEvent<string>)
    })
    const client = Rpc.client<{ add: (value: number) => number }>(target)
    const output = await client.call("add", 41)
    expect(output).toBe(42)
  })

  test("client call rejects rpc.error payload", async () => {
    const target = rpcTarget((packet, bus) => {
      const output = {
        type: "rpc.error",
        id: packet.id,
        error: {
          name: "RemoteFailure",
          message: "boom",
        },
      }
      bus.onmessage?.({ data: JSON.stringify(output) } as MessageEvent<string>)
    })
    const client = Rpc.client<{ add: (value: number) => number }>(target)
    await expect(client.call("add", 1)).rejects.toThrow("boom")
  })

  test("client call times out when worker does not respond", async () => {
    const target = rpcTarget(() => {})
    const client = Rpc.client<{ ping: (value: string) => string }>(target)
    await expect(client.call("ping", "ok", { timeoutMs: 10 })).rejects.toBeInstanceOf(Rpc.TimeoutError)
  })
})
