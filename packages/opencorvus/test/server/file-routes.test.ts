import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function contentBase64(value: string | Buffer): string {
  return Buffer.from(value).toString("base64")
}

describe("file routes", () => {
  afterEach(async () => {
    await resetDatabase()
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
