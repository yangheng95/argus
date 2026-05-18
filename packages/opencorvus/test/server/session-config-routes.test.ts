import { describe, expect, test } from "bun:test"
import { readFile } from "fs/promises"
import path from "path"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")

async function repoFile(...parts: string[]) {
  return await readFile(path.join(ROOT, ...parts), "utf8")
}

describe("session config route contract", () => {
  test("Session.mergeConfigOverlay is a transaction-local read/merge/write path", async () => {
    const source = await repoFile("packages", "opencorvus", "src", "session", "index.ts")
    const start = source.indexOf("export const mergeConfigOverlay")
    expect(start).toBeGreaterThan(0)
    const body = source.slice(start, source.indexOf("export const setArchived", start))

    expect(body).toContain("Database.transaction")
    expect(body).toContain("Config.Overlay.parse")
    expect(body).toContain("Config.mergeOverlay")
    expect(body).toContain("configOverlay: nextOverlay")
    expect(body).toContain("Bus.publish(Event.Updated")
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
    expect(source).toContain("validator(\"json\", Config.Overlay)")
    expect(source).toContain("Session.mergeConfigOverlay")
    expect(source).toContain("Config.mergeOverlay(base, overlay)")
    expect(source).toContain("origin: originTree(config, overlay)")
  })

  test("SDK/OpenAPI generation points stay explicit", async () => {
    const sdkBuild = await repoFile("packages", "sdk", "js", "script", "build.ts")
    const rootGenerate = await repoFile("script", "generate.ts")
    const routeCheck = await repoFile("packages", "opencorvus", "script", "check", "routes.ts")

    expect(sdkBuild).toContain("bun dev generate")
    expect(sdkBuild).toContain("createClient")
    expect(rootGenerate).toContain("packages/sdk/js/script/build.ts")
    expect(routeCheck).toContain("api:routes-check")
  })
})
