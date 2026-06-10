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

describe("SessionShell browser preview target materialization", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("persists a reachable task preview target from streamed stdout and stderr", async () => {
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

          expect(findLatestBrowserPreviewTarget(taskID)?.url).toBe(previewUrl)
        },
      })
    } finally {
      preview.stop(true)
    }
  })
})
