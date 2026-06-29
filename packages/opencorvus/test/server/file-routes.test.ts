import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { pathToFileURL } from "url"
import { File } from "../../src/file"
import { Ripgrep } from "../../src/file/ripgrep"
import { LSP } from "../../src/lsp"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { createDirectoryAlias, tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function contentBase64(value: string | Buffer): string {
  return Buffer.from(value).toString("base64")
}

describe("file routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("GET /find propagates ripgrep search failures", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(Ripgrep, "search").mockRejectedValue(new Error("ripgrep backend unavailable"))
        const response = await Server.App().request(`/find?${new URLSearchParams({ pattern: "Route" })}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toMatchObject({
          name: "UnknownError",
          data: { message: "ripgrep backend unavailable" },
        })
      },
    })
  })

  test("GET /find/file propagates index failures and retries the next scan", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const files = spyOn(Ripgrep, "files")
        files.mockImplementation(async function* () {
          throw new Error("ripgrep file listing unavailable")
        })

        const failed = await Server.App().request(`/find/file?${new URLSearchParams({ query: "route" })}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(failed.status).toBe(500)
        await expect(failed.json()).resolves.toMatchObject({
          name: "UnknownError",
          data: { message: "ripgrep file listing unavailable" },
        })

        files.mockImplementation(async function* () {
          yield "src/route.ts"
        })

        const retried = await Server.App().request(`/find/file?${new URLSearchParams({ query: "route" })}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(retried.status).toBe(200)
        await expect(retried.json()).resolves.toEqual(["src/route.ts"])
      },
    })
  })

  test("GET /find/symbol returns LSP workspace symbols", async () => {
    await using tmp = await tmpdir({ git: true })
    const symbol = {
      name: "RouteSymbol",
      kind: 12,
      location: {
        uri: pathToFileURL(path.join(tmp.path, "src", "route.ts")).href,
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 13 },
        },
      },
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const workspaceSymbol = spyOn(LSP, "workspaceSymbol").mockResolvedValue([symbol])
        const response = await Server.App().request(`/find/symbol?${new URLSearchParams({ query: "Route" })}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        expect(workspaceSymbol).toHaveBeenCalledWith("Route")
        await expect(response.json()).resolves.toEqual([symbol])
      },
    })
  })

  test("GET /find/symbol propagates LSP workspace symbol failures", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(LSP, "workspaceSymbol").mockRejectedValue(new Error("lsp workspace symbol unavailable"))
        const response = await Server.App().request(`/find/symbol?${new URLSearchParams({ query: "Route" })}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toMatchObject({
          name: "UnknownError",
          data: { message: "lsp workspace symbol unavailable" },
        })
      },
    })
  })

  test("GET /file/content returns 404 for missing files", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.App().request(`/file/content?${new URLSearchParams({ path: "missing.md" })}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(404)
        await expect(response.json()).resolves.toMatchObject({ name: "FileNotFoundError" })
      },
    })
  })

  test("GET /file/content propagates read failures", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(File, "read").mockRejectedValue(new Error("content read denied"))
        const response = await Server.App().request(`/file/content?${new URLSearchParams({ path: "denied.md" })}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toMatchObject({
          name: "UnknownError",
          data: { message: "content read denied" },
        })
      },
    })
  })

  test("PATCH /file/content returns named errors for invalid write targets", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "archive.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04]))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const invalidPath = await app.request("/file/content", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ path: "../outside.txt", content: "escape" }),
        })
        const missing = await app.request("/file/content", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ path: "missing.md", content: "missing" }),
        })
        const binary = await app.request("/file/content", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ path: "archive.zip", content: "binary" }),
        })

        expect(invalidPath.status).toBe(400)
        await expect(invalidPath.json()).resolves.toMatchObject({ name: "FileInvalidPathError" })
        expect(missing.status).toBe(404)
        await expect(missing.json()).resolves.toMatchObject({ name: "FileNotFoundError" })
        expect(binary.status).toBe(400)
        await expect(binary.json()).resolves.toMatchObject({
          name: "FileInvalidPathError",
          data: { message: "Cannot edit binary file: archive.zip" },
        })
      },
    })
  })

  test("POST/PATCH/DELETE /file/item creates, moves, and deletes project file entries", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "docs"), { recursive: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const headers = {
          "content-type": "application/json",
          "x-opencorvus-directory": tmp.path,
        }

        const createResponse = await app.request("/file/item", {
          method: "POST",
          headers,
          body: JSON.stringify({
            path: "notes.md",
            type: "file",
            content: "route create",
          }),
        })

        expect(createResponse.status).toBe(200)
        await expect(createResponse.json()).resolves.toMatchObject({
          name: "notes.md",
          path: "notes.md",
          type: "file",
        })
        expect(await fs.readFile(path.join(tmp.path, "notes.md"), "utf-8")).toBe("route create")

        const moveResponse = await app.request("/file/item", {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            path: "notes.md",
            newPath: path.join("docs", "renamed.md"),
          }),
        })

        expect(moveResponse.status).toBe(200)
        await expect(moveResponse.json()).resolves.toMatchObject({
          previousPath: "notes.md",
          path: path.join("docs", "renamed.md"),
          node: {
            name: "renamed.md",
            path: path.join("docs", "renamed.md"),
            type: "file",
          },
        })
        await expect(fs.stat(path.join(tmp.path, "notes.md"))).rejects.toThrow()
        expect(await fs.readFile(path.join(tmp.path, "docs", "renamed.md"), "utf-8")).toBe("route create")

        const deleteResponse = await app.request(`/file/item?${new URLSearchParams({ path: "docs" })}`, {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(deleteResponse.status).toBe(200)
        await expect(deleteResponse.json()).resolves.toEqual({ path: "docs" })
        await expect(fs.stat(path.join(tmp.path, "docs"))).rejects.toThrow()
      },
    })
  })

  test("PATCH /file/item moves to a non-existing destination under a project path alias", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, ".nova-vibecoding-template"), { recursive: true })
    await fs.mkdir(path.join(tmp.path, ".agents"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, ".agents", "config.md"), "agent config", "utf-8")
    const alias = await createDirectoryAlias(tmp.path)

    try {
      await Instance.provide({
        directory: alias,
        fn: async () => {
          const response = await Server.App().request("/file/item", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": alias,
            },
            body: JSON.stringify({
              path: ".agents",
              newPath: path.join(".nova-vibecoding-template", ".agents"),
            }),
          })

          expect(response.status).toBe(200)
          await expect(response.json()).resolves.toMatchObject({
            previousPath: ".agents",
            path: path.join(".nova-vibecoding-template", ".agents"),
            node: {
              name: ".agents",
              type: "directory",
            },
          })
          expect(
            await fs.readFile(path.join(tmp.path, ".nova-vibecoding-template", ".agents", "config.md"), "utf-8"),
          ).toBe("agent config")
        },
      })
    } finally {
      await Instance.tryProvideActive({
        directory: alias,
        fn: () => Instance.dispose(),
      })
      await fs.rm(alias, { recursive: true, force: true })
    }
  })

  test("POST /file/item returns named 400 errors for invalid project paths", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/file/item", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            path: "../escape.txt",
            type: "file",
            content: "nope",
          }),
        })

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toMatchObject({ name: "FileInvalidPathError" })
      },
    })
  })

  test("DELETE /file/item returns named 404 errors for missing entries", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request(`/file/item?${new URLSearchParams({ path: "missing.md" })}`, {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(404)
        await expect(response.json()).resolves.toMatchObject({ name: "FileNotFoundError" })
      },
    })
  })

  test("PATCH /file/item returns named 409 errors for existing destinations", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "source.md"), "source", "utf-8")
    await fs.writeFile(path.join(tmp.path, "existing.md"), "existing", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/file/item", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            path: "source.md",
            newPath: "existing.md",
          }),
        })

        expect(response.status).toBe(409)
        await expect(response.json()).resolves.toMatchObject({ name: "FileConflictError" })
        expect(await fs.readFile(path.join(tmp.path, "source.md"), "utf-8")).toBe("source")
        expect(await fs.readFile(path.join(tmp.path, "existing.md"), "utf-8")).toBe("existing")
      },
    })
  })

  test("POST /file/upload writes dropped files through the project-scoped file API", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "docs"), { recursive: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/file/upload", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            targetDir: "docs",
            files: [{ name: "dropped.txt", contentBase64: contentBase64("route upload") }],
          }),
        })

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual([
          { name: "dropped.txt", path: path.join("docs", "dropped.txt"), bytes: 12 },
        ])
        expect(await fs.readFile(path.join(tmp.path, "docs", "dropped.txt"), "utf-8")).toBe("route upload")
      },
    })
  })

  test("POST /file/upload returns named 400 errors for invalid uploaded names", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/file/upload", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            targetDir: "",
            files: [{ name: "../escape.txt", contentBase64: contentBase64("nope") }],
          }),
        })

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toMatchObject({ name: "FileUploadInvalidNameError" })
      },
    })
  })

  test("POST /file/upload returns named 409 errors for existing destinations", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "README.md"), "existing", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/file/upload", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            targetDir: "",
            files: [{ name: "README.md", contentBase64: contentBase64("new") }],
          }),
        })

        expect(response.status).toBe(409)
        await expect(response.json()).resolves.toMatchObject({ name: "FileUploadConflictError" })
        expect(await fs.readFile(path.join(tmp.path, "README.md"), "utf-8")).toBe("existing")
      },
    })
  })
})
