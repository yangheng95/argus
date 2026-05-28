import { afterEach, describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { EffectiveConfig } from "../../src/config/effective"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("task config isolation", () => {
  afterEach(async () => {
    Agent.resetAll()
    Provider.resetAll()
    await resetDatabase()
  })

  test("task model resolution reads the task root config snapshot, not the live project config", async () => {
    await using tmp = await tmpdir({ config: { model: "live/project" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "isolated config" })
        await Session.mergeMetadata({
          sessionID: session.id,
          patch: {
            [EffectiveConfig.TASK_SNAPSHOT_KEY]: {
              model: "task/snapshot",
            },
          },
        })
        const taskID = "task-config-snapshot"
        Database.use((db) =>
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: session.id,
              title: "isolated config",
              request: "isolated config",
            })
            .run(),
        )

        const { resolveConfiguredModelRef } = await import("../../src/agent/model")
        await expect(resolveConfiguredModelRef({ taskID })).resolves.toEqual({
          providerID: "task",
          modelID: "snapshot",
        })
      },
    })
  })

  test("agent config resolves from the task root snapshot", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "isolated agent config" })
        await Session.mergeMetadata({
          sessionID: session.id,
          patch: {
            [EffectiveConfig.TASK_SNAPSHOT_KEY]: {
              agent: {
                coding: {
                  prompt: "task snapshot prompt",
                },
              },
            },
          },
        })
        const taskID = "task-agent-config-snapshot"
        Database.use((db) =>
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: session.id,
              title: "isolated agent config",
              request: "isolated agent config",
            })
            .run(),
        )

        const scoped = await Agent.get("coding", { config: await EffectiveConfig.effective({ taskID }) })

        expect(scoped.prompt).toBe("task snapshot prompt")
      },
    })
  })

  test("provider registry can be resolved from an explicit task config without using project cache", async () => {
    const provider = (authorization: string, apiModelID = "model") => ({
      name: "Isolated Provider",
      npm: "@ai-sdk/openai-compatible",
      api: "https://example.invalid/v1",
      env: [],
      options: {
        headers: {
          Authorization: authorization,
        },
      },
      models: {
        model: {
          id: apiModelID,
          name: "Isolated Model",
          release_date: "2026-05-27",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 128000, output: 8192 },
          options: {},
        },
      },
    })
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskConfig = {
          provider: {
            isolated: provider("Bearer task-local"),
          },
        } as never

        const scoped = await Provider.getProvider("isolated", { config: taskConfig })
        const live = await Provider.getProvider("isolated")

        expect(scoped.options.headers.Authorization).toBe("Bearer task-local")
        expect(live).toBeUndefined()
      },
    })
  }, 15_000)

  test("provider language model is canonicalized through the explicit task config", async () => {
    const provider = (apiModelID: string) => ({
      name: "Canonical Provider",
      npm: "@ai-sdk/openai-compatible",
      api: "https://example.invalid/v1",
      env: [],
      options: {},
      models: {
        model: {
          id: apiModelID,
          name: "Canonical Model",
          release_date: "2026-05-27",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 128000, output: 8192 },
          options: {},
        },
      },
    })
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const liveConfig = { provider: { canonical: provider("live-api-model") } } as never
        const taskConfig = { provider: { canonical: provider("task-api-model") } } as never
        const liveModel = await Provider.getModel("canonical", "model", { config: liveConfig })
        const language = await Provider.getLanguage(liveModel, { config: taskConfig })

        expect((language as unknown as { modelId: string }).modelId).toBe("task-api-model")
      },
    })
  }, 15_000)
})
