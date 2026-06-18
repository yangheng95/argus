import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

// What this pins
// ----------------
// PATCH /config used to validate only the top-level shape (record of
// arbitrary keys, RFC 7396 merge semantics). A malformed `provider[id]`
// — e.g. `models` typed as a string instead of a record — sailed past
// the validator, was deep-merged into the on-disk file, and only blew
// up on the next parseConfig pass. The user saw 200 OK + "saved
// successfully" and lost the provider on the next reload. This test
// pins the new contract: the provider sub-shape is enforced inside the
// handler, malformed entries return 400 with a human-readable error
// referencing the offending providerID + zod issue path.
describe("config PATCH provider sub-shape validation", () => {
  beforeEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
    Config.global.reset()
  })

  afterEach(async () => {
    Config.global.reset()
    await Instance.disposeAll()
    await resetDatabase()
  })

  async function patch(tmpPath: string, body: unknown) {
    const app = Server.App()
    return app.request("/config", {
      method: "PATCH",
      headers: {
        "x-opencorvus-directory": tmpPath,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  }

  test("well-formed provider passes through (happy path)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const res = await patch(tmp.path, {
          provider: {
            "my-provider": {
              name: "My Provider",
              api: "https://api.example.com/v1",
              models: { "gpt-x": { name: "GPT-X" } },
            },
          },
        })
        expect(res.status).toBe(200)
      },
    })
  })

  test("provider as non-object yields 400 with a readable error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const res = await patch(tmp.path, { provider: "this-is-not-an-object" })
        expect(res.status).toBe(400)
        const body = (await res.json()) as { error: string }
        expect(body.error).toMatch(/must be a record/i)
      },
    })
  })

  test("malformed provider entry yields 400 naming the providerID + zod issue", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const res = await patch(tmp.path, {
          provider: {
            broken: {
              name: 42, // name must be a string per ModelsDev.Provider
            },
          },
        })
        expect(res.status).toBe(400)
        const body = (await res.json()) as { error: string }
        expect(body.error).toContain("config.provider.broken")
        expect(body.error).toContain("name")
      },
    })
  })

  test("deprecated provider model status is rejected at the config boundary", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const res = await patch(tmp.path, {
          provider: {
            broken: {
              name: "Broken Provider",
              api: "https://api.example.com/v1",
              models: {
                retired: {
                  name: "Retired Model",
                  status: "deprecated",
                },
              },
            },
          },
        })
        expect(res.status).toBe(400)
        const body = (await res.json()) as { error: string }
        expect(body.error).toContain("config.provider.broken")
        expect(body.error).toContain("models.retired.status")
      },
    })
  })

  test("RFC 7396 null deletion of a previously-saved provider passes the validator", async () => {
    // Pin the validator's RFC 7396 contract specifically: the new sub-shape
    // check must NOT 400 a null-valued entry — that is the deletion sentinel
    // and the user-facing delete button relies on it. We add a provider first
    // so the deletion has something to remove, mirroring the real overlay
    // path (handleDelete is only ever reached on an existing entry).
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const addRes = await patch(tmp.path, {
          provider: {
            "to-be-removed": {
              name: "Temp",
              api: "https://api.example.com/v1",
              models: { m1: { name: "M1" } },
            },
          },
        })
        expect(addRes.status).toBe(200)

        const deleteRes = await patch(tmp.path, { provider: { "to-be-removed": null } })
        // The validator we added must not classify null as malformed; status
        // must not be 400. (Downstream Config.update may reasonably 200 or
        // 500 depending on merge specifics — this test pins only the
        // validator surface, not the merge layer.)
        expect(deleteRes.status).not.toBe(400)
      },
    })
  })
})
