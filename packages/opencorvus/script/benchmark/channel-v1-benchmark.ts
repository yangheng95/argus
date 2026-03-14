#!/usr/bin/env bun

import { mock, spyOn } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as GuiScreenshot from "../../src/gui/screenshot"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { parseSSE } from "../../src/control-plane/sse"
import { type ExecutorAdapter } from "../../src/executor/compat"
import { ExecutorRegistry } from "../../src/executor/registry"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Identifier } from "../../src/id/id"
import { Event as OrchestratorEvent } from "../../src/orchestrator/model"
import { OrchestratorInteractionRequestTable, OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { OrchestratorService } from "../../src/orchestrator/service"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SpecService } from "../../src/spec/service"
import { PlannerService } from "../../src/planner/service"
import { Database, eq } from "../../src/storage/db"
import { SessionSummary } from "../../src/session/summary"
import { Log } from "../../src/util/log"
import { installControlModel } from "../../test/control-plane/mock-control-model"
import { resetDatabase } from "../../test/fixture/db"
import { loadBenchmarkEnv } from "./env"

Log.init({ print: true })

await loadBenchmarkEnv(import.meta.dir)

const report = process.argv.find((item) => item.startsWith("--report="))?.slice("--report=".length)
const keep = process.argv.includes("--keep")

const stamp = Date.now().toString(36)
const root = {
  platform: "discord" as const,
  channel: `benchmark-room-${stamp}`,
  thread: `benchmark-thread-${stamp}`,
}

const temp = {
  config: "",
  dir: "",
}

const steps: Array<{
  name: string
  ok: boolean
  duration_ms: number
  detail?: Record<string, unknown>
  error?: string
}> = []

let taskID = ""
let selectedTaskID = ""

