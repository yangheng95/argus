import { afterEach, describe, expect, test } from "bun:test"
import { PassThrough } from "node:stream"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProcessSupervisor } from "../../src/shell/process-supervisor"
import { Session } from "../../src/session"
import { SessionShell } from "../../src/session/shell-exec"
import { findLatestBrowserPreviewTarget } from "../../src/browser-preview/persist"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("SessionShell browser preview target isolation", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("does not persist a reachable task preview target from streamed stdout and stderr", async () => {
    const preview = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response("<!doctype html><title>Preview</title>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      },
    })
    try {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ kind: "root", title: "session shell preview target" })
          const taskID = `tsk_sessionshellpreview${Date.now()}`
          Database.use((db) =>
            db
              .insert(EngineTaskTable)
              .values({
                id: taskID,
                project_id: Instance.project.id,
                session_id: session.id,
                title: "Preview task",
                request: "Preview task",
                source: "api",
                time_created: Date.now(),
                time_updated: Date.now(),
              })
              .run(),
          )

          const previewUrl = `http://127.0.0.1:${preview.port}/session-shell`
          const split = previewUrl.indexOf(`${preview.port}`)
          const restore = ProcessSupervisor.setFactoryForTest(async () => {
            const stdout = new PassThrough()
            const stderr = new PassThrough()
            let resolveExit!: (code: number) => void
            const exited = new Promise<number>((resolve) => {
              resolveExit = resolve
            })
            queueMicrotask(() => {
              stdout.write(`Local: ${previewUrl.slice(0, split)}`)
              stderr.write(`${previewUrl.slice(split)}\n`)
              stdout.end()
              stderr.end()
              setTimeout(() => resolveExit(0), 0)
            })
            return {
              pid: 9020,
              stdin: null,
              stdout,
              stderr,
              exited,
              terminate: async () => {},
              dispose: async () => {},
              unref: () => {},
            }
          })
          try {
            await SessionShell.shell({
              sessionID: session.id,
              agent: "build",
              model: { providerID: "test", modelID: "test-model" },
              command: "npm run dev",
            })
          } finally {
            restore()
          }

          expect(findLatestBrowserPreviewTarget(taskID)).toBeUndefined()
        },
      })
    } finally {
      preview.stop(true)
    }
  }, 10_000)

  test("does not persist a reachable task preview target from frontend command port without URL output", async () => {
    const preview = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response("<!doctype html><title>Preview</title>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      },
    })
    try {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ kind: "root", title: "session shell preview target from port" })
          const taskID = `tsk_sessionshellpreviewport${Date.now()}`
          Database.use((db) =>
            db
              .insert(EngineTaskTable)
              .values({
                id: taskID,
                project_id: Instance.project.id,
                session_id: session.id,
                title: "Preview task",
                request: "Preview task",
                source: "api",
                time_created: Date.now(),
                time_updated: Date.now(),
              })
              .run(),
          )

          const restore = ProcessSupervisor.setFactoryForTest(async () => {
            const stdout = new PassThrough()
            const stderr = new PassThrough()
            let resolveExit!: (code: number) => void
            const exited = new Promise<number>((resolve) => {
              resolveExit = resolve
            })
            queueMicrotask(() => {
              stdout.end()
              stderr.end()
              setTimeout(() => resolveExit(0), 0)
            })
            return {
              pid: 9021,
              stdin: null,
              stdout,
              stderr,
              exited,
              terminate: async () => {},
              dispose: async () => {},
              unref: () => {},
            }
          })
          try {
            await SessionShell.shell({
              sessionID: session.id,
              agent: "build",
              model: { providerID: "test", modelID: "test-model" },
              command: `npx rsbuild dev --port ${preview.port}`,
            })
          } finally {
            restore()
          }

          expect(findLatestBrowserPreviewTarget(taskID)).toBeUndefined()
        },
      })
    } finally {
      preview.stop(true)
    }
  }, 10_000)
})
