import { afterEach, describe, expect, test } from "bun:test"
import { JsonRpcLineTransport } from "../../src/executor/protocol/json-rpc"

describe("json rpc line transport", () => {
  afterEach(() => {
    delete process.env.OPENCORVUS_TRANSPORT_TEST
  })

  test("sends requests and receives notifications over line-delimited json", async () => {
    const script = [
      "const rl = require('node:readline').createInterface({ input: process.stdin, crlfDelay: Infinity })",
      "for await (const line of rl) {",
      "  const msg = JSON.parse(line)",
      "  if (msg.method === 'initialize') {",
      "    process.stdout.write(JSON.stringify({ id: msg.id, result: { ok: true } }) + '\\n')",
      "    process.stdout.write(JSON.stringify({ method: 'thread/started', params: { threadId: 'thr_test' } }) + '\\n')",
      "  }",
      "}",
    ].join("\n")

    const transport = JsonRpcLineTransport.create({
      command: [process.execPath, "-e", script],
    })

    const result = await transport.request("initialize", {
      clientInfo: {
        name: "test",
        version: "0.0.1-alpha",
      },
    })
    expect(result).toEqual({ ok: true })

    const events = transport.events()
    const next = await events.next()
    expect(next.value).toEqual({
      type: "notification",
      method: "thread/started",
      params: {
        threadId: "thr_test",
      },
    })

    await transport.close()
  })
})
