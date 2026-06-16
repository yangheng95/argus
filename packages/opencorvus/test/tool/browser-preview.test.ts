import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import { PassThrough } from "node:stream"
import sharp from "sharp"
import { BrowserPreviewTool } from "../../src/tool/browser-preview"
import { BrowserPreviewBindLocalModuleTool } from "../../src/tool/browser-preview-bind-local-module"
import { BrowserPreviewCompareRegionsTool } from "../../src/tool/browser-preview-compare-regions"
import { ToolRegistry } from "../../src/tool/registry"
import { ProcessSupervisor } from "../../src/shell/process-supervisor"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import {
  findLatestBrowserPreviewTarget,
  latestBrowserPreviewEvidenceID,
  persistBrowserPreviewTarget,
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

async function seedTask(directory: string) {
  const taskID = `tsk_browserpreviewtool${Date.now()}`
  await Instance.provide({
    directory,
    fn: () => {
      const time = Date.now()
      const sessionID = `${taskID}_root`
      Database.use((db) =>
        db.transaction((tx) => {
          tx.insert(SessionTable)
            .values({
              id: sessionID,
              project_id: Instance.project.id,
              slug: taskID,
              directory,
              title: "Preview task",
              version: "test",
              kind: "root",
              time_created: time,
              time_updated: time,
            })
            .run()
          tx.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: sessionID,
              title: "Preview task",
              request: "Preview task",
              source: "api",
              time_created: time,
              time_updated: time,
            })
            .run()
        }),
      )
    },
  })
  return taskID
}

async function startModulePreviewServer(input?: { hiddenRegion?: boolean }): Promise<{ url: string; close: () => Promise<void> }> {
  let server: Server | undefined
  server = createServer((req, res) => {
    if (req.url !== "/world-economy") {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(`<!doctype html>
      <html>
        <head>
          <title>World economy preview</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #f7f8fa; }
            main { padding: 40px; }
            [data-oc-region="economic-calendar"] {
              ${input?.hiddenRegion ? "display: none;" : ""}
              width: 360px;
              min-height: 150px;
              background: #ffffff;
              border: 1px solid #d7dde5;
              border-radius: 8px;
              padding: 20px;
              box-sizing: border-box;
            }
            h2 { margin: 0 0 16px; font-size: 26px; line-height: 1.1; }
            p { margin: 0; font-size: 16px; color: #4c5a68; }
          </style>
        </head>
        <body>
          <main>
            <section data-oc-region="economic-calendar">
              <h2>Economic calendar</h2>
              <p>GDP, inflation, interest rate, and jobs events</p>
            </section>
          </main>
        </body>
      </html>`)
  })
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("module preview test server did not bind a TCP address")
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve())
        server = undefined
      }),
  }
}

