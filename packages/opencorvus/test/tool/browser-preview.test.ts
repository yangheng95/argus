import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import path from "node:path"
import { PassThrough } from "node:stream"
import { BrowserPreviewTool } from "../../src/tool/browser-preview"
import {
  BrowserPreviewCompareRegionsTool,
  BrowserPreviewCompareRegionsToolParameters,
} from "../../src/tool/browser-preview-compare-regions"
import { ToolRegistry } from "../../src/tool/registry"
import { ProcessSupervisor } from "../../src/shell/process-supervisor"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { findLatestBrowserPreviewTarget } from "../../src/browser-preview/persist"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const baseCtx = {
  sessionID: "ses_browser_preview_tool",
  messageID: "msg_browser_preview_tool",
  callID: "call_browser_preview_tool",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}
const BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS = 30_000

afterEach(async () => {
  await resetDatabase()
})

async function startReachablePreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((_, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end("<!doctype html><title>preview</title><main>ready</main>")
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("preview test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function seedTask(directory: string) {
  const taskID = `tsk_browserpreviewtool${Date.now()}`
  await Instance.provide({
    directory,
    fn: () => {
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            title: "Preview task",
            request: "Preview task",
            source: "api",
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run(),
      )
    },
  })
  return taskID
}

describe("tool.browser_preview", () => {
  test(
    "is registered for assistant tool use",
    async () => {
      await Instance.provide({
        directory: path.join(__dirname, "../.."),
        fn: async () => {
          await expect(ToolRegistry.ids()).resolves.toContain("browser_preview")
          await expect(ToolRegistry.ids()).resolves.toContain("browser_preview_compare_regions")
        },
      })
    },
    { timeout: BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "starts a background service and opens preview from printed process URL",
    async () => {
      const preview = await startReachablePreviewServer()
      try {
        await using tmp = await tmpdir({ git: true })
        const taskID = await seedTask(tmp.path)
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const restore = ProcessSupervisor.setFactoryForTest(async () => {
              const stdout = new PassThrough()
              queueMicrotask(() => {
                stdout.write(`Local: ${preview.url}\n`)
              })
              return {
                pid: 9101,
                stdin: null,
                stdout,
                stderr: new PassThrough(),
                exited: new Promise<number>(() => {}),
                terminate: async () => {},
                dispose: async () => {},
                unref: () => {},
              }
            })
            try {
              const tool = await BrowserPreviewTool.init()
              const result = await tool.execute(
                {
                  command: "npm run dev",
                  timeout: 20,
                  leaseTimeout: 200,
                },
                { ...baseCtx, extra: { taskID } },
              )
              const payload = JSON.parse(result.output)

              expect(result.metadata.targetUrl).toBe(preview.url)
              expect(result.metadata.targetStatus).toBe("ready")
              expect(payload.target.url).toBe(preview.url)
              expect(payload.diagnostics.join("\n")).toContain("browser_preview_target")
              expect(findLatestBrowserPreviewTarget(taskID)?.url).toBe(preview.url)
            } finally {
              restore()
            }
          },
        })
      } finally {
        await preview.close()
      }
    },
    { timeout: BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "starts a background service and keeps explicit URL ahead of printed URLs",
    async () => {
      const preview = await startReachablePreviewServer()
      const printed = await startReachablePreviewServer()
      try {
        await using tmp = await tmpdir({ git: true })
        const taskID = await seedTask(tmp.path)
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const restore = ProcessSupervisor.setFactoryForTest(async () => {
              const stdout = new PassThrough()
              queueMicrotask(() => {
                stdout.write(`Local: ${printed.url}\n`)
              })
              return {
                pid: 9102,
                stdin: null,
                stdout,
                stderr: new PassThrough(),
                exited: new Promise<number>(() => {}),
                terminate: async () => {},
                dispose: async () => {},
                unref: () => {},
              }
            })
            try {
              const tool = await BrowserPreviewTool.init()
              const result = await tool.execute(
                {
                  command: "npm run dev",
                  url: preview.url,
                  timeout: 20,
                  leaseTimeout: 200,
                },
                { ...baseCtx, extra: { taskID } },
              )
              const payload = JSON.parse(result.output)

              expect(result.metadata.explicitUrlPersisted).toBe(true)
              expect(result.metadata.targetUrl).toBe(preview.url)
              expect(payload.explicitUrlPersisted).toBe(true)
              expect(payload.startupCandidates).toContainEqual({
                source: "process-output",
                url: printed.url,
                skipReason: "explicit preview URL owns target selection",
              })
              expect(findLatestBrowserPreviewTarget(taskID)?.url).toBe(preview.url)
            } finally {
              restore()
            }
          },
        })
      } finally {
        await preview.close()
        await printed.close()
      }
    },
    { timeout: BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "keeps command-derived preview URLs diagnostic only",
    async () => {
      const preview = await startReachablePreviewServer()
      try {
        await using tmp = await tmpdir({ git: true })
        const taskID = await seedTask(tmp.path)
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const url = new URL(preview.url)
            const restore = ProcessSupervisor.setFactoryForTest(async () => ({
              pid: 9103,
              stdin: null,
              stdout: new PassThrough(),
              stderr: new PassThrough(),
              exited: new Promise<number>(() => {}),
              terminate: async () => {},
              dispose: async () => {},
              unref: () => {},
            }))
            try {
              const tool = await BrowserPreviewTool.init()
              const result = await tool.execute(
                {
                  command: `npx vite --host 127.0.0.1 --port ${url.port}`,
                  timeout: 20,
                  leaseTimeout: 200,
                },
                { ...baseCtx, extra: { taskID } },
              )
              const payload = JSON.parse(result.output)

              expect(result.metadata.targetStatus).toBe("missing")
              expect(result.metadata.targetUrl).toBeUndefined()
              expect(payload.startupTargets).toEqual([])
              expect(payload.startupCandidates).toEqual([
                {
                  source: "command",
                  url: preview.url,
                  reachable: true,
                  skipReason: "command-derived URL is diagnostic only; pass url to persist it",
                },
              ])
              expect(payload.diagnostics.join("\n")).toContain("No browser_preview_target was persisted")
              expect(findLatestBrowserPreviewTarget(taskID)).toBeUndefined()
            } finally {
              restore()
            }
          },
        })
      } finally {
        await preview.close()
      }
    },
    { timeout: BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "rejects an invalid explicit URL before starting a background service",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          let spawned = false
          const restore = ProcessSupervisor.setFactoryForTest(async () => {
            spawned = true
            return {
              pid: 9104,
              stdin: null,
              stdout: new PassThrough(),
              stderr: new PassThrough(),
              exited: new Promise<number>(() => {}),
              terminate: async () => {},
              dispose: async () => {},
              unref: () => {},
            }
          })
          try {
            const tool = await BrowserPreviewTool.init()
            await expect(
              tool.execute(
                {
                  command: "npm run dev",
                  url: "file:///tmp/index.html",
                  timeout: 20,
                  leaseTimeout: 200,
                },
                { ...baseCtx, extra: { taskID } },
              ),
            ).rejects.toThrow("Invalid browser preview URL")
            expect(spawned).toBe(false)
          } finally {
            restore()
          }
        },
      })
    },
    { timeout: BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "requires a task context before starting a preview service",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tool = await BrowserPreviewTool.init()
          await expect(
            tool.execute(
              {
                command: "npm run dev",
                timeout: 20,
                leaseTimeout: 200,
              },
              baseCtx,
            ),
          ).rejects.toThrow("requires a task context")
        },
      })
    },
    { timeout: BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "compare regions tool requires a persisted target ID",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tool = await BrowserPreviewCompareRegionsTool.init()
          await expect(
            tool.execute(
              {
                targetID: "art_previewtarget_missing",
                viewportIDs: ["desktop"],
                inlineBindings: [
                  {
                    region_id: "economy",
                    viewport_id: "desktop",
                    region_scope: "page-section",
                    source: {
                      reference_artifact_id: "reference.png",
                      bbox: { x: 0, y: 0, width: 100, height: 80 },
                      semantic_role: "economy section",
                    },
                    implementation: {
                      route: "/",
                      locator: { kind: "data-oc-region", value: "economy" },
                    },
                  },
                ],
              },
              { ...baseCtx, extra: { taskID } },
            ),
          ).rejects.toThrow("Browser preview target not found: art_previewtarget_missing")
        },
      })
    },
    { timeout: BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS },
  )

  test("compare regions tool parameters reject direct URL and output directory fields", () => {
    const binding = {
      region_id: "economy",
      viewport_id: "desktop",
      region_scope: "page-section",
      source: {
        reference_artifact_id: "reference.png",
        bbox: { x: 0, y: 0, width: 100, height: 80 },
        semantic_role: "economy section",
      },
      implementation: {
        route: "/",
        locator: { kind: "data-oc-region", value: "economy" },
      },
    }

    expect(() =>
      BrowserPreviewCompareRegionsToolParameters.parse({
        targetID: "art_previewtarget_1",
        viewportIDs: ["desktop"],
        inlineBindings: [binding],
        url: "http://127.0.0.1:5173/",
      }),
    ).toThrow(/url/)

    expect(() =>
      BrowserPreviewCompareRegionsToolParameters.parse({
        targetID: "art_previewtarget_1",
        viewportIDs: ["desktop"],
        inlineBindings: [
          {
            ...binding,
            implementation: {
              ...binding.implementation,
              outDir: ".opencorvus/other",
            },
          },
        ],
      }),
    ).toThrow(/outDir/)
  })
})
