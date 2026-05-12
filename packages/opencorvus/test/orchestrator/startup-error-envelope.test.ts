import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import path from "node:path"
import { Provider } from "../../src/provider/provider"
import { findTask } from "../../src/engine/store"
import { deriveTaskStatus } from "../../src/engine/task-status"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("Orchestrator startup error envelope", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("preserves NamedError data inside engine_task.error while keeping startup fast-fail", async () => {
    mock.module("@/agent/model", () => ({
      resolveAgentModel: async () => {
        throw new Provider.ModelNotFoundError({
          providerID: "missing-provider",
          modelID: "missing-model",
          suggestions: ["deepseek/deepseek-v4-pro"],
        })
      },
    }))

    const { Orchestrator, parseOrchestratorTaskErrorEnvelope } = await import("../../src/orchestrator/agent")
    await using tmp = await tmpdir({ config: { agent: {}, model: "deepseek/deepseek-v4-pro" } })
    const prevHome = process.env.OPENCORVUS_HOME
    const prevGlobalConfigDir = process.env.OPENCORVUS_GLOBAL_CONFIG_DIR
    const prevDisablePlugins = process.env.OPENCORVUS_DISABLE_DEFAULT_PLUGINS
    process.env.OPENCORVUS_HOME = path.join(tmp.path, ".opencorvus-home")
    process.env.OPENCORVUS_GLOBAL_CONFIG_DIR = path.join(tmp.path, ".opencorvus-home", "config")
    process.env.OPENCORVUS_DISABLE_DEFAULT_PLUGINS = "1"

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const now = Date.now()
          const taskID = Identifier.ascending("task")
          const root = await Session.create({ kind: "root", title: "Startup error task" })
          const prompt = spyOn(SessionPrompt, "prompt").mockImplementation(async () => {
            throw new Error("SessionPrompt.prompt must not run when model resolution fails")
          })

          Database.use((db) => {
            db.insert(EngineTaskTable).values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "Startup error task",
              request: "do work",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            }).run()
          })

          await Orchestrator.processTask(taskID)

          const task = findTask(taskID)
          expect(task).toBeDefined()
          expect(deriveTaskStatus(task!)).toBe("failed")
          expect(prompt).not.toHaveBeenCalled()
          expect(task!.error).toContain("missing-provider")
          const envelope = parseOrchestratorTaskErrorEnvelope(task!.error)
          expect(envelope).toEqual({
            errorName: "ProviderModelNotFoundError",
            message: expect.stringContaining("missing-provider"),
            data: {
              providerID: "missing-provider",
              modelID: "missing-model",
              suggestions: ["deepseek/deepseek-v4-pro"],
            },
          })
        },
      })
    } finally {
      if (prevHome === undefined) delete process.env.OPENCORVUS_HOME
      else process.env.OPENCORVUS_HOME = prevHome
      if (prevGlobalConfigDir === undefined) delete process.env.OPENCORVUS_GLOBAL_CONFIG_DIR
      else process.env.OPENCORVUS_GLOBAL_CONFIG_DIR = prevGlobalConfigDir
      if (prevDisablePlugins === undefined) delete process.env.OPENCORVUS_DISABLE_DEFAULT_PLUGINS
      else process.env.OPENCORVUS_DISABLE_DEFAULT_PLUGINS = prevDisablePlugins
    }
  })
})
