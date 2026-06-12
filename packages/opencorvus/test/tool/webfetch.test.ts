import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { WebFetchTool } from "../../src/tool/webfetch"
import { Truncate } from "../../src/tool/truncation"
import { tmpdir } from "../fixture/fixture"
import { exaMcpCall } from "../../src/tool/exa-mcp"

const projectRoot = path.join(import.meta.dir, "../..")
const INSTANCE_STARTUP_TIMEOUT_MS = 60_000

const ctx = {
  sessionID: "test",
  messageID: "message",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

async function withFetch(
  mockFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch as unknown as typeof fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

describe("tool.webfetch", () => {
  test(
    "uses configured authenticated proxy for web research fetches",
    async () => {
      let seenProxy: unknown
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencorvus.json"),
            JSON.stringify({
              $schema: "https://opencorvus.ai/config.json",
              network: {
                proxy: {
                  url: "http://10.217.133.185:30100",
                  username: "hexin",
                  password: "hx300033",
                  llmProvider: false,
                  webResearch: true,
                },
              },
            }),
          )
        },
      })

      await withFetch(
        async (_input, init) => {
          seenProxy = (init as any)?.proxy
          return new Response("proxied webfetch", {
            status: 200,
            headers: { "content-type": "text/plain; charset=utf-8" },
          })
        },
        async () => {
          await Instance.provide({
            directory: tmp.path,
            fn: async () => {
              const webfetch = await WebFetchTool.init()
              const result = await webfetch.execute({ url: "https://example.com/file.txt", format: "text" }, ctx)
              expect(result.output).toBe("proxied webfetch")
              expect(seenProxy).toBe("http://hexin:hx300033@10.217.133.185:30100/")
            },
          })
        },
      )
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "uses configured authenticated proxy for Exa MCP web research transport",
    async () => {
      let seenProxy: unknown
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(
            path.join(dir, "opencorvus.json"),
            JSON.stringify({
              $schema: "https://opencorvus.ai/config.json",
              network: {
                proxy: {
                  url: "http://10.217.133.185:30100",
                  username: "hexin",
                  password: "hx300033",
                  llmProvider: false,
                  webResearch: true,
                },
              },
            }),
          )
        },
      })

      await withFetch(
        async (_input, init) => {
          seenProxy = (init as any)?.proxy
          return new Response(
            'data: {"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"proxied search"}]}}\n',
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          )
        },
        async () => {
          await Instance.provide({
            directory: tmp.path,
            fn: async () => {
              const text = await exaMcpCall({
                name: "web_search_exa",
                arguments: { query: "proxy test" },
                timeoutMs: 1000,
                label: "Web search",
              })
              expect(text).toBe("proxied search")
              expect(seenProxy).toBe("http://hexin:hx300033@10.217.133.185:30100/")
            },
          })
        },
      )
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "returns image responses as file attachments",
    async () => {
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
      await withFetch(
        async () => new Response(bytes, { status: 200, headers: { "content-type": "IMAGE/PNG; charset=binary" } }),
        async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const webfetch = await WebFetchTool.init()
              const result = await webfetch.execute({ url: "https://example.com/image.png", format: "markdown" }, ctx)
              expect(result.output).toBe("Image fetched successfully")
              expect(result.attachments).toBeDefined()
              expect(result.attachments?.length).toBe(1)
              expect(result.attachments?.[0].type).toBe("file")
              expect(result.attachments?.[0].mime).toBe("image/png")
              expect(result.attachments?.[0].url.startsWith("data:image/png;base64,")).toBe(true)
              expect(result.attachments?.[0]).not.toHaveProperty("id")
              expect(result.attachments?.[0]).not.toHaveProperty("sessionID")
              expect(result.attachments?.[0]).not.toHaveProperty("messageID")
            },
          })
        },
      )
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "keeps svg as text output",
    async () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>hello</text></svg>'
      await withFetch(
        async () =>
          new Response(svg, {
            status: 200,
            headers: { "content-type": "image/svg+xml; charset=UTF-8" },
          }),
        async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const webfetch = await WebFetchTool.init()
              const result = await webfetch.execute({ url: "https://example.com/image.svg", format: "html" }, ctx)
              expect(result.output).toContain("<svg")
              expect(result.attachments).toBeUndefined()
            },
          })
        },
      )
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "keeps text responses as text output",
    async () => {
      await withFetch(
        async () =>
          new Response("hello from webfetch", {
            status: 200,
            headers: { "content-type": "text/plain; charset=utf-8" },
          }),
        async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const webfetch = await WebFetchTool.init()
              const result = await webfetch.execute({ url: "https://example.com/file.txt", format: "text" }, ctx)
              expect(result.output).toBe("hello from webfetch")
              expect(result.attachments).toBeUndefined()
            },
          })
        },
      )
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "clips large html output before it enters agent context",
    async () => {
      const html = `<html><body><main><h1>World Economy</h1><p>${"market data ".repeat(20_000)}</p></main></body></html>`
      await withFetch(
        async () =>
          new Response(html, {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const webfetch = await WebFetchTool.init()
              const result = await webfetch.execute(
                { url: "https://example.com/markets/world-economy/", format: "markdown" },
                ctx,
              )
              expect(result.output).toContain("World Economy")
              expect(result.output).toContain("[webfetch output clipped:")
              expect(Buffer.byteLength(result.output, "utf8")).toBeLessThan(Truncate.MAX_BYTES + 200)
              expect(result.metadata.webfetchOutputClipped).toBe(true)
            },
          })
        },
      )
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )

  test(
    "clips single-line text without returning an empty preview",
    async () => {
      const text = "A".repeat(Truncate.MAX_BYTES * 2)
      await withFetch(
        async () =>
          new Response(text, {
            status: 200,
            headers: { "content-type": "text/plain; charset=utf-8" },
          }),
        async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const webfetch = await WebFetchTool.init()
              const result = await webfetch.execute({ url: "https://example.com/long.txt", format: "text" }, ctx)
              expect(result.output.startsWith("A".repeat(100))).toBe(true)
              expect(result.output).toContain("[webfetch output clipped:")
              expect(result.metadata.webfetchOutputClipped).toBe(true)
            },
          })
        },
      )
    },
    { timeout: INSTANCE_STARTUP_TIMEOUT_MS },
  )
})
