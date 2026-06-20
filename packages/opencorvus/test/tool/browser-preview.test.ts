import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import { createServer, type Server } from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import { PassThrough } from "node:stream"
import sharp from "sharp"
import { BrowserPreviewTool } from "../../src/tool/browser-preview"
import {
  BrowserPreviewBindLocalModuleTool,
  BrowserPreviewBindLocalModuleToolParameters,
} from "../../src/tool/browser-preview-bind-local-module"
import { BrowserPreviewCompareRegionsTool } from "../../src/tool/browser-preview-compare-regions"
import { ToolRegistry } from "../../src/tool/registry"
import { ProcessSupervisor } from "../../src/shell/process-supervisor"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { ProtocolStore } from "../../src/protocol/store"
import { Database } from "../../src/storage/db"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import {
  findLatestBrowserPreviewTarget,
  findReadableBrowserPreviewEvidenceByID,
  persistBrowserPreviewEvidence,
  persistBrowserPreviewTarget,
  resolveRuntimeRelativePath,
} from "../../src/browser-preview/persist"
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

async function startDelayedReadyPreviewServer(delayMs: number): Promise<{ url: string; close: () => Promise<void> }> {
  const readyAt = Date.now() + delayMs
  let server: Server | undefined
  server = createServer((_, res) => {
    if (Date.now() < readyAt) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" })
      res.end("compiling")
      return
    }
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
          await expect(ToolRegistry.ids()).resolves.toContain("browser_preview_bind_local_module")
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
              const events = ProtocolStore.listTaskEvents(taskID)
              const event = events.find((item) => item.type === "task.updated" && item.source === "browser-preview.target")
              expect(event?.payload?.summary).toBe("Browser preview target updated")
              expect(event?.payload?.taskID).toBe(taskID)
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
    "persists a process-output URL printed after bash background readiness returns",
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
              setTimeout(() => {
                stdout.write(`Local: ${preview.url}\n`)
              }, 1_600)
              return {
                pid: 9105,
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
                  timeout: 1_500,
                  leaseTimeout: 2_000,
                },
                { ...baseCtx, extra: { taskID } },
              )
              const payload = JSON.parse(result.output)

              expect(result.metadata.targetStatus).toBe("ready")
              expect(result.metadata.targetUrl).toBe(preview.url)
              expect(payload.startupTargets).toHaveLength(1)
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
    "persists an explicit URL that becomes HTTP-ready after the initial background window",
    async () => {
      const preview = await startDelayedReadyPreviewServer(800)
      try {
        await using tmp = await tmpdir({ git: true })
        const taskID = await seedTask(tmp.path)
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const restore = ProcessSupervisor.setFactoryForTest(async () => ({
              pid: 9106,
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
                  command: "npm run dev",
                  url: preview.url,
                  timeout: 2_500,
                  leaseTimeout: 3_000,
                },
                { ...baseCtx, extra: { taskID } },
              )
              const payload = JSON.parse(result.output)

              expect(result.metadata.explicitUrlPersisted).toBe(true)
              expect(result.metadata.targetStatus).toBe("ready")
              expect(payload.target.url).toBe(preview.url)
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
    "waits through silent startup before persisting a later process-output URL",
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
              setTimeout(() => {
                stdout.write(`Local: ${preview.url}\n`)
              }, 6_100)
              return {
                pid: 9108,
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
                  timeout: 7_000,
                  leaseTimeout: 8_000,
                },
                { ...baseCtx, extra: { taskID } },
              )
              const payload = JSON.parse(result.output)

              expect(result.metadata.targetStatus).toBe("ready")
              expect(result.metadata.targetUrl).toBe(preview.url)
              expect(payload.startupTargets).toHaveLength(1)
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
    "resets process-output discovery timeout on startup activity before the URL appears",
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
              setTimeout(() => stdout.write("compiling chunk 1\n"), 800)
              setTimeout(() => stdout.write("compiling chunk 2\n"), 1_600)
              setTimeout(() => stdout.write(`Local: ${preview.url}\n`), 2_400)
              return {
                pid: 9109,
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
                  timeout: 1_000,
                  leaseTimeout: 4_000,
                },
                { ...baseCtx, extra: { taskID } },
              )
              const payload = JSON.parse(result.output)

              expect(result.metadata.targetStatus).toBe("ready")
              expect(result.metadata.targetUrl).toBe(preview.url)
              expect(payload.startupTargets).toHaveLength(1)
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
    "does not persist a printed URL when an explicit URL owns target selection but is unreachable",
    async () => {
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
                pid: 9107,
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
                  url: "http://127.0.0.1:9/",
                  timeout: 500,
                  leaseTimeout: 1_500,
                },
                { ...baseCtx, extra: { taskID } },
              )
              const payload = JSON.parse(result.output)

              expect(result.metadata.targetStatus).toBe("missing")
              expect(payload.startupTargets).toEqual([])
              expect(payload.startupCandidates).toContainEqual({
                source: "process-output",
                url: printed.url,
                skipReason: "explicit preview URL owns target selection",
              })
              expect(findLatestBrowserPreviewTarget(taskID)).toBeUndefined()
            } finally {
              restore()
            }
          },
        })
      } finally {
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
    "does not return a stale task target when the current startup persists no target",
    async () => {
      const stalePreview = await startReachablePreviewServer()
      const commandPreview = await startReachablePreviewServer()
      try {
        await using tmp = await tmpdir({ git: true })
        const taskID = await seedTask(tmp.path)
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            await persistBrowserPreviewTarget({ taskID, url: stalePreview.url })
            const commandUrl = new URL(commandPreview.url)
            const restore = ProcessSupervisor.setFactoryForTest(async () => ({
              pid: 9104,
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
                  command: `npx vite --host 127.0.0.1 --port ${commandUrl.port}`,
                  timeout: 20,
                  leaseTimeout: 200,
                },
                { ...baseCtx, extra: { taskID } },
              )
              const payload = JSON.parse(result.output)

              expect(result.metadata.targetStatus).toBe("missing")
              expect(result.metadata.targetUrl).toBeUndefined()
              expect(payload.target.status).toBe("missing")
              expect(payload.target.url).toBeUndefined()
              expect(payload.startupTargets).toEqual([])
              expect(payload.startupCandidates).toEqual([
                {
                  source: "command",
                  url: commandPreview.url,
                  reachable: true,
                  skipReason: "command-derived URL is diagnostic only; pass url to persist it",
                },
              ])
              expect(payload.diagnostics.join("\n")).toContain(
                "No browser_preview_target was persisted for this service startup.",
              )
              expect(findLatestBrowserPreviewTarget(taskID)?.url).toBe(stalePreview.url)
            } finally {
              restore()
            }
          },
        })
      } finally {
        await stalePreview.close()
        await commandPreview.close()
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

  test(
    "browser preview evidence without operation kind is not readable",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const artifactDir = ProjectRuntimePaths.taskAbsolute(tmp.path, taskID, "bp", "missing-operation-kind")
          await fs.mkdir(artifactDir, { recursive: true })
          await fs.writeFile(path.join(artifactDir, "side-by-side.png"), "png")
          Database.use((db) =>
            db
              .insert(EngineArtifactTable)
              .values({
                id: "art_missing_operation_kind",
                task_id: taskID,
                run_id: null,
                goal_run_id: null,
                acceptance_id: null,
                kind: "browser_preview_evidence",
                label: "capture",
                payload: {
                  target_id: "art_target",
                  viewport_id: "desktop",
                  region_id: "region_header",
                  artifact_paths: {
                    side_by_side: ProjectRuntimePaths.taskRelative(
                      taskID,
                      "bp",
                      "missing-operation-kind",
                      "side-by-side.png",
                    ),
                  },
                  status: "passed",
                  summary: "Missing operation kind should be unreadable.",
                  diagnostics: [],
                  time_completed: Date.now(),
                },
                time_created: Date.now(),
                time_updated: Date.now(),
              })
              .run(),
          )
          const evidence = await findReadableBrowserPreviewEvidenceByID({
            projectRoot: tmp.path,
            taskID,
            evidenceID: "art_missing_operation_kind",
          })
          expect(evidence).toBeUndefined()
        },
      })
    },
    { timeout: BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "browser preview evidence writer rejects missing operation kind",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:4173/" })
          expect(() =>
            persistBrowserPreviewEvidence({
              projectRoot: tmp.path,
              taskID,
              targetID: target.id,
              viewportID: "desktop",
              operationKind: undefined as any,
              status: "passed",
              summary: "Missing operation kind should throw.",
              capture: null,
              diagnostics: [],
            }),
          ).toThrow()
        },
      })
    },
    { timeout: BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "browser preview evidence writer rejects passed reference comparisons without required artifacts",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const artifactDir = ProjectRuntimePaths.taskAbsolute(tmp.path, taskID, "bp", "incomplete-comparison")
          await fs.mkdir(artifactDir, { recursive: true })
          const sideBySidePath = path.join(artifactDir, "side-by-side.png")
          await fs.writeFile(sideBySidePath, "side-by-side")
          const target = await persistBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:4173/" })
          expect(() =>
            persistBrowserPreviewEvidence({
              projectRoot: tmp.path,
              taskID,
              targetID: target.id,
              viewportID: "desktop",
              operationKind: "reference-comparison",
              regionID: "region_header",
              status: "passed",
              summary: "Incomplete comparison should throw.",
              artifactPaths: { side_by_side: sideBySidePath },
              diagnostics: [],
            }),
          ).toThrow("source_crop")
        },
      })
    },
    { timeout: BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS },
  )

  test("bind local module tool parameters reject non-canonical source reference IDs", () => {
    const parsed = BrowserPreviewBindLocalModuleToolParameters.safeParse({
      targetID: "art_previewtarget",
      viewportID: "desktop",
      regionID: "tool-local-module",
      route: "/",
      implementationLocator: { kind: "data-oc-region", value: "tool-local-module" },
      componentFiles: ["src/ToolLocalModule.tsx"],
      sourceReferenceArtifactID: ".opencorvus/r/t/S9/qzBwOu/fd/webpage-evidence/reference.png",
    })

    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error("non-canonical source reference unexpectedly parsed")
    expect(parsed.error.issues.map((issue) => issue.path.join(".")).join("\n")).toContain("sourceReferenceArtifactID")
  })

  test(
    "bind local module tool feeds compare regions tool and persists reference comparison evidence",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await writeBindingToolReference(paths.sourcePackageAbsolute)
      const server = await startBindingToolPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistBrowserPreviewTarget({ taskID, url: server.url }),
        })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const tool = await BrowserPreviewBindLocalModuleTool.init()
            const result = await tool.execute(
              {
                targetID: target.id,
                viewportID: "desktop",
                regionID: "tool-local-module",
                route: "/",
                implementationLocator: { kind: "data-oc-region", value: "tool-local-module" },
                componentFiles: ["src/ToolLocalModule.tsx"],
                sourceReferenceArtifactID: "reference.png",
                textAnchors: ["Tool Local Module", "Binding Anchor"],
                sourcePadding: 0,
                localPadding: 0,
              },
              { ...baseCtx, extra: { taskID } },
            )

            expect(result.title).toBe("Local module source binding completed")
            expect(result.attachments).toHaveLength(1)
            expect(result.metadata.status).toBe("passed")
            expect(result.metadata.binding.region_id).toBe("tool-local-module")
            expect(result.metadata.binding.source.bbox).toEqual({ x: 24, y: 30, width: 180, height: 92 })
            expect(result.metadata.binding.implementation.locator).toEqual({
              kind: "data-oc-region",
              value: "tool-local-module",
            })
            const bindingEvidence = await findReadableBrowserPreviewEvidenceByID({
              projectRoot: tmp.path,
              taskID,
              evidenceID: result.metadata.evidenceID,
            })
            expect(bindingEvidence?.operationKind).toBe("source-binding")

            const compareTool = await BrowserPreviewCompareRegionsTool.init()
            const comparison = await compareTool.execute(
              {
                targetID: target.id,
                viewportIDs: ["desktop"],
                inlineBindings: [result.metadata.binding],
                includeDiff: true,
              },
              { ...baseCtx, extra: { taskID } },
            )
            const comparisonPayload = JSON.parse(comparison.output)
            const evidenceID = comparison.metadata.evidenceIDs["desktop:default:tool-local-module"]
            const evidence = await findReadableBrowserPreviewEvidenceByID({
              projectRoot: tmp.path,
              taskID,
              evidenceID,
            })

            expect(comparison.title).toBe("Region comparison completed")
            expect(comparison.attachments).toHaveLength(1)
            expect(comparison.metadata.status).toBe("passed")
            expect(comparisonPayload.operation).toBe("reference-comparison")
            const comparedRegion = comparisonPayload.regions[0]
            const artifacts = comparedRegion.artifacts
            expect(artifacts.source_crop).toEndWith("source.png")
            expect(artifacts.implementation_crop).toEndWith("implementation.png")
            expect(artifacts.side_by_side).toEndWith("side-by-side.png")
            expect(artifacts.diff).toEndWith("diff.png")
            expect(evidence?.operationKind).toBe("reference-comparison")
            expect(evidence?.regionID).toBe("tool-local-module")
            expect(evidence?.artifactPaths?.source_crop).toBe(artifacts.source_crop)
            expect(evidence?.artifactPaths?.implementation_crop).toBe(artifacts.implementation_crop)
            expect(evidence?.artifactPaths?.side_by_side).toBe(artifacts.side_by_side)
            expect(evidence?.artifactPaths?.diff).toBe(artifacts.diff)

            const sourceCropPath = resolveRuntimeRelativePath(tmp.path, artifacts.source_crop)
            const implementationCropPath = resolveRuntimeRelativePath(tmp.path, artifacts.implementation_crop)
            const sideBySidePath = resolveRuntimeRelativePath(tmp.path, artifacts.side_by_side)
            const diffPath = resolveRuntimeRelativePath(tmp.path, artifacts.diff)
            expect(await fileExists(sourceCropPath)).toBe(true)
            expect(await fileExists(implementationCropPath)).toBe(true)
            expect(await fileExists(sideBySidePath)).toBe(true)
            expect(await fileExists(diffPath)).toBe(true)
            const sourceDimensions = {
              width: Math.ceil(comparedRegion.source_bbox.width),
              height: Math.ceil(comparedRegion.source_bbox.height),
            }
            const implementationDimensions = {
              width: Math.ceil(comparedRegion.implementation_bbox.width),
              height: Math.ceil(comparedRegion.implementation_bbox.height),
            }
            await expectPngDimensions(sourceCropPath, sourceDimensions)
            await expectPngDimensions(implementationCropPath, implementationDimensions)
            await expectPngDimensions(diffPath, sourceDimensions)
            await expectPngDimensions(sideBySidePath, {
              width: sourceDimensions.width + implementationDimensions.width + 16,
              height: 44 + 32 + Math.max(sourceDimensions.height, implementationDimensions.height),
            })
            await expectPngHasColorDiversity(sourceCropPath)
            await expectPngHasColorDiversity(implementationCropPath)
            await expectPngHasColorDiversity(sideBySidePath)
            await expectPngHasColorDiversity(diffPath)
          },
        })
      } finally {
        await server.close()
      }
    },
    { timeout: 60_000 },
  )

  test(
    "compare regions tool writes task evidence under the primary project root when invoked from a linked worktree",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const linkedWorktree = `${tmp.path}-goal-worktree`
      await $`git worktree add ${linkedWorktree} -b ${`opencorvus/test-browser-preview-${Date.now()}`}`.cwd(
        tmp.path,
      ).quiet()
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await writeBindingToolReference(paths.sourcePackageAbsolute)
      const server = await startBindingToolPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () => persistBrowserPreviewTarget({ taskID, url: server.url }),
        })
        await Instance.provide({
          directory: linkedWorktree,
          fn: async () => {
            const compareTool = await BrowserPreviewCompareRegionsTool.init()
            const comparison = await compareTool.execute(
              {
                targetID: target.id,
                viewportIDs: ["desktop"],
                inlineBindings: [
                  {
                    region_id: "linked-worktree-module",
                    viewport_id: "desktop",
                    state_id: "default",
                    region_scope: "page-section",
                    source: {
                      reference_artifact_id: "reference.png",
                      bbox: { x: 24, y: 30, width: 180, height: 92 },
                      semantic_role: "linked worktree module",
                      text_anchors: ["Tool Local Module", "Binding Anchor"],
                      source_refs: ["source screenshot"],
                    },
                    implementation: {
                      route: "/",
                      locator: { kind: "data-oc-region", value: "tool-local-module" },
                      component_files: ["src/ToolLocalModule.tsx"],
                    },
                    acceptance_refs: ["linked worktree evidence root"],
                  },
                ],
                includeDiff: true,
              },
              { ...baseCtx, extra: { taskID } },
            )
            const payload = JSON.parse(comparison.output)
            const region = payload.regions[0]
            const evidenceID = comparison.metadata.evidenceIDs["desktop:default:linked-worktree-module"]
            const evidence = await findReadableBrowserPreviewEvidenceByID({
              projectRoot: tmp.path,
              taskID,
              evidenceID,
            })

            expect(comparison.metadata.status).toBe("passed")
            expect(evidence?.status).toBe("passed")
            expect(await fileExists(resolveRuntimeRelativePath(tmp.path, region.artifacts.side_by_side))).toBe(true)
            expect(await fileExists(resolveRuntimeRelativePath(linkedWorktree, region.artifacts.side_by_side))).toBe(
              false,
            )
          },
        })
      } finally {
        await server.close()
        await $`git worktree remove --force ${linkedWorktree}`.cwd(tmp.path).quiet().catch(() => {})
      }
    },
    { timeout: 60_000 },
  )
})