async function writeLocalModuleBindingSourceEvidence(root: string, taskID: string) {
  const designPaths = ProjectRuntimePaths.frontendDesignPaths(root, taskID)
  await fs.mkdir(path.join(designPaths.skeletonProjectAbsolute, "src/data"), { recursive: true })
  await fs.mkdir(designPaths.sourcePackageAbsolute, { recursive: true })
  await sharp({
    create: {
      width: 900,
      height: 700,
      channels: 4,
      background: "#f7f8fa",
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="380" height="170" xmlns="http://www.w3.org/2000/svg">
            <rect width="380" height="170" rx="8" fill="#ffffff" stroke="#d7dde5"/>
            <text x="24" y="56" font-family="Arial" font-size="28" fill="#111827">Economic calendar</text>
            <text x="24" y="98" font-family="Arial" font-size="16" fill="#4c5a68">GDP, inflation, interest rate, and jobs events</text>
          </svg>`,
        ),
        left: 64,
        top: 96,
      },
    ])
    .png()
    .toFile(path.join(designPaths.sourcePackageAbsolute, "reference.png"))
  await fs.writeFile(
    path.join(designPaths.skeletonProjectAbsolute, "src/data/sourceDomRegions.ts"),
    `export const sourceDomRegions = ${JSON.stringify(
      [
        {
          componentName: "EconomicCalendarRegion",
          heading: "Economic calendar",
          textPreview: "GDP, inflation, interest rate, and jobs events",
          sourceBounds: { x: 64, y: 96, width: 380, height: 170 },
          selector: "section:nth-of-type(1)",
        },
      ],
      null,
      2,
    )} as const\n`,
  )
  return designPaths
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
    "bind local module tool requires a persisted target ID",
    async () => {
      await using tmp = await tmpdir({ git: true })
      const taskID = await seedTask(tmp.path)
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tool = await BrowserPreviewBindLocalModuleTool.init()
          await expect(
            tool.execute(
              {
                targetID: "art_previewtarget_missing",
                viewportID: "desktop",
                regionID: "economy",
                route: "/",
                implementationLocator: { kind: "data-oc-region", value: "economy" },
                componentFiles: ["src/Economy.tsx"],
                textAnchors: ["Economy"],
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
    "bind local module tool returns a source-local puzzle image attachment and compare-ready binding",
    async () => {
      const preview = await startModulePreviewServer()
      try {
        await using tmp = await tmpdir({ git: true })
        const taskID = await seedTask(tmp.path)
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const designPaths = ProjectRuntimePaths.frontendDesignPaths(tmp.path, taskID)
            await fs.mkdir(path.join(designPaths.skeletonProjectAbsolute, "src/data"), { recursive: true })
            await fs.mkdir(designPaths.sourcePackageAbsolute, { recursive: true })
            await sharp({
              create: {
                width: 900,
                height: 700,
                channels: 4,
                background: "#f7f8fa",
              },
            })
              .composite([
                {
                  input: Buffer.from(
                    `<svg width="380" height="170" xmlns="http://www.w3.org/2000/svg">
                      <rect width="380" height="170" rx="8" fill="#ffffff" stroke="#d7dde5"/>
                      <text x="24" y="56" font-family="Arial" font-size="28" fill="#111827">Economic calendar</text>
                      <text x="24" y="98" font-family="Arial" font-size="16" fill="#4c5a68">GDP, inflation, interest rate, and jobs events</text>
                    </svg>`,
                  ),
                  left: 64,
                  top: 96,
                },
              ])
              .png()
              .toFile(path.join(designPaths.sourcePackageAbsolute, "reference.png"))
            await fs.writeFile(
              path.join(designPaths.skeletonProjectAbsolute, "src/data/sourceDomRegions.ts"),
              `export const sourceDomRegions = ${JSON.stringify(
                [
                  {
                    componentName: "EconomicCalendarRegion",
                    heading: "Economic calendar",
                    textPreview: "GDP, inflation, interest rate, and jobs events",
                    sourceBounds: { x: 64, y: 96, width: 380, height: 170 },
                    selector: "section:nth-of-type(1)",
                  },
                ],
                null,
                2,
              )} as const\n`,
            )
            const target = await persistBrowserPreviewTarget({ taskID, url: preview.url })
            const tool = await BrowserPreviewBindLocalModuleTool.init()
            const result = await tool.execute(
              {
                targetID: target.id,
                viewportID: "desktop",
                regionID: "economic-calendar",
                route: "/world-economy",
                implementationLocator: { kind: "data-oc-region", value: "economic-calendar" },
                componentFiles: ["src/pages/world-economy/EconomicCalendar.tsx"],
                sourceReferenceArtifactID: "reference.png",
                textAnchors: ["Economic calendar", "GDP", "inflation"],
              },
              { ...baseCtx, extra: { taskID } },
            )
            const payload = JSON.parse(result.output)

            expect(result.attachments).toHaveLength(1)
            expect(result.attachments?.[0]?.mime).toBe("image/png")
            expect(result.attachments?.[0]?.filename).toBe("desktop-economic-calendar-binding-puzzle.png")
            expect(result.metadata.attachmentCount).toBe(1)
            expect(result.metadata.binding.region_id).toBe("economic-calendar")
            expect(result.metadata.binding.source.bbox.width).toBeGreaterThanOrEqual(380)
            expect(result.metadata.binding.implementation.locator).toEqual({
              kind: "data-oc-region",
              value: "economic-calendar",
            })
            expect(payload.nextStep).toContain("pass metadata.binding to browser_preview_compare_regions")
            expect(payload.artifacts.binding_puzzle).toEndWith("binding-puzzle.png")
          },
        })
      } finally {
        await preview.close()
      }
    },
    { timeout: BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "bind local module tool rejects hidden implementation locators before persisting evidence",
    async () => {
      const preview = await startModulePreviewServer({ hiddenRegion: true })
      try {
        await using tmp = await tmpdir({ git: true })
        const taskID = await seedTask(tmp.path)
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            await writeLocalModuleBindingSourceEvidence(tmp.path, taskID)
            const target = await persistBrowserPreviewTarget({ taskID, url: preview.url })
            const tool = await BrowserPreviewBindLocalModuleTool.init()

            await expect(
              tool.execute(
                {
                  targetID: target.id,
                  viewportID: "desktop",
                  regionID: "economic-calendar",
                  route: "/world-economy",
                  implementationLocator: { kind: "data-oc-region", value: "economic-calendar" },
                  componentFiles: ["src/pages/world-economy/EconomicCalendar.tsx"],
                  sourceReferenceArtifactID: "reference.png",
                  textAnchors: ["Economic calendar", "GDP", "inflation"],
                },
                { ...baseCtx, extra: { taskID } },
              ),
            ).rejects.toThrow("Implementation locator matched an element that is not visible.")

            expect(latestBrowserPreviewEvidenceID({ taskID, targetID: target.id })).toBeUndefined()
          },
        })
      } finally {
        await preview.close()
      }
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
    "compare regions tool rejects raw URL and output directory parameters",
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
                url: "http://127.0.0.1:5174/other",
                outDir: ".opencorvus/r/tsk/browser-preview/job",
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
              } as any,
              { ...baseCtx, extra: { taskID } },
            ),
          ).rejects.toThrow("invalid arguments")
        },
      })
    },
    { timeout: BROWSER_PREVIEW_TOOL_TEST_TIMEOUT_MILLISECONDS },
  )
})
