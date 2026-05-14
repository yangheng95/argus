/**
 * /gateway/task/decompose end-to-end shape & isolation tests.
 *
 * Covers QA gaps the existing suite did not pin:
 *
 *   • C — error response carries `Gateway decomposition failed —
 *     <ErrClass>: <≤240 chars>` (post-fix; pre-fix collapsed every
 *     failure to a generic message).
 *   • G — decomposition is a preview: NO engine_task / engine_artifact /
 *     engine_goal / engine_requirement / engine_progress_snapshot rows
 *     are written by the call.
 *   • H — services/task.ts createTask threads the operator-confirmed
 *     priority/executor/title onto POST /task; the persisted task
 *     reflects the proposal selection, not project defaults.
 */
import { afterEach, describe, expect, test, mock, spyOn } from "bun:test"
import { eq } from "drizzle-orm"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { EngineService } from "@/task-api"
import { Database } from "@/storage/db"
import {
  EngineArtifactTable,
  EngineGoalTable,
  EngineRequirementTable,
  EngineTaskTable,
} from "@/engine/engine.sql"
import * as TaskLoop from "../../src/orchestrator/loop"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
  await resetDatabase()
})

describe("Decompose route — error shape (codex round-2 P2 / scenario C)", () => {
  test(
    "model misconfiguration returns 'Gateway decomposition failed — <Class>: <msg>' shape",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const response = await Server.App().request("/gateway/task/decompose", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": tmp.path,
            },
            body: JSON.stringify({ requirement: "shape check on missing model" }),
          })
          // Server-side error shape per PRD §14: prefix + class + message.
          expect(response.status).toBeGreaterThanOrEqual(400)
          const body = await response.text()
          expect(body).toContain("Gateway decomposition failed — ")
          // Class prefix MUST appear so operators can distinguish failure
          // modes (MissingModelConfigError vs ProviderModelNotFoundError vs
          // model-API errors).
          expect(body).toMatch(/Gateway decomposition failed — \w+Error: /)
          // No raw V8 stack frames in the response.
          expect(body).not.toMatch(/\bat\s+\S+\s+\([^)]+:\d+:\d+\)/)
        },
      })
    },
    { timeout: 30_000 },
  )

  test(
    "error message is truncated to 240 chars + ellipsis (no leaked stack traces)",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Force the decompose helper to surface a deliberately huge
          // error. resolveAgentModel is the first failure point that
          // could carry an unbounded message — patching its return path
          // via spyOn covers the route's `catch` body without needing
          // mock.module on the named-import boundary.
          const AgentModel = await import("@/agent/model")
          const long = "x".repeat(1000)
          spyOn(AgentModel, "resolveAgentModel").mockImplementation(async () => {
            const err = new Error(long)
            err.name = "OversizedDiagnosticError"
            throw err
          })

          const response = await Server.App().request("/gateway/task/decompose", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": tmp.path,
            },
            body: JSON.stringify({ requirement: "force large error" }),
          })

          expect(response.status).toBeGreaterThanOrEqual(400)
          const body = await response.text()
          // Truncation guard ⇒ ellipsis present, original 1000-char
          // payload is NOT echoed in full. The class prefix is preserved
          // so the operator still sees what failed.
          expect(body).toContain("OversizedDiagnosticError")
          expect(body).toContain("…")
          expect(body).not.toContain(long)
          expect(body.length).toBeLessThan(1024)
        },
      })
    },
    { timeout: 30_000 },
  )
})

describe("Decompose route — zero persistence (scenario G)", () => {
  test(
    "a decompose call writes zero rows to engine_task / engine_artifact / engine_goal / engine_requirement",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Snapshot row counts before the call.
          const counts = (): {
            tasks: number
            artifacts: number
            goals: number
            requirements: number
          } =>
            Database.use((db) => ({
              tasks: db.select().from(EngineTaskTable).all().length,
              artifacts: db.select().from(EngineArtifactTable).all().length,
              goals: db.select().from(EngineGoalTable).all().length,
              requirements: db.select().from(EngineRequirementTable).all().length,
            }))
          const before = counts()

          const response = await Server.App().request("/gateway/task/decompose", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": tmp.path,
            },
            body: JSON.stringify({ requirement: "Decomposition is a preview only." }),
          })

          // Response may be 200 (model resolved, real LLM call) or 4xx/5xx
          // (no model, network error). In NEITHER case may any engine row
          // have been written — the PRD is explicit (§17.7, §17.15).
          const after = counts()
          expect(after.tasks).toBe(before.tasks)
          expect(after.artifacts).toBe(before.artifacts)
          expect(after.goals).toBe(before.goals)
          expect(after.requirements).toBe(before.requirements)
          // Sanity — assertion ran (the preview happened, in some form).
          expect(typeof response.status).toBe("number")
        },
      })
    },
    { timeout: 60_000 },
  )
})

describe("Task create routing — services/task.ts → POST /task threading (scenario H)", () => {
  test("POST /task priority + executor land on engine_task (codex round-1 P2)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        const response = await Server.App().request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            request: "decompose-derived task",
            executor: "codex",
            priority: "critical",
            kind: "workflow",
            queue: false,
            metadata: { source: "gateway:decompose:test" },
          }),
        })
        expect(response.status).toBe(202)
        const accepted = (await response.json()) as { task_id: string }

        // Read straight from the SQL row — the public Task DTO does not
        // surface `executor` (it's an engine-internal field), but the
        // overlay's createTask MUST persist it correctly so the queue
        // / orchestrator routes the work to the right runner.
        const row = Database.use((db) =>
          db
            .select({
              executor: EngineTaskTable.executor,
              priority: EngineTaskTable.priority,
              kind: EngineTaskTable.kind,
            })
            .from(EngineTaskTable)
            .where(eq(EngineTaskTable.id, accepted.task_id))
            .get(),
        )
        expect(row).toBeDefined()
        expect(row!.executor).toBe("codex")
        expect(row!.priority).toBe("critical")
        expect(row!.kind).toBe("workflow")

        await EngineService.deleteTask(accepted.task_id).catch(() => undefined)
      },
    })
  })

  test("POST /task without explicit executor falls back to project default (single source)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(TaskLoop, "runTaskLoop").mockResolvedValue(undefined)

        const response = await Server.App().request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            request: "no-executor task",
            kind: "workflow",
            queue: false,
            metadata: { source: "gateway:test" },
          }),
        })
        expect(response.status).toBe(202)
        const accepted = (await response.json()) as { task_id: string }
        const row = Database.use((db) =>
          db
            .select({ executor: EngineTaskTable.executor, priority: EngineTaskTable.priority })
            .from(EngineTaskTable)
            .where(eq(EngineTaskTable.id, accepted.task_id))
            .get(),
        )
        // Server default ("mirrorcode") and "normal" priority — proves
        // the overlay's optional executor / priority threading isn't
        // accidentally injecting nulls when the operator omits them.
        expect(row!.executor).toBe("mirrorcode")
        expect(row!.priority).toBe("normal")
        await EngineService.deleteTask(accepted.task_id).catch(() => undefined)
      },
    })
  })
})
