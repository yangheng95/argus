import path from "path"
import { mkdir } from "fs/promises"
import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const originalProjectDir = process.env.OPENCORVUS_PROJECT_DIR

describe("global project discovery", () => {
  afterEach(() => {
    if (originalProjectDir === undefined) delete process.env.OPENCORVUS_PROJECT_DIR
    else process.env.OPENCORVUS_PROJECT_DIR = originalProjectDir
  })

  test("GET /global/projects/discover scans launch root and direct children with .opencorvus", async () => {
    await using root = await tmpdir()
    const nested = path.join(root.path, "nested-project")
    const plain = path.join(root.path, "plain-folder")
    await mkdir(path.join(root.path, ".opencorvus"), { recursive: true })
    await mkdir(path.join(nested, ".opencorvus"), { recursive: true })
    await mkdir(path.join(plain, "src"), { recursive: true })
    process.env.OPENCORVUS_PROJECT_DIR = root.path

    const response = await Server.App().request("/global/projects/discover")

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      root: string
      projects: Array<{ directory: string; name: string; marker: string }>
    }
    expect(path.resolve(body.root)).toBe(path.resolve(root.path))
    expect(body.projects.map((project) => path.resolve(project.directory)).sort()).toEqual(
      [root.path, nested].map((item) => path.resolve(item)).sort(),
    )
    expect(body.projects.find((project) => path.resolve(project.directory) === path.resolve(plain))).toBeUndefined()
    expect(body.projects.every((project) => path.basename(project.marker) === ".opencorvus")).toBe(true)
  })
})
