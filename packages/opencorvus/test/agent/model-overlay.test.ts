import { afterEach, describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { SessionContext } from "../../src/session/context"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import fs from "node:fs/promises"
import path from "node:path"

// Phase 2 (spec §11.1/§13.1): single model resolver, monotone precedence
//   explicitModel > session overlay (agent.<name>.model > model)
//             > project base (agent.<name>.model > model) > throw
// Session overlay comes from the ambient SessionContext.

function withSession<R>(overlay: unknown, fn: () => R): R {
  return SessionContext.provide({ id: "s1", metadata: { configOverlay: overlay } } as never, fn)
}

describe("resolveAgentModelRef — single source + session overlay", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("child worktree session resolves project base config from the root session directory", async () => {
    await using tmp = await tmpdir({ config: { model: "root/base", agent: { compaction: { model: "root/compact" } } } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ kind: "root", title: "root config base" })
        const worktree = path.join(tmp.path, ".opencorvus", "worktrees", "goal-child")
        await fs.mkdir(worktree, { recursive: true })
        const child = await Session.createNext({
          kind: "build",
          parentID: root.id,
          title: "child worktree",
          directory: worktree,
        })

        const { resolveAgentModelRef, resolveConfiguredModelRef } = await import("../../src/agent/model")
        await Instance.provide({
          directory: worktree,
          fn: async () => {
            await expect(resolveAgentModelRef("compaction", { sessionID: child.id })).resolves.toEqual({
              providerID: "root",
              modelID: "compact",
            })
            await expect(resolveConfiguredModelRef({ sessionID: child.id })).resolves.toEqual({
              providerID: "root",
              modelID: "base",
            })
          },
        })
      },
    })
  })

  test("explicitModel wins over everything (incl. session overlay)", async () => {
    await using tmp = await tmpdir({ config: { model: "base/m" } })
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
    await using tmp = await tmpdir({ config: { model: "base/top" } })
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
    await using tmp = await tmpdir({ config: { model: "base/top" } })
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

  test("explicit taskID root overlay wins over ambient child session context", async () => {
    await using tmp = await tmpdir({ config: { model: "base/top" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskRoot = await Session.create({ kind: "root", title: "task root overlay" })
        await Session.mergeConfigOverlay({
          sessionID: taskRoot.id,
          patch: { model: "task/top" },
        })
        const ambientRoot = await Session.create({ kind: "root", title: "ambient root overlay" })
        await Session.mergeConfigOverlay({
          sessionID: ambientRoot.id,
          patch: { model: "ambient/top" },
        })
        const ambientChild = await Session.create({
          kind: "build",
          parentID: ambientRoot.id,
          title: "ambient child",
        })
        const taskID = "task-model-overlay-ambient-precedence"
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: taskRoot.id,
              title: "task overlay",
              request: "task overlay",
            })
            .run(),
        )

        const { resolveConfiguredModelRef } = await import("../../src/agent/model")
        const ref = await SessionContext.provide(ambientChild, () => resolveConfiguredModelRef({ taskID }))
        expect(ref).toEqual({ providerID: "task", modelID: "top" })
      },
    })
  })

  test("taskID with null task.session_id is a hard error, not project-base fallback", async () => {
    await using tmp = await tmpdir({ config: { model: "base/top" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = "task-model-overlay-null-session"
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: null,
              title: "orphaned task",
              request: "orphaned task",
            })
            .run(),
        )

        const { resolveConfiguredModelRef } = await import("../../src/agent/model")
        await expect(resolveConfiguredModelRef({ taskID })).rejects.toThrow("engine_task.session_id is null")
      },
    })
  })

  test("taskID and sessionID reject only when they resolve to different roots", async () => {
    await using tmp = await tmpdir({ config: { model: "base/top" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskRoot = await Session.create({ kind: "root", title: "task root overlay" })
        await Session.mergeConfigOverlay({ sessionID: taskRoot.id, patch: { model: "task/top" } })
        const otherRoot = await Session.create({ kind: "root", title: "other root overlay" })
        const otherChild = await Session.create({
          kind: "build",
          parentID: otherRoot.id,
          title: "other child",
        })
        const taskID = "task-model-overlay-conflicting-session"
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: taskRoot.id,
              title: "task overlay",
              request: "task overlay",
            })
            .run(),
        )

        const { resolveConfiguredModelRef } = await import("../../src/agent/model")
        await expect(resolveConfiguredModelRef({ taskID, sessionID: taskRoot.id })).resolves.toEqual({
          providerID: "task",
          modelID: "top",
        })
        await expect(resolveConfiguredModelRef({ taskID, sessionID: otherChild.id })).rejects.toThrow(
          "Contradictory model-resolution inputs",
        )
      },
    })
  })

  test("no model anywhere → MissingModelConfigError (no DEFAULT_MODEL / history fallback)", async () => {
    await using tmp = await tmpdir()
    await using globalConfig = await tmpdir()
    const previousGlobalConfigDir = process.env.OPENCORVUS_GLOBAL_CONFIG_DIR
    process.env.OPENCORVUS_GLOBAL_CONFIG_DIR = globalConfig.path
    Config.global.reset()
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        withSession(undefined, async () => {
          try {
            Config.global.reset()
            await Config.state.reset()
            const { resolveConfiguredModelRef } = await import("../../src/agent/model")
            await expect(resolveConfiguredModelRef()).rejects.toThrow("MissingModelConfigError")
          } finally {
            if (previousGlobalConfigDir === undefined) delete process.env.OPENCORVUS_GLOBAL_CONFIG_DIR
            else process.env.OPENCORVUS_GLOBAL_CONFIG_DIR = previousGlobalConfigDir
            Config.global.reset()
            await Config.state.reset()
          }
        }),
    })
  })
})
