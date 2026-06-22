import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import {
  extractBrowserPreviewUrlFromText,
  extractBrowserPreviewUrlsFromText,
  persistBrowserPreviewUrls,
} from "../../src/browser-preview/extract"
import { findRecentBrowserPreviewTargets, persistBrowserPreviewTarget } from "../../src/browser-preview/persist"
import { normalizeBrowserPreviewUrl, resolveBrowserPreviewTarget } from "../../src/browser-preview/target"
import { Tool } from "../../src/tool/tool"
import { Instance } from "../../src/project/instance"
import { ProtocolStore } from "../../src/protocol/store"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const BROWSER_PREVIEW_TARGET_TEST_TIMEOUT_MILLISECONDS = 60_000

async function writePackageJson(root: string, value: unknown) {
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify(value, null, 2))
}

describe("browser preview target resolver", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  async function seedTask(directory: string) {
    const taskID = `tsk_browserpreviewtarget${Date.now()}`
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

  test(
    "uses the task artifact target as the only resolved URL source",
    async () => {
      await using tmp = await tmpdir()
      await writePackageJson(tmp.path, {
        opencorvus: {
          browserPreview: {
            url: "http://127.0.0.1:4173/",
            command: "npm run dev",
          },
        },
      })
      const taskID = await seedTask(tmp.path)
      const persisted = await persistBrowserPreviewTarget({
        taskID,
        url: "http://127.0.0.1:5173/task",
      })

      const target = await resolveBrowserPreviewTarget({
        projectRoot: tmp.path,
        taskID,
        isVisible: async () => true,
      })

      expect(target.id).toBe(persisted.id)
      expect(target.kind).toBe("task-url")
      expect(target.status).toBe("ready")
      expect(target.source).toBe("task-artifact")
      expect(target.url).toBe("http://127.0.0.1:5173/task")
      expect(target.candidates).toEqual([
        {
          id: persisted.id,
          url: "http://127.0.0.1:5173/task",
          source: "task-artifact",
          selected: true,
          timeUpdated: persisted.timeUpdated,
        },
      ])
      expect(target.viewports.map((viewport) => viewport.id)).toEqual(["desktop", "tablet", "mobile"])
    },
    { timeout: BROWSER_PREVIEW_TARGET_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "duplicate preview target saves reuse one artifact and promote by update time",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const first = await persistBrowserPreviewTarget({
        taskID,
        url: "http://127.0.0.1:5173/task",
        now: 100,
      })
      const second = await persistBrowserPreviewTarget({
        taskID,
        url: "http://127.0.0.1:5173/task",
        now: 100,
      })

      expect(second.id).toBe(first.id)
      expect(second.timeUpdated).toBeGreaterThan(first.timeUpdated)
      expect(findRecentBrowserPreviewTargets(taskID).map((target) => target.id)).toEqual([first.id])
    },
    { timeout: BROWSER_PREVIEW_TARGET_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "reports saved unreachable preview targets as failed instead of missing",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const persisted = await persistBrowserPreviewTarget({
        taskID,
        url: "http://127.0.0.1:5173/task",
        now: 100,
      })

      const target = await resolveBrowserPreviewTarget({
        projectRoot: tmp.path,
        taskID,
        isVisible: async () => false,
      })

      expect(target.id).toBe(persisted.id)
      expect(target.kind).toBe("failed")
      expect(target.status).toBe("failed")
      expect(target.source).toBe("task-artifact")
      expect(target.url).toBe("http://127.0.0.1:5173/task")
      expect(target.candidates).toEqual([
        {
          id: persisted.id,
          url: "http://127.0.0.1:5173/task",
          source: "task-artifact",
          selected: true,
          timeUpdated: persisted.timeUpdated,
        },
      ])
      expect(target.diagnostics.join("\n")).toContain("Saved browser preview target is unreachable")
    },
    { timeout: BROWSER_PREVIEW_TARGET_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "does not replace the selected preview target with another reachable candidate",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      const reachable = await persistBrowserPreviewTarget({
        taskID,
        url: "http://127.0.0.1:5173/reachable",
        now: 100,
      })
      const unreachable = await persistBrowserPreviewTarget({
        taskID,
        url: "http://127.0.0.1:5174/unreachable",
        now: 200,
      })
      const probedUrls: string[] = []

      const target = await resolveBrowserPreviewTarget({
        projectRoot: tmp.path,
        taskID,
        isVisible: async (url) => {
          probedUrls.push(url)
          return url === reachable.url
        },
      })

      expect(target.id).toBe(unreachable.id)
      expect(target.status).toBe("failed")
      expect(target.url).toBe(unreachable.url)
      expect(target.candidates.map((candidate) => ({ id: candidate.id, selected: candidate.selected }))).toEqual([
        { id: unreachable.id, selected: true },
        { id: reachable.id, selected: false },
      ])
      expect(target.diagnostics.join("\n")).toContain(unreachable.url)
      expect(target.diagnostics.join("\n")).not.toContain(reachable.url)
      expect(probedUrls).toEqual([unreachable.url])
    },
    { timeout: BROWSER_PREVIEW_TARGET_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "probes only the selected preview target while keeping older candidates visible",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      for (let index = 0; index < 12; index += 1) {
        await persistBrowserPreviewTarget({
          taskID,
          url: `http://127.0.0.1:${5200 + index}/candidate-${index}`,
          now: 100 + index,
        })
      }
      const selected = findRecentBrowserPreviewTargets(taskID)[0]!
      const probedUrls: string[] = []

      const target = await resolveBrowserPreviewTarget({
        projectRoot: tmp.path,
        taskID,
        isVisible: async (url) => {
          probedUrls.push(url)
          return true
        },
      })

      expect(target.status).toBe("ready")
      expect(target.id).toBe(selected.id)
      expect(target.candidates).toHaveLength(12)
      expect(target.candidates[0]).toMatchObject({ id: selected.id, selected: true })
      expect(probedUrls).toEqual([selected.url])
    },
    { timeout: BROWSER_PREVIEW_TARGET_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "generic tool output does not materialize browser preview candidates",
    async () => {
      await using tmp = await tmpdir()
      const preview = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          return new Response("<!doctype html><title>Preview</title>", {
            headers: { "content-type": "text/html" },
          })
        },
      })
      const taskID = await seedTask(tmp.path)
      try {
        const previewUrl = `http://127.0.0.1:${preview.port}/`
        const info = await Tool.define("fixture_preview_output", {
          description: "Fixture preview output",
          parameters: z.object({}),
          async execute() {
            return {
              title: "fixture",
              metadata: {},
              output: `dev server ready at ${previewUrl}`,
            }
          },
        }).init()

        await info.execute(
          {},
          {
            sessionID: "ses_preview_fixture",
            messageID: "msg_preview_fixture",
            agent: "build",
            abort: AbortSignal.any([]),
            extra: { taskID },
            messages: [],
            metadata() {},
            async ask() {},
          },
        )

        expect(findRecentBrowserPreviewTargets(taskID).map((target) => target.url)).toEqual([])
      } finally {
        preview.stop(true)
      }
    },
    { timeout: BROWSER_PREVIEW_TARGET_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "explicit preview URL persistence materializes a task preview target",
    async () => {
      await using tmp = await tmpdir()
      const preview = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          return new Response("<!doctype html><title>Browser MCP Preview</title>", {
            headers: { "content-type": "text/html" },
          })
        },
      })
      const taskID = await seedTask(tmp.path)
      try {
        const previewUrl = `http://127.0.0.1:${preview.port}/world-economy/`

        await persistBrowserPreviewUrls({
          taskID,
          urls: [previewUrl],
        })

        expect(findRecentBrowserPreviewTargets(taskID).map((target) => target.url)).toEqual([previewUrl])
      } finally {
        preview.stop(true)
      }
    },
    { timeout: BROWSER_PREVIEW_TARGET_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "explicit preview URL persistence retries a URL after an unreachable probe",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)
      let probeCount = 0
      const input = {
        taskID,
        urls: ["http://127.0.0.1:5173/app"],
        probe: async () => ++probeCount >= 2,
      }

      expect(await persistBrowserPreviewUrls(input)).toEqual([])
      const persisted = await persistBrowserPreviewUrls(input)

      expect(probeCount).toBe(2)
      expect(persisted.map((target) => target.url)).toEqual(["http://127.0.0.1:5173/app"])
      expect(findRecentBrowserPreviewTargets(taskID).map((target) => target.url)).toEqual([
        "http://127.0.0.1:5173/app",
      ])
    },
    { timeout: BROWSER_PREVIEW_TARGET_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "persisting a preview target emits a task update event for overlay refresh",
    async () => {
      await using tmp = await tmpdir()
      const taskID = await seedTask(tmp.path)

      await persistBrowserPreviewTarget({
        taskID,
        url: "http://127.0.0.1:5173/task",
      })

      const events = ProtocolStore.listTaskEvents(taskID)
      const event = events.find((item) => item.type === "task.updated" && item.source === "browser-preview.target")
      expect(event?.payload?.summary).toBe("Browser preview target updated")
      expect(event?.payload?.taskID).toBe(taskID)
    },
    { timeout: BROWSER_PREVIEW_TARGET_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "does not resolve package metadata when the task has no saved target",
    async () => {
      await using tmp = await tmpdir()
      await writePackageJson(tmp.path, {
        packageManager: "npm@10.9.0",
        scripts: { dev: "vite --host 127.0.0.1" },
        opencorvus: {
          browserPreview: {
            url: "http://localhost:4173/",
            command: "npm run dev",
          },
        },
      })
      const taskID = await seedTask(tmp.path)

      const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path, taskID })

      expect(target.status).toBe("missing")
      expect(target.kind).toBe("missing")
      expect(target.url).toBeUndefined()
      expect(target.source).toBe("none")
      expect(target.diagnostics.join("\n")).toContain("No browser preview target saved for this task")
    },
    { timeout: BROWSER_PREVIEW_TARGET_TEST_TIMEOUT_MILLISECONDS },
  )

  test(
    "does not parse package.json when resolving a missing task target",
    async () => {
      await using tmp = await tmpdir()
      await fs.writeFile(path.join(tmp.path, "package.json"), "{")
      const taskID = await seedTask(tmp.path)

      const target = await resolveBrowserPreviewTarget({ projectRoot: tmp.path, taskID })

      expect(target.status).toBe("missing")
      expect(target.kind).toBe("missing")
      expect(target.source).toBe("none")
      expect(target.diagnostics.join("\n")).toContain("No browser preview target saved for this task")
    },
    { timeout: BROWSER_PREVIEW_TARGET_TEST_TIMEOUT_MILLISECONDS },
  )

  test("normalizes explicit http(s) URLs and loopback host-port text before saving task targets", () => {
    expect(normalizeBrowserPreviewUrl(" http://127.0.0.1:5173/dashboard ")).toBe("http://127.0.0.1:5173/dashboard")
    expect(normalizeBrowserPreviewUrl("localhost:5173")).toBe("http://localhost:5173/")
    expect(normalizeBrowserPreviewUrl("127.0.0.1:5173/dashboard")).toBe("http://127.0.0.1:5173/dashboard")
    expect(normalizeBrowserPreviewUrl("[::1]:5173")).toBe("http://[::1]:5173/")
    expect(normalizeBrowserPreviewUrl("https://example.test/")).toBe("https://example.test/")
    expect(normalizeBrowserPreviewUrl("file:///tmp/index.html")).toBeUndefined()
    expect(normalizeBrowserPreviewUrl("example.test:5173")).toBeUndefined()
    expect(normalizeBrowserPreviewUrl("")).toBeUndefined()
  })

  test("extracts a loopback preview URL from process output", () => {
    const output = [
      "  VITE v6.0.0 ready in 120 ms",
      "  ➜  Local:   http://localhost:5173/",
      "  docs: https://vite.dev/",
    ].join("\n")

    expect(extractBrowserPreviewUrlFromText(output)).toBe("http://localhost:5173/")
  })

  test("extracts multiple loopback preview URLs from process output", () => {
    const output = [
      "  Local:   localhost:5173",
      "  Network: http://127.0.0.1:5174/dashboard",
      "  docs: https://vite.dev/",
      "  Local:   http://localhost:5173/",
    ].join("\n")

    expect(extractBrowserPreviewUrlsFromText(output)).toEqual([
      "http://localhost:5173/",
      "http://127.0.0.1:5174/dashboard",
    ])
  })

  test("extracts an IPv6 loopback preview URL from process output", () => {
    expect(extractBrowserPreviewUrlFromText("Local: http://[::1]:5173/")).toBe("http://[::1]:5173/")
  })
})
