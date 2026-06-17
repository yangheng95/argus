import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function writeFixturePlugin(root: string) {
  const pluginDir = path.join(root, ".opencorvus", "plugin")
  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    path.join(pluginDir, "service.ts"),
    `
      export const FixturePlugin = async () => ({
        service: async () => {
          const app = {
            fetch: async (request) => {
              const url = new URL(request.url)
              return Response.json({
                path: url.pathname,
                query: url.searchParams.get("x"),
                header: request.headers.get("x-fixture"),
                body: await request.json(),
              })
            },
          }
          return { id: "fixture", app }
        },
      })
    `,
  )
}

async function writePlugin(root: string, name: string, source: string) {
  const pluginDir = path.join(root, ".opencorvus", "plugin")
  await mkdir(pluginDir, { recursive: true })
  await writeFile(path.join(pluginDir, name), source)
}

describe("plugin service routes", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("dispatches project-scoped plugin service requests with rewritten path", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFixturePlugin(dir)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.App().request("/plugin/fixture/ping?x=1", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-fixture": "seen",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ ok: true }),
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
          path: "/ping",
          query: "1",
          header: "seen",
          body: { ok: true },
        })
      },
    })
  }, 30_000)

  test("rewrites plugin service IDs that overlap the route prefix exactly", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writePlugin(
          dir,
          "prefix-overlap.ts",
          `
            export const PrefixOverlapPlugin = async () => ({
              service: async () => ({
                id: "plug",
                app: {
                  fetch: async (request) => {
                    const url = new URL(request.url)
                    return Response.json({
                      path: url.pathname,
                      method: request.method,
                      query: url.searchParams.get("x"),
                      header: request.headers.get("x-fixture"),
                      body: await request.json(),
                    })
                  },
                },
              }),
            })
          `,
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.App().request("/plugin/plug/ping?x=1", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-fixture": "seen",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ ok: true }),
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
          path: "/ping",
          method: "POST",
          query: "1",
          header: "seen",
          body: { ok: true },
        })
      },
    })
  }, 30_000)

  test("requires project directory before plugin dispatch", async () => {
    const response = await Server.App().request("/plugin/fixture/ping", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ ok: true }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      name: "DirectoryRequiredError",
    })
  }, 30_000)

  test("returns named 404 for unknown plugin service", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.App().request("/plugin/missing/ping", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(404)
        expect(await response.json()).toMatchObject({
          name: "PluginServiceNotFoundError",
          data: {
            serviceID: "missing",
          },
        })
      },
    })
  }, 30_000)

  test("loads a generic service from a plugin manifest", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writePlugin(
          dir,
          "manifest-service.plugin.json",
          JSON.stringify(
            {
              packageSpecifier: pathToFileURL(path.join(dir, ".opencorvus", "manifest-package")).href,
              serviceID: "manifest-service",
              backendExport: "./service.ts",
              overlayExport: "./overlay",
              resources: [],
            },
            null,
            2,
          ),
        )
        const packageDir = path.join(dir, ".opencorvus", "manifest-package")
        await mkdir(packageDir, { recursive: true })
        await writeFile(
          path.join(packageDir, "service.ts"),
          `
            export const ManifestService = async () => ({
              service: async () => ({
                id: "manifest-service",
                app: {
                  fetch: async (request) => {
                    const url = new URL(request.url)
                    return Response.json({ path: url.pathname, query: url.searchParams.get("x") })
                  },
                },
              }),
            })
          `,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.App().request("/plugin/manifest-service/ping?x=1", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ path: "/ping", query: "1" })
      },
    })
  }, 60_000)

  test("core plugin runtime does not import the coding-agent-tui implementation", () => {
    const source = readFileSync(path.resolve(import.meta.dir, "../../src/plugin/index.ts"), "utf8")
    expect(source).not.toContain("@opencorvus-ai/coding-agent-tui")
    expect(source).not.toContain("codingAgentTuiPlugin")
    expect(source).not.toContain("coding_agent_tui_target")
  })

  test("does not keep retired core tui routes", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const path of ["/tui/embed/status", "/tui/status", "/tui/runtime/start"]) {
          const response = await Server.App().request(path, {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          })
          expect(response.status).toBe(404)
        }
      },
    })
  }, 30_000)

  test("returns named 500 for duplicate plugin service id", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writePlugin(
          dir,
          "left.ts",
          'export const Left = async () => ({ service: async () => ({ id: "dupe", app: { fetch: async () => new Response("left") } }) })\n',
        )
        await writePlugin(
          dir,
          "right.ts",
          'export const Right = async () => ({ service: async () => ({ id: "dupe", app: { fetch: async () => new Response("right") } }) })\n',
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.App().request("/plugin/dupe/ping", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(500)
        expect(await response.json()).toMatchObject({
          name: "PluginServiceDuplicateIDError",
          data: {
            serviceID: "dupe",
          },
        })
      },
    })
  }, 30_000)

  test("returns named 500 for manifest plugin service registration failure", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencorvus", "plugin")
        await writePlugin(
          dir,
          "broken.ts",
          'export const Broken = async () => ({ service: async () => { throw new Error("registration failed visibly") } })\n',
        )
        await writePlugin(
          dir,
          "manifest-name-does-not-contain-service-id.plugin.json",
          JSON.stringify(
            {
              packageSpecifier: pathToFileURL(pluginDir).href,
              serviceID: "broken-service",
              backendExport: "./broken.ts",
              overlayExport: "./overlay",
              resources: [],
            },
            null,
            2,
          ),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.App().request("/plugin/broken-service/ping", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(500)
        expect(await response.json()).toMatchObject({
          name: "PluginServiceRegistrationError",
          data: {
            message: "registration failed visibly",
            serviceID: "broken-service",
            specifier: expect.stringContaining("manifest-name-does-not-contain-service-id.plugin.json"),
          },
        })
      },
    })
  }, 30_000)
})