async function fileExists(input: string): Promise<boolean> {
  try {
    await fs.access(input)
    return true
  } catch {
    return false
  }
}

async function expectPngDimensions(input: string, expected: { width: number; height: number }): Promise<void> {
  const metadata = await sharp(input).metadata()
  expect(metadata.format).toBe("png")
  expect({ width: metadata.width, height: metadata.height }).toEqual(expected)
}

async function expectPngHasColorDiversity(input: string): Promise<void> {
  const stats = await sharp(input).stats()
  expect(stats.channels.some((channel) => channel.min !== channel.max)).toBe(true)
}

async function writeBindingToolReference(sourcePackageAbsolute: string): Promise<void> {
  await fs.mkdir(sourcePackageAbsolute, { recursive: true })
  await sharp({
    create: {
      width: 360,
      height: 220,
      channels: 4,
      background: "#ffffff",
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="180" height="92" xmlns="http://www.w3.org/2000/svg">
            <rect width="180" height="92" fill="#fef3c7"/>
            <text x="16" y="38" font-family="Arial" font-size="20" font-weight="700" fill="#78350f">Tool Local Module</text>
            <text x="16" y="66" font-family="Arial" font-size="16" fill="#92400e">Binding Anchor</text>
          </svg>`,
        ),
        left: 24,
        top: 30,
      },
    ])
    .png()
    .toFile(path.join(sourcePackageAbsolute, "reference.png"))
  await fs.writeFile(
    path.join(sourcePackageAbsolute, "visual-surface-candidates.json"),
    JSON.stringify(
      {
        candidates: [
          {
            id: "ToolLocalModuleSurface",
            name: "Tool Local Module",
            bounds: { x: 24, y: 30, w: 180, h: 92 },
            textPreview: ["Tool Local Module", "Binding Anchor"],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  )
}

async function startBindingToolPreviewServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((_req, res) => {
    const body = `<!doctype html>
      <html>
        <head>
          <title>Binding tool preview</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; }
            main { padding: 48px; }
            [data-oc-region="tool-local-module"] {
              width: 180px;
              height: 92px;
              box-sizing: border-box;
              padding: 16px;
              background: #fef3c7;
              color: #78350f;
            }
            h2 { margin: 0 0 10px; font-size: 20px; line-height: 1; }
            p { margin: 0; font-size: 16px; color: #92400e; }
          </style>
        </head>
        <body><main><section data-oc-region="tool-local-module"><h2>Tool Local Module</h2><p>Binding Anchor</p></section></main></body>
      </html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(body)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("binding tool test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}
