import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")

async function repoFile(...parts: string[]) {
  return await readFile(path.join(ROOT, ...parts), "utf8")
}

describe("session config route contract", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("Session.mergeConfigOverlay is a transaction-local read/merge/write path", async () => {
    const source = await repoFile("packages", "opencorvus", "src", "session", "index.ts")
    const start = source.indexOf("export const mergeConfigOverlay")
    expect(start).toBeGreaterThan(0)
    const body = source.slice(start, source.indexOf("export const setArchived", start))

    expect(body).toContain("Database.transaction")
    expect(body).toContain("assertConfigurableRoot")
    expect(body).toContain("assertNoStoredConfigOverlayNull")
    expect(body).toContain("Config.Overlay.parse")
    expect(body).toContain("Config.mergeOverlay")
    expect(body).toContain("configOverlay: nextOverlay")
    expect(body).toContain("Bus.publish(Event.Updated")
    expect(body).toContain("Bus.publish(Event.ConfigChanged")
  })

  test("Session.mergeMetadata remains a shallow top-level metadata merge", async () => {
    const source = await repoFile("packages", "opencorvus", "src", "session", "index.ts")
    const start = source.indexOf("export const mergeMetadata")
    expect(start).toBeGreaterThan(0)
    const body = source.slice(start, source.indexOf("export const mergeConfigOverlay", start))

    expect(body).toContain("const next = { ...current, ...input.patch }")
    expect(body).not.toContain("Config.mergeOverlay")
  })

  test("session config routes use Config.Overlay for PATCH and return effective config with origin", async () => {
    const source = await repoFile("packages", "opencorvus", "src", "server", "routes", "session.ts")

    expect(source).toContain('"/:sessionID/config"')
    expect(source).toContain('operationId: "session.config.get"')
    expect(source).toContain('operationId: "session.config.update"')
    expect(source).toContain('validator("json", Config.Overlay)')
    expect(source).toContain("Session.assertConfigurableRoot(session)")
    expect(source).toContain("assertNoStoredNull(stored)")
    expect(source).toContain("Session.mergeConfigOverlay")
    expect(source).toContain("Provider.reset()")
    expect(source).toContain("Agent.reset()")
    expect(source).toContain("Config.mergeOverlay(base, overlay)")
    expect(source).toContain("origin: originTree(config, overlay)")
  })

  test("child sessions cannot own session config overlays", async () => {
    await using tmp = await tmpdir({ config: { model: "base/top" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ kind: "root", title: "root config owner" })
        const child = await Session.create({ kind: "build", parentID: root.id, title: "child config reject" })

        await expect(
          Session.mergeConfigOverlay({
            sessionID: child.id,
            patch: { model: "child/model" },
          }),
        ).rejects.toThrow("ChildSessionConfigError")
      },
    })
  })

  test("session config PATCH validates model refs before writing overlay", async () => {
    const source = await repoFile("packages", "opencorvus", "src", "server", "routes", "session.ts")
    const start = source.indexOf('operationId: "session.config.update"')
    expect(start).toBeGreaterThan(0)
    const returnIndex = source.indexOf("return c.json(await sessionConfig(sessionID))", start)
    const body = source.slice(start, returnIndex)

    expect(body).toContain('validateConfigModelReferences(patch, "configOverlay")')
    expect(body.indexOf("validateConfigModelReferences")).toBeLessThan(body.indexOf("Session.mergeConfigOverlay"))
    expect(body.indexOf("Session.mergeConfigOverlay")).toBeLessThan(body.indexOf("Provider.reset()"))
    expect(source.indexOf("Provider.reset()", start)).toBeLessThan(returnIndex)
  })

  test("session loop resolves the live overlay model instead of persisted user-message model", async () => {
    const source = await repoFile("packages", "opencorvus", "src", "session", "loop.ts")
    const start = source.indexOf("export const loop")
    expect(start).toBeGreaterThan(0)
    const body = source.slice(start, source.indexOf("const task = tasks.pop()", start))

    expect(body).toContain("resolveAgentModel(lastUser.agent, { sessionID })")
    expect(body).not.toContain("lastUser.model.providerID")
    expect(body).not.toContain("lastUser.model.modelID")
  })

  test("stored configOverlay cannot contain persisted null delete markers", async () => {
    await using tmp = await tmpdir({ config: { model: "base/top" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "corrupt stored overlay" })
        Database.use((db) =>
          db
            .update(SessionTable)
            .set({
              metadata: {
                configOverlay: {
                  model: "overlay/top",
                  agent: {
                    build: {
                      model: null,
                    },
                  },
                },
              },
            })
            .where(eq(SessionTable.id, session.id))
            .run(),
        )

        await expect(
          Session.mergeConfigOverlay({
            sessionID: session.id,
            patch: { prompt: { core: "override" } },
          }),
        ).rejects.toThrow("Stored session overlay contains a null")
      },
    })
  })

  test("SDK/OpenAPI generation points stay explicit", async () => {
    const sdkBuild = await repoFile("packages", "sdk", "js", "script", "build.ts")
    const sdkServer = await repoFile("packages", "sdk", "js", "src", "server.ts")
    const sdkIndex = await repoFile("packages", "sdk", "js", "src", "index.ts")
    const rootGenerate = await repoFile("script", "generate.ts")
    const routeCheck = await repoFile("packages", "opencorvus", "script", "check", "routes.ts")

    expect(sdkBuild).toContain("bun ./script/generate-openapi.ts")
    expect(sdkBuild).not.toContain("bun dev generate")
    expect(sdkBuild).toContain("createClient")
    expect(sdkServer).not.toContain("createOpenCorvusTui")
    expect(sdkServer).not.toContain("TuiOptions")
    expect(sdkIndex).not.toContain("createOpenCorvusTui")
    expect(sdkIndex).not.toContain("TuiOptions")
    expect(rootGenerate).toContain("packages/sdk/js/script/build.ts")
    expect(rootGenerate).toContain("bun ./script/generate-openapi.ts")
    expect(routeCheck).toContain("api:routes-check")
  })
})
