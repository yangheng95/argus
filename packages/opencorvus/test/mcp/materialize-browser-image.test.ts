import { describe, expect, test } from "bun:test"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { tmpdir } from "../fixture/fixture"
import { materializeMcpToolResult } from "../../src/mcp/materialize"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"

const ONE_BY_ONE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8t6XwAAAABJRU5ErkJggg=="

describe("materializeMcpToolResult browser image content", () => {
  test("stores MCP image content as an attachment instead of retaining inline base64", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result: CallToolResult = {
          content: [
            { type: "image", data: ONE_BY_ONE_PNG_BASE64, mimeType: "image/png" },
            { type: "text", text: JSON.stringify({ width: 1, height: 1 }) },
          ],
          structuredContent: {
            url: "http://127.0.0.1:3000/",
            title: "Browser fixture",
            viewport: { width: 800, height: 600 },
            screenshot: {
              data: ONE_BY_ONE_PNG_BASE64,
              mimeType: "image/png",
              width: 1,
              height: 1,
            },
            diagnostics: {
              consoleErrors: [{ text: "fixture-error" }],
              pageErrors: [],
              failedRequests: [],
              httpErrors: [{ status: 404 }],
            },
          },
        } as CallToolResult

        const materialized = await materializeMcpToolResult({
          projectID: Instance.project.id,
          result,
          imageFilename: "browser-observation.png",
        })

        expect(materialized.attachments).toHaveLength(1)
        const [attachment] = materialized.attachments
        expect(attachment.mime).toBe("image/png")
        expect(attachment.url.startsWith(`/attachment/${Instance.project.id}/`)).toBe(true)
        expect(attachment.url).not.toContain("data:image/png;base64")
        expect(materialized.text).not.toContain(ONE_BY_ONE_PNG_BASE64)

        const located = AttachmentStore.nameFromUrl(attachment.url)
        expect(located?.projectID).toBe(Instance.project.id)
        const bytes = await AttachmentStore.read(located!.projectID, located!.name)
        expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        expect(materialized.metadata.browser).toEqual({
          url: "http://127.0.0.1:3000/",
          title: "Browser fixture",
          viewport: { width: 800, height: 600 },
          screenshot: {
            mimeType: "image/png",
            width: 1,
            height: 1,
            attachmentUrl: attachment.url,
            sha: attachment.sha,
          },
          diagnostics: {
            consoleErrors: 1,
            pageErrors: 0,
            failedRequests: 0,
            httpErrors: 1,
          },
        })
        expect(JSON.stringify(materialized.metadata)).not.toContain(ONE_BY_ONE_PNG_BASE64)
      },
    })
  })
})
