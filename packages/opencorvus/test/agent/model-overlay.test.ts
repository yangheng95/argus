import { afterEach, describe, expect, test, mock } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { SessionContext } from "../../src/session/context"
import { tmpdir } from "../fixture/fixture"

// Phase 2 (spec §11.1/§13.1): single model resolver, monotone precedence
//   explicitModel > session overlay (agent.<name>.model > model)
//             > project base (agent.<name>.model > model) > throw
// Session overlay comes from the ambient SessionContext.

function withSession<R>(overlay: unknown, fn: () => R): R {
  return SessionContext.provide({ id: "s1", metadata: { configOverlay: overlay } } as never, fn)
}

describe("resolveAgentModelRef — single source + session overlay", () => {
  afterEach(() => mock.restore())

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