try {
  temp.config = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-channel-benchmark-config-"))
  temp.dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-channel-benchmark-project-"))
process.env.OPENCORVUS_CONFIG_DIR = temp.config
process.env.OPENCORVUS_DISABLE_DEFAULT_PLUGINS = "1"

  await resetDatabase()
  Config.global.reset()
  ExecutorRegistry.reset()
  spyOn(SessionSummary, "summarize").mockResolvedValue(undefined as never)
  stub()
  installControlModel()
  spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
    sessionID,
    queueTaskID: Identifier.ascending("task"),
  }))
  spyOn(OpencodeExecutor, "status").mockResolvedValue({
    queueTaskID: Identifier.ascending("task"),
    status: "running",
    error: null,
  })
  spyOn(GuiScreenshot, "captureWindowScreenshot").mockResolvedValue({
    mime: "image/png",
    filename: "opencorvus-gui.png",
    url: `data:image/png;base64,${Buffer.from("hello").toString("base64")}`,
    title: "OpenCorvus",
    app: "OpenCorvus",
    width: 1280,
    height: 720,
  })
  const resolved: Array<{ kind: string; requestID: string }> = []
  const codex: ExecutorAdapter = {
    capabilities() {
      return {
        submit: true,
        status: true,
        abort: true,
        delivery: true,
        resume: true,
        events: true,
      }
    },
    async submit(input) {
      return {
        sessionID: input.sessionID,
        queueTaskID: Identifier.ascending("task"),
      }
    },
    async status(queueTaskID) {
      return {
        queueTaskID,
        status: "queued",
        error: null,
      }
    },
    async abort() {
      return true
    },
    async delivery() {
      return {
        summary: "done",
        diffs: [],
      }
    },
    async resume(input) {
      return this.submit({
        sessionID: input.sessionID,
        prompt: input.message,
        priority: input.priority,
      })
    },
    async *events() {},
    async resolve(input) {
      resolved.push({
        kind: input.kind,
        requestID: input.requestID,
      })
      return true
    },
  }
  ExecutorRegistry.register("codex", codex)

  await Instance.provide({
    directory: temp.dir,
    async fn() {
      const app = Server.App()
      const call = (input: Record<string, unknown>) =>
        app.request("/channel/v1/ingress", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": temp.dir,
          },
          body: JSON.stringify({
            type: "channel_ingress",
            version: "channel.v1",
            ...input,
          }),
        })
      const get = (url: string, init?: RequestInit) =>
        app.request(url, {
          headers: {
            "x-opencorvus-directory": temp.dir,
          },
          ...init,
        })

      await run("create_task", async () => {
        const res = await call({
          request_id: "bench-create",
          ...root,
          user: { id: "bench-user" },
          message: {
            text: "Create a task to benchmark the channel.v1 protocol flow.",
          },
        })
        const body = await json(res)
        ensure(res.status === 200, `unexpected status ${res.status}`)
        ensure(body.result?.kind === "created", "task was not created")
        ensure(typeof body.result?.task_id === "string", "task_id missing")
        taskID = body.result.task_id
        selectedTaskID = taskID
        return {
          task_id: taskID,
          kind: body.result.kind,
        }
      })

      await run("thread_state", async () => {
        const res = await get(`/channel/v1/thread?platform=${root.platform}&channel=${root.channel}&thread=${root.thread}`)
        const body = await json(res)
        ensure(res.status === 200, `unexpected status ${res.status}`)
        ensure(body.binding?.task_id === taskID, "binding.task_id mismatch")
        ensure(body.board?.task?.id === taskID, "board.task.id mismatch")
        return {
          task_id: body.binding.task_id,
          status: body.board.task.status,
        }
      })

      await run("view_plan", async () => {
        const res = await call({
          request_id: "bench-plan",
          ...root,
          message: {
            text: "view plan",
          },
        })
        const body = await json(res)
        ensure(res.status === 200, `unexpected status ${res.status}`)
        ensure(body.result?.message?.includes("Plan"), "plan summary missing")
        return {
          kind: body.result.kind,
        }
      })

      await run("add_goal", async () => {
        const res = await call({
          request_id: "bench-goal",
          ...root,
          message: {
            text: "/goal add regression coverage",
          },
        })
        const body = await json(res)
        ensure(res.status === 200, `unexpected status ${res.status}`)
        ensure(body.result?.message?.includes("Recorded goal update"), "goal update missing")
        return {
          message: body.result.message,
        }
      })

      await run("add_plan_hint", async () => {
        const res = await call({
          request_id: "bench-plan-hint",
          ...root,
          message: {
            text: "/plan keep the diff small",
          },
        })
        const body = await json(res)
        ensure(res.status === 200, `unexpected status ${res.status}`)
        ensure(body.result?.message?.includes("Plan hint recorded"), "plan hint missing")
        return {
          message: body.result.message,
        }
      })

      await run("list_tasks", async () => {
        const res = await get(`/channel/v1/tasks?platform=${root.platform}&channel=${root.channel}&thread=${root.thread}&limit=10`)
        const body = await json(res)
        ensure(res.status === 200, `unexpected status ${res.status}`)
        ensure(Array.isArray(body.board?.tasks) && body.board.tasks.length > 0, "task list empty")
        ensure(body.binding?.task_id === taskID, "task list binding mismatch")
        return {
          count: body.board.tasks.length,
        }
      })

      await run("select_task", async () => {
        const next = await OrchestratorService.createTask({
          request: "second benchmark task",
          executor: "codex",
          source: "api",
        })
        const res = await app.request("/channel/v1/thread/select", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": temp.dir,
          },
          body: JSON.stringify({
            ...root,
            task_id: next,
          }),
        })
        const body = await json(res)
        ensure(res.status === 200, `unexpected status ${res.status}`)
        ensure(body.binding?.task_id === next, "selected binding mismatch")
        selectedTaskID = next
        return {
          task_id: next,
        }
      })

      await run("screenshot", async () => {
        const res = await call({
          request_id: "bench-screenshot",
          ...root,
          message: {
            text: "send me an OpenCorvus screenshot",
          },
        })
        const body = await json(res)
        ensure(res.status === 200, `unexpected status ${res.status}`)
        ensure(body.result?.attachments?.[0]?.filename === "opencorvus-gui.png", "screenshot attachment missing")
        return {
          filename: body.result.attachments[0].filename,
        }
      })

      await run("reply_permission", async () => {
        const task = Database.use((db) =>
          db
            .select()
            .from(OrchestratorTaskTable)
            .where(eq(OrchestratorTaskTable.id, selectedTaskID))
            .get(),
        )
        ensure(!!task?.session_id, "selected task session missing")
        const now = Date.now()
        const interactionID = Identifier.ascending("interaction")
        Database.use((db) =>
          db.insert(OrchestratorInteractionRequestTable).values({
            id: interactionID,
            task_id: selectedTaskID,
            run_id: task!.active_run_id!,
            session_id: task!.session_id!,
            external_id: "protocol-request-1",
            request_type: "permission",
            status: "pending",
            title: "Permission: bash",
            body: "echo *",
            payload: {
              protocol_request: true,
              request_id: "protocol-request-1",
            },
            time_created: now,
            time_updated: now,
          }).run(),
        )
        const res = await call({
          request_id: "bench-allow",
          ...root,
          metadata: {
            interactionID,
            reply: "once",
          },
          message: {
            text: "allow",
          },
        })
        const body = await json(res)
        ensure(res.status === 200, `unexpected status ${res.status}`)
        ensure(body.result?.kind === "interaction", "interaction reply not recorded")
        ensure(resolved.some((item) => item.kind === "approval" && item.requestID === "protocol-request-1"), "executor resolve missing")
        return {
          kind: body.result.kind,
          resolved: resolved.length,
        }
      })

      await run("events", async () => {
        const stop = new AbortController()
        const res = await get(`/channel/v1/thread/events?platform=${root.platform}&channel=${root.channel}&thread=${root.thread}`, {
          signal: stop.signal,
        })
        ensure(res.status === 200, `unexpected status ${res.status}`)
        ensure(!!res.body, "missing event stream body")
        const seen: unknown[] = []
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("timed out waiting for channel event")), 3000)
            void parseSSE(res.body!, stop.signal, (item) => {
              seen.push(item)
              const next = item as { type?: string; event?: { type?: string } }
              if (next.type === "channel_event" && next.event?.type === "channel.connected") {
                void Bus.publish(OrchestratorEvent.TaskUpdated, {
                  taskID: selectedTaskID,
                  status: "running",
                  summary: "benchmark event",
                }).catch((error) => {
                  clearTimeout(timeout)
                  reject(error)
                })
                return
              }
              if (next.type !== "channel_event" || next.event?.type !== "task.updated") return
              clearTimeout(timeout)
              resolve()
            }).catch((error) => {
              clearTimeout(timeout)
              reject(error)
            })
          })
        } finally {
          stop.abort()
        }
        return {
          seen: seen.length,
        }
      })

      await run("cancel_task", async () => {
        const res = await call({
          request_id: "bench-cancel",
          ...root,
          message: {
            text: "perform cancel",
          },
        })
        const body = await json(res)
        ensure(res.status === 200, `unexpected status ${res.status}`)
        ensure(body.result?.message?.includes("cancel"), "cancel response missing")
        return {
          message: body.result.message,
        }
      })
    },
  })
} catch (error) {
  steps.push({
    name: "benchmark",
    ok: false,
    duration_ms: 0,
    error: error instanceof Error ? error.message : String(error),
  })
} finally {
  const out = {
    generated_at: new Date().toISOString(),
    directory: temp.dir,
    task_id: taskID,
    selected_task_id: selectedTaskID,
    ok: steps.every((item) => item.ok),
    steps,
  }
  const file = report || path.join(process.cwd(), `channel-v1-benchmark-report-${Date.now()}.json`)
  await Bun.write(file, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  console.log(`report: ${file}`)

  mock.restore()
  Config.global.reset()
  await Instance.disposeAll().catch(() => undefined)
  await resetDatabase().catch(() => undefined)
  if (!keep && temp.dir) await fs.rm(temp.dir, { recursive: true, force: true }).catch(() => undefined)
  if (!keep && temp.config) await fs.rm(temp.config, { recursive: true, force: true }).catch(() => undefined)
  if (!steps.every((item) => item.ok)) process.exitCode = 1
}

function stub() {
  spyOn(SpecService, "initial").mockResolvedValue({
    summary: "Implement feature",
    content: "# Scope\n\nImplement feature",
    goals: [
      {
        description: "Implement the requested change",
        criteria: "The requested change is implemented and checks pass.",
        priority: "blocking",
      },
    ],
    assumptions: [],
    risks: [],
    clarifications: [],
    spec_items: [{
      title: "Implement the requested change",
      description: "The requested change is implemented and checks pass.",
      priority: "blocking",
      check_selector: ["spec_check"],
    }],
    evidence_sources: [],
    unresolved_questions: [],
  })
  spyOn(SpecService, "rewrite").mockResolvedValue({
    summary: "Implement feature rewrite",
    content: "# Scope\n\nImplement feature rewrite",
    goals: [
      {
        description: "Implement the requested change",
        criteria: "The requested change is implemented and checks pass.",
        priority: "blocking",
      },
    ],
    assumptions: [],
    risks: [],
    clarifications: [],
    spec_items: [{
      title: "Implement the requested change",
      description: "The requested change is implemented and checks pass.",
      priority: "blocking",
      check_selector: ["spec_check"],
    }],
    evidence_sources: [],
    unresolved_questions: [],
  })
  spyOn(PlannerService, "initial").mockResolvedValue({
    summary: "Implement feature",
    prompt: "Do the work",
    metadata: {
      strategy: "initial",
      steps: ["Implement the requested change"],
      clarification: undefined,
      spec_analysis: undefined,
    },
  })
  spyOn(PlannerService, "replan").mockResolvedValue({
    summary: "Implement feature replan",
    prompt: "Do the work",
    metadata: {
      strategy: "replan",
      steps: ["Implement the requested change"],
      clarification: undefined,
      spec_analysis: undefined,
    },
  })
}

async function run(name: string, fn: () => Promise<Record<string, unknown> | void>) {
  const startedAt = Date.now()
  try {
    const detail = await fn()
    steps.push({
      name,
      ok: true,
      duration_ms: Date.now() - startedAt,
      ...(detail ? { detail } : {}),
    })
  } catch (error) {
    steps.push({
      name,
      ok: false,
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function json(response: Response) {
  return response.json().catch(async () => ({ text: await response.text().catch(() => "") }))
}
