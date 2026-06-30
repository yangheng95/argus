import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import { PassThrough } from "node:stream"
import sharp from "sharp"
import { BrowserPreviewTool } from "../../src/tool/browser-preview"
import { BrowserPreviewReferenceRegionsTool } from "../../src/tool/browser-preview-reference-regions"
import { Agent } from "../../src/agent/agent"
import { ToolRegistry } from "../../src/tool/registry"
import { ProcessSupervisor } from "../../src/shell/process-supervisor"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { ProtocolStore } from "../../src/protocol/store"
import { Database } from "../../src/storage/db"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import {
  BrowserPreviewEvidenceCorruptionError,
  findLatestBrowserPreviewTarget,
  findReadableBrowserPreviewEvidenceByID,
  persistBrowserPreviewEvidence,
  resolveRuntimeRelativePath,
} from "../../src/browser-preview/persist"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { persistTestBrowserPreviewTarget, TEST_BROWSER_PREVIEW_VIEWPORTS } from "../fixture/browser-preview"

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
const BINDING_TOOL_TEST_VIEWPORTS = [
  { id: "desktop", labelKey: "browser_preview.viewport.desktop", width: 360, height: 220 },
] satisfies typeof TEST_BROWSER_PREVIEW_VIEWPORTS

function browserPreviewToolInput<T extends { viewports?: typeof TEST_BROWSER_PREVIEW_VIEWPORTS }>(
  input: T,
): T & { viewports: typeof TEST_BROWSER_PREVIEW_VIEWPORTS } {
  return { ...input, viewports: input.viewports ?? TEST_BROWSER_PREVIEW_VIEWPORTS }
}

