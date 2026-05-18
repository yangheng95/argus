import { afterEach, describe, expect, test, mock } from "bun:test"
import { Config } from "../../src/config/config"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { SessionContext } from "../../src/session/context"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

// Phase 2 (spec §11.1/§13.1): single model resolver, monotone precedence
//   explicitModel > session overlay (agent.<name>.model > model)
//             > project base (agent.<name>.model > model) > throw
// Session overlay comes from the ambient SessionContext.

function withSession<R>(overlay: unknown, fn: () => R): R {
  return SessionContext.provide({ id: "s1", metadata: { configOverlay: overlay } } as never, fn)
}

describe("resolveAgentModelRef — single source + session overlay", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("explicitModel wins over everything (incl. session overlay)", async () => {
    await using tmp = await tmpdir()
    mock.module("../../src/config/config", () => ({
      Config: { ...Config, get: async () => ({ model: "base/m" }) as never },
    }))
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        withSession({ model: "p/overlay" }, async () => {
          const { resolveAgentModelRef } = await import("../../src/agent/model")
          const ref = await resolveAgentModelRef("coding", {
            explicitModel: { providerID: "exp", modelID: "x" },
          })
          expect(ref).toEqual({ providerID: "exp", modelID: "x" })
        }),
    })
  })

  test("session overlay agent.<name>.model beats overlay top-level and base", async () => {
    await using tmp = await tmpdir()
    mock.module("../../src/config/config", () => ({
      Config: { ...Config, get: async () => ({ model: "base/top" }) as never },
    }))
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        withSession({ model: "ov/top", agent: { coding: { model: "ov/coding" } } }, async () => {
          const { resolveAgentModelRef } = await import("../../src/agent/model")
          const ref = await resolveAgentModelRef("coding")
          expect(ref).toEqual({ providerID: "ov", modelID: "coding" })
        }),
    })
  })

  test("no session: falls to project base (no overlay, no fallback default)", async () => {
    await using tmp = await tmpdir()
    mock.module("../../src/config/config", () => ({
      Config: { ...Config, get: async () => ({ model: "base/top" }) as never },
    }))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { resolveConfiguredModelRef } = await import("../../src/agent/model")
        expect(SessionContext.tryUse()).toBeUndefined()
        expect(await resolveConfiguredModelRef()).toEqual({ providerID: "base", modelID: "top" })
      },
    })
  })

  test("sessionID option resolves session overlay without ambient SessionContext", async () => {
    await using tmp = await tmpdir({ config: { model: "base/top" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "sessionID overlay" })
        await Session.mergeConfigOverlay({
          sessionID: session.id,
          patch: { model: "sid/top", agent: { coding: { model: "sid/coding" } } },
        })

        const { resolveAgentModelRef, resolveConfiguredModelRef } = await import("../../src/agent/model")
        expect(SessionContext.tryUse()).toBeUndefined()
        await expect(resolveAgentModelRef("coding", { sessionID: session.id })).resolves.toEqual({
          providerID: "sid",
          modelID: "coding",
        })
        await expect(resolveConfiguredModelRef({ sessionID: session.id })).resolves.toEqual({
          providerID: "sid",
          modelID: "top",
        })
      },
    })
  })

  test("taskID option resolves through task.session_id without ambient SessionContext", async () => {
    await using tmp = await tmpdir({ config: { model: "base/top" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "task overlay" })
        await Session.mergeConfigOverlay({
          sessionID: session.id,
          patch: { model: "task/top", agent: { coding: { model: "task/coding" } } },
        })
        const taskID = "task-model-overlay"
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: session.id,
              title: "task overlay",
              request: "task overlay",
            })
            .run(),
        )

        const { resolveAgentModelRef, resolveConfiguredModelRef } = await import("../../src/agent/model")
        expect(SessionContext.tryUse()).toBeUndefined()
        await expect(resolveAgentModelRef("coding", { taskID })).resolves.toEqual({
          providerID: "task",
          modelID: "coding",
        })
        await expect(resolveConfiguredModelRef({ taskID })).resolves.toEqual({
          providerID: "task",
          modelID: "top",
        })
      },
    })
  })

  test("no model anywhere → MissingModelConfigError (no DEFAULT_MODEL / history fallback)", async () => {
    await using tmp = await tmpdir()
    mock.module("../../src/config/config", () => ({
      Config: { ...Config, get: async () => ({}) as never },
    }))
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        withSession(undefined, async () => {
          const { resolveConfiguredModelRef } = await import("../../src/agent/model")
          await expect(resolveConfiguredModelRef()).rejects.toThrow("MissingModelConfigError")
        }),
    })
  })
})
