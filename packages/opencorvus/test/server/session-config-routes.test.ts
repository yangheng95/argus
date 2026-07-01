import { afterEach, describe, expect, test } from "bun:test"
import { readFile } from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
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

  test("Session.mergeConfigOverlayInProject is a transaction-local project-scoped read/merge/write path", async () => {
    const source = await repoFile("packages", "opencorvus", "src", "session", "index.ts")
    const start = source.indexOf("export const mergeConfigOverlayInProject")
    expect(start).toBeGreaterThan(0)
    const body = source.slice(start, source.indexOf("export const mergeConfigOverlay =", start))

    expect(body).toContain("Database.transaction")
    expect(body).toContain("SessionTable.project_id")
    expect(body).toContain("assertConfigurableRoot")
    expect(body).toContain("assertNoStoredConfigOverlayNull")
    expect(body).toContain("Config.Overlay.parse")
    expect(body).toContain("Config.mergeOverlay")
    expect(body).toContain("configOverlay: nextOverlay")
    expect(body).toContain("Bus.publish(Event.Updated")
    expect(body).toContain("Bus.publish(Event.ConfigChanged")

    const wrapper = source.slice(
      source.indexOf("export const mergeConfigOverlay =", start),
      source.indexOf("export const setArchived", start),
    )
    expect(wrapper).toContain("projectID: Instance.project.id")
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
    expect(source).toContain("Session.getInProject({ sessionID, projectID })")
    expect(source).toContain("Session.assertConfigurableRoot(session)")
    expect(source).toContain("assertNoStoredNull(stored)")
    expect(source).toContain("Session.mergeConfigOverlayInProject")
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

  test("session config routes reject foreign project sessions before reading or writing overlays", async () => {
    await using one = await tmpdir({ git: true, config: { model: "opencorvus/auto" } })
    await using two = await tmpdir({ git: true, config: { model: "opencorvus/auto" } })
    const app = Server.App()
    let oneSessionID = ""
    let twoSessionID = ""

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        oneSessionID = (await Session.create({ kind: "root", title: "project a config owner" })).id
      },
    })
    await Instance.provide({
      directory: two.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "project b config owner" })
        twoSessionID = session.id
        await Session.mergeConfigOverlay({
          sessionID: twoSessionID,
          patch: { prompt: { core: "project-b/session" } },
        })
      },
    })

    const foreignGet = await app.request(`/session/${twoSessionID}/config`, {
      headers: {
        "x-opencorvus-directory": one.path,
      },
    })
    expect(foreignGet.status).toBe(404)
    expect(await foreignGet.text()).not.toContain("project-b/session")

    const foreignPatch = await app.request(`/session/${twoSessionID}/config`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": one.path,
      },
      body: JSON.stringify({ prompt: { core: "project-a/foreign-write" } }),
    })
    expect(foreignPatch.status).toBe(404)
    expect((await Session.get(twoSessionID)).metadata?.configOverlay).toMatchObject({
      prompt: { core: "project-b/session" },
    })

    const ownPatch = await app.request(`/session/${oneSessionID}/config`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": one.path,
      },
      body: JSON.stringify({ prompt: { core: "project-a/session" } }),
    })
    expect(ownPatch.status).toBe(200)
    const ownBody = (await ownPatch.json()) as {
      config: { prompt: { core: string } }
      origin: { prompt: { core: string } }
    }
    expect(ownBody.config.prompt.core).toBe("project-a/session")
    expect(ownBody.origin.prompt.core).toBe("session")
  }, 30_000)

  test("Session.mergeConfigOverlay rejects foreign sessions in the active project context", async () => {
    await using one = await tmpdir({ git: true, config: { model: "opencorvus/auto" } })
    await using two = await tmpdir({ git: true, config: { model: "opencorvus/auto" } })
    let twoSessionID = ""

    await Instance.provide({
      directory: two.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "project b service owner" })
        twoSessionID = session.id
        await Session.mergeConfigOverlay({
          sessionID: twoSessionID,
          patch: { prompt: { core: "project-b/session" } },
        })
      },
    })

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        await expect(
          Session.mergeConfigOverlay({
            sessionID: twoSessionID,
            patch: { prompt: { core: "project-a/foreign-service-write" } },
          }),
        ).rejects.toThrow("Session not found")
      },
    })

    expect((await Session.get(twoSessionID)).metadata?.configOverlay).toMatchObject({
      prompt: { core: "project-b/session" },
    })
  }, 30_000)

  test("session config PATCH validates model refs before writing overlay", async () => {
    const source = await repoFile("packages", "opencorvus", "src", "server", "routes", "session.ts")
    const start = source.indexOf('operationId: "session.config.update"')
    expect(start).toBeGreaterThan(0)
    const returnIndex = source.indexOf("return c.json(await sessionConfig({ sessionID, projectID }))", start)
    const body = source.slice(start, returnIndex)

    expect(body).toContain("await Session.getInProject({ sessionID, projectID })")
    expect(body).toContain('validateConfigModelReferences(patch, "configOverlay")')
    expect(body.indexOf("Session.getInProject")).toBeLessThan(body.indexOf("validateConfigModelReferences"))
    expect(body.indexOf("validateConfigModelReferences")).toBeLessThan(
      body.indexOf("Session.mergeConfigOverlayInProject"),
    )
    expect(body.indexOf("Session.mergeConfigOverlayInProject")).toBeLessThan(body.indexOf("Provider.reset()"))
    expect(source.indexOf("Provider.reset()", start)).toBeLessThan(returnIndex)
  })

  test("session loop resolves the live overlay model instead of persisted user-message model", async () => {
    const source = await repoFile("packages", "opencorvus", "src", "session", "loop.ts")
    const start = source.indexOf("export const loop")
    expect(start).toBeGreaterThan(0)
    const resolverIndex = source.indexOf("resolveAgentModel(lastUser.agent", start)
    expect(resolverIndex).toBeGreaterThan(0)
    const body = source.slice(resolverIndex, source.indexOf("}).catch", resolverIndex))

    expect(body).toContain("resolveAgentModel(lastUser.agent")
    expect(body).toContain("sessionID")
    expect(body).not.toContain("explicitModel")
    expect(body).not.toContain("lastUser.model.providerID")
    expect(body).not.toContain("lastUser.model.modelID")
  })

  test("ACP load_session reports live configured model instead of persisted user-message model", async () => {
    const source = await repoFile("packages", "opencorvus", "src", "acp", "agent.ts")
    const start = source.indexOf("async loadSession(params: LoadSessionRequest)")
    expect(start).toBeGreaterThan(0)
    const body = source.slice(start, source.indexOf("async newSession", start))

    expect(body).toContain("const model = await defaultModel(this.config, directory)")
    expect(body).toContain("await this.sessionManager.load(sessionId, params.cwd, params.mcpServers, model)")
    expect(body).not.toContain("result.models.currentModelId = `${lastUser.model")
    expect(body).not.toContain("this.sessionManager.setModel(sessionId")
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
    expect(rootGenerate).toContain("packages/opencorvus/script/docs/render-api-md.ts")
    expect(rootGenerate).toContain('import { GENERATED_ARTIFACT_PATHS } from "./generated-artifacts"')
    expect(rootGenerate).toContain("API_MDX_ARTIFACT_PATHS")
    expect(rootGenerate).toContain("prettierArtifactPaths")
    expect(rootGenerate).toContain(
      'Bun.spawn(["bun", "run", "prettier", "--ignore-unknown", "--write", ...prettierArtifactPaths]',
    )
    expect(rootGenerate).not.toContain("bun ./script/format.ts")
    expect(rootGenerate).not.toContain("--write .")
    expect(rootGenerate.indexOf("packages/sdk/js/script/build.ts")).toBeLessThan(
      rootGenerate.indexOf("packages/opencorvus/script/docs/render-api-md.ts"),
    )
    expect(rootGenerate.indexOf("packages/opencorvus/script/docs/render-api-md.ts")).toBeLessThan(
      rootGenerate.indexOf('Bun.spawn(["bun", "run", "prettier", "--ignore-unknown", "--write"'),
    )
    expect(rootGenerate).not.toContain("bun ./script/generate-openapi.ts")
    expect(routeCheck).toContain("api:routes-check")
  })
})
