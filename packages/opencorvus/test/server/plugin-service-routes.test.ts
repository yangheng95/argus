import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
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
  })

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
  })

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
  })

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
  })

  test("returns named 500 for plugin service registration failure", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writePlugin(
          dir,
          "broken.ts",
          'export const Broken = async () => ({ service: async () => { throw new Error("registration failed visibly") } })\n',
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.App().request("/plugin/broken/ping", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(500)
        expect(await response.json()).toMatchObject({
          name: "PluginServiceRegistrationError",
          data: {
            message: "registration failed visibly",
          },
        })
      },
    })
  })
})