afterEach(async () => {
  await resetDatabase()
}, BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS)

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
    "keeps shared preview entry global and repair tools agent-private",
    async () => {
      await Instance.provide({
        directory: path.join(__dirname, "../.."),
        fn: async () => {
          const globalIDs = await ToolRegistry.ids()
          expect(globalIDs).toContain("browser_preview")
          expect(globalIDs).not.toContain("browser_preview_bind_local_module")
          expect(globalIDs).not.toContain("browser_preview_compare_regions")
          expect(globalIDs).not.toContain("browser_preview_reference_regions")
          expect(globalIDs).not.toContain("browser_preview_compare_scroll_slices")

          const visualQa = await Agent.get("visual-qa")
          const visualQaTools = await ToolRegistry.tools({ providerID: "", modelID: "" }, visualQa)
          const visualQaIDs = visualQaTools.map((tool) => tool.id)
          expect(visualQaIDs).not.toContain("browser_preview_bind_local_module")
          expect(visualQaIDs).not.toContain("browser_preview_compare_regions")
          expect(visualQaIDs).toContain("browser_preview_reference_regions")
          expect(visualQaIDs).toContain("browser_preview_compare_scroll_slices")

          const build = await Agent.get("build")
          const buildTools = await ToolRegistry.tools({ providerID: "", modelID: "" }, build)
          const buildIDs = buildTools.map((tool) => tool.id)
          expect(buildIDs).not.toContain("browser_preview_bind_local_module")
          expect(buildIDs).not.toContain("browser_preview_compare_regions")
          expect(buildIDs).toContain("browser_preview_reference_regions")
          expect(buildIDs).toContain("browser_preview_compare_scroll_slices")
        },
      })
    },
    { timeout: BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS },
  )

  test("reference regions tool describes one module binding comparison instead of page screenshots", async () => {
    const tool = await BrowserPreviewReferenceRegionsTool.init()
    const normalized = tool.description.replace(/\s+/g, " ")

    expect(normalized).toContain("exactly one module comparison screenshot attachment")
    expect(normalized).toContain("does not run a second reference-comparison pass")
    expect(normalized).toContain("does not auto-call other tools on bind failure")
    expect(normalized).toContain("Use browser_preview_compare_scroll_slices for first-viewport")
    expect(normalized).toContain("Browser MCP screenshot/observe tools")
  })

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
                browserPreviewToolInput({
                  command: "npm run dev",
                  viewports: TEST_BROWSER_PREVIEW_VIEWPORTS,
                  timeout: 20,
                  leaseTimeout: 200,
                }),
                { ...baseCtx, extra: { taskID } },
              )
              const payload = JSON.parse(result.output)

              expect(result.metadata.targetUrl).toBe(preview.url)
              expect(result.metadata.targetStatus).toBe("ready")
              expect(payload.target.url).toBe(preview.url)
              expect(payload.diagnostics.join("\n")).toContain("browser_preview_target")
              expect(findLatestBrowserPreviewTarget(taskID)?.url).toBe(preview.url)
              const events = ProtocolStore.listTaskEvents(taskID)
              const event = events.find(
                (item) => item.type === "task.updated" && item.source === "browser-preview.target",
              )
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
                browserPreviewToolInput({
                  command: "npm run dev",
                  viewports: TEST_BROWSER_PREVIEW_VIEWPORTS,
                  timeout: 1_500,
                  leaseTimeout: 2_000,
                }),
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
                browserPreviewToolInput({
                  command: "npm run dev",
                  viewports: TEST_BROWSER_PREVIEW_VIEWPORTS,
                  url: preview.url,
                  timeout: 2_500,
                  leaseTimeout: 3_000,
                }),
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
                browserPreviewToolInput({
                  command: "npm run dev",
                  viewports: TEST_BROWSER_PREVIEW_VIEWPORTS,
                  url: preview.url,
                  timeout: 20,
                  leaseTimeout: 200,
                }),
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
                browserPreviewToolInput({
                  command: "npm run dev",
                  viewports: TEST_BROWSER_PREVIEW_VIEWPORTS,
                  timeout: 7_000,
                  leaseTimeout: 8_000,
                }),
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
                browserPreviewToolInput({
                  command: "npm run dev",
                  viewports: TEST_BROWSER_PREVIEW_VIEWPORTS,
                  timeout: 1_000,
                  leaseTimeout: 4_000,
                }),
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
                browserPreviewToolInput({
                  command: "npm run dev",
                  viewports: TEST_BROWSER_PREVIEW_VIEWPORTS,
                  url: "http://127.0.0.1:9/",
                  timeout: 500,
                  leaseTimeout: 1_500,
                }),
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
                browserPreviewToolInput({
                  command: `npx vite --host 127.0.0.1 --port ${url.port}`,
                  viewports: TEST_BROWSER_PREVIEW_VIEWPORTS,
                  timeout: 20,
                  leaseTimeout: 200,
                }),
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
            await persistTestBrowserPreviewTarget({ taskID, url: stalePreview.url })
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
                browserPreviewToolInput({
                  command: `npx vite --host 127.0.0.1 --port ${commandUrl.port}`,
                  viewports: TEST_BROWSER_PREVIEW_VIEWPORTS,
                  timeout: 20,
                  leaseTimeout: 200,
                }),
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
                browserPreviewToolInput({
                  command: "npm run dev",
                  viewports: TEST_BROWSER_PREVIEW_VIEWPORTS,
                  url: "file:///tmp/index.html",
                  timeout: 20,
                  leaseTimeout: 200,
                }),
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
              browserPreviewToolInput({
                command: "npm run dev",
                viewports: TEST_BROWSER_PREVIEW_VIEWPORTS,
                timeout: 20,
                leaseTimeout: 200,
              }),
              baseCtx,
            ),
          ).rejects.toThrow("requires a task context")
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
          try {
            await findReadableBrowserPreviewEvidenceByID({
              projectRoot: tmp.path,
              taskID,
              evidenceID: "art_missing_operation_kind",
            })
            throw new Error("Expected browser preview evidence corruption")
          } catch (error) {
            expect(BrowserPreviewEvidenceCorruptionError.isInstance(error)).toBe(true)
          }
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
          const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:4173/" })
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
    "browser preview evidence writer rejects passed reference comparisons without crop intent",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const artifactDir = ProjectRuntimePaths.taskAbsolute(tmp.path, taskID, "bp", "missing-crop-intent")
          await fs.mkdir(artifactDir, { recursive: true })
          const sourcePath = path.join(artifactDir, "source.png")
          const implementationPath = path.join(artifactDir, "implementation.png")
          const sideBySidePath = path.join(artifactDir, "side-by-side.png")
          await fs.writeFile(sourcePath, "source")
          await fs.writeFile(implementationPath, "implementation")
          await fs.writeFile(sideBySidePath, "side-by-side")
          const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:4173/" })
          expect(() =>
            persistBrowserPreviewEvidence({
              projectRoot: tmp.path,
              taskID,
              targetID: target.id,
              viewportID: "desktop",
              operationKind: "reference-comparison",
              regionID: "region_header",
              status: "passed",
              summary: "Missing crop intent should throw.",
              artifactPaths: {
                source_crop: sourcePath,
                implementation_crop: implementationPath,
                side_by_side: sideBySidePath,
              },
              diagnostics: [],
            }),
          ).toThrow("cropIntent")
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
          const target = await persistTestBrowserPreviewTarget({ taskID, url: "http://127.0.0.1:4173/" })
          expect(() =>
            persistBrowserPreviewEvidence({
              projectRoot: tmp.path,
              taskID,
              targetID: target.id,
              viewportID: "desktop",
              operationKind: "reference-comparison",
              regionID: "region_header",
              cropIntent: "full-region",
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

  test(
    "reference regions tool binds a local module and returns one module comparison attachment",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const paths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
      await writeBindingToolReference(paths.sourcePackageAbsolute)
      const server = await startBindingToolPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () =>
            persistTestBrowserPreviewTarget({ taskID, url: server.url, viewports: BINDING_TOOL_TEST_VIEWPORTS }),
        })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const tool = await BrowserPreviewReferenceRegionsTool.init()
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
            const payload = JSON.parse(result.output)
            const bindingEvidenceID = result.metadata.bindingEvidenceID
            const bindingEvidence = await findReadableBrowserPreviewEvidenceByID({
              projectRoot: tmp.path,
              taskID,
              evidenceID: bindingEvidenceID,
            })

            expect(result.title).toBe("Reference module binding completed")
            expect(result.attachments).toHaveLength(1)
            expect(result.metadata.status).toBe("passed")
            expect(result.metadata.operation).toBe("bind_local_module")
            expect(result.metadata.moduleBindingProof).toBe(true)
            expect(result.metadata).not.toHaveProperty("comparisonEvidenceIDs")
            expect(result.metadata).not.toHaveProperty("referenceComparisonProof")
            expect(bindingEvidence?.operationKind).toBe("source-binding")
            expect(bindingEvidence?.status).toBe("passed")
            expect(payload.sourceBinding.binding.region_id).toBe("tool-local-module")
            expect(payload.sourceBinding.binding.source.bbox).toEqual({ x: 24, y: 30, width: 180, height: 92 })
            expect(payload).not.toHaveProperty("referenceComparison")
            const artifacts = payload.sourceBinding.artifacts
            expect(bindingEvidence?.artifactPaths?.source_crop).toBe(artifacts.source_crop)
            expect(bindingEvidence?.artifactPaths?.implementation_crop).toBe(artifacts.implementation_crop)
            expect(bindingEvidence?.artifactPaths?.side_by_side).toBe(artifacts.module_comparison)

            const sourceCropPath = resolveRuntimeRelativePath(tmp.path, artifacts.source_crop)
            const implementationCropPath = resolveRuntimeRelativePath(tmp.path, artifacts.implementation_crop)
            const moduleComparisonPath = resolveRuntimeRelativePath(tmp.path, artifacts.module_comparison)
            expect(await fileExists(sourceCropPath)).toBe(true)
            expect(await fileExists(implementationCropPath)).toBe(true)
            expect(await fileExists(moduleComparisonPath)).toBe(true)
            const sourceDimensions = { width: 180, height: 92 }
            const implementationDimensions = { width: 180, height: 92 }
            await expectPngDimensions(sourceCropPath, sourceDimensions)
            await expectPngDimensions(implementationCropPath, implementationDimensions)
            await expectPngDimensions(moduleComparisonPath, {
              width: 640,
              height: 96 + 38 + Math.max(sourceDimensions.height, implementationDimensions.height) + 20,
            })
            await expectPngHasColorDiversity(sourceCropPath)
            await expectPngHasColorDiversity(implementationCropPath)
            await expectPngHasColorDiversity(moduleComparisonPath)
          },
        })
      } finally {
        await server.close()
      }
    },
    { timeout: 60_000 },
  )

  test(
    "reference regions tool reports binding failure without fallback attachments",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      const server = await startBindingToolPreviewServer()
      try {
        const target = await Instance.provide({
          directory: tmp.path,
          fn: () =>
            persistTestBrowserPreviewTarget({ taskID, url: server.url, viewports: BINDING_TOOL_TEST_VIEWPORTS }),
        })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const tool = await BrowserPreviewReferenceRegionsTool.init()
            const result = await tool.execute(
              {
                targetID: target.id,
                viewportID: "desktop",
                regionID: "missing-local-module",
                route: "/",
                implementationLocator: { kind: "data-oc-region", value: "missing-local-module" },
                componentFiles: ["src/MissingLocalModule.tsx"],
                sourceReferenceArtifactID: "reference.png",
                textAnchors: ["Missing Local Module"],
              },
              { ...baseCtx, extra: { taskID } },
            )
            const payload = JSON.parse(result.output)

            expect(result.title).toBe("Reference module binding failed")
            expect(result.attachments).toHaveLength(0)
            expect(result.metadata.status).toBe("failed")
            expect(result.metadata.operation).toBe("bind_local_module")
            expect(result.metadata.moduleBindingProof).toBe(false)
            expect(result.metadata.attachmentCount).toBe(0)
            expect(result.metadata.reason).toEqual(expect.any(String))
            expect(result.metadata).not.toHaveProperty("bindingEvidenceID")
            expect(result.metadata).not.toHaveProperty("comparisonEvidenceIDs")
            expect(result.metadata).not.toHaveProperty("referenceComparisonProof")
            expect(payload.status).toBe("failed")
            expect(payload.reason).toEqual(expect.any(String))
            expect(payload).not.toHaveProperty("sourceBinding")
            expect(payload).not.toHaveProperty("referenceComparison")
          },
        })
      } finally {
        await server.close()
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
