/**
 * Real-LLM smoke test for the phase-5-b-2 BuildAgent.
 *
 * Gated by OPENCORVUS_RUN_LIVE_E2E=1 / OPENCORVUS_RUN_BUILD_SMOKE=1 so normal
 * `bun test` skips it. Invoked explicitly the test spins up a temp git repo,
 * drives BuildAgent.run with a trivial request, and asserts the returned
 * BuildResult matches the contract shape (status, commit_ref when passed,
 * tests[] is an array, etc.).
 */
import { afterAll, describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Server } from "../../src/server/server"
import { BuildAgent } from "../../src/build/agent"
import { loadBenchmarkEnv, resolveBenchmarkModel } from "../../script/benchmark/env"
import { tmpdir } from "../fixture/fixture"
import { Database } from "../../src/storage/db"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { findTask } from "../../src/engine/store"

await loadBenchmarkEnv(import.meta.dir)

const RUN_LIVE =
  process.env.OPENCORVUS_RUN_LIVE_E2E === "1" ||
  process.env.OPENCORVUS_RUN_LIVE_E2E === "true" ||
  process.env.OPENCORVUS_RUN_BUILD_SMOKE === "1"

let _liveServer: ReturnType<typeof Server.listen> | undefined
if (RUN_LIVE) {
  _liveServer = Server.listen({ port: 0, hostname: "127.0.0.1" })
}

let liveModel: string | undefined
if (RUN_LIVE) {
  liveModel = await resolveBenchmarkModel(import.meta.dir, {
    explicitKeys: ["OPENCORVUS_BUILD_TEST_MODEL", "OPENCORVUS_E2E_MODEL"],
  }).catch((err) => {
    console.warn(`[build-agent smoke] resolveBenchmarkModel failed: ${String(err)}`)
    return undefined
  })
}

const HAS_LIVE =
  RUN_LIVE &&
  !!liveModel &&
  (await (async () => {
    try {
      const parsed = Provider.parseModel(liveModel!)
      return await Instance.provide({
        directory: path.resolve(import.meta.dir, "../.."),
        fn: async () => {
          const resolved = await Provider.getModel(parsed.providerID, parsed.modelID)
          await Provider.getLanguage(resolved)
          return true
        },
      })
    } catch (err) {
      console.warn(`[build-agent smoke] model unavailable for ${liveModel}: ${String(err)}`)
      return false
    }
  })())

const liveTest = HAS_LIVE ? test : test.skip

afterAll(() => {
  _liveServer?.stop?.(true)
})

describe("BuildAgent.run (real-LLM smoke)", () => {
  liveTest(
    "executes a trivial request in a temp git repo and returns a valid BuildResult",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Seed a fake task so AgentSemaphore has something to gate on.
          const taskID = `task_build_smoke_${Date.now()}`
          const now = Date.now()
          Database.use((db) =>
            db
              .insert(EngineTaskTable)
              .values({
                id: taskID,
                project_id: Instance.project.id,
                source: "test",
                title: "build smoke",
                request: "add README",
                priority: "normal",
                budget: { max_executor_groups: 1 } as any,
                time_created: now,
                time_updated: now,
                time_started: now,
              })
              .run(),
          )
          const task = findTask(taskID)
          expect(task).toBeTruthy()

          const parsed = Provider.parseModel(liveModel!)
          const { result, sessionID, worktreeDir } = await BuildAgent.run({
            task: task!,
            target: {
              kind: "request",
              text: "Create a file named HELLO.md with the single line 'hello from build smoke'. No tests required. Commit and report.",
            },
            model: { providerID: parsed.providerID, modelID: parsed.modelID },
          })

          expect(sessionID).toBeTruthy()
          expect(typeof worktreeDir === "string" || worktreeDir === undefined).toBe(true)
          expect(["passed", "failed"]).toContain(result.status)
          expect(result.summary.length).toBeGreaterThan(0)
          expect(Array.isArray(result.tests)).toBe(true)
          // When the agent reports passed, it MUST have produced a commit.
          if (result.status === "passed") {
            expect(typeof result.commit_ref).toBe("string")
            expect((result.commit_ref ?? "").length).toBeGreaterThan(0)
          }
        },
      })
    },
    600_000,
  )
})
